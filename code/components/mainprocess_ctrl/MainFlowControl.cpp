#include "MainFlowControl.h"
#include "../../include/defines.h"
#include "../../include/api_helper.h"

#include <string>
#include <vector>

#include <esp_log.h>
#include <esp_timer.h>
#include "esp_heap_caps.h"
#include <cJSON.h>

#include "configClass.h"
#include "helper.h"
#include "system.h"
#include "statusled.h"
#include "time_sntp.h"
#include "ClassControlCamera.h"
#include "ClassLogFile.h"
#include "gpioControl.h"
#include "webserver.h"
#include "server_file.h"
#include "network_main.h"
#include "connect_wlan.h"
#include "psram.h"
#include "CImageMod.h"
#include "ClassFlowLive.h"

#ifdef ENABLE_MQTT
#include "interface_mqtt.h"
#include "server_mqtt.h"
#endif // ENABLE_MQTT


static const char *TAG = "MAINCTRL";

ClassFlowControl flowctrl;

static TaskHandle_t xHandletask_autodoFlow = NULL;
static bool bTaskAutoFlowCreated = false;
static int taskAutoFlowState = FLOW_TASK_STATE_SETUPMODE;
static bool reloadConfig = false;
static bool manualFlowStart = false;
static long automaticProcessInterval = 0;
static int cycleCounter = 0;
static int processingTime = 0;
static time_t cycleStartUptime = 0; // Uptime [s] when the running cycle started
static bool autoCountdownPaused = false;     // Countdown to the next automatic cycle is paused (config mode), reset by reboot
static int64_t autoCountdownRemainingMs = -1; // Remaining wait time until the next automatic cycle [ms], -1 if not waiting
static time_t lastSuccessUptime = -1;         // Uptime [s] of the last successful cycle, -1 if there was none since boot
static std::string lastSuccessTime = "";      // Local time of the last successful cycle (ISO 8601)


bool doInit(void)
{
    bool bRetVal = true;

    // Deinit main flow components before init all ressources again
    // ********************************************
    flowctrl.deinitFlow();

#ifdef DEBUG_DETAIL_ON
    heap_caps_dump(MALLOC_CAP_INTERNAL);
    heap_caps_dump(MALLOC_CAP_SPIRAM);
#endif // DEBUG_DETAIL_ON

    // Apply actual config
    // ********************************************
    ConfigClass::getInstance()->reinitConfig();

    // Init GPIO handler (for generic usage)
    // Note 1: GPIO has to be initialized before MQTT (topic subscription)
    // Note 2: GPIO handler gets either init here,
    // - in cameraCtrl.initFlashlight() to control flashlight
    // - in initStatusLed() to control smartled statusLED
    // ********************************************
    deinitGpioHandler();

#ifdef GPIO_STATUS_LED_ONBOARD_USE_SMARTLED
    // Enable if status LED is a smartLED
    if (!initGpioHandler()) {
        bRetVal = false;
    }
#else
    // Enable only if GPIO customization is enabled
    if (ConfigClass::getInstance()->get()->sectionGpio.customizationEnabled) {
        if (!initGpioHandler()) {
            bRetVal = false;
        }
    }
#endif

    // Init camera
    // Note: Make sure this is called between deinit and init
    // of flow components (avoid SPIRAM fragmentation)
    // ********************************************
    if (cameraCtrl.initCam() != ESP_OK) { // Camera init failed
        return false;
    }

    // Init main flow components
    // ********************************************
    if (!flowctrl.initFlow()) {
        flowctrl.deinitFlow();
        return false;
    }

    // Init MQTT service
    // ********************************************
#ifdef ENABLE_MQTT
    if (!flowctrl.initMqttService()) {
        bRetVal = false;
    }
#endif // ENABLE_MQTT

#ifdef DEBUG_DETAIL_ON
    heap_caps_dump(MALLOC_CAP_INTERNAL);
    heap_caps_dump(MALLOC_CAP_SPIRAM);
#endif // DEBUG_DETAIL_ON

    return bRetVal;
}


esp_err_t triggerReloadConfig(httpd_req_t *req)
{
    static char codeBuf[16] = {0};
    static char messageBuf[128] = {0};

    const std::string timestamp = getCurrentTimeString("%H:%M:%S");

    if (taskAutoFlowState == FLOW_TASK_STATE_INIT || taskAutoFlowState == FLOW_TASK_STATE_SETUPMODE ||
        taskAutoFlowState == FLOW_TASK_STATE_IDLE_NO_AUTOSTART) {
        snprintf(codeBuf, sizeof(codeBuf), "001");
        snprintf(messageBuf, sizeof(messageBuf), "001: Reload config and redo flow initialization (%s)", timestamp.c_str());
        reloadConfig = true;
    }
    else if (taskAutoFlowState == FLOW_TASK_STATE_INIT_DELAYED) {
        snprintf(codeBuf, sizeof(codeBuf), "002");
        snprintf(messageBuf, sizeof(messageBuf), "002: Abort waiting delay and continue with process initialization (%s)",
                 timestamp.c_str());
        xTaskAbortDelay(xHandletask_autodoFlow);
    }
    else if (taskAutoFlowState == FLOW_TASK_STATE_IDLE_AUTOSTART) {
        snprintf(codeBuf, sizeof(codeBuf), "003");
        snprintf(messageBuf, sizeof(messageBuf), "003: Abort waiting delay, reload config and reinitialize process (%s)",
                 timestamp.c_str());
        reloadConfig = true;
        xTaskAbortDelay(xHandletask_autodoFlow);
    }
    else if (taskAutoFlowState == FLOW_TASK_STATE_IMG_PROCESSING || taskAutoFlowState == FLOW_TASK_STATE_PUBLISH_DATA ||
             taskAutoFlowState == FLOW_TASK_STATE_ADDITIONAL_TASKS) {
        LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "Reload config and schedule process reinitialization");
        snprintf(codeBuf, sizeof(codeBuf), "004");
        snprintf(messageBuf, sizeof(messageBuf), "004: Reload config and reinitialization got scheduled (%s)", timestamp.c_str());
        reloadConfig = true;
    }
    else {
        LogFile.writeToFile(ESP_LOG_WARN, TAG, "Reload configuration not possible. No main task. Request rejected");
        snprintf(codeBuf, sizeof(codeBuf), "E90");
        snprintf(messageBuf, sizeof(messageBuf), "E90: Reload config not possible. No main task. Request rejected (%s)", timestamp.c_str());
    }

    // --- Send Response
    if (req->method == HTTP_GET) {
        httpd_resp_set_type(req, "text/plain");
        return httpd_resp_send(req, messageBuf, strlen(messageBuf));
    }
    else if (req->method == HTTP_POST) {
        httpd_resp_set_hdr(req, "Access-Control-Expose-Headers", "X-Reload-Code, X-Reload-Message");
        httpd_resp_set_hdr(req, "X-Reload-Code", codeBuf);
        httpd_resp_set_hdr(req, "X-Reload-Message", messageBuf);
    }

    return ESP_OK;
}


#ifdef ENABLE_MQTT
esp_err_t triggerFlowStartByMqtt(std::string _topic)
{
    if (taskAutoFlowState == FLOW_TASK_STATE_IDLE_NO_AUTOSTART || taskAutoFlowState == FLOW_TASK_STATE_IDLE_AUTOSTART) {
        LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "Cycle start triggered by MQTT topic " + _topic);
        manualFlowStart = true;

        if (taskAutoFlowState == FLOW_TASK_STATE_IDLE_AUTOSTART) {
            xTaskAbortDelay(xHandletask_autodoFlow); // Delay will be aborted if task is in blocked (waiting) state
        }
    }
    else if (taskAutoFlowState == FLOW_TASK_STATE_IMG_PROCESSING || taskAutoFlowState == FLOW_TASK_STATE_PUBLISH_DATA ||
             taskAutoFlowState == FLOW_TASK_STATE_ADDITIONAL_TASKS) {
        LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "Cycle start triggered by MQTT topic " + _topic + " got scheduled");
        manualFlowStart = true;
    }
    else {
        LogFile.writeToFile(ESP_LOG_WARN, TAG,
                            "Cycle start triggered by MQTT topic " + _topic + ". Main task not initialized. Request rejected");
    }

    return ESP_OK;
}
#endif // ENABLE_MQTT


