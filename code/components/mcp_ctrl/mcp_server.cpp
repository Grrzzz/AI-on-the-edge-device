#include "mcp_server.h"

#include <cstring>
#include <strings.h>
#include <string>
#include <vector>

#include <cJSON.h>
#include <esp_heap_caps.h>
#include <esp_http_client.h>
#include <esp_log.h>
#include <esp_random.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <mbedtls/base64.h>
#include <psa/crypto.h>
#include <nvs.h>

#include "ClassLogFile.h"
#include "configClass.h"
#include "http_auth.h"

static const char *TAG = "MCP";

namespace {

constexpr const char *NVS_NAMESPACE = "mcp";
constexpr size_t MAX_BODY = 300 * 1024;       // request body (image uploads as base64)
constexpr size_t MAX_RESPONSE = 220 * 1024;   // answer of a REST call
constexpr size_t MAX_TEXT = 30 * 1024;        // text that is handed to the client
constexpr int MCP_TASK_STACK = 10240;

bool mcpEnabled = false;
bool mcpAllowSystem = false;
char mcpTokenHash[65] = {};
volatile bool mcpBusy = false; // one request at a time: the device has little memory

/* ======================================================================== */
/* NVS                                                                       */
/* ======================================================================== */
void nvsRead(const char *key, char *out, size_t len)
{
    out[0] = '\0';
    nvs_handle_t h;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &h) != ESP_OK) {
        return;
    }
    size_t l = len;
    if (nvs_get_str(h, key, out, &l) != ESP_OK) {
        out[0] = '\0';
    }
    nvs_close(h);
}

void nvsWrite(const char *key, const char *value)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &h) != ESP_OK) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "NVS open failed");
        return;
    }
    nvs_set_str(h, key, value);
    nvs_commit(h);
    nvs_close(h);
}

/* ======================================================================== */
/* Token                                                                     */
/* ======================================================================== */
std::string toHex(const unsigned char *data, size_t len)
{
    static const char *digits = "0123456789abcdef";
    std::string out;
    out.reserve(len * 2);
    for (size_t i = 0; i < len; i++) {
        out += digits[data[i] >> 4];
        out += digits[data[i] & 15];
    }
    return out;
}

std::string sha256Hex(const std::string &in)
{
    unsigned char hash[32];
    size_t hashLen = 0;
    psa_crypto_init(); // mbedTLS 4: hashing runs through the PSA API (idempotent)
    if (psa_hash_compute(PSA_ALG_SHA_256, reinterpret_cast<const unsigned char *>(in.data()), in.size(), hash, sizeof(hash), &hashLen) !=
            PSA_SUCCESS ||
        hashLen != sizeof(hash)) {
        return "";
    }
    return toHex(hash, sizeof(hash));
}

bool constTimeEqual(const char *a, const char *b, size_t len)
{
    unsigned char diff = 0;
    for (size_t i = 0; i < len; i++) {
        diff |= static_cast<unsigned char>(a[i]) ^ static_cast<unsigned char>(b[i]);
    }
    return diff == 0;
}

/// New random token (32 bytes from the hardware random generator, hex). Only its hash is stored.
std::string generateToken()
{
    unsigned char raw[32];
    esp_fill_random(raw, sizeof(raw));
    const std::string token = toHex(raw, sizeof(raw));
    const std::string hash = sha256Hex(token);
    if (hash.size() != 64) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Token hash failed");
        return "";
    }
    strlcpy(mcpTokenHash, hash.c_str(), sizeof(mcpTokenHash));
    nvsWrite("hash", mcpTokenHash);
    return token;
}

bool bearerValid(httpd_req_t *req)
{
    if (mcpTokenHash[0] == '\0') {
        return false;
    }
    char header[160];
    const size_t len = httpd_req_get_hdr_value_len(req, "Authorization");
    if (len == 0 || len >= sizeof(header)) {
        return false;
    }
    if (httpd_req_get_hdr_value_str(req, "Authorization", header, sizeof(header)) != ESP_OK) {
        return false;
    }
    if (strncmp(header, "Bearer ", 7) != 0) {
        return false;
    }
    const std::string hash = sha256Hex(header + 7);
    return hash.size() == strlen(mcpTokenHash) && constTimeEqual(hash.c_str(), mcpTokenHash, hash.size());
}

/* ======================================================================== */
/* Text helpers                                                              */
/* ======================================================================== */
/// Valid UTF-8 for the JSON answer (logs can contain anything)
std::string sanitizeText(const char *s, size_t len)
{
    std::string out;
    out.reserve(len);
    for (size_t i = 0; i < len;) {
        const unsigned char c = static_cast<unsigned char>(s[i]);
        size_t n = 0;
        if (c < 0x80) {
            out += (c >= 0x20 || c == '\n' || c == '\t') ? static_cast<char>(c) : ' ';
            i++;
            continue;
        }
        if ((c & 0xE0) == 0xC0) n = 2;
        else if ((c & 0xF0) == 0xE0) n = 3;
        else if ((c & 0xF8) == 0xF0) n = 4;
        bool ok = n > 0 && i + n <= len;
        for (size_t k = 1; ok && k < n; k++) {
            ok = (static_cast<unsigned char>(s[i + k]) & 0xC0) == 0x80;
        }
        if (ok) {
            out.append(s + i, n);
            i += n;
        }
        else {
            out += '?';
            i++;
        }
    }
    return out;
}

