#pragma once

// Helpers for the JSON REST API (/api/...): JSON responses and JSON request bodies.
// Every response is an object. Errors use an HTTP error status and {"ok":false,"code":"E..","message":".."}.

#include <cstdio>
#include <cstdlib>
#include <string>

#include <cJSON.h>
#include <esp_http_server.h>


// Sends the object (ownership is taken, it is deleted here) as application/json. status: "200 OK", "409 Conflict", ...
inline esp_err_t apiSendJson(httpd_req_t *req, const char *status, cJSON *object)
{
    if (object == NULL) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "E91: Error, JSON object cannot be created");
        return ESP_FAIL;
    }

    char *json = cJSON_PrintUnformatted(object);
    cJSON_Delete(object);
    if (json == NULL) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "E91: Error, JSON object cannot be serialized");
        return ESP_FAIL;
    }

    httpd_resp_set_status(req, status);
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
    httpd_resp_set_type(req, "application/json");
    const esp_err_t result = httpd_resp_sendstr(req, json);
    cJSON_free(json);
    return result;
}


// {"ok":ok,"code":"001","message":"text"}
inline esp_err_t apiSendResult(httpd_req_t *req, const char *status, bool ok, const char *code, const std::string &message)
{
    cJSON *object = cJSON_CreateObject();
    if (object != NULL) {
        cJSON_AddBoolToObject(object, "ok", ok);
        cJSON_AddStringToObject(object, "code", code);
        cJSON_AddStringToObject(object, "message", message.c_str());
    }
    return apiSendJson(req, status, object);
}


// Reads the request body (max. 4 KB) and parses it as JSON object. Returns NULL (response already sent) on failure.
// The caller has to cJSON_Delete() the result.
inline cJSON *apiReadJsonBody(httpd_req_t *req)
{
    const size_t maxLen = 4096;
    if (req->content_len == 0 || req->content_len > maxLen) {
        apiSendResult(req, "400 Bad Request", false, "E91", "Request body missing or too large (JSON object, max. 4 KB)");
        return NULL;
    }

    char *buffer = (char *)malloc(req->content_len + 1);
    if (buffer == NULL) {
        apiSendResult(req, "500 Internal Server Error", false, "E91", "Out of memory");
        return NULL;
    }

    size_t received = 0;
    while (received < req->content_len) {
        const int r = httpd_req_recv(req, buffer + received, req->content_len - received);
        if (r <= 0) {
            free(buffer);
            apiSendResult(req, "400 Bad Request", false, "E91", "Request body could not be read");
            return NULL;
        }
        received += r;
    }
    buffer[received] = '\0';

    cJSON *root = cJSON_Parse(buffer);
    free(buffer);
    if (root == NULL || !cJSON_IsObject(root)) {
        cJSON_Delete(root);
        apiSendResult(req, "400 Bad Request", false, "E91", "Request body is not a valid JSON object");
        return NULL;
    }
    return root;
}


// String member of an object (numbers are converted), empty string if missing
inline std::string apiGetString(const cJSON *object, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    if (cJSON_IsString(item) && item->valuestring != NULL) {
        return item->valuestring;
    }
    if (cJSON_IsNumber(item)) {
        char text[32];
        snprintf(text, sizeof(text), "%.10g", item->valuedouble);
        return text;
    }
    return "";
}


// Integer member, false if missing or not a number
inline bool apiGetInt(const cJSON *object, const char *key, int &value)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    if (!cJSON_IsNumber(item)) {
        return false;
    }
    value = (int)item->valuedouble;
    return true;
}