void triggerFlowStartByGpio()
{
    if (taskAutoFlowState == FLOW_TASK_STATE_IDLE_NO_AUTOSTART || taskAutoFlowState == FLOW_TASK_STATE_IDLE_AUTOSTART) {
        LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "Cycle start triggered by GPIO");
        manualFlowStart = true;

        if (taskAutoFlowState == FLOW_TASK_STATE_IDLE_AUTOSTART) {
            xTaskAbortDelay(xHandletask_autodoFlow); // Delay will be aborted if task is in blocked (waiting) state
        }
    }
    else if (taskAutoFlowState == FLOW_TASK_STATE_IMG_PROCESSING || taskAutoFlowState == FLOW_TASK_STATE_PUBLISH_DATA ||
             taskAutoFlowState == FLOW_TASK_STATE_ADDITIONAL_TASKS) {
        LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "Cycle start triggered by GPIO got scheduled");
        manualFlowStart = true;
    }
    else {
        LogFile.writeToFile(ESP_LOG_WARN, TAG, "Cycle start triggered by GPIO. Main task not initialized. Request rejected");
    }
}


// GET /api/status: State of the main process (for the cycle display and the start button of the WebUI)
// {"api_name":"status:v1","state":"Idle - Waiting For Autostart","stateCode":7,"stateSeconds":42,"cycle":842,"autoStart":true,
//  "running":false,"cycleStart":"ready","processInterval":5.0,"processTime":12,"cycleSeconds":0,"uptime":123456,"error":0}
// processTime: duration of the last cycle [s], cycleSeconds: seconds since the running cycle started (0 if idle)
// cycleStart: "ready" (starts immediately), "queued" (starts after the running cycle), "unavailable" (not initialized)
static const char *getCycleStartAvailability(void)
{
    if (taskAutoFlowState == FLOW_TASK_STATE_IDLE_NO_AUTOSTART || taskAutoFlowState == FLOW_TASK_STATE_IDLE_AUTOSTART ||
        flowctrl.getActualProcessState() == FLOW_INIT_WAITING_VALID_TIME || flowctrl.getActualProcessState() == FLOW_INIT_FAILED ||
        taskAutoFlowState == FLOW_TASK_STATE_INIT_DELAYED) {
        return "ready";
    }
    if (taskAutoFlowState == FLOW_TASK_STATE_IMG_PROCESSING || taskAutoFlowState == FLOW_TASK_STATE_PUBLISH_DATA ||
        taskAutoFlowState == FLOW_TASK_STATE_ADDITIONAL_TASKS) {
        return manualFlowStart ? "unavailable" : "queued"; // a start is already queued
    }
    return "unavailable";
}


esp_err_t handler_api_status(httpd_req_t *req)
{
    LiveFlow::markWatched(); // the WebUI polls the status regularly: someone is looking
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        return apiSendJson(req, "200 OK", NULL);
    }

    const bool running = taskAutoFlowState == FLOW_TASK_STATE_IMG_PROCESSING || taskAutoFlowState == FLOW_TASK_STATE_PUBLISH_DATA ||
                         taskAutoFlowState == FLOW_TASK_STATE_ADDITIONAL_TASKS;
    time_t since = flowctrl.getActualProcessStateSince();
    const time_t now = getUptime();

    cJSON_AddStringToObject(root, "api_name", "status:v1");
    cJSON_AddStringToObject(root, "state", flowctrl.getActualProcessState().c_str());
    cJSON_AddNumberToObject(root, "stateCode", taskAutoFlowState);
    cJSON_AddNumberToObject(root, "stateSeconds", now >= since ? (double)(now - since) : 0);
    cJSON_AddNumberToObject(root, "cycle", cycleCounter);
    cJSON_AddBoolToObject(root, "autoStart", flowctrl.isAutoStart());
    cJSON_AddBoolToObject(root, "running", running);
    cJSON_AddStringToObject(root, "cycleStart", getCycleStartAvailability());
    cJSON_AddNumberToObject(root, "processInterval", (int)(flowctrl.getProcessInterval() * 100) / 100.0);
    cJSON_AddNumberToObject(root, "processTime", processingTime);
    cJSON_AddNumberToObject(root, "cycleSeconds", running && now >= cycleStartUptime ? (double)(now - cycleStartUptime) : 0);
    cJSON_AddNumberToObject(root, "uptime", (double)now);
    cJSON_AddNumberToObject(root, "error", flowctrl.getFlowStateErrorOrDeviation());
    // Countdown to the next automatic cycle [s], -1 if the process is not waiting for one
    cJSON_AddNumberToObject(root, "nextRunSeconds",
                            taskAutoFlowState == FLOW_TASK_STATE_IDLE_AUTOSTART && autoCountdownRemainingMs >= 0
                                ? (double)((autoCountdownRemainingMs + 999) / 1000)
                                : -1);
    cJSON_AddBoolToObject(root, "paused", autoCountdownPaused);
    // Last successful cycle: age [s] (-1: none since boot) and local time
    cJSON_AddNumberToObject(root, "lastSuccessSeconds", lastSuccessUptime >= 0 && now >= lastSuccessUptime ? (double)(now - lastSuccessUptime) : -1);
    cJSON_AddStringToObject(root, "lastSuccess", lastSuccessTime.c_str());
    return apiSendJson(req, "200 OK", root);
}


// POST /api/cycle: Trigger a cycle start. {"ok":true,"code":"001","message":"..."}
// 001 started, 002 queued (after the running cycle), 003 init delay aborted, E90 rejected (not initialized, HTTP 409)
esp_err_t handler_api_cycle(httpd_req_t *req)
{
    const std::string timeStamp = " (" + getCurrentTimeString("%H:%M:%S") + ")";

    // POST /api/cycle {"paused":true|false}: pause or resume the countdown to the next automatic cycle (config mode)
    if (req->content_len > 0) {
        cJSON *body = apiReadJsonBody(req);
        if (body == NULL) {
            return ESP_FAIL; // response already sent
        }
        const cJSON *paused = cJSON_GetObjectItemCaseSensitive(body, "paused");
        if (!cJSON_IsBool(paused)) {
            cJSON_Delete(body);
            return apiSendResult(req, "400 Bad Request", false, "E91", "Parameter 'paused' (boolean) missing");
        }
        autoCountdownPaused = cJSON_IsTrue(paused);
        cJSON_Delete(body);
        LogFile.writeToFile(ESP_LOG_INFO, TAG, autoCountdownPaused ? "Automatic cycle countdown paused (REST API)" : "Automatic cycle countdown resumed (REST API)");
        return apiSendResult(req, "200 OK", true, autoCountdownPaused ? "004" : "005",
                             std::string(autoCountdownPaused ? "Countdown paused" : "Countdown resumed") + timeStamp);
    }

    if (taskAutoFlowState == FLOW_TASK_STATE_IDLE_NO_AUTOSTART || taskAutoFlowState == FLOW_TASK_STATE_IDLE_AUTOSTART ||
        flowctrl.getActualProcessState() == FLOW_INIT_WAITING_VALID_TIME ||
        flowctrl.getActualProcessState() == FLOW_INIT_FAILED) // Possibility to manual retrigger a cycle when init is already failed
    {
        LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "Cycle start triggered by REST API");
        manualFlowStart = true;

        if (taskAutoFlowState == FLOW_TASK_STATE_IDLE_AUTOSTART) {
            xTaskAbortDelay(xHandletask_autodoFlow); // Delay will be aborted if task is in blocked (waiting) state
        }
        return apiSendResult(req, "200 OK", true, "001", "Cycle start triggered" + timeStamp);
    }

    if (taskAutoFlowState == FLOW_TASK_STATE_IMG_PROCESSING || taskAutoFlowState == FLOW_TASK_STATE_PUBLISH_DATA ||
        taskAutoFlowState == FLOW_TASK_STATE_ADDITIONAL_TASKS) {
        LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "Cycle start triggered by REST API got scheduled");
        manualFlowStart = true;
        return apiSendResult(req, "200 OK", true, "002", "Cycle start scheduled, starts after the running cycle" + timeStamp);
    }

    if (taskAutoFlowState == FLOW_TASK_STATE_INIT_DELAYED) {
        LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "Cycle start triggered by REST API (abort state 'Initialization (delayed)'");
        xTaskAbortDelay(xHandletask_autodoFlow); // Delay will be aborted if task is in blocked (waiting) state
        return apiSendResult(req, "200 OK", true, "003", "Initialization delay aborted" + timeStamp);
    }

    LogFile.writeToFile(ESP_LOG_WARN, TAG, "Cycle start triggered by REST API. Main task not initialized. Request rejected");
    return apiSendResult(req, "409 Conflict", false, "E90", "Main task not initialized. Request rejected" + timeStamp);
}


