#include "ClassFlowLive.h"

#include <vector>

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>


namespace LiveFlow {

namespace {

struct RoiResult {
    std::string sequence;
    std::string kind;
    std::string name;
    std::string value;
    int confidence = -1;
    bool rejected = false;
};

SemaphoreHandle_t mutex = NULL;
int cycleNo = 0;
bool rawAvailable = false;
bool alignAvailable = false;
bool alignOk = false;
float alignRotation = 0.0f;
int alignDx = 0;
int alignDy = 0;
Rect alignMarkers[2];
int alignMarkerCount = 0;
std::vector<RoiResult> rois;
volatile TickType_t lastPollTick = 0; // last request of /api/live (0: never)

// Short wait: the web server must not block the flow and the other way round
struct Lock {
    bool locked = false;
    Lock()
    {
        locked = mutex != NULL && xSemaphoreTake(mutex, pdMS_TO_TICKS(100)) == pdTRUE;
    }
    ~Lock()
    {
        if (locked) {
            xSemaphoreGive(mutex);
        }
    }
};

void addRect(cJSON *array, const Rect &r)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "x", r.x);
    cJSON_AddNumberToObject(o, "y", r.y);
    cJSON_AddNumberToObject(o, "w", r.w);
    cJSON_AddNumberToObject(o, "h", r.h);
    cJSON_AddItemToArray(array, o);
}

cJSON *alignmentObject()
{
    cJSON *a = cJSON_CreateObject();
    cJSON_AddBoolToObject(a, "ok", alignOk);
    cJSON_AddStringToObject(a, "rawImage", "/img_tmp/raw.jpg");
    cJSON_AddNumberToObject(a, "rotation", (int)(alignRotation * 100.0f) / 100.0);
    cJSON_AddNumberToObject(a, "dx", alignDx);
    cJSON_AddNumberToObject(a, "dy", alignDy);
    cJSON_AddNumberToObject(a, "scale", 1);
    cJSON *markers = cJSON_AddArrayToObject(a, "markers");
    for (int i = 0; i < alignMarkerCount; i++) {
        addRect(markers, alignMarkers[i]);
    }
    return a;
}

} // namespace


void init()
{
    if (mutex == NULL) {
        mutex = xSemaphoreCreateMutex();
    }
}


void begin(int cycle)
{
    Lock lock;
    cycleNo = cycle;
    rawAvailable = false;
    alignAvailable = false;
    rois.clear();
}


void rawReady()
{
    Lock lock;
    rawAvailable = true;
}


void alignmentDone(bool ok, float rotation, int dx, int dy, const Rect *markers, int markerCount)
{
    Lock lock;
    alignAvailable = true;
    alignOk = ok;
    alignRotation = rotation;
    alignDx = dx;
    alignDy = dy;
    alignMarkerCount = markerCount > 2 ? 2 : markerCount;
    for (int i = 0; i < alignMarkerCount; i++) {
        alignMarkers[i] = markers[i];
    }
}


void roiDone(const std::string &sequence, const char *kind, const std::string &roiName, const std::string &value, int confidencePct,
             bool rejected)
{
    Lock lock;
    RoiResult r;
    r.sequence = sequence;
    r.kind = kind;
    r.name = roiName;
    r.value = value;
    r.confidence = confidencePct;
    r.rejected = rejected;
    rois.push_back(r);
}


void markWatched()
{
    lastPollTick = xTaskGetTickCount() | 1; // never 0
}


void stepPause(int ms)
{
    const TickType_t last = lastPollTick;
    if (last != 0 && (xTaskGetTickCount() - last) < pdMS_TO_TICKS(8000)) {
        vTaskDelay(pdMS_TO_TICKS(ms));
    }
}


cJSON *liveJson(bool running, const std::string &state)
{
    markWatched();
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        return NULL;
    }

    cJSON_AddStringToObject(root, "api_name", "live:v1");
    cJSON_AddBoolToObject(root, "running", running);
    cJSON_AddStringToObject(root, "state", state.c_str());

    Lock lock;
    cJSON_AddNumberToObject(root, "cycle", cycleNo);
    cJSON_AddBoolToObject(root, "raw", rawAvailable);
    if (alignAvailable) {
        cJSON_AddItemToObject(root, "alignment", alignmentObject());
    }
    else {
        cJSON_AddNullToObject(root, "alignment");
    }

    cJSON *list = cJSON_AddArrayToObject(root, "rois");
    for (const auto &r : rois) {
        cJSON *o = cJSON_CreateObject();
        cJSON_AddStringToObject(o, "seq", r.sequence.c_str());
        cJSON_AddStringToObject(o, "kind", r.kind.c_str());
        cJSON_AddStringToObject(o, "name", r.name.c_str());
        cJSON_AddStringToObject(o, "value", r.value.c_str());
        if (r.confidence >= 0) {
            cJSON_AddNumberToObject(o, "confidence", r.confidence);
        }
        cJSON_AddBoolToObject(o, "rejected", r.rejected);
        cJSON_AddItemToArray(list, o);
    }
    return root;
}


void addAlignment(cJSON *parent)
{
    Lock lock;
    if (alignAvailable && rawAvailable) {
        cJSON_AddItemToObject(parent, "alignment", alignmentObject());
    }
}

} // namespace LiveFlow
