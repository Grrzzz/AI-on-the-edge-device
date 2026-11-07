#ifndef CLASSFLOWLIVE_H
#define CLASSFLOWLIVE_H

#include <string>
#include <cJSON.h>


/**
 * @brief Progress of the running cycle for the WebUI (GET /api/live)
 *
 * Collects what the process produces step by step: the raw image, the result of the alignment and the result of each ROI.
 * The flow task writes, the web server task reads. The data of the last cycle stays available until the next cycle starts.
 */
namespace LiveFlow {

struct Rect {
    int x = 0;
    int y = 0;
    int w = 0;
    int h = 0;
};

void init();

/// Pause after a step (ms) of the process while a WebUI follows the cycle
constexpr int PAUSE_STEP_MS = 2000; // raw image, alignment
constexpr int PAUSE_ROI_MS = 400;   // each ROI

/// A WebUI is open (it asks for the status regularly): the steps of the process are paused for the live view
void markWatched();

/**
 * @brief Pause the process if a WebUI is open (GET /api/status or /api/live was requested within the last seconds)
 *
 * The device is too busy while it processes to answer in real time. With a short pause after each step the WebUI can
 * show the steps one after another. Nobody watching: no pause, the process is not slowed down.
 */
void stepPause(int ms);

/// A new cycle starts: forget the data of the last one
void begin(int cycle);

/// The raw image of this cycle is available (/img_tmp/raw.jpg)
void rawReady();

/**
 * @brief Result of the alignment. The aligned image is: shift (dx, dy) applied after the rotation around the image center
 * @param ok alignment successful
 * @param rotation total rotation in degrees (initial rotation + correction), positive is clockwise
 * @param dx shift in x [px]
 * @param dy shift in y [px]
 * @param markers reference marker (position in the aligned image)
 * @param markerCount number of markers (0 if no marker based alignment is configured)
 */
void alignmentDone(bool ok, float rotation, int dx, int dy, const Rect *markers, int markerCount);

/// Result of one ROI (digit or analog). confidencePct: 0 to 100, negative if the model gives none
void roiDone(const std::string &sequence, const char *kind, const std::string &roiName, const std::string &value, int confidencePct,
             bool rejected);

/// JSON object for GET /api/live, the caller has to delete it
cJSON *liveJson(bool running, const std::string &state);

/// Adds the object "alignment" (if the last cycle did an alignment) to parent
void addAlignment(cJSON *parent);

} // namespace LiveFlow

#endif // CLASSFLOWLIVE_H