// GET /api/fallback?sequence=<name>: {"ok":true,"sequence":"main","value":"530.0080"}
// POST /api/fallback {"sequence":"main","value":"1234.5"}: value >= 0 sets the Fallback Value, value < 0 takes the actual RAW value
esp_err_t handler_api_fallback(httpd_req_t *req)
{
    if (taskAutoFlowState <= FLOW_TASK_STATE_INIT) {
        return apiSendResult(req, "403 Forbidden", false, "E95", "Request rejected, flow not initialized");
    }

    std::string sequence, value;
    if (req->method == HTTP_POST) {
        cJSON *body = apiReadJsonBody(req);
        if (body == NULL) {
            return ESP_FAIL; // response already sent
        }
        sequence = apiGetString(body, "sequence");
        value = apiGetString(body, "value");
        cJSON_Delete(body);
    }
    else {
        char query[100];
        char param[50];
        if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK &&
            httpd_query_key_value(query, "sequence", param, sizeof(param)) == ESP_OK) {
            sequence = param;
        }
    }

    if (sequence.empty()) {
        return apiSendResult(req, "400 Bad Request", false, "E91", "Parameter 'sequence' missing");
    }

    if (req->method == HTTP_POST) {
        if (value.empty() || value.size() >= 20) {
            return apiSendResult(req, "400 Bad Request", false, "E91", "Parameter 'value' missing or invalid");
        }

        LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "REST API fallback value called: sequence: " + sequence + ", value: " + value);
        if (!flowctrl.setFallbackValue(sequence, value)) {
            return apiSendResult(req, "409 Conflict", false, "E93", "Update request rejected. Please check device logs for more details");
        }
    }

    const std::string current = flowctrl.getFallbackValue(sequence);
    if (current.empty()) {
        return apiSendResult(req, "404 Not Found", false, "E92", "Number sequence not found");
    }

    cJSON *root = cJSON_CreateObject();
    if (root != NULL) {
        cJSON_AddBoolToObject(root, "ok", true);
        cJSON_AddStringToObject(root, "sequence", sequence.c_str());
        cJSON_AddStringToObject(root, "value", current.c_str());
    }
    return apiSendJson(req, "200 OK", root);
}


// Only files below /config/ and /img_tmp/ may be addressed by the flow editing endpoints
static bool isFlowEditPathAllowed(const std::string &path)
{
    return path.size() < 100 && path.find("..") == std::string::npos &&
           (path.rfind("/config/", 0) == 0 || path.rfind("/img_tmp/", 0) == 0);
}


// POST /api/flow/copy {"in":"/img_tmp/marker1.jpg","out":"/config/marker1.jpg"}
esp_err_t handler_api_flow_copy(httpd_req_t *req)
{
    cJSON *body = apiReadJsonBody(req);
    if (body == NULL) {
        return ESP_FAIL; // response already sent
    }
    const std::string in = apiGetString(body, "in");
    const std::string out = apiGetString(body, "out");
    cJSON_Delete(body);

    if (!isFlowEditPathAllowed(in) || !isFlowEditPathAllowed(out)) {
        return apiSendResult(req, "400 Bad Request", false, "E91", "Parameters 'in' and 'out' must be paths below /config/ or /img_tmp/");
    }

    copyFile("/sdcard" + in, "/sdcard" + out);
    return apiSendResult(req, "200 OK", true, "001", "Copy done");
}


// POST /api/flow/cutref {"in":"/config/reference.jpg","out":"/img_tmp/marker1.jpg","x":10,"y":10,"dx":40,"dy":40}
esp_err_t handler_api_flow_cutref(httpd_req_t *req)
{
    if (taskAutoFlowState < FLOW_TASK_STATE_INIT_DELAYED) {
        return apiSendResult(req, "403 Forbidden", false, "E90", "Request rejected, flow not initialized");
    }
    // Interlock request for memory category 4MB due to memory limitation
    if (taskAutoFlowState == FLOW_TASK_STATE_IMG_PROCESSING && getSPIRAMCategory() == SPIRAMCategory_4MB) {
        return apiSendResult(req, "405 Method Not Allowed", false, "E91",
                             "Request rejected, flow in process | Actual State: " + flowctrl.getActualProcessState());
    }

    cJSON *body = apiReadJsonBody(req);
    if (body == NULL) {
        return ESP_FAIL; // response already sent
    }
    std::string in = apiGetString(body, "in");
    std::string out = apiGetString(body, "out");
    int x = 0, y = 0, dx = 0, dy = 0;
    const bool numbersOk = apiGetInt(body, "x", x) && apiGetInt(body, "y", y) && apiGetInt(body, "dx", dx) && apiGetInt(body, "dy", dy);
    cJSON_Delete(body);

    if (!isFlowEditPathAllowed(in) || !isFlowEditPathAllowed(out) || !numbersOk || x < 0 || y < 0 || dx < 1 || dy < 1) {
        return apiSendResult(req, "400 Bad Request", false, "E91", "Parameters in, out, x, y, dx, dy missing or invalid");
    }

    in = "/sdcard" + in;   // --> config/reference.jpg
    out = "/sdcard" + out; // --> img_tmp/markerX.jpg

    // 4MB RAM external SPIRAM are not sufficient to perform alignment marker update while processing cycle
    // Reuse allocated memory of CImage element "imgProcess" (ClassTakeImage.cpp) and interlock operation at UI level
    if (taskAutoFlowState >= FLOW_TASK_STATE_IDLE_NO_AUTOSTART && getSPIRAMCategory() == SPIRAMCategory_4MB) {
        STBIObjectPSRAM.usePreallocated = true;
        STBIObjectPSRAM.name = flowctrl.getFlowImageData()->imgProcess->getName();
        STBIObjectPSRAM.PreallocatedMemory = flowctrl.getFlowImageData()->imgProcess->getImgData();
        STBIObjectPSRAM.PreallocatedMemorySize = flowctrl.getFlowImageData()->imgProcess->getAllocSize();
    }
    else {
        STBIObjectPSRAM.usePreallocated = false;
    }
    // Create element, be aware: CImage of process image will be created first (921kB RAM required)
    CImage *img = new CImage("markerSource", in, STBIObjectPSRAM.usePreallocated);
    CImage *imgCropped = new CImage("markerCropped", dx, dy, STBI_rgb);

    CImageMod::crop(*img, x, y, dx, dy, *imgCropped);
    imgCropped->saveJpgToFile(out, 100);

    delete imgCropped;
    delete img;

    return apiSendResult(req, "200 OK", true, "001", "Cut image done");
}


