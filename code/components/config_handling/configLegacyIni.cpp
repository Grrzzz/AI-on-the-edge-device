#include "configLegacyIni.h"
#include "../../include/defines.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <vector>

#include <cJSON.h>
#include <esp_log.h>
#include <nvs.h>

#include "ClassLogFile.h"
#include "helper.h"


static const char *TAG = "CFGLEGACY";

// Model files named in config.ini (firmware v16 kept them in /config, newer firmware expects /config/models)
static std::vector<std::string> legacyModelFiles;


namespace {

struct IniSection {
    std::map<std::string, std::vector<std::string>> values; // key (lower case) -> values
    std::vector<std::vector<std::string>> lines;            // lines without "key = value" (ROI and marker lines), split at white space
};


std::string trimStr(const std::string &s)
{
    size_t a = 0, b = s.size();
    while (a < b && isspace((unsigned char)s[a])) a++;
    while (b > a && isspace((unsigned char)s[b - 1])) b--;
    return s.substr(a, b - a);
}


std::string lower(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return (char)tolower(c); });
    return s;
}


std::vector<std::string> splitWhitespace(const std::string &s)
{
    std::vector<std::string> out;
    size_t i = 0;
    while (i < s.size()) {
        while (i < s.size() && isspace((unsigned char)s[i])) i++;
        size_t start = i;
        while (i < s.size() && !isspace((unsigned char)s[i])) i++;
        if (i > start) out.push_back(s.substr(start, i - start));
    }
    return out;
}


std::string baseName(const std::string &path)
{
    const size_t pos = path.find_last_of('/');
    return trimStr(pos == std::string::npos ? path : path.substr(pos + 1));
}


// Sections are only recognized if their header is not commented. Commented lines are ignored.
std::map<std::string, IniSection> parseIni(const std::string &text)
{
    std::map<std::string, IniSection> sections;
    IniSection *cur = &sections[""]; // lines before the first header (wlan.ini has no sections)

    size_t pos = 0;
    while (pos <= text.size()) {
        size_t end = text.find('\n', pos);
        if (end == std::string::npos) end = text.size();
        const std::string line = trimStr(text.substr(pos, end - pos));
        pos = end + 1;

        if (line.empty() || line[0] == ';') continue;

        if (line.front() == '[' && line.back() == ']') {
            cur = &sections[line.substr(1, line.size() - 2)];
            continue;
        }
        if (!cur) continue;

        const size_t eq = line.find('=');
        if (eq != std::string::npos && eq > 0 && trimStr(line.substr(0, eq)).find_first_of(" \t") == std::string::npos) {
            cur->values[lower(trimStr(line.substr(0, eq)))].push_back(trimStr(line.substr(eq + 1)));
        }
        else {
            cur->lines.push_back(splitWhitespace(line));
        }
    }
    return sections;
}


const std::string *firstValue(const IniSection *sec, const std::string &key)
{
    if (!sec) return nullptr;
    auto it = sec->values.find(lower(key));
    return (it == sec->values.end() || it->second.empty()) ? nullptr : &it->second.front();
}


std::string unquote(std::string s)
{
    s = trimStr(s);
    if (s.size() >= 2 && ((s.front() == '"' && s.back() == '"') || (s.front() == '\'' && s.back() == '\''))) {
        s = s.substr(1, s.size() - 2);
    }
    return s;
}


bool asBool(const std::string &v)
{
    return lower(trimStr(v)) == "true";
}


bool asNumber(const std::string *v, double &out)
{
    if (!v) return false;
    const std::string s = trimStr(*v);
    if (s.empty()) return false;
    char *endPtr = nullptr;
    out = strtod(s.c_str(), &endPtr);
    return endPtr != s.c_str() && *endPtr == '\0';
}


std::string formatFixed(double v, int decimals)
{
    char buf[32];
    snprintf(buf, sizeof(buf), "%.*f", decimals, v);
    return buf;
}


// Model file name of a key that may occur several times (some backups have the analog model below the digit section)
std::string modelByPrefix(const IniSection *sec, const char *prefix)
{
    if (!sec) return "";
    auto it = sec->values.find("model");
    if (it == sec->values.end()) return "";
    for (const auto &v : it->second) {
        const std::string name = baseName(v);
        if (lower(name).rfind(prefix, 0) == 0) return name;
    }
    return "";
}


