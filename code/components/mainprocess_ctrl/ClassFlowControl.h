#ifndef CLASSFLOWCONTROL_H
#define CLASSFLOWCONTROL_H

#include <ctime>
#include <string>

#include "configClass.h"
#include "ClassFlow.h"
#include "ClassFlowDefineTypes.h"
#include "ClassFlowTakeImage.h"
#include "ClassFlowAlignment.h"
#include "ClassFlowCNNGeneral.h"
#include "ClassFlowPostProcessing.h"

#ifdef ENABLE_MQTT
#include "ClassFlowMQTT.h"
#endif // ENABLE_MQTT




enum flowStateEvent {
    MULTIPLE_ERROR_IN_ROW = -2,
    SINGLE_ERROR = -1,
    NONE,
    SINGLE_DEVIATION,
    MULTIPLE_DEVIATION_IN_ROW
};


class ClassFlowControl : public ClassFlow
{
  protected:
    ConfigClass *cfgClassPtr;
    std::vector<ClassFlow *> FlowControlImage;
    std::vector<ClassFlow *> FlowControlPublish;
    std::vector<strFlowState *> FlowStateEvaluationEvent;
    std::vector<strFlowState *> FlowStatePublishEvent;

    ClassFlowTakeImage *flowtakeimage;
    ClassFlowAlignment *flowalignment;
    ClassFlowCNNGeneral *flowanalog;
    ClassFlowCNNGeneral *flowdigit;
    ClassFlowPostProcessing *flowpostprocessing;
#ifdef ENABLE_MQTT
    ClassFlowMQTT *flowMQTT;
#endif // ENABLE_MQTT

    std::string actualProcessState;
    std::string actualProcessStateWithTime;
    time_t actualProcessStateSince = 0; // Uptime [s] when the state was set
    int flowStateErrorInRow;
    int flowStateDeviationInRow;

  public:
    ClassFlowControl();
    virtual ~ClassFlowControl();

    bool initFlow();
    void deinitFlow(void);

    bool loadParameter();
    bool doFlowImageEvaluation(std::string time);
    bool doFlowPublishData(std::string time);

    bool getStatusSetupModus();
    float getProcessInterval();
    bool isAutoStart();
    bool isAutoStart(long &_interval);

    void setActualProcessState(std::string _actualProcessState);
    std::string getActualProcessState();
    std::string getActualProcessStateWithTime();
    time_t getActualProcessStateSince();
    std::string translateActualProcessState(std::string classname);

    void setFlowStateError();
    void clearFlowStateEventInRowCounter();
    int getFlowStateErrorOrDeviation();
    bool flowStateEventOccurred();
    void postProcessEventHandler();

    void drawDigitRoi(CImage &image);
    void drawAnalogRoi(CImage &image);

#ifdef ENABLE_MQTT
    bool initMqttService();
#endif // ENABLE_MQTT

    const FlowImageData *getFlowImageData() const { return flowImageData; };

    const std::vector<SequenceData *> &getSequenceData() const { return sequenceData; };
    std::string getSequenceResultInline(int type, std::string sequenceName = "");

    bool setFallbackValue(std::string _sequenceName, std::string _newvalue);
    std::string getFallbackValue(std::string _sequenceName);

    esp_err_t sendProcessImages(httpd_req_t *req, const char *filename);

    std::string name() { return "ClassFlowControl"; };

    // Only used for unity testing
    std::vector<SequenceData *> &getSequenceData() { return sequenceData; };
};

#endif // CLASSFLOWCONTROL_H