esp_err_t handler_process_data(httpd_req_t *req)
{
    if (!bTaskAutoFlowCreated) {
        httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "E90: Request rejected, flow not initialized");
        return ESP_FAIL;
    }

    const char *APIName = "process_data:v3"; // API name and version
    char query[200];
    char valuechar[30];
    std::string type, numberSequence;

    if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
        if (httpd_query_key_value(query, "type", valuechar, sizeof(valuechar)) == ESP_OK) {
            type = std::string(valuechar);
        }
        if (httpd_query_key_value(query, "sequence", valuechar, sizeof(valuechar)) == ESP_OK) {
            numberSequence = std::string(valuechar);
        }
    }
    else { // default - no parameter set: send data as JSON
        esp_err_t retVal = ESP_OK;
        cJSON *cJSONObject = cJSON_CreateObject();

        if (cJSONObject == NULL) {
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "E91: Error, JSON object cannot be created");
            return ESP_FAIL;
        }

        if (cJSON_AddStringToObject(cJSONObject, "api_name", APIName) == NULL) {
            retVal = ESP_FAIL;
        }
        if (cJSON_AddNumberToObject(cJSONObject, "number_sequences", flowctrl.getSequenceData().size()) == NULL) {
            retVal = ESP_FAIL;
        }

        cJSON *cJSONObjectTimestampProcessed;
        if (!cJSON_AddItemToObject(cJSONObject, "timestamp_processed", cJSONObjectTimestampProcessed = cJSON_CreateObject())) {
            retVal = ESP_FAIL;
        }
        cJSON *cJSONObjectTimestampFallbackValue;
        if (!cJSON_AddItemToObject(cJSONObject, "timestamp_fallbackvalue", cJSONObjectTimestampFallbackValue = cJSON_CreateObject())) {
            retVal = ESP_FAIL;
        }
        cJSON *cJSONObjectActualValue;
        if (!cJSON_AddItemToObject(cJSONObject, "actual_value", cJSONObjectActualValue = cJSON_CreateObject())) {
            retVal = ESP_FAIL;
        }
        cJSON *cJSONObjectFallbackValue;
        if (!cJSON_AddItemToObject(cJSONObject, "fallback_value", cJSONObjectFallbackValue = cJSON_CreateObject())) {
            retVal = ESP_FAIL;
        }
        cJSON *cJSONObjectRawValue;
        if (!cJSON_AddItemToObject(cJSONObject, "raw_value", cJSONObjectRawValue = cJSON_CreateObject())) {
            retVal = ESP_FAIL;
        }
        cJSON *cJSONObjectValueStatus;
        if (!cJSON_AddItemToObject(cJSONObject, "value_status", cJSONObjectValueStatus = cJSON_CreateObject())) {
            retVal = ESP_FAIL;
        }
        cJSON *cJSONObjectRatePerMin;
        if (!cJSON_AddItemToObject(cJSONObject, "rate_per_minute", cJSONObjectRatePerMin = cJSON_CreateObject())) {
            retVal = ESP_FAIL;
        }
        cJSON *cJSONObjectRatePerInterval;
        if (!cJSON_AddItemToObject(cJSONObject, "rate_per_interval", cJSONObjectRatePerInterval = cJSON_CreateObject())) {
            retVal = ESP_FAIL;
        }

        for (const auto &sequence : flowctrl.getSequenceData()) {
            if (cJSON_AddStringToObject(cJSONObjectTimestampProcessed, sequence->sequenceName.c_str(), sequence->sTimeProcessed.c_str()) ==
                NULL) {
                retVal = ESP_FAIL;
            }
            if (cJSON_AddStringToObject(cJSONObjectTimestampFallbackValue, sequence->sequenceName.c_str(),
                                        sequence->sTimeFallbackValue.c_str()) == NULL) {
                retVal = ESP_FAIL;
            }
            if (cJSON_AddStringToObject(cJSONObjectActualValue, sequence->sequenceName.c_str(), sequence->sActualValue.c_str()) == NULL) {
                retVal = ESP_FAIL;
            }
            if (cJSON_AddStringToObject(cJSONObjectFallbackValue, sequence->sequenceName.c_str(), sequence->sFallbackValue.c_str()) ==
                NULL) {
                retVal = ESP_FAIL;
            }
            if (cJSON_AddStringToObject(cJSONObjectRawValue, sequence->sequenceName.c_str(), sequence->sRawValue.c_str()) == NULL) {
                retVal = ESP_FAIL;
            }
            if (cJSON_AddStringToObject(cJSONObjectValueStatus, sequence->sequenceName.c_str(), sequence->sValueStatus.c_str()) == NULL) {
                retVal = ESP_FAIL;
            }
            if (cJSON_AddStringToObject(cJSONObjectRatePerMin, sequence->sequenceName.c_str(), sequence->sRatePerMin.c_str()) == NULL) {
                retVal = ESP_FAIL;
            }
            if (cJSON_AddStringToObject(cJSONObjectRatePerInterval, sequence->sequenceName.c_str(), sequence->sRatePerInterval.c_str()) ==
                NULL) {
                retVal = ESP_FAIL;
            }
        }

        if (cJSON_AddStringToObject(cJSONObject, "process_status", getProcessStatus().c_str()) == NULL) {
            retVal = ESP_FAIL;
        }
        if (cJSON_AddNumberToObject(cJSONObject, "process_interval", (int)(flowctrl.getProcessInterval() * 10) / 10.0) == NULL) {
            retVal = ESP_FAIL;
        }
        if (cJSON_AddNumberToObject(cJSONObject, "process_time", getFlowProcessingTime()) == NULL) {
            retVal = ESP_FAIL;
        }
        if (cJSON_AddStringToObject(cJSONObject, "process_state", flowctrl.getActualProcessStateWithTime().c_str()) == NULL) {
            retVal = ESP_FAIL;
        }

        // 0: No error, -1: Error occurred, -2: Multiple errors in a row, 1: Deviation occurred, 2: Multiple deviations in a row
        if (cJSON_AddNumberToObject(cJSONObject, "process_error", flowctrl.getFlowStateErrorOrDeviation()) == NULL) {
            retVal = ESP_FAIL;
        }
        if (cJSON_AddNumberToObject(cJSONObject, "device_uptime", getUptime()) == NULL) {
            retVal = ESP_FAIL;
        }
        if (cJSON_AddNumberToObject(cJSONObject, "cycle_counter", getFlowCycleCounter()) == NULL) {
            retVal = ESP_FAIL;
        }
        if (cJSON_AddNumberToObject(cJSONObject, "wlan_rssi", getWifiRssi()) == NULL) {
            retVal = ESP_FAIL;
        }

        // Print to preallocted buffer
        char *jsonData = ((struct HttpServerData *)req->user_ctx)->scratch;

        if (!cJSON_PrintPreallocated(cJSONObject, jsonData, WEBSERVER_SCRATCH_BUFSIZE, 1)) {
            retVal = ESP_FAIL;
        }

        cJSON_Delete(cJSONObject);

        httpd_resp_set_type(req, "application/json");

        if (retVal == ESP_OK) {
            httpd_resp_send(req, jsonData, strlen(jsonData));
        }
        else {
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "E92: Error while adding JSON elements");
        }

        return retVal;
    }

    /* Legacy: Provide single data as text response */
    httpd_resp_set_type(req, "text/plain");

    if (type.compare("api_name") == 0) {
        httpd_resp_sendstr(req, APIName);
        return ESP_OK;
    }
    else if (type.compare("number_sequences") == 0) {
        httpd_resp_sendstr(req, std::to_string(flowctrl.getSequenceData().size()).c_str());
        return ESP_OK;
    }
    else if (type.compare("timestamp_processed") == 0) {
        if (numberSequence.empty()) {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_TIMESTAMP_PROCESSED).c_str());
            return ESP_OK;
        }
        else {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_TIMESTAMP_PROCESSED, numberSequence).c_str());
            return ESP_OK;
        }
    }
    else if (type.compare("timestamp_fallbackvalue") == 0) {
        if (numberSequence.empty()) {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_TIMESTAMP_FALLBACKVALUE).c_str());
            return ESP_OK;
        }
        else {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_TIMESTAMP_FALLBACKVALUE, numberSequence).c_str());
            return ESP_OK;
        }
    }
    else if (type.compare("actual_value") == 0) {
        if (numberSequence.empty()) {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_VALUE).c_str());
            return ESP_OK;
        }
        else {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_VALUE, numberSequence).c_str());
            return ESP_OK;
        }
    }
    else if (type.compare("fallback_value") == 0) {
        if (numberSequence.empty()) {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_FALLBACKVALUE).c_str());
            return ESP_OK;
        }
        else {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_FALLBACKVALUE, numberSequence).c_str());
            return ESP_OK;
        }
    }
    else if (type.compare("raw_value") == 0) {
        if (numberSequence.empty()) {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_RAWVALUE).c_str());
            return ESP_OK;
        }
        else {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_RAWVALUE, numberSequence).c_str());
            return ESP_OK;
        }
    }
    else if (type.compare("value_status") == 0) {
        if (numberSequence.empty()) {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_VALUE_STATUS).c_str());
            return ESP_OK;
        }
        else {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_VALUE_STATUS, numberSequence).c_str());
            return ESP_OK;
        }
    }
    else if (type.compare("rate_per_minute") == 0) {
        if (numberSequence.empty()) {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_RATE_PER_MIN).c_str());
            return ESP_OK;
        }
        else {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_RATE_PER_MIN, numberSequence).c_str());
            return ESP_OK;
        }
    }
    else if (type.compare("rate_per_interval") == 0) {
        if (numberSequence.empty()) {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_RATE_PER_INTERVAL).c_str());
            return ESP_OK;
        }
        else {
            httpd_resp_sendstr(req, flowctrl.getSequenceResultInline(READOUT_TYPE_RATE_PER_INTERVAL, numberSequence).c_str());
            return ESP_OK;
        }
    }
    else if (type.compare("process_status") == 0) {
        httpd_resp_sendstr(req, getProcessStatus().c_str());
        return ESP_OK;
    }
    else if (type.compare("process_interval") == 0) {
        httpd_resp_sendstr(req, to_stringWithPrecision(flowctrl.getProcessInterval(), 1).c_str());
        return ESP_OK;
    }
    else if (type.compare("process_time") == 0) {
        httpd_resp_sendstr(req, std::to_string(getFlowProcessingTime()).c_str());
        return ESP_OK;
    }
    else if (type.compare("process_state") == 0) {
        httpd_resp_sendstr(req, flowctrl.getActualProcessStateWithTime().c_str());
        return ESP_OK;
    }
    else if (type.compare("process_error") == 0) {
        // 000: No error, E01: Error occurred, E02: Multiple errors in a row, 001: Deviation occurred, 002: Multiple deviations in a row
        if (flowctrl.getFlowStateErrorOrDeviation() == 0) {
            httpd_resp_sendstr(req, "000: No process error/deviation");
        }
        else if (flowctrl.getFlowStateErrorOrDeviation() == -2) {
            httpd_resp_sendstr(req, "E02: Multiple process errors in row");
        }
        else if (flowctrl.getFlowStateErrorOrDeviation() == 2) {
            httpd_resp_sendstr(req, "002: Multiple process deviation in row");
        }
        else if (flowctrl.getFlowStateErrorOrDeviation() == -1) {
            httpd_resp_sendstr(req, "E01: Process error occurred");
        }
        else if (flowctrl.getFlowStateErrorOrDeviation() == 1) {
            httpd_resp_sendstr(req, "001: Process deviation occurred");
        }
        return ESP_OK;
    }
    else if (type.compare("device_uptime") == 0) {
        httpd_resp_sendstr(req, std::to_string(getUptime()).c_str());
        return ESP_OK;
    }
    else if (type.compare("cycle_counter") == 0) {
        httpd_resp_sendstr(req, std::to_string(getFlowCycleCounter()).c_str());
        return ESP_OK;
    }
    else if (type.compare("wlan_rssi") == 0) {
        httpd_resp_sendstr(req, std::to_string(getWifiRssi()).c_str());
        return ESP_OK;
    }
    else {
        httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "E93: Parameter not found");
        return ESP_FAIL;
    }
}