cJSON *child(cJSON *parent, const char *key)
{
    cJSON *c = cJSON_GetObjectItem(parent, key);
    return c ? c : cJSON_AddObjectToObject(parent, key);
}


struct JsonPath {
    cJSON *root;

    cJSON *objectAt(std::initializer_list<const char *> path) const
    {
        cJSON *o = root;
        for (const char *k : path) o = child(o, k);
        return o;
    }
    void num(std::initializer_list<const char *> path, const char *key, double v) const
    {
        cJSON_AddNumberToObject(objectAt(path), key, v);
    }
    void boolean(std::initializer_list<const char *> path, const char *key, bool v) const
    {
        cJSON_AddBoolToObject(objectAt(path), key, v);
    }
    void str(std::initializer_list<const char *> path, const char *key, const std::string &v) const
    {
        if (!v.empty()) cJSON_AddStringToObject(objectAt(path), key, v.c_str());
    }
};


// "<sequence>.dig3" / "<sequence>.ana1" -> sequence name, false if the token is no ROI line of the given kind
bool parseRoiToken(const std::string &token, const char *kind, std::string &sequence)
{
    const size_t dot = token.find('.');
    if (dot == std::string::npos || dot == 0) return false;
    const std::string rest = token.substr(dot + 1);
    if (rest.size() < 4 || lower(rest.substr(0, 3)) != kind) return false;
    if (!std::all_of(rest.begin() + 3, rest.end(), [](unsigned char c) { return isdigit(c); })) return false;
    sequence = token.substr(0, dot);
    return true;
}


struct RoiList {
    std::vector<std::string> sequenceOrder;
    std::map<std::string, std::vector<std::vector<double>>> rois; // sequence -> [x, y, dx, dy, ccw]
};


RoiList parseRois(const IniSection *sec, const char *kind)
{
    RoiList list;
    if (!sec) return list;
    for (const auto &tok : sec->lines) {
        std::string sequence;
        if (tok.size() < 5 || !parseRoiToken(tok[0], kind, sequence)) continue;

        std::vector<double> v(5, 0);
        bool ok = true;
        for (int i = 0; i < 4; i++) {
            char *endPtr = nullptr;
            v[i] = strtod(tok[i + 1].c_str(), &endPtr);
            ok = ok && endPtr != tok[i + 1].c_str() && *endPtr == '\0';
        }
        if (!ok) continue;
        v[4] = (tok.size() > 5 && asBool(tok[5])) ? 1 : 0;

        if (list.rois.find(sequence) == list.rois.end()) list.sequenceOrder.push_back(sequence);
        list.rois[sequence].push_back(v);
    }
    return list;
}


cJSON *roiSequenceJson(const std::string &name, const std::vector<std::vector<double>> &rois, bool analog)
{
    cJSON *seq = cJSON_CreateObject();
    cJSON_AddNumberToObject(seq, "sequenceid", 0);
    cJSON_AddStringToObject(seq, "sequencename", name.c_str());
    cJSON *arr = cJSON_AddArrayToObject(seq, "roi");
    for (const auto &r : rois) {
        cJSON *o = cJSON_CreateObject();
        cJSON_AddNumberToObject(o, "x", r[0]);
        cJSON_AddNumberToObject(o, "y", r[1]);
        cJSON_AddNumberToObject(o, "dx", r[2]);
        cJSON_AddNumberToObject(o, "dy", r[3]);
        if (analog) cJSON_AddBoolToObject(o, "ccw", r[4] != 0);
        cJSON_AddItemToArray(arr, o);
    }
    return seq;
}

} // namespace


