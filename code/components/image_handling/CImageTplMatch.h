#ifndef CIMAGETPLMATCH_H
#define CIMAGETPLMATCH_H

#include "ClassFlowDefineTypes.h"
#include "CImage.h"


/**
 * @brief Supported matching algorithms
 */
enum class TplMatchAlgorithm {
    SAD = 0 // Sum of Absolute Difference
};


/**
 * @brief Status codes
 */
enum TplMatchStatus {
    TPL_MATCH_OK = 0,                         // Match successful with algorithm
    TPL_MATCH_FAILED = -1,                    // Match failed
    TPL_MATCH_UNKNOWN_ALGORITHM = -2,         // Error unkown algorithm
    TPL_MATCH_ERROR_IMAGE = -3,               // Error with image
    TPL_MATCH_ERROR_TIMEOUT = ESP_ERR_TIMEOUT // Error with image lock
};


/**
 * @brief Correction applied by the alignment (after the initial rotation): rotation around the image center, then shift
 */
struct TplMatchResult {
    float angle = 0.0f; // Degrees, positive is clockwise
    int dx = 0;
    int dy = 0;
};


/**
 * @brief Image template matching (Helper class)
 *
 * Provides image template matching functionality
 */
class CImageTplMatch
{
  private:
    /**
     * @brief Performs template matching using the Sum of Absolute Differences (SAD) algorithm
     * @param img Source image
     * @param marker Alignment marker to match
     * @return Status code
     */
    static TplMatchStatus tplMatchBySad(CImage &img, AlignmentMarker &marker);

  public:
    /**
     * @brief Invokes template matching using a specified matching algorithm
     * @param img Source image
     * @param imgTarget Target image (template)
     * @param marker1 First alignment marker
     * @param marker2 Second alignment marker
     * @param tplMatchAlgorithm Algorithm to use for matching (default: SAD)
     * @param result Optional: correction that was applied
     * @return Status code
     */
    static TplMatchStatus invokeTplMatch(CImage &img, CImage &imgTarget, AlignmentMarker &marker1, AlignmentMarker &marker2,
                                         TplMatchAlgorithm tplMatchAlgorithm = TplMatchAlgorithm::SAD, TplMatchResult *result = nullptr);
};

#endif // CIMAGETPLMATCH_H