// Helper: ROI list of one kind (digit or analog) as JSON object {"enabled":bool,"rois":[...]}
static void addRecognitionRois(cJSON *parent, const char *key, const auto &roiList, bool enabled)
{
    cJSON *group = cJSON_AddObjectToObject(parent, key);
    cJSON_AddBoolToObject(group, "enabled", enabled);
    cJSON *rois = cJSON_AddArrayToObject(group, "rois");

    if (!enabled) {
        return;
    }

    for (const auto &roi : roiList) {
        cJSON *item = cJSON_CreateObject();
        cJSON_AddStringToObject(item, "name", roi->param->roiName.c_str());
        if (roi->CNNResult > -1) {
            cJSON_AddBoolToObject(item, "valid", true);
            cJSON_AddStringToObject(item, "value", roi->sCNNResult.c_str());
            cJSON_AddStringToObject(item, "image", ("/img_tmp/" + roi->param->roiName + "_org.jpg").c_str());
            if (roi->confidencePct >= 0) {
                cJSON_AddNumberToObject(item, "confidence", roi->confidencePct);
            }
        }
        else {
            cJSON_AddBoolToObject(item, "valid", false);
        }
        cJSON *rect = cJSON_AddObjectToObject(item, "rect"); // Position in the aligned image
        cJSON_AddNumberToObject(rect, "x", roi->param->x);
        cJSON_AddNumberToObject(rect, "y", roi->param->y);
        cJSON_AddNumberToObject(rect, "w", roi->param->dx);
        cJSON_AddNumberToObject(rect, "h", roi->param->dy);
        cJSON_AddItemToArray(rois, item);
    }
}


// GET /api/live: Progress of the running cycle (raw image, alignment result, ROI results as they are evaluated)
// {"api_name":"live:v1","running":true,"state":"...","cycle":842,"raw":true,"alignment":{"ok":true,"rotation":-3.2,"dx":22,"dy":-16,
//  "rawImage":"/img_tmp/raw.jpg","scale":1,"markers":[{"x":240,"y":312,"w":56,"h":34}]},
//  "rois":[{"seq":"main","kind":"digit","name":"main_dig1","value":"4.0","confidence":98,"rejected":false}]}
esp_err_t handler_api_live(httpd_req_t *req)
{
    const bool running = taskAutoFlowState == FLOW_TASK_STATE_IMG_PROCESSING || taskAutoFlowState == FLOW_TASK_STATE_PUBLISH_DATA ||
                         taskAutoFlowState == FLOW_TASK_STATE_ADDITIONAL_TASKS;
    return apiSendJson(req, "200 OK", LiveFlow::liveJson(running, flowctrl.getActualProcessState()));
}


// GET /api/recognition: Result of the last completed cycle (sequences, ROI values and images) as JSON
// {"api_name":"recognition:v3","ready":true,"state":"...","image":"/img_tmp/alg_roi.jpg",
//  "sequences":[{"name":"main","rawValue":"..","actualValue":"..","digit":{"enabled":true,"rois":[{"name":"d1","valid":true,"value":"5","image":".."}]},"analog":{..}}]}
esp_err_t handler_recognition_details(httpd_req_t *req)
{
    const char *APIName = "recognition:v3";

    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "E91: Error, JSON object cannot be created");
        return ESP_FAIL;
    }

    cJSON_AddStringToObject(root, "api_name", APIName);
    cJSON_AddStringToObject(root, "state", flowctrl.getActualProcessState().c_str());

    const bool ready = !(taskAutoFlowState < 3 || taskAutoFlowState == FLOW_TASK_STATE_IMG_PROCESSING || cycleCounter == 0);
    cJSON_AddBoolToObject(root, "ready", ready);

    if (ready) {
        const bool digitEnabled = ConfigClass::getInstance()->get()->sectionDigit.enabled;
        const bool analogEnabled = ConfigClass::getInstance()->get()->sectionAnalog.enabled;

        cJSON *sequences = cJSON_AddArrayToObject(root, "sequences");
        for (const auto &sequence : flowctrl.getSequenceData()) {
            cJSON *item = cJSON_CreateObject();
            cJSON_AddStringToObject(item, "name", sequence->sequenceName.c_str());
            cJSON_AddStringToObject(item, "rawValue", sequence->sRawValue.c_str());
            cJSON_AddStringToObject(item, "actualValue", sequence->sActualValue.c_str());
            addRecognitionRois(item, "digit", sequence->digitRoi, digitEnabled);
            addRecognitionRois(item, "analog", sequence->analogRoi, analogEnabled);
            cJSON_AddItemToArray(sequences, item);
        }
        cJSON_AddStringToObject(root, "image", "/img_tmp/alg_roi.jpg");
        LiveFlow::addAlignment(root); // raw image and pose of the last cycle (if available)
    }

    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (json == NULL) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "E91: Error, JSON object cannot be serialized");
        return ESP_FAIL;
    }

    httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
    httpd_resp_set_type(req, "application/json");
    esp_err_t retVal = httpd_resp_sendstr(req, json);
    free(json);
    return retVal;
}