bool legacyIniToJson(std::string &json)
{
    std::string text;
    if (!fileExists(LEGACY_INI_FILE) || !readFileToString(LEGACY_INI_FILE, text) || text.empty()) {
        return false;
    }

    const auto ini = parseIni(text);
    auto section = [&](const char *name) -> const IniSection * {
        auto it = ini.find(name);
        return it == ini.end() ? nullptr : &it->second;
    };

    cJSON *root = cJSON_CreateObject();
    if (!root) return false;
    JsonPath j{root};
    double n = 0;

    // ---- operation
    if (const IniSection *timer = section("AutoTimer")) {
        if (asNumber(firstValue(timer, "Interval"), n) && n > 0) {
            j.num({"operationmode"}, "opmode", 1); // automatic
            j.str({"operationmode"}, "automaticprocessinterval", formatFixed(n, 2));
        }
    }
    if (const std::string *demo = firstValue(section("TakeImage"), "Demo")) {
        j.boolean({"operationmode"}, "usedemoimages", asBool(*demo));
    }

    // ---- camera and flash
    if (const IniSection *t = section("TakeImage")) {
        if (asNumber(firstValue(t, "WaitBeforeTakingPicture"), n)) j.num({"takeimage", "flashlight"}, "flashtime", n * 1000);
        if (asNumber(firstValue(t, "LEDIntensity"), n)) j.num({"takeimage", "flashlight"}, "flashintensity", n);

        const char *const cameraKeys[][2] = {{"CamBrightness", "brightness"}, {"CamContrast", "contrast"},
                                             {"CamSaturation", "saturation"}, {"CamSharpness", "sharpness"}};
        for (const auto &k : cameraKeys) {
            if (asNumber(firstValue(t, k[0]), n)) j.num({"takeimage", "camera"}, k[1], n);
        }
        if (asNumber(firstValue(t, "CamQuality"), n)) j.num({"takeimage", "camera"}, "imagequality", n);
        if (const std::string *v = firstValue(t, "CamHmirror")) j.boolean({"takeimage", "camera"}, "mirrorimage", asBool(*v));
        if (const std::string *v = firstValue(t, "CamVflip")) j.boolean({"takeimage", "camera"}, "flipimage", asBool(*v));

        // exposure: 0 manual, 1 auto, 2 auto (AEC2)
        if (const std::string *aec = firstValue(t, "CamAec")) {
            const std::string *aec2 = firstValue(t, "CamAec2");
            const int mode = asBool(*aec) ? 1 : ((aec2 && asBool(*aec2)) ? 2 : 0);
            j.num({"takeimage", "camera"}, "exposurecontrolmode", mode);
            if (mode == 0) {
                j.num({"takeimage", "camera"}, "manualexposurevalue", asNumber(firstValue(t, "CamAecValue"), n) ? n : 300);
            }
            else if (asNumber(firstValue(t, "CamAeLevel"), n)) {
                j.num({"takeimage", "camera"}, "autoexposurelevel", n);
            }
        }
        // gain: 0 manual, 1 auto
        if (const std::string *agc = firstValue(t, "CamAgc")) {
            j.num({"takeimage", "camera"}, "gaincontrolmode", asBool(*agc) ? 1 : 0);
            if (!asBool(*agc)) j.num({"takeimage", "camera"}, "manualgainvalue", asNumber(firstValue(t, "CamAgcGain"), n) ? n : 0);
        }
    }

    // ---- alignment
    if (const IniSection *a = section("Alignment")) {
        j.str({"imagealignment"}, "imagerotation", formatFixed(asNumber(firstValue(a, "InitialRotate"), n) ? n : 0, 1));
        if (asNumber(firstValue(a, "SearchFieldX"), n)) j.num({"imagealignment", "searchfield"}, "x", n);
        if (asNumber(firstValue(a, "SearchFieldY"), n)) j.num({"imagealignment", "searchfield"}, "y", n);
        j.num({"imagealignment"}, "alignmentalgo", 0); // v16 "default" = rotate + align, red channel

        cJSON *markers = cJSON_AddArrayToObject(child(root, "imagealignment"), "marker");
        for (const auto &tok : a->lines) {
            const std::string file = lower(baseName(tok[0]));
            if (tok.size() >= 3 && file.rfind("ref", 0) == 0 && file.size() >= 8 && file.compare(file.size() - 4, 4, ".jpg") == 0 &&
                file.find("_org") == std::string::npos) {
                cJSON *m = cJSON_CreateObject();
                cJSON_AddNumberToObject(m, "x", atof(tok[1].c_str()));
                cJSON_AddNumberToObject(m, "y", atof(tok[2].c_str()));
                cJSON_AddItemToArray(markers, m);
            }
        }
        if (cJSON_GetArraySize(markers) != 2) {
            cJSON_DeleteItemFromObject(child(root, "imagealignment"), "marker"); // keep the device default
        }
    }

    // ---- digit / analog regions
    const IniSection *digitsSec = section("Digits");
    const IniSection *analogSec = section("Analog");
    const RoiList digits = parseRois(digitsSec, "dig");
    const RoiList analog = parseRois(analogSec, "ana");

    std::string sequenceName = "main";
    if (!digits.sequenceOrder.empty()) sequenceName = digits.sequenceOrder.front();
    else if (!analog.sequenceOrder.empty()) sequenceName = analog.sequenceOrder.front();
    if (digits.sequenceOrder.size() > 1 || analog.sequenceOrder.size() > 1) {
        LogFile.writeToFile(ESP_LOG_WARN, TAG, "config.ini: More than one number sequence found, only '" + sequenceName + "' is migrated");
    }

    cJSON *numberSequences = cJSON_AddArrayToObject(child(root, "numbersequences"), "sequence");
    {
        cJSON *s = cJSON_CreateObject();
        cJSON_AddNumberToObject(s, "sequenceid", 0);
        cJSON_AddStringToObject(s, "sequencename", sequenceName.c_str());
        cJSON_AddItemToArray(numberSequences, s);
    }

    j.boolean({"digit"}, "enabled", !digits.sequenceOrder.empty());
    j.str({"digit"}, "model", modelByPrefix(digitsSec, "dig"));
    if (!modelByPrefix(digitsSec, "dig").empty()) legacyModelFiles.push_back(modelByPrefix(digitsSec, "dig"));
    if (asNumber(firstValue(digitsSec, "CNNGoodThreshold"), n)) j.str({"digit"}, "cnngoodthreshold", formatFixed(n, 2));
    if (digits.rois.count(sequenceName)) {
        cJSON *arr = cJSON_AddArrayToObject(child(root, "digit"), "sequence");
        cJSON_AddItemToArray(arr, roiSequenceJson(sequenceName, digits.rois.at(sequenceName), false));
    }

    j.boolean({"analog"}, "enabled", analogSec != nullptr && !analog.sequenceOrder.empty());
    if (analogSec && !analog.sequenceOrder.empty()) {
        j.str({"analog"}, "model", modelByPrefix(analogSec, "ana"));
        if (!modelByPrefix(analogSec, "ana").empty()) legacyModelFiles.push_back(modelByPrefix(analogSec, "ana"));
        if (analog.rois.count(sequenceName)) {
            cJSON *arr = cJSON_AddArrayToObject(child(root, "analog"), "sequence");
            cJSON_AddItemToArray(arr, roiSequenceJson(sequenceName, analog.rois.at(sequenceName), true));
        }
    }

    // ---- post-processing
    if (const IniSection *p = section("PostProcessing")) {
        cJSON *arr = cJSON_AddArrayToObject(child(root, "postprocessing"), "sequence");
        cJSON *post = cJSON_CreateObject();
        cJSON_AddStringToObject(post, "sequencename", sequenceName.c_str());
        auto key = [&](const char *name) { return firstValue(p, sequenceName + "." + name); };

        if (asNumber(key("DecimalShift"), n)) cJSON_AddNumberToObject(post, "decimalshift", n);
        if (const std::string *v = key("ExtendedResolution")) cJSON_AddBoolToObject(post, "extendedresolution", asBool(*v));
        if (const std::string *v = key("IgnoreLeadingNaN")) cJSON_AddBoolToObject(post, "ignoreleadingnan", asBool(*v));
        if (const std::string *v = key("CheckDigitIncreaseConsistency")) {
            cJSON_AddBoolToObject(post, "checkdigitincreaseconsistency", asBool(*v));
        }
        if (const std::string *v = key("AllowNegativeRates")) cJSON_AddBoolToObject(post, "allownegativerate", asBool(*v));
        if (asNumber(key("MaxRateValue"), n)) {
            cJSON_AddStringToObject(post, "maxrate", formatFixed(n, 3).c_str());
            // v16 "AbsoluteChange" (default) = limit per interval, "RateChange" = per minute
            const std::string *type = key("MaxRateType");
            cJSON_AddNumberToObject(post, "maxratechecktype", (type && lower(trimStr(*type)) == "ratechange") ? 1 : 2);
        }
        if (const std::string *v = firstValue(p, "PreValueUse")) cJSON_AddBoolToObject(post, "usefallbackvalue", asBool(*v));
        if (asNumber(firstValue(p, "PreValueAgeStartup"), n)) cJSON_AddNumberToObject(post, "fallbackvalueagestartup", n);
        cJSON_AddItemToArray(arr, post);
    }

    // ---- MQTT
    if (const IniSection *m = section("MQTT")) {
        if (const std::string *uri = firstValue(m, "Uri")) {
            j.boolean({"mqtt"}, "enabled", true);
            j.str({"mqtt"}, "uri", *uri);
            if (const std::string *v = firstValue(m, "MainTopic")) j.str({"mqtt"}, "maintopic", *v);
            if (const std::string *v = firstValue(m, "ClientID")) j.str({"mqtt"}, "clientid", *v);
            const std::string *user = firstValue(m, "user");
            j.num({"mqtt"}, "authmode", user ? 1 : 0);
            if (user) {
                j.str({"mqtt"}, "username", *user);
                if (const std::string *pw = firstValue(m, "password")) j.str({"mqtt"}, "password", *pw); // keep the broker password
            }
            j.num({"mqtt"}, "processdatanotation", 1); // v16 published single topics
            if (const std::string *v = firstValue(m, "RetainMessages")) j.boolean({"mqtt"}, "retainprocessdata", asBool(*v));
            if (const std::string *v = firstValue(m, "ValidateServerCert")) {
                j.num({"mqtt", "tls"}, "servercertverification", asBool(*v) ? 2 : 0);
            }
            if (const std::string *v = firstValue(m, "CACert")) j.str({"mqtt", "tls"}, "cacert", baseName(*v));
            if (const std::string *v = firstValue(m, "ClientCert")) j.str({"mqtt", "tls"}, "clientcert", baseName(*v));
            if (const std::string *v = firstValue(m, "ClientKey")) j.str({"mqtt", "tls"}, "clientkey", baseName(*v));
            if (const std::string *v = firstValue(m, "HomeassistantDiscovery")) {
                j.boolean({"mqtt", "homeassistant"}, "discoveryenabled", asBool(*v));
            }
            if (const std::string *v = firstValue(m, "MeterType")) {
                static const std::map<std::string, int> meterTypes = {{"water_m3", 1}, {"water_l", 2}, {"water_gal", 3}, {"water_ft3", 4}, {"gas_m3", 5}};
                auto it = meterTypes.find(lower(trimStr(*v)));
                if (it != meterTypes.end()) j.num({"mqtt", "homeassistant"}, "metertype", it->second);
            }
        }
    }

    // ---- network (v16: config.ini [System] and /sdcard/wlan.ini, WLAN credentials are kept in the NVS otherwise)
    std::string wlanText;
    std::map<std::string, IniSection> wlanIni;
    if (fileExists(LEGACY_WLAN_FILE) && readFileToString(LEGACY_WLAN_FILE, wlanText)) {
        wlanIni = parseIni(wlanText);
    }
    const IniSection *wlan = wlanIni.count("") ? &wlanIni[""] : nullptr;
    auto wlanValue = [&](const char *key) -> std::string {
        const std::string *v = firstValue(wlan, key);
        return v ? unquote(*v) : "";
    };

    std::string hostname;
    if (const std::string *h = firstValue(section("System"), "Hostname")) hostname = unquote(*h);
    if (hostname.empty() || hostname == "undefined") hostname = wlanValue("hostname");
    if (!hostname.empty() && hostname != "undefined") j.str({"network"}, "hostname", hostname);

    j.str({"network", "wlan"}, "ssid", wlanValue("ssid"));
    j.str({"network", "wlan"}, "password", wlanValue("password"));
    if (!wlanValue("ip").empty() && !wlanValue("gateway").empty() && !wlanValue("netmask").empty()) {
        j.num({"network", "wlan", "ipv4"}, "networkconfig", 1); // static IP
        j.str({"network", "wlan", "ipv4"}, "ipaddress", wlanValue("ip"));
        j.str({"network", "wlan", "ipv4"}, "subnetmask", wlanValue("netmask"));
        j.str({"network", "wlan", "ipv4"}, "gatewayaddress", wlanValue("gateway"));
        j.str({"network", "wlan", "ipv4"}, "dnsserver", wlanValue("dns"));
    }

    // v16: RSSIThreshold 0 = no roaming
    double rssi = 0;
    bool haveRssi = asNumber(firstValue(section("System"), "RSSIThreshold"), rssi);
    if (!haveRssi && !wlanValue("rssi_threshold").empty()) {
        const std::string t = wlanValue("rssi_threshold");
        rssi = atof(t.c_str());
        haveRssi = true;
    }
    if (haveRssi) {
        j.boolean({"network", "wlan", "wlanroaming"}, "enabled", rssi != 0);
        if (rssi != 0) j.num({"network", "wlan", "wlanroaming"}, "rssithreshold", rssi);
    }

    // ---- GPIO (v16: "IOn = <mode> <interrupt> <value> <expose to MQTT> <expose to REST> [name]")
    if (const IniSection *g = section("GPIO")) {
        static const std::map<std::string, std::string> modes = {
            {"input", "input"}, {"input-pullup", "input-pullup"}, {"input-pulldown", "input-pulldown"}, {"output", "output"},
            {"output-pwm", "output-pwm"}, {"flashlight-pwm", "flashlight-pwm"}, {"flashlight-digital", "flashlight-digital"},
            {"flashlight-smartled", "flashlight-smartled"}, {"trigger-cycle-start", "trigger-cycle-start"},
            {"resume-wlan-connection", "resume-wlan-connection"}};
        static const std::map<std::string, std::string> capture = {
            {"disabled", "cyclic-polling"}, {"cyclic-polling", "cyclic-polling"}, {"rising-edge", "interrupt-rising-edge"},
            {"falling-edge", "interrupt-falling-edge"}, {"rising-and-falling", "interrupt-rising-falling"},
            {"low-level-trigger", "interrupt-low-level"}, {"high-level-trigger", "interrupt-high-level"}};

        cJSON *pins = cJSON_CreateArray();
        for (const auto &entry : g->values) {
            const std::string &key = entry.first; // io4
            if (key.size() < 3 || key.compare(0, 2, "io") != 0 || entry.second.empty()) continue;
            const int number = atoi(key.c_str() + 2);
            const std::vector<std::string> tok = splitWhitespace(entry.second.front());
            if (tok.empty() || !modes.count(lower(tok[0]))) {
                LogFile.writeToFile(ESP_LOG_WARN, TAG, "config.ini: GPIO" + std::to_string(number) + " mode '" + (tok.empty() ? "" : tok[0]) + "' not migrated");
                continue;
            }
            cJSON *pin = cJSON_CreateObject();
            cJSON_AddNumberToObject(pin, "gpionumber", number);
            cJSON_AddBoolToObject(pin, "pinenabled", true);
            cJSON_AddStringToObject(pin, "pinmode", modes.at(lower(tok[0])).c_str());
            if (tok.size() > 1 && capture.count(lower(tok[1]))) cJSON_AddStringToObject(pin, "capturemode", capture.at(lower(tok[1])).c_str());
            if (tok.size() > 3) cJSON_AddBoolToObject(pin, "exposetomqtt", asBool(tok[3]));
            if (tok.size() > 4) cJSON_AddBoolToObject(pin, "exposetorest", asBool(tok[4]));
            if (tok.size() > 5) cJSON_AddStringToObject(pin, "pinname", tok[5].c_str());
            cJSON_AddItemToArray(pins, pin);
        }
        if (cJSON_GetArraySize(pins) > 0) {
            cJSON *gpio = child(root, "gpio");
            cJSON_AddBoolToObject(gpio, "customizationenabled", true);
            cJSON_AddItemToObject(gpio, "gpiopin", pins);
            LogFile.writeToFile(ESP_LOG_INFO, TAG, "config.ini: GPIO settings migrated, please verify them under Configuration > GPIO");
        }
        else {
            cJSON_Delete(pins);
        }
    }

    // ---- system and logging
    if (asNumber(firstValue(section("System"), "CPUFrequency"), n)) j.num({"system"}, "cpufrequency", n);
    if (asNumber(firstValue(section("Debug"), "LogLevel"), n) && n >= 1 && n <= 4) j.num({"log", "debug"}, "loglevel", n);
    if (const std::string *tz = firstValue(section("System"), "TimeZone")) j.str({"network", "time"}, "timezone", *tz);
    if (const std::string *v = firstValue(section("DataLogging"), "DataLogActive")) j.boolean({"log", "data"}, "enabled", asBool(*v));
    if (asNumber(firstValue(section("DataLogging"), "DataFilesRetention"), n)) j.num({"log", "data"}, "datafilesretention", n);
    if (asNumber(firstValue(section("Debug"), "LogfilesRetention"), n)) j.num({"log", "debug"}, "logfilesretention", n);

    char *printed = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!printed) return false;
    json = printed;
    cJSON_free(printed);

    LogFile.writeToFile(ESP_LOG_INFO, TAG, "Converted config.ini (firmware v16) to JSON configuration");
    return true;
}