std::string jsonString(const std::string &s)
{
    cJSON *item = cJSON_CreateString(s.c_str());
    char *printed = cJSON_PrintUnformatted(item);
    std::string out = printed ? printed : "\"\"";
    cJSON_free(printed);
    cJSON_Delete(item);
    return out;
}

/* ======================================================================== */
/* Loopback REST call                                                        */
/* ======================================================================== */
struct HttpResult {
    int status = 0;
    char *data = nullptr;
    size_t len = 0;
    size_t cap = 0;
    bool truncated = false;
    std::string contentType;
    std::string reloadCode;

    ~HttpResult() { free(data); }

    bool append(const char *p, size_t n)
    {
        if (len + n > MAX_RESPONSE) {
            truncated = true;
            return true;
        }
        if (len + n + 1 > cap) {
            size_t newCap = cap ? cap * 2 : 4096;
            while (newCap < len + n + 1) newCap *= 2;
            char *grown = static_cast<char *>(heap_caps_realloc(data, newCap, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
            if (!grown) {
                grown = static_cast<char *>(realloc(data, newCap));
            }
            if (!grown) {
                return false;
            }
            data = grown;
            cap = newCap;
        }
        memcpy(data + len, p, n);
        len += n;
        data[len] = '\0';
        return true;
    }
};

esp_err_t httpEvent(esp_http_client_event_t *e)
{
    auto *r = static_cast<HttpResult *>(e->user_data);
    if (e->event_id == HTTP_EVENT_ON_DATA && e->data_len > 0) {
        r->append(static_cast<const char *>(e->data), e->data_len);
    }
    else if (e->event_id == HTTP_EVENT_ON_HEADER && e->header_key && e->header_value) {
        if (strcasecmp(e->header_key, "Content-Type") == 0) {
            r->contentType = e->header_value;
        }
        else if (strcasecmp(e->header_key, "X-Reload-Code") == 0) {
            r->reloadCode = e->header_value;
        }
    }
    return ESP_OK;
}

std::string basicAuthHeader()
{
    const auto &auth = ConfigClass::getInstance()->get()->sectionWebUi.httpAuth;
    if (auth.authMode == HTTP_AUTH_DISABLED) {
        return "";
    }
    const std::string plain = auth.username + ":" + auth.password;
    unsigned char enc[256];
    size_t olen = 0;
    if (mbedtls_base64_encode(enc, sizeof(enc), &olen, reinterpret_cast<const unsigned char *>(plain.data()), plain.size()) != 0) {
        return "";
    }
    return "Basic " + std::string(reinterpret_cast<char *>(enc), olen);
}

/// The tools use the REST endpoints of this device: the same behavior and the same checks as the WebUI
bool httpCall(esp_http_client_method_t method, const std::string &path, const char *body, size_t bodyLen, const char *contentType,
              HttpResult &r)
{
    const std::string url = "http://127.0.0.1" + path;
    esp_http_client_config_t cfg = {};
    cfg.url = url.c_str();
    cfg.method = method;
    cfg.event_handler = httpEvent;
    cfg.user_data = &r;
    cfg.timeout_ms = 60000;
    cfg.disable_auto_redirect = true;
    cfg.buffer_size = 1024;
    cfg.buffer_size_tx = 1024;

    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        return false;
    }
    const std::string auth = basicAuthHeader();
    if (!auth.empty()) {
        esp_http_client_set_header(client, "Authorization", auth.c_str());
    }
    if (body) {
        esp_http_client_set_header(client, "Content-Type", contentType ? contentType : "application/json");
        esp_http_client_set_post_field(client, body, static_cast<int>(bodyLen));
    }
    const esp_err_t err = esp_http_client_perform(client);
    r.status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    return err == ESP_OK;
}

bool httpGet(const std::string &path, HttpResult &r)
{
    return httpCall(HTTP_METHOD_GET, path, nullptr, 0, nullptr, r);
}

bool httpPost(const std::string &path, const std::string &body, HttpResult &r, const char *contentType = "application/json")
{
    return httpCall(HTTP_METHOD_POST, path, body.c_str(), body.size(), contentType, r);
}

/* ======================================================================== */
/* Tool plumbing                                                             */
/* ======================================================================== */
struct Out {
    std::vector<std::string> items; // serialized content items
    bool isError = false;