void setTaskAutoFlowState(int _value)
{
    taskAutoFlowState = _value;
}


int getTaskAutoFlowState()
{
    return taskAutoFlowState;
}


std::string getProcessStatus(void)
{
    std::string process_status;

    if (flowctrl.isAutoStart() && (taskAutoFlowState >= 4 && taskAutoFlowState <= 7)) {
        process_status = "Processing (Automatic)";
    }
    else if (!flowctrl.isAutoStart() && (taskAutoFlowState >= 3 && taskAutoFlowState <= 7)) {
        process_status = "Processing (Triggered Only)";
    }
    else if (taskAutoFlowState >= 0 && taskAutoFlowState < 3) {
        process_status = "Not Processing / Not Ready";
    }
    else {
        process_status = "Status unknown - State: " + std::to_string(taskAutoFlowState);
    }

    return process_status;
}


int getFlowCycleCounter()
{
    return cycleCounter;
}


int getFlowProcessingTime()
{
    return processingTime;
}


void task_autodoFlow(void *pvParameter)
{
    int64_t cycleStartActualTime = 0;
    time_t cycleStartTime = 0;
    bTaskAutoFlowCreated = true;

    while (true) {
        // SETUP MODE CHECK
        // ********************************************
        if (taskAutoFlowState == FLOW_TASK_STATE_SETUPMODE) {
            if (flowctrl.getStatusSetupModus()) {
                LogFile.writeToFile(ESP_LOG_INFO, TAG, "Process state: " + std::string(FLOW_SETUP_MODE));
                flowctrl.setActualProcessState(std::string(FLOW_SETUP_MODE));
#ifdef ENABLE_MQTT
                publishMqttData(mqttServer_getMainTopic() + "/process/status/process_state", flowctrl.getActualProcessState(), 1, false);
#endif // ENABLE_MQTT

                while (true) { // Waiting for a REQUEST
                    vTaskDelay(1000 / portTICK_PERIOD_MS);
                    if (reloadConfig) {
                        reloadConfig = false;
                        LogFile.writeToFile(ESP_LOG_INFO, TAG, "Trigger: Reload configuration");

                        ConfigClass::getInstance()->reinitConfig();
                        if (!flowctrl.getStatusSetupModus()) {
                            taskAutoFlowState = FLOW_TASK_STATE_INIT; // Setup Mode done --> Do FLOW INIT
                            break;
                        }
                    }
                }
            }
            else {
                taskAutoFlowState = FLOW_TASK_STATE_INIT; // Setup Mode done --> Do FLOW INIT
            }
        }

        // FLOW INITIALIZATION - DELAYED
        // Delay flow initialization if reboot was triggered by software exception
        // Note: Init and logging of the event is handled already in "main.cpp"
        // ********************************************
        else if (taskAutoFlowState == FLOW_TASK_STATE_INIT_DELAYED) {
            LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Process state: " + std::string(FLOW_INIT_DELAYED));
            flowctrl.setActualProcessState(std::string(FLOW_INIT_DELAYED));
            flowctrl.setFlowStateError();
            // Right now, it's not possible to provide state via MQTT because mqtt service is not yet started

            vTaskDelay(60 * 5000 / portTICK_PERIOD_MS); // Wait 5 minutes to give time to do an OTA update or fetch the log

            taskAutoFlowState = FLOW_TASK_STATE_INIT; // Continue to FLOW INIT
        }

        // FLOW INITIALIZATION
        // ********************************************
        else if (taskAutoFlowState == FLOW_TASK_STATE_INIT) {
            LogFile.writeToFile(ESP_LOG_INFO, TAG, "Process state: " + std::string(FLOW_INIT));
            flowctrl.setActualProcessState(std::string(FLOW_INIT));

            if (!doInit()) {
                LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Process state: " + std::string(FLOW_INIT_FAILED));
                flowctrl.setActualProcessState(std::string(FLOW_INIT_FAILED));
                flowctrl.setFlowStateError();
#ifdef ENABLE_MQTT
                if (getMqttIsConnected()) {
                    publishMqttData(mqttServer_getMainTopic() + "/process/status/process_state", flowctrl.getActualProcessState(), 1,
                                    false);
                }
#endif // ENABLE_MQTT

                while (true) { // Waiting for a REQUEST
                    vTaskDelay(1000 / portTICK_PERIOD_MS);
                    if (reloadConfig) { // Possibility to manual retrigger a cycle with parameter reload when init is already failed
                        reloadConfig = false;
                        manualFlowStart = false; // parameter reload has higher prio
                        LogFile.writeToFile(ESP_LOG_INFO, TAG, "Trigger: Reload configuration");
                        taskAutoFlowState = FLOW_TASK_STATE_INIT; // Repeat FLOW INIT
                        break;
                    }
                    else if (manualFlowStart) { // Possibility to manual retrigger a cycle with manual start when init is already failed
                        manualFlowStart = false;
                        LogFile.writeToFile(ESP_LOG_INFO, TAG, "Trigger: Start process (manual trigger)");
                        taskAutoFlowState = FLOW_TASK_STATE_INIT; // Repeat FLOW INIT
                        break;
                    }
                }
            }
            else {
                // Waiting for time set to ensure process start with valid time
                if (ConfigClass::getInstance()->get()->sectionNetwork.time.processStartInterlock) {
                    LogFile.writeToFile(ESP_LOG_INFO, TAG, "Process start interlock: Waiting for valid time");
                    flowctrl.setActualProcessState(std::string(FLOW_INIT_WAITING_VALID_TIME));
#ifdef ENABLE_MQTT
                    if (getMqttIsConnected()) {
                        publishMqttData(mqttServer_getMainTopic() + "/process/status/process_state", flowctrl.getActualProcessState(), 1,
                                        false);
                    }
#endif // ENABLE_MQTT

                    while (true) { // Waiting for time sync
                        vTaskDelay(1000 / portTICK_PERIOD_MS);
                        if (reloadConfig) {
                            reloadConfig = false;
                            manualFlowStart = false; // Reload config has higher prio
                            LogFile.writeToFile(ESP_LOG_INFO, TAG, "Trigger: Reload configuration");
                            taskAutoFlowState = FLOW_TASK_STATE_INIT; // Return to state "FLOW INIT"
                            break;
                        }
                        else if (manualFlowStart) {
                            manualFlowStart = false;
                            LogFile.writeToFile(ESP_LOG_INFO, TAG, "Start process (manual trigger) without synced time");
                            taskAutoFlowState = FLOW_TASK_STATE_IDLE_NO_AUTOSTART; // Continue to test if AUTOSTART is TRUE
                            break;
                        }
                        else if ((getTimeSyncEnabled() && getTimeIsSynced()) || (!getTimeSyncEnabled() && getTimeIsSet())) {
                            taskAutoFlowState = FLOW_TASK_STATE_IDLE_NO_AUTOSTART; // Continue to test if AUTOSTART is TRUE
                            break;
                        }
                    }
                }
                else {
                    taskAutoFlowState = FLOW_TASK_STATE_IDLE_NO_AUTOSTART; // Continue to test if AUTOSTART is TRUE
                }
            }
        }

        // AUTOSTART CHECK --> AUTOMATIC OR MANUAL MODE?
        // ********************************************
        else if (taskAutoFlowState == FLOW_TASK_STATE_IDLE_NO_AUTOSTART) {
            if (!flowctrl.isAutoStart(automaticProcessInterval)) {
                LogFile.writeToFile(ESP_LOG_INFO, TAG, "Process state: " + std::string(FLOW_IDLE_NO_AUTOSTART));
                flowctrl.setActualProcessState(std::string(FLOW_IDLE_NO_AUTOSTART));
#ifdef ENABLE_MQTT
                publishMqttData(mqttServer_getMainTopic() + "/process/status/process_state", flowctrl.getActualProcessState(), 1, false);
#endif // ENABLE_MQTT

                while (true) { // Waiting for a REQUEST
                    vTaskDelay(1000 / portTICK_PERIOD_MS);
                    if (reloadConfig) {
                        reloadConfig = false;
                        manualFlowStart = false; // Reload config has higher prio
                        LogFile.writeToFile(ESP_LOG_INFO, TAG, "Trigger: Reload configuration");
                        taskAutoFlowState = FLOW_TASK_STATE_INIT; // Return to state "FLOW INIT"
                        break;
                    }
                    else if (manualFlowStart) {
                        LogFile.writeToFile(ESP_LOG_INFO, TAG, "Start process (manual trigger)");
                        taskAutoFlowState = FLOW_TASK_STATE_IMG_PROCESSING; // Start manual triggered single cycle of "FLOW PROCESSING"
                        break;
                    }
                    else {
                        // WLAN suspention handling (if activated)
                        // Check whether WLAN set to suspended mode based on configured delay time
                        // ********************************************
                        suspendWifiConnection();
                    }
                }
            }
            else {
                LogFile.writeToFile(ESP_LOG_INFO, TAG, "Start process (automatic trigger)");
                taskAutoFlowState = FLOW_TASK_STATE_IMG_PROCESSING; // Continue to state "FLOW PROCESSING"
            }
        }

        // IMAGE PROCESSING / EVALUATION
        // ********************************************
        else if (taskAutoFlowState == FLOW_TASK_STATE_IMG_PROCESSING) {
            // Clear separation between runs
            LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "--------------------------------");
            LogFile.writeToFile(ESP_LOG_INFO, TAG, "Cycle #" + std::to_string(++cycleCounter) + " started");
            LiveFlow::begin(cycleCounter);
            cycleStartTime = getUptime();
            cycleStartUptime = cycleStartTime;
            cycleStartActualTime = esp_timer_get_time();

            if (flowctrl.doFlowImageEvaluation(getCurrentTimeString(DEFAULT_TIME_FORMAT))) {
                LogFile.writeToFile(ESP_LOG_INFO, TAG,
                                    "Image evaluation completed (" + std::to_string(getUptime() - cycleStartTime) + "s)");
            }
            else {
                LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Image evaluation: Process error occured");
            }

            taskAutoFlowState = FLOW_TASK_STATE_PUBLISH_DATA; // Continue with TASKS after FLOW FINISHED
        }

        // PUBLISH DATA / RESULTS
        // ********************************************
        else if (taskAutoFlowState == FLOW_TASK_STATE_PUBLISH_DATA) {
            if (getNetworkConnectionState()) { // Skip pusblishing services if network connection is not connected or suspended
                if (!flowctrl.doFlowPublishData(getCurrentTimeString(DEFAULT_TIME_FORMAT))) {
                    LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Publish data: Process error occured");
                }
            }
            else {
                LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "No network connection, skip publishing services");
            }
            taskAutoFlowState = FLOW_TASK_STATE_ADDITIONAL_TASKS; // Continue with TASKS after FLOW FINISHED
        }

        // ADDITIONAL TASKS
        // Process further tasks after image is fully processed and results are published
        // ********************************************
        else if (taskAutoFlowState == FLOW_TASK_STATE_ADDITIONAL_TASKS) {
            // Post process handling (if neccessary)
            // ********************************************
            if (flowctrl.flowStateEventOccurred()) {
                LogFile.writeToFile(ESP_LOG_INFO, TAG, "Process state: " + std::string(FLOW_POST_EVENT_HANDLING));
                flowctrl.setActualProcessState(std::string(FLOW_POST_EVENT_HANDLING));
#ifdef ENABLE_MQTT
                publishMqttData(mqttServer_getMainTopic() + "/process/status/process_state", flowctrl.getActualProcessState(), 1, false);
#endif // ENABLE_MQTT

                flowctrl.postProcessEventHandler();
            }
            else {
                flowctrl.clearFlowStateEventInRowCounter();
                lastSuccessUptime = getUptime(); // Cycle without error or deviation
                lastSuccessTime = getCurrentTimeString("%Y-%m-%dT%H:%M:%S%z");
#ifdef ENABLE_MQTT
                publishMqttData(std::string(mqttServer_getMainTopic() + "/process/status/process_error"), "0", 1, false);
#endif // ENABLE_MQTT
            }

            // Additional tasks
            // ********************************************
            LogFile.writeToFile(ESP_LOG_INFO, TAG, "Process state: " + std::string(FLOW_ADDITIONAL_TASKS));
            flowctrl.setActualProcessState(std::string(FLOW_ADDITIONAL_TASKS));
#ifdef ENABLE_MQTT
            publishMqttData(mqttServer_getMainTopic() + "/process/status/process_state", flowctrl.getActualProcessState(), 1, false);
#endif // ENABLE_MQTT

            // Cleanup outdated log and data files (retention policy)
            LogFile.removeOldLogFile();
            LogFile.removeOldDataLog();
            LogFile.removeOldDebugFiles();

            // CPU Temp -> Logfile
            LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "CPU Temperature: " + std::to_string((int)getSOCTemperature()) + "°C");

            // WIFI Signal Strength (RSSI) -> Logfile
            LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "WIFI Signal (RSSI): " + std::to_string(getWifiRssi()) + "dBm");

            processingTime = (int)(getUptime() - cycleStartTime);
            // Cycle finished -> Logfile
            LogFile.writeToFile(ESP_LOG_INFO, TAG,
                                "Cycle #" + std::to_string(cycleCounter) + " completed (" + std::to_string(processingTime) + "s)");

            // Check if time is synchronized (if NTP is configured)
            if (getTimeSyncEnabled() && !getTimeIsSynced()) {
                LogFile.writeToFile(ESP_LOG_WARN, TAG, "Time synchronization is enabled, but time is not yet set");
                setStatusLed(TIME_CHECK, 1, false);
            }

            // WIFI roaming handling (if activated)
            // Trigger client triggered roaming query
            // ********************************************