// Takes over the last valid value of prevalue.ini ("<sequence> <timestamp> <value>") into the NVS storage of the fallback value
static void migratePrevalue()
{
    std::string text;
    if (!fileExists(LEGACY_PREVALUE_FILE) || !readFileToString(LEGACY_PREVALUE_FILE, text)) {
        return;
    }

    size_t end = text.find('\n');
    const std::vector<std::string> tok = splitWhitespace(text.substr(0, end));
    if (tok.size() < 3) {
        return;
    }
    const std::string &name = tok[0];
    const std::string &time = tok[1]; // 2026-11-06T16:29:21+0100 (the part behind the seconds is ignored when reading)
    const std::string &value = tok.back();

    nvs_handle_t handle;
    esp_err_t err = nvs_open("fallbackvalue", NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "prevalue.ini: nvs_open failed | Error: " + intToHexString(err));
        return;
    }

    err = nvs_set_i16(handle, "sequence_size", 1);
    if (err == ESP_OK) err = nvs_set_str(handle, "name0", name.c_str());
    if (err == ESP_OK) err = nvs_set_str(handle, "time0", time.c_str());
    if (err == ESP_OK) err = nvs_set_str(handle, "value0", value.c_str());
    if (err == ESP_OK) err = nvs_commit(handle);
    nvs_close(handle);

    if (err != ESP_OK) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "prevalue.ini: Failed to store fallback value | Error: " + intToHexString(err));
        return;
    }

    LogFile.writeToFile(ESP_LOG_INFO, TAG, "Migrated last valid value of '" + name + "' from prevalue.ini: " + value);
    renameFile(LEGACY_PREVALUE_FILE, LEGACY_PREVALUE_FILE_MIGRATED);
}