    void text(const std::string &t)
    {
        const std::string clean = sanitizeText(t.c_str(), t.size() > MAX_TEXT ? MAX_TEXT : t.size());
        std::string s = "{\"type\":\"text\",\"text\":" + jsonString(clean + (t.size() > MAX_TEXT ? "\n[cut]" : "")) + "}";
        items.push_back(std::move(s));
    }
    void fail(const std::string &t)
    {
        isError = true;
        text(t);
    }
    void image(const unsigned char *data, size_t len, const char *mime)
    {
        size_t olen = 0;
        mbedtls_base64_encode(nullptr, 0, &olen, data, len);
        char *b64 = static_cast<char *>(heap_caps_malloc(olen + 1, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
        if (!b64) {
            fail("Out of memory for the image");
            return;
        }
        size_t written = 0;
        mbedtls_base64_encode(reinterpret_cast<unsigned char *>(b64), olen, &written, data, len);
        std::string s = "{\"type\":\"image\",\"mimeType\":\"";
        s += mime;
        s += "\",\"data\":\"";
        s.append(b64, written);
        s += "\"}";
        free(b64);
        items.push_back(std::move(s));
    }
};

using ToolFn = void (*)(cJSON *args, Out &out);

struct Tool {
    const char *name;
    const char *description;
    const char *properties; // JSON object of the input properties
    const char *required;   // JSON array of required property names
    bool system;            // needs "System actions" (MCP page)
    ToolFn fn;
};

std::string argStr(cJSON *args, const char *key, const char *def = "")
{
    cJSON *it = args ? cJSON_GetObjectItem(args, key) : nullptr;
    return cJSON_IsString(it) && it->valuestring ? it->valuestring : def;
}

double argNum(cJSON *args, const char *key, double def)
{
    cJSON *it = args ? cJSON_GetObjectItem(args, key) : nullptr;
    return cJSON_IsNumber(it) ? it->valuedouble : def;
}

bool argBool(cJSON *args, const char *key, bool def)
{
    cJSON *it = args ? cJSON_GetObjectItem(args, key) : nullptr;
    return cJSON_IsBool(it) ? cJSON_IsTrue(it) : def;
}

/// SD card path: absolute, no '..', no characters that need URL encoding
bool pathValid(const std::string &p)
{
    if (p.size() < 2 || p.size() > 200 || p[0] != '/' || p.find("..") != std::string::npos) {
        return false;
    }
    for (const char c : p) {
        if (c <= ' ' || c == '?' || c == '#' || c == '%' || c == '\\' || c == '"' || c == '&' || c == '+') {
            return false;
        }
    }
    return true;
}

std::string restText(HttpResult &r)
{
    return r.data ? std::string(r.data, r.len) : std::string();
}

/// Passes a REST answer on: JSON text for 2xx, an error with the answer otherwise
void passOn(HttpResult &r, bool ok, Out &out)
{
    if (!ok) {
        out.fail("The device did not answer the internal request");
        return;
    }
    if (r.status >= 200 && r.status < 300) {
        out.text(restText(r) + (r.truncated ? "\n[answer cut]" : ""));
    }
    else {
        out.fail("Request failed (HTTP " + std::to_string(r.status) + "): " + restText(r));
    }
}

bool cycleRunning()
{
    HttpResult r;
    if (!httpGet("/api/status", r) || r.status != 200 || !r.data) {
        return false;
    }
    cJSON *j = cJSON_Parse(r.data);
    bool running = false;
    if (j) {
        cJSON *it = cJSON_GetObjectItem(j, "running");
        running = cJSON_IsTrue(it);
        cJSON_Delete(j);
    }
    return running;
}

bool refuseWhileRunning(Out &out)
{
    if (cycleRunning()) {
        out.fail("A cycle is running. Wait until it has finished (get_status: running=false) and try again.");
        return true;
    }
    return false;
}

void fetchImage(const std::string &path, Out &out)
{
    HttpResult r;
    const bool ok = httpGet(path, r);
    if (!ok || r.status != 200 || !r.data || r.len < 4) {
        out.fail("Image not available (HTTP " + std::to_string(r.status) + ")");
        return;
    }
    if (r.truncated) {
        out.fail("Image too large");
        return;
    }
    const auto *d = reinterpret_cast<const unsigned char *>(r.data);
    if (!(d[0] == 0xFF && d[1] == 0xD8)) {
        out.fail("The answer is not a JPEG image");
        return;
    }
    out.image(d, r.len, "image/jpeg");
    out.text("JPEG image, " + std::to_string(r.len) + " bytes, " + path);
}

/* ======================================================================== */
/* Tools                                                                     */
/* ======================================================================== */
void toolGetStatus(cJSON *, Out &out)
{
    HttpResult r;
    passOn(r, httpGet("/api/status", r), out);
}

void toolGetLive(cJSON *, Out &out)
{
    HttpResult r;
    passOn(r, httpGet("/api/live", r), out);
}

void toolGetRecognition(cJSON *, Out &out)
{
    HttpResult r;
    passOn(r, httpGet("/api/recognition", r), out);
}

void toolGetConfig(cJSON *args, Out &out)
{
    HttpResult r;
    const bool ok = httpGet("/config", r);
    const std::string section = argStr(args, "section");
    if (!section.empty() && ok && r.status == 200 && r.data) {
        cJSON *j = cJSON_Parse(r.data);
        cJSON *it = j ? cJSON_GetObjectItem(j, section.c_str()) : nullptr;
        if (it) {
            char *printed = cJSON_PrintUnformatted(it);
            out.text(printed ? printed : "{}");
            cJSON_free(printed);
        }
        else {
            out.fail("Section '" + section + "' not found");
        }
        cJSON_Delete(j);
        return;
    }
    passOn(r, ok, out);
}

void toolGetFallback(cJSON *args, Out &out)
{
    HttpResult r;
    passOn(r, httpGet("/api/fallback?sequence=" + argStr(args, "sequence", "main"), r), out);
}

void toolGetLog(cJSON *args, Out &out)
{
    HttpResult r;
    if (!httpGet("/log", r) || r.status != 200 || !r.data) {
        out.fail("Log not available (HTTP " + std::to_string(r.status) + ")");
        return;
    }
    int lines = static_cast<int>(argNum(args, "lines", 80));
    lines = lines < 1 ? 1 : lines > 500 ? 500 : lines;
    // the last lines
    size_t pos = r.len;
    int found = 0;
    while (pos > 0 && found <= lines) {
        pos--;
        if (r.data[pos] == '\n' && pos + 1 < r.len) {
            found++;
        }
    }
    const size_t start = found > lines ? pos + 1 : 0;
    out.text(std::string(r.data + start, r.len - start));
}

void toolListFiles(cJSON *args, Out &out)
{
    std::string path = argStr(args, "path", "/");
    if (!pathValid(path) && path != "/") {
        out.fail("Invalid path");
        return;
    }
    if (path.back() != '/') {
        path += '/';
    }
    HttpResult r;
    passOn(r, httpGet("/fileserver" + path + "?format=json", r), out);
}

void toolGetImage(cJSON *args, Out &out)
{
    const std::string name = argStr(args, "name", "alg");
    if (name == "reference") {
        fetchImage("/fileserver/config/reference.jpg", out);
    }
    else if (name == "alg" || name == "alg_roi" || name == "raw") {
        fetchImage("/img_tmp/" + name + ".jpg", out);
    }
    else if (name.rfind("marker", 0) == 0 && name.size() <= 9 && name.find_first_not_of("0123456789", 6) == std::string::npos &&
             name.size() > 6) {
        fetchImage("/fileserver/config/" + name + ".jpg", out);
    }
    else {
        out.fail("Unknown image. Use reference, alg, alg_roi, raw or marker1, marker2, ...");
    }
}

void toolCaptureImage(cJSON *, Out &out)
{
    if (refuseWhileRunning(out)) {
        return;
    }
    fetchImage("/camera?task=capture", out);
}

void toolSaveConfig(cJSON *args, Out &out)
{
    cJSON *cfg = args ? cJSON_GetObjectItem(args, "config") : nullptr;
    if (!cJSON_IsObject(cfg)) {
        out.fail("Parameter 'config' must be a JSON object with the parameters to change (partial configuration)");
        return;
    }
    if (refuseWhileRunning(out)) {
        return;
    }
    char *printed = cJSON_PrintUnformatted(cfg);
    if (!printed) {
        out.fail("Out of memory");
        return;
    }
    const bool apply = argBool(args, "apply", true);
    HttpResult r;
    const bool ok = httpPost(apply ? "/config?reload=true" : "/config", printed, r);
    cJSON_free(printed);
    if (!ok || r.status != 200) {
        out.fail("Saving failed (HTTP " + std::to_string(r.status) + "): " + restText(r));
        return;
    }
    std::string msg = "Configuration saved.";
    if (apply) {
        msg += " Applied (reload code " + (r.reloadCode.empty() ? std::string("-") : r.reloadCode) +
               "). The device re-initializes and starts a cycle.";
    }
    else {
        msg += " Not applied yet: it takes effect with the next reload.";
    }
    out.text(msg);
}

void toolStartCycle(cJSON *, Out &out)
{
    HttpResult r;
    passOn(r, httpPost("/api/cycle", "", r), out);
}

void toolSetPaused(cJSON *args, Out &out)
{
    HttpResult r;
    passOn(r, httpPost("/api/cycle", argBool(args, "paused", true) ? "{\"paused\":true}" : "{\"paused\":false}", r), out);
}

void toolSetFallback(cJSON *args, Out &out)
{
    cJSON *body = cJSON_CreateObject();
    cJSON_AddStringToObject(body, "sequence", argStr(args, "sequence", "main").c_str());
    cJSON_AddNumberToObject(body, "value", argNum(args, "value", -1));
    char *printed = cJSON_PrintUnformatted(body);
    cJSON_Delete(body);
    HttpResult r;
    passOn(r, httpPost("/api/fallback", printed ? printed : "{}", r), out);
    cJSON_free(printed);
}

void toolCutMarker(cJSON *args, Out &out)
{
    const std::string in = argStr(args, "in", "/config/reference.jpg");
    const std::string outPath = argStr(args, "out");
    if (!pathValid(in) || !pathValid(outPath)) {
        out.fail("Invalid path in 'in' or 'out'");
        return;
    }
    cJSON *body = cJSON_CreateObject();
    cJSON_AddStringToObject(body, "in", in.c_str());
    cJSON_AddStringToObject(body, "out", outPath.c_str());
    for (const char *k : {"x", "y", "dx", "dy"}) {
        cJSON_AddNumberToObject(body, k, argNum(args, k, 0));
    }
    char *printed = cJSON_PrintUnformatted(body);
    cJSON_Delete(body);
    HttpResult r;
    passOn(r, httpPost("/api/flow/cutref", printed ? printed : "{}", r), out);
    cJSON_free(printed);
}

void toolCopyFile(cJSON *args, Out &out)
{
    const std::string in = argStr(args, "in");
    const std::string outPath = argStr(args, "out");
    if (!pathValid(in) || !pathValid(outPath)) {
        out.fail("Invalid path in 'in' or 'out'");
        return;
    }
    cJSON *body = cJSON_CreateObject();
    cJSON_AddStringToObject(body, "in", in.c_str());
    cJSON_AddStringToObject(body, "out", outPath.c_str());
    char *printed = cJSON_PrintUnformatted(body);
    cJSON_Delete(body);
    HttpResult r;
    passOn(r, httpPost("/api/flow/copy", printed ? printed : "{}", r), out);
    cJSON_free(printed);
}

void toolUploadFile(cJSON *args, Out &out)
{
    const std::string path = argStr(args, "path");
    if (!pathValid(path) || (path.rfind("/config/", 0) != 0 && path.rfind("/img_tmp/", 0) != 0)) {
        out.fail("Only files in /config/ and /img_tmp/ can be uploaded");
        return;
    }
    cJSON *data = args ? cJSON_GetObjectItem(args, "data_base64") : nullptr;
    if (!cJSON_IsString(data) || !data->valuestring) {
        out.fail("Parameter 'data_base64' is missing");
        return;
    }
    if (refuseWhileRunning(out)) {
        return;
    }
    const size_t b64len = strlen(data->valuestring);
    size_t cap = b64len / 4 * 3 + 4;
    unsigned char *bin = static_cast<unsigned char *>(heap_caps_malloc(cap, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!bin) {
        out.fail("Out of memory");
        return;
    }
    size_t binLen = 0;
    if (mbedtls_base64_decode(bin, cap, &binLen, reinterpret_cast<const unsigned char *>(data->valuestring), b64len) != 0) {
        free(bin);
        out.fail("'data_base64' is not valid base64");
        return;
    }
    HttpResult r;
    const bool ok = httpCall(HTTP_METHOD_POST, "/upload" + path + "?overwrite=true", reinterpret_cast<const char *>(bin), binLen,
                             "application/octet-stream", r);
    free(bin);
    if (!ok || r.status < 200 || r.status >= 400) {
        out.fail("Upload failed (HTTP " + std::to_string(r.status) + "): " + restText(r));
        return;
    }
    out.text("Uploaded " + std::to_string(binLen) + " bytes to " + path);
}

void toolDeleteFile(cJSON *args, Out &out)
{
    const std::string path = argStr(args, "path");
    if (!pathValid(path)) {
        out.fail("Invalid path");
        return;
    }
    HttpResult r;
    const bool ok = httpPost("/delete" + path, "", r);
    if (!ok || r.status < 200 || r.status >= 400) {
        out.fail("Delete failed (HTTP " + std::to_string(r.status) + "): " + restText(r));
        return;
    }
    out.text("Deleted " + path);
}

void toolReboot(cJSON *, Out &out)
{
    HttpResult r;
    passOn(r, httpPost("/api/reboot", "", r), out);
}

void toolStartUpdate(cJSON *args, Out &out)
{
    cJSON *body = cJSON_CreateObject();
    cJSON_AddStringToObject(body, "url", argStr(args, "url").c_str());
    char *printed = cJSON_PrintUnformatted(body);
    cJSON_Delete(body);
    HttpResult r;
    passOn(r, httpPost("/api/update", printed ? printed : "{}", r), out);
    cJSON_free(printed);
}

void toolGetUpdateStatus(cJSON *, Out &out)
{
    HttpResult r;
    passOn(r, httpGet("/api/update/status", r), out);
}

const Tool TOOLS[] = {
    {"get_status", "State of the device and the process: state, cycle number, running, countdown to the next run, paused, last success.", "{}", "[]", false,
     toolGetStatus},
    {"get_live", "Progress of the running cycle: raw image ready, alignment result, results of the regions evaluated so far.", "{}", "[]", false, toolGetLive},
    {"get_recognition",
     "Result of the last completed cycle: digit and analog regions with value, confidence (0 to 100) and rectangle, plus the alignment of the last cycle "
     "(rotation, dx, dy, markers). Use it to judge whether markers and regions are placed well.",
     "{}", "[]", false, toolGetRecognition},
    {"get_config",
     "The configuration as JSON. With 'section' only that top-level part, e.g. imagealignment (alignment markers), digit, analog, numbersequences "
     "(regions of interest per sequence), takeimage (camera), postprocessing.",
     "{\"section\":{\"type\":\"string\",\"description\":\"top-level section, optional\"}}", "[]", false, toolGetConfig},
    {"get_fallback", "Fallback value (last valid reading) of a number sequence.", "{\"sequence\":{\"type\":\"string\",\"description\":\"default: main\"}}", "[]", false,
     toolGetFallback},
    {"get_log", "The last lines of the device log.", "{\"lines\":{\"type\":\"integer\",\"description\":\"1 to 500, default 80\"}}", "[]", false, toolGetLog},
    {"list_files", "Lists a folder of the SD card (name, size, folder or file).", "{\"path\":{\"type\":\"string\",\"description\":\"e.g. /config/ or /config/models/\"}}", "[]",
     false, toolListFiles},
    {"get_image",
     "Returns an image as picture: reference (reference image with the markers and regions placed on it), alg (aligned image of the last cycle), alg_roi (aligned "
     "image with the regions drawn), raw (raw camera image of the last cycle), marker1, marker2, ... (the alignment marker templates).",
     "{\"name\":{\"type\":\"string\",\"description\":\"reference, alg, alg_roi, raw or markerN\"}}", "[\"name\"]", false, toolGetImage},
    {"capture_image", "Takes a new picture with the current camera settings and returns it (not stored). Not while a cycle runs.", "{}", "[]", false, toolCaptureImage},
    {"save_config",
     "Changes configuration parameters. 'config' is a partial configuration in the structure of get_config; only the given parameters change, but arrays "
     "(markers, regions of interest) are replaced as a whole, so send the complete array. With apply=true (default) the device re-initializes and starts a cycle. "
     "Refused while a cycle runs.",
     "{\"config\":{\"type\":\"object\",\"description\":\"partial configuration\"},\"apply\":{\"type\":\"boolean\",\"description\":\"default true\"}}", "[\"config\"]",
     false, toolSaveConfig},
    {"start_cycle", "Starts a cycle now (or queues it behind the running one).", "{}", "[]", false, toolStartCycle},
    {"set_paused", "Pauses or resumes the countdown to the next automatic cycle (config mode).", "{\"paused\":{\"type\":\"boolean\"}}", "[\"paused\"]", false,
     toolSetPaused},
    {"set_fallback", "Sets the fallback value of a number sequence. A negative value takes the current raw value.",
     "{\"sequence\":{\"type\":\"string\",\"description\":\"default: main\"},\"value\":{\"type\":\"number\"}}", "[\"value\"]", false, toolSetFallback},
    {"cut_marker",
     "Cuts an area out of an image, e.g. an alignment marker out of the reference image: in=/config/reference.jpg, out=/img_tmp/marker1.jpg, x, y, dx (width), "
     "dy (height) in pixels of the 640x480 reference image. Copy the result to /config/ with copy_file to keep it.",
     "{\"in\":{\"type\":\"string\"},\"out\":{\"type\":\"string\"},\"x\":{\"type\":\"integer\"},\"y\":{\"type\":\"integer\"},\"dx\":{\"type\":\"integer\"},"
     "\"dy\":{\"type\":\"integer\"}}",
     "[\"out\",\"x\",\"y\",\"dx\",\"dy\"]", false, toolCutMarker},
    {"copy_file", "Copies a file on the SD card (paths start with /config/ or /img_tmp/).", "{\"in\":{\"type\":\"string\"},\"out\":{\"type\":\"string\"}}",
     "[\"in\",\"out\"]", false, toolCopyFile},
    {"upload_file", "Stores a file (base64) in /config/ or /img_tmp/, e.g. a new reference image (JPEG, 640x480). Refused while a cycle runs.",
     "{\"path\":{\"type\":\"string\"},\"data_base64\":{\"type\":\"string\"}}", "[\"path\",\"data_base64\"]", false, toolUploadFile},
    {"get_update_status", "State of a running firmware update.", "{}", "[]", false, toolGetUpdateStatus},
    {"delete_file", "Deletes a file or folder on the SD card. System action.", "{\"path\":{\"type\":\"string\"}}", "[\"path\"]", true, toolDeleteFile},
    {"reboot", "Restarts the device. System action.", "{}", "[]", true, toolReboot},
    {"start_update", "Starts a firmware update from a GitHub release package (url of the zip). System action.", "{\"url\":{\"type\":\"string\"}}", "[\"url\"]", true,
     toolStartUpdate},
};

/* ======================================================================== */
/* JSON-RPC                                                                  */
/* ======================================================================== */
std::string rpcError(const std::string &id, int code, const std::string &message)
{
    return "{\"jsonrpc\":\"2.0\",\"id\":" + id + ",\"error\":{\"code\":" + std::to_string(code) + ",\"message\":" + jsonString(message) + "}}";
}

std::string rpcResult(const std::string &id, const std::string &result)
{
    return "{\"jsonrpc\":\"2.0\",\"id\":" + id + ",\"result\":" + result + "}";
}

std::string toolsListJson()
{
    cJSON *tools = cJSON_CreateArray();
    for (const Tool &t : TOOLS) {
        cJSON *o = cJSON_CreateObject();
        cJSON_AddStringToObject(o, "name", t.name);
        std::string d = t.description;
        if (t.system) {
            d += mcpAllowSystem ? "" : " (disabled: 'System actions' is off on the MCP page)";
        }
        cJSON_AddStringToObject(o, "description", d.c_str());
        cJSON *schema = cJSON_CreateObject();
        cJSON_AddStringToObject(schema, "type", "object");
        cJSON_AddItemToObject(schema, "properties", cJSON_Parse(t.properties));
        cJSON_AddItemToObject(schema, "required", cJSON_Parse(t.required));
        cJSON_AddItemToObject(o, "inputSchema", schema);
        cJSON_AddItemToArray(tools, o);
    }
    cJSON *res = cJSON_CreateObject();
    cJSON_AddItemToObject(res, "tools", tools);
    char *printed = cJSON_PrintUnformatted(res);
    std::string s = printed ? printed : "{\"tools\":[]}";
    cJSON_free(printed);
    cJSON_Delete(res);
    return s;
}

/// Processes one JSON-RPC message. status 202 with an empty answer for notifications.
void processRpc(const char *body, std::string &answer, int &status)
{
    status = 200;
    cJSON *root = cJSON_Parse(body);
    if (!root || !cJSON_IsObject(root)) {
        cJSON_Delete(root);
        status = 400;
        answer = rpcError("null", -32700, "Parse error");
        return;
    }
    cJSON *idItem = cJSON_GetObjectItem(root, "id");
    cJSON *methodItem = cJSON_GetObjectItem(root, "method");
    if (!idItem || !cJSON_IsString(methodItem)) { // notification or a response of the client
        cJSON_Delete(root);
        status = 202;
        answer.clear();
        return;
    }
    char *idPrinted = cJSON_PrintUnformatted(idItem);
    const std::string id = idPrinted ? idPrinted : "null";
    cJSON_free(idPrinted);
    const std::string method = methodItem->valuestring;
    cJSON *params = cJSON_GetObjectItem(root, "params");

    if (method == "initialize") {
        std::string version = "2025-06-18";
        cJSON *pv = params ? cJSON_GetObjectItem(params, "protocolVersion") : nullptr;
        if (cJSON_IsString(pv) && pv->valuestring &&
            (!strcmp(pv->valuestring, "2025-03-26") || !strcmp(pv->valuestring, "2024-11-05") || !strcmp(pv->valuestring, "2025-06-18"))) {
            version = pv->valuestring;
        }
        answer = rpcResult(id, "{\"protocolVersion\":\"" + version +
                                   "\",\"capabilities\":{\"tools\":{\"listChanged\":false}},\"serverInfo\":{\"name\":\"ai-on-the-edge\",\"version\":\"1.0-beta\"},"
                                   "\"instructions\":\"Tools of an AI-on-the-Edge meter reading device. Start with get_status and get_recognition. Alignment markers and "
                                   "regions of interest are in the configuration (get_config section imagealignment / numbersequences); get_image returns the pictures. "
                                   "The device is busy while a cycle runs: write tools are refused then.\"}");
    }
    else if (method == "ping") {
        answer = rpcResult(id, "{}");
    }
    else if (method == "tools/list") {
        answer = rpcResult(id, toolsListJson());
    }
    else if (method == "tools/call") {
        cJSON *nameItem = params ? cJSON_GetObjectItem(params, "name") : nullptr;
        cJSON *args = params ? cJSON_GetObjectItem(params, "arguments") : nullptr;
        const Tool *tool = nullptr;
        if (cJSON_IsString(nameItem)) {
            for (const Tool &t : TOOLS) {
                if (strcmp(t.name, nameItem->valuestring) == 0) {
                    tool = &t;
                }
            }
        }
        if (!tool) {
            answer = rpcError(id, -32602, "Unknown tool");
        }
        else {
            Out out;
            if (tool->system && !mcpAllowSystem) {
                out.fail("System actions are disabled. Switch on 'System actions' on the MCP page (System > MCP).");
            }
            else {
                LogFile.writeToFile(ESP_LOG_INFO, TAG, std::string("Tool: ") + tool->name);
                tool->fn(args, out);
            }
            std::string result = "{\"content\":[";
            for (size_t i = 0; i < out.items.size(); i++) {
                result += (i ? "," : "") + out.items[i];
            }
            result += std::string("],\"isError\":") + (out.isError ? "true" : "false") + "}";
            answer = rpcResult(id, result);
        }
    }
    else {
        answer = rpcError(id, -32601, "Method not found");
    }
    cJSON_Delete(root);
}

/* ======================================================================== */
/* HTTP handlers                                                             */
/* ======================================================================== */
struct McpJob {
    httpd_req_t *req;
    char *body;
};

void mcpTask(void *arg)
{
    auto *job = static_cast<McpJob *>(arg);
    std::string answer;
    int status = 200;
    processRpc(job->body, answer, status);

    httpd_resp_set_type(job->req, "application/json");
    if (status == 202) {
        httpd_resp_set_status(job->req, "202 Accepted");
        httpd_resp_send(job->req, nullptr, 0);
    }
    else {
        if (status == 400) {
            httpd_resp_set_status(job->req, "400 Bad Request");
        }
        httpd_resp_send(job->req, answer.c_str(), answer.size());
    }
    httpd_req_async_handler_complete(job->req);
    free(job->body);
    free(job);
    mcpBusy = false;
    vTaskDelete(nullptr);
}

esp_err_t sendJsonStatus(httpd_req_t *req, const char *status, const char *json)
{
    httpd_resp_set_status(req, status);
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_send(req, json, HTTPD_RESP_USE_STRLEN);
}

esp_err_t handlerMcp(httpd_req_t *req)
{
    if (!mcpEnabled) {
        return httpd_resp_send_404(req);
    }
    if (req->method != HTTP_POST) {
        httpd_resp_set_hdr(req, "Allow", "POST");
        return sendJsonStatus(req, "405 Method Not Allowed", "{\"error\":\"POST only\"}");
    }
    if (!bearerValid(req)) {
        httpd_resp_set_hdr(req, "WWW-Authenticate", "Bearer realm=\"AI-on-the-Edge MCP\"");
        return sendJsonStatus(req, "401 Unauthorized", "{\"error\":\"Access token missing or wrong\"}");
    }
    if (req->content_len == 0 || req->content_len > MAX_BODY) {
        return sendJsonStatus(req, "413 Payload Too Large", "{\"error\":\"Empty or too large request\"}");
    }
    if (mcpBusy) {
        return sendJsonStatus(req, "503 Service Unavailable", "{\"error\":\"The device is handling another MCP request\"}");
    }

    char *body = static_cast<char *>(heap_caps_malloc(req->content_len + 1, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!body) {
        return sendJsonStatus(req, "503 Service Unavailable", "{\"error\":\"Out of memory\"}");
    }
    size_t received = 0;
    while (received < req->content_len) {
        const int n = httpd_req_recv(req, body + received, req->content_len - received);
        if (n <= 0) {
            if (n == HTTPD_SOCK_ERR_TIMEOUT) {
                continue;
            }
            free(body);
            return ESP_FAIL;
        }
        received += n;
    }
    body[received] = '\0';

    // The tools call this web server: the request is handled in its own task, the web server stays free meanwhile
    httpd_req_t *copy = nullptr;
    if (httpd_req_async_handler_begin(req, &copy) != ESP_OK) {
        free(body);
        return sendJsonStatus(req, "503 Service Unavailable", "{\"error\":\"Request could not be handled\"}");
    }
    auto *job = static_cast<McpJob *>(malloc(sizeof(McpJob)));
    if (job) {
        // the job must be complete before the task exists: the task may run on the other core at once
        job->req = copy;
        job->body = body;
        mcpBusy = true;
    }
    if (!job || xTaskCreate(mcpTask, "mcp", MCP_TASK_STACK, job, 5, nullptr) != pdPASS) {
        mcpBusy = false;
        free(body);
        httpd_resp_set_status(copy, "503 Service Unavailable");
        httpd_resp_send(copy, "{\"error\":\"No memory for the request\"}", HTTPD_RESP_USE_STRLEN);
        httpd_req_async_handler_complete(copy);
        free(job);
        return ESP_OK;
    }
    return ESP_OK;
}

std::string stateJson(const std::string &token = "")
{
    std::string s = std::string("{\"ok\":true,\"enabled\":") + (mcpEnabled ? "true" : "false") +
                    ",\"allowSystem\":" + (mcpAllowSystem ? "true" : "false") + ",\"tokenSet\":" + (mcpTokenHash[0] ? "true" : "false") +
                    ",\"endpoint\":\"/mcp\"";
    if (!token.empty()) {
        s += ",\"token\":\"" + token + "\"";
    }
    return s + "}";
}

/// GET: state. POST {"enabled":bool,"allowSystem":bool,"regenerate":bool}: change, a new token is returned once
esp_err_t handlerApiMcp(httpd_req_t *req)
{
    if (req->method == HTTP_GET) {
        return sendJsonStatus(req, "200 OK", stateJson().c_str());
    }
    if (req->content_len > 512) {
        return sendJsonStatus(req, "413 Payload Too Large", "{\"ok\":false,\"message\":\"Request too large\"}");
    }
    char buf[513] = {};
    size_t received = 0;
    while (received < req->content_len) {
        const int n = httpd_req_recv(req, buf + received, req->content_len - received);
        if (n <= 0) {
            if (n == HTTPD_SOCK_ERR_TIMEOUT) {
                continue;
            }
            return ESP_FAIL;
        }
        received += n;
    }
    cJSON *j = cJSON_Parse(buf);
    if (!j || !cJSON_IsObject(j)) {
        cJSON_Delete(j);
        return sendJsonStatus(req, "400 Bad Request", "{\"ok\":false,\"message\":\"Body must be a JSON object\"}");
    }
    std::string newToken;
    cJSON *en = cJSON_GetObjectItem(j, "enabled");
    cJSON *sys = cJSON_GetObjectItem(j, "allowSystem");
    cJSON *regen = cJSON_GetObjectItem(j, "regenerate");
    if (cJSON_IsBool(en)) {
        mcpEnabled = cJSON_IsTrue(en);
        nvsWrite("on", mcpEnabled ? "1" : "0");
    }
    if (cJSON_IsBool(sys)) {
        mcpAllowSystem = cJSON_IsTrue(sys);
        nvsWrite("sys", mcpAllowSystem ? "1" : "0");
    }
    // the token is created when the function is switched on for the first time or on request; it stays until it is regenerated
    if ((cJSON_IsTrue(regen)) || (mcpEnabled && mcpTokenHash[0] == '\0')) {
        newToken = generateToken();
        LogFile.writeToFile(ESP_LOG_INFO, TAG, "MCP access token created");
    }
    cJSON_Delete(j);
    LogFile.writeToFile(ESP_LOG_INFO, TAG, std::string("MCP ") + (mcpEnabled ? "enabled" : "disabled") + (mcpAllowSystem ? ", system actions allowed" : ""));
    return sendJsonStatus(req, "200 OK", stateJson(newToken).c_str());
}

} // namespace

void mcpInit()
{
    char buf[8];
    nvsRead("on", buf, sizeof(buf));
    mcpEnabled = strcmp(buf, "1") == 0;
    nvsRead("sys", buf, sizeof(buf));
    mcpAllowSystem = strcmp(buf, "1") == 0;
    nvsRead("hash", mcpTokenHash, sizeof(mcpTokenHash));
    if (strlen(mcpTokenHash) != 64) {
        mcpTokenHash[0] = '\0';
    }
    if (mcpEnabled) {
        LogFile.writeToFile(ESP_LOG_INFO, TAG, std::string("MCP server enabled") + (mcpAllowSystem ? ", system actions allowed" : ""));
    }
}

void registerMcpUri(httpd_handle_t server)
{
    httpd_uri_t uri = {};
    uri.user_ctx = nullptr;

    uri.method = HTTP_POST;
    uri.uri = "/mcp";
    uri.handler = handlerMcp; // own token check, no HTTP basic auth
    httpd_register_uri_handler(server, &uri);

    uri.method = HTTP_GET;
    uri.uri = "/mcp";
    uri.handler = handlerMcp;
    httpd_register_uri_handler(server, &uri);

    uri.method = HTTP_GET;
    uri.uri = "/api/mcp";
    uri.handler = HTTP_AUTH_BASIC(handlerApiMcp);
    httpd_register_uri_handler(server, &uri);

    uri.method = HTTP_POST;
    uri.uri = "/api/mcp";
    uri.handler = HTTP_AUTH_BASIC(handlerApiMcp);
    httpd_register_uri_handler(server, &uri);
}