#if (defined WLAN_USE_MESH_ROAMING && defined WLAN_USE_MESH_ROAMING_ACTIVATE_CLIENT_TRIGGERED_QUERIES)
            wifiRoamingQuery();
#endif // WLAN_USE_MESH_ROAMING

            // Scan channels and check if an AP with better RSSI is available, then disconnect and try to reconnect to AP with better RSSI
            // NOTE: Keep this at the end of this state, because scan is done in blocking mode and this takes ca. 1,5 - 2s.
#ifdef WLAN_USE_ROAMING_BY_SCANNING
            wifiRoamByScanning();
#endif // WLAN_USE_ROAMING_BY_SCANNING

            // Check if triggerd reload config or manually triggered single cycle
            // ********************************************
            if (taskAutoFlowState == FLOW_TASK_STATE_INIT) {
                reloadConfig = false;    // reload by post process event handler has higher prio
                manualFlowStart = false; // Reload config has higher prio
                LogFile.writeToFile(ESP_LOG_INFO, TAG, "postProcessEventHandler trigger: Reload configuration");
            }
            else if (reloadConfig) {
                reloadConfig = false;
                manualFlowStart = false; // Reload config has higher prio
                LogFile.writeToFile(ESP_LOG_INFO, TAG, "Manual trigger: Reload configuration");
                taskAutoFlowState = FLOW_TASK_STATE_INIT; // Return to state "FLOW INIT"
            }
            else if (manualFlowStart) {
                manualFlowStart = false;
                if (flowctrl.isAutoStart()) {
                    LogFile.writeToFile(ESP_LOG_INFO, TAG, "Start process (manual trigger)");
                    taskAutoFlowState = FLOW_TASK_STATE_IMG_PROCESSING; // Continue with next "FLOW PROCESSING" cycle"
                }
                else {
                    taskAutoFlowState = FLOW_TASK_STATE_IDLE_NO_AUTOSTART; // Return to state "Idle (NO AUTOSTART)"
                }
            }
            else {
                taskAutoFlowState = FLOW_TASK_STATE_IDLE_AUTOSTART; // Continue to state "Idle (AUTOSTART / WAITING STATE)"
            }
        }

        // IDLE / WAIT STATE
        // "Wait state" until autotimer is elapsed to restart next cycle
        // ********************************************
        else if (taskAutoFlowState == FLOW_TASK_STATE_IDLE_AUTOSTART) {
            LogFile.writeToFile(ESP_LOG_INFO, TAG, "Process state: " + std::string(FLOW_IDLE_AUTOSTART));
            flowctrl.setActualProcessState(std::string(FLOW_IDLE_AUTOSTART));
#ifdef ENABLE_MQTT
            publishMqttData(mqttServer_getMainTopic() + "/process/status/process_state", flowctrl.getActualProcessState(), 1, false);
#endif // ENABLE_MQTT

            // WLAN suspention handling (if activated)
            // Check whether WLAN set to suspended mode based on configured delay time
            // ********************************************
            suspendWifiConnection();

            // Wait until the interval is elapsed. The wait runs in 1 s steps to provide the countdown and to be able to pause it.
            // A manual start or a config reload aborts the wait (xTaskAbortDelay)
            int64_t processIntervalDeltaTime = (esp_timer_get_time() - cycleStartActualTime) / 1000;
            autoCountdownRemainingMs = automaticProcessInterval > processIntervalDeltaTime ? automaticProcessInterval - processIntervalDeltaTime : 0;
            int64_t lastTickUs = esp_timer_get_time();
            while (autoCountdownRemainingMs > 0 && !reloadConfig && !manualFlowStart) {
                vTaskDelay((autoCountdownRemainingMs < 1000 && !autoCountdownPaused ? autoCountdownRemainingMs : 1000) / portTICK_PERIOD_MS);
                const int64_t nowUs = esp_timer_get_time();
                if (!autoCountdownPaused) {
                    autoCountdownRemainingMs -= (nowUs - lastTickUs) / 1000;
                }
                lastTickUs = nowUs;
            }
            autoCountdownRemainingMs = -1;

            // Check if reload config is triggered by REST API
            // ********************************************
            if (reloadConfig) {
                reloadConfig = false;
                manualFlowStart = false; // Reload config has higher prio
                LogFile.writeToFile(ESP_LOG_INFO, TAG, "Trigger: Reload configuration");
                taskAutoFlowState = FLOW_TASK_STATE_INIT; // Return to state "FLOW INIT"
            }
            else if (manualFlowStart) {
                manualFlowStart = false;
                LogFile.writeToFile(ESP_LOG_INFO, TAG, "Start process (manual trigger)");
                taskAutoFlowState = FLOW_TASK_STATE_IMG_PROCESSING; // Continue with next "FLOW PROCESSING" cycle"
            }
            else {
                taskAutoFlowState = FLOW_TASK_STATE_IMG_PROCESSING; // Continue with next "FLOW PROCESSING" cycle
            }
        }

        // INVALID STATE
        // ********************************************
        else {
            LogFile.writeToFile(ESP_LOG_ERROR, TAG, "taskAutoFlowState: Invalid state called. Programming error");
            flowctrl.setActualProcessState(std::string(FLOW_INVALID_STATE));
        }

        taskYIELD();
    }

    // Delete task if it exits from the loop above
    // ********************************************
    vTaskDelete(NULL);
    xHandletask_autodoFlow = NULL;
}