void legacyIniFinishMigration()
{
    // Alignment marker images: ref0.jpg / ref1.jpg -> marker1.jpg / marker2.jpg
    const char *const markers[][2] = {{"/sdcard/config/ref0.jpg", "/sdcard/config/marker1.jpg"},
                                      {"/sdcard/config/ref1.jpg", "/sdcard/config/marker2.jpg"}};
    for (const auto &m : markers) {
        if (fileExists(m[0])) {
            if (copyFile(m[0], m[1])) {
                LogFile.writeToFile(ESP_LOG_INFO, TAG, std::string("Alignment marker image copied: ") + m[0] + " -> " + m[1]);
            }
            else {
                LogFile.writeToFile(ESP_LOG_WARN, TAG, std::string("Failed to copy alignment marker image: ") + m[0]);
            }
        }
    }

    // Model files: /config/<model> -> /config/models/<model>
    for (const std::string &model : legacyModelFiles) {
        const std::string source = "/sdcard/config/" + model;
        const std::string target = "/sdcard/config/models/" + model;
        if (fileExists(target)) {
            continue;
        }
        if (!fileExists(source)) {
            LogFile.writeToFile(ESP_LOG_WARN, TAG, "Model file not found, upload it to /config/models: " + model);
        }
        else if (copyFile(source, target)) {
            LogFile.writeToFile(ESP_LOG_INFO, TAG, "Model file copied: " + source + " -> " + target);
        }
        else {
            LogFile.writeToFile(ESP_LOG_WARN, TAG, "Failed to copy model file: " + source);
        }
    }
    legacyModelFiles.clear();

    migratePrevalue();

    if (renameFile(LEGACY_INI_FILE, LEGACY_INI_FILE_MIGRATED)) {
        LogFile.writeToFile(ESP_LOG_INFO, TAG, "Migration done: config.ini renamed to config.ini.migrated");
    }
    else {
        LogFile.writeToFile(ESP_LOG_WARN, TAG, "Migration done, but config.ini could not be renamed");
    }
}