void createMainFlowTask()
{
    LiveFlow::init();

#ifdef DEBUG_DETAIL_ON
    LogFile.writeHeapInfo("CreateFlowTask: start");
#endif // DEBUG_DETAIL_ON

    LogFile.writeToFile(ESP_LOG_INFO, TAG, "Process state: " + std::string(FLOW_CREATE_FLOW_TASK));
    flowctrl.setActualProcessState(std::string(FLOW_CREATE_FLOW_TASK));

    BaseType_t xReturned = xTaskCreatePinnedToCore(&task_autodoFlow, "task_autodoFlow", 12 * 1024, NULL, tskIDLE_PRIORITY + 6,
                                                   &xHandletask_autodoFlow, 0);
    if (xReturned != pdPASS) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Failed to create task_autodoFlow");
        LogFile.writeHeapInfo("CreateFlowTask: Failed to create task");
        flowctrl.setActualProcessState(std::string(FLOW_FLOW_TASK_FAILED));
        flowctrl.setFlowStateError();
    }

#ifdef DEBUG_DETAIL_ON
    LogFile.writeHeapInfo("CreateFlowTask: end");
#endif // DEBUG_DETAIL_ON
}


void deleteMainFlowTask()
{
#ifdef DEBUG_DETAIL_ON
    ESP_LOGD(TAG, "deleteMainFlowTask: xHandletask_autodoFlow: %ld", (long)xHandletask_autodoFlow);
#endif // DEBUG_DETAIL_ON
    if (xHandletask_autodoFlow != NULL) {
        vTaskDelete(xHandletask_autodoFlow);
        xHandletask_autodoFlow = NULL;
    }
#ifdef DEBUG_DETAIL_ON
    ESP_LOGD(TAG, "Killed: xHandletask_autodoFlow");
#endif // DEBUG_DETAIL_ON
}


void registerMainFlowTaskUri(httpd_handle_t server)
{
    ESP_LOGI(TAG, "Registering URI handlers");

    httpd_uri_t camuri = {};
    camuri.method = HTTP_GET;

    camuri.method = HTTP_GET;
    camuri.uri = "/api/status";
    camuri.handler = HTTP_AUTH_BASIC(handler_api_status);
    camuri.user_ctx = NULL;
    httpd_register_uri_handler(server, &camuri);

    camuri.method = HTTP_POST;
    camuri.uri = "/api/cycle";
    camuri.handler = HTTP_AUTH_BASIC(handler_api_cycle);
    camuri.user_ctx = NULL;
    httpd_register_uri_handler(server, &camuri);

    camuri.method = HTTP_GET;
    camuri.uri = "/api/fallback";
    camuri.handler = HTTP_AUTH_BASIC(handler_api_fallback);
    camuri.user_ctx = NULL;
    httpd_register_uri_handler(server, &camuri);

    camuri.method = HTTP_POST;
    camuri.uri = "/api/fallback";
    camuri.handler = HTTP_AUTH_BASIC(handler_api_fallback);
    camuri.user_ctx = NULL;
    httpd_register_uri_handler(server, &camuri);

    camuri.method = HTTP_POST;
    camuri.uri = "/api/flow/copy";
    camuri.handler = HTTP_AUTH_BASIC(handler_api_flow_copy);
    camuri.user_ctx = NULL;
    httpd_register_uri_handler(server, &camuri);

    camuri.method = HTTP_POST;
    camuri.uri = "/api/flow/cutref";
    camuri.handler = HTTP_AUTH_BASIC(handler_api_flow_cutref);
    camuri.user_ctx = NULL;
    httpd_register_uri_handler(server, &camuri);

    camuri.method = HTTP_GET;
    camuri.uri = "/api/live";
    camuri.handler = HTTP_AUTH_BASIC(handler_api_live);
    camuri.user_ctx = NULL;
    httpd_register_uri_handler(server, &camuri);

    camuri.method = HTTP_GET;
    camuri.uri = "/process_data";
    camuri.handler = HTTP_AUTH_BASIC(handler_process_data);
    camuri.user_ctx = httpServerData; // Pass server data as context
    httpd_register_uri_handler(server, &camuri);

    camuri.uri = "/api/recognition";
    camuri.handler = HTTP_AUTH_BASIC(handler_recognition_details);
    camuri.user_ctx = NULL;
    httpd_register_uri_handler(server, &camuri);
}
