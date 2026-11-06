#include "server_ota.h"
#include "../../include/defines.h"

#include <string>

#include <freertos/task.h>

#include <sys/stat.h>
#include <esp_task_wdt.h>
#include <esp_ota_ops.h>
#include <esp_system.h>
#include <esp_log.h>
#include <esp_partition.h>
#include <esp_app_format.h>
#include <esp_http_client.h>
#include <esp_crt_bundle.h>
#include <cJSON.h>
#include <atomic>
#include <cstring>
#include <strings.h>
#include "miniz.h"

#ifdef ENABLE_MQTT
#include "interface_mqtt.h"
#endif // ENABLE_MQTT

#include "server_help.h"
#include "webserver.h"
#include "MainFlowControl.h"
#include "gpioControl.h"
#include "ClassControlCamera.h"
#include "network_main.h"
#include "ClassLogFile.h"
#include "helper.h"
#include "system.h"
#include "statusled.h"
#include "time_sntp.h"


static const char *TAG = "SERVER_OTA";

constexpr const char *DIR_OTA_STAGED_CONFIG = DIR_OTA_STAGED "/config";
constexpr const char *DIR_OTA_STAGED_HTML = DIR_OTA_STAGED "/html";
constexpr const char *FILE_OTA_STAGED_FW = DIR_OTA_STAGED "/firmware.bin";
constexpr const char *FILE_OTA_STAGED_PACKAGE = DIR_OTA_STAGED "/ota_package";
constexpr const char *FILE_OTA_STAGED_CONFIG_BACKUP_MANIFEST = DIR_OTA_STAGED "/meta.json";


static bool unzipFile(const std::string &inputZipFile, const std::string &destFolder)
{
    mz_zip_archive zipArchive = {};

    if (!mz_zip_reader_init_file(&zipArchive, inputZipFile.c_str(), 0)) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "unzipFile: Failed to init");
        return false;
    }

    const mz_uint numberOfFiles = mz_zip_reader_get_num_files(&zipArchive);

    std::string destFolderValid = destFolder;
    if (!destFolderValid.empty() && destFolderValid.back() != '/') {
        destFolderValid += '/';
    }

    for (mz_uint i = 0; i < numberOfFiles; ++i) {
        mz_zip_archive_file_stat fileStat;

        if (!mz_zip_reader_file_stat(&zipArchive, i, &fileStat)) {
            LogFile.writeToFile(ESP_LOG_ERROR, TAG, "unzipFile: Failed to get file stat | Index: " + std::to_string(i));
            mz_zip_reader_end(&zipArchive);
            return false;
        }

        if (fileStat.m_is_directory) {
            continue;
        }

        const std::string archiveFilename(fileStat.m_filename);

        if (!isSafePath(archiveFilename)) {
            LogFile.writeToFile(ESP_LOG_ERROR, TAG, "unzipFile: Unsafe path: " + archiveFilename);
            mz_zip_reader_end(&zipArchive);
            return false;
        }

        const std::string destinationPath = destFolderValid + archiveFilename;

        // Ignore an archive entry that would overwrite the uploaded ZIP itself
        if (destinationPath == inputZipFile) {
            continue;
        }

        ESP_LOGI(TAG, "Unzip file: %s", destinationPath.c_str());

        makeDir(getDirectory(destinationPath));
        deleteFile(destinationPath);

        if (!mz_zip_reader_extract_to_file(&zipArchive, i, destinationPath.c_str(), 0)) {
            const mz_zip_error zipError = mz_zip_get_last_error(&zipArchive);
            LogFile.writeToFile(ESP_LOG_ERROR, TAG,
                                "unzipFile: Failed to extract: " + archiveFilename + " | Error: " + std::to_string(zipError));
            deleteFile(destinationPath);
            mz_zip_reader_end(&zipArchive);
            return false;
        }
    }

    mz_zip_reader_end(&zipArchive);

    LogFile.writeToFile(ESP_LOG_INFO, TAG, "Unzip successful");

    return true;
}


// Reads the first few bytes to classify the staged OTA package
// Returns "ZIP", "BIN", or "" if unrecognized.
static std::string detectPackageType(const std::string &path)
{
    uint8_t header[4] = {0};
    FILE *file = fopen(path.c_str(), "rb");
    if (!file) {
        return "";
    }
    size_t n = fread(header, 1, sizeof(header), file);
    fclose(file);

    // Inspect header for valid zip file
    if (n >= 4 && header[0] == 'P' && header[1] == 'K' && header[2] == 0x03 && header[3] == 0x04) {
        return "ZIP";
    }
    // Inspect header for valid ESP bin file
    else if (n >= 1 && header[0] == ESP_IMAGE_HEADER_MAGIC) {
        return "BIN";
    }

    return "";
}


static bool updateOtaAssets(void)
{
    bool success = true;

    if (dirExists(DIR_OTA_STAGED_CONFIG)) {
        if (mergeFolder(DIR_OTA_STAGED_CONFIG, DIR_CONFIG_ROOT)) {
            LogFile.writeToFile(ESP_LOG_INFO, TAG, "Staged asset: Config update successful");
        }
        else {
            LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Staged asset: Failed to process config folder");
            success = false;
        }
    }

    if (dirExists(DIR_OTA_STAGED_HTML)) {
        if (replaceFolder(DIR_OTA_STAGED_HTML, DIR_HTML_ROOT)) {
            LogFile.writeToFile(ESP_LOG_INFO, TAG, "Staged asset: WebUI update successful");
        }
        else {
            LogFile.writeToFile(ESP_LOG_WARN, TAG, "Staged asset: Failed to update webUI (HTML folder)");
            success = false;
        }
    }

    return success;
}


#ifdef CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE
/**
 * @brief System self-diagnostic check after an OTA update
 * @return true if healthy, false if failure detected
 */
static bool firmwareVerification(void)
{
    const esp_reset_reason_t resetReason = esp_reset_reason();
    if (resetReason == ESP_RST_PANIC || resetReason == ESP_RST_INT_WDT || resetReason == ESP_RST_TASK_WDT || resetReason == ESP_RST_WDT) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Firmware verification failed | Reset reason: " + std::to_string(resetReason));
        return false;
    }

    return true;
}


// 5. Evaluates partition state on boot up and updates assets if valid
static void finalizeOtaUpdate(void)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    if (!running) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Failed to get running partition");
        deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
        return;
    }

    esp_ota_img_states_t otaState;
    const esp_err_t otaStateError = esp_ota_get_state_partition(running, &otaState);
    if (otaStateError != ESP_OK) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Failed to get OTA state: " + intToHexString(otaStateError));
        deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
        return;
    }

    const char *otaStateStr = "UNKNOWN";
    switch (otaState) {
        case ESP_OTA_IMG_NEW:
            otaStateStr = "NEW";
            break;
        case ESP_OTA_IMG_PENDING_VERIFY:
            otaStateStr = "PENDING_VERIFY";
            break;
        case ESP_OTA_IMG_VALID:
            otaStateStr = "VALID";
            break;
        case ESP_OTA_IMG_INVALID:
            otaStateStr = "INVALID";
            break;
        case ESP_OTA_IMG_ABORTED:
            otaStateStr = "ABORTED";
            break;
        case ESP_OTA_IMG_UNDEFINED:
            otaStateStr = "UNDEFINED";
            break;
        default:
            break;
    }

    LogFile.writeToFile(ESP_LOG_INFO, TAG, "Active Partition: " + std::string(running->label) + " | OTA State: " + otaStateStr);

    // Legacy bootloader: Rollback verification is not supported
    if (otaState == ESP_OTA_IMG_NEW || otaState == ESP_OTA_IMG_UNDEFINED) {
        LogFile.writeToFile(ESP_LOG_INFO, TAG, "Update bootloader manually to support firmware rollback feature");

        // Process webUI update, after unzip done (during previous boot)
        if (!fileExists(FILE_OTA_STAGED_PACKAGE)) {
            updateOtaAssets();
            deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
        }
    }
    // Bootloader with rollback support (firmware version >= v18.x.x-SLFORK)
    else if (otaState == ESP_OTA_IMG_PENDING_VERIFY) {
        LogFile.writeToFile(ESP_LOG_INFO, TAG, "Firmware verification...");

        if (!firmwareVerification()) {
            deleteAllFilesInDirectory(DIR_OTA_STAGED, true);

            LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Firmware verification failed. Trying to rollback...");
            const esp_err_t rollbackError = esp_ota_mark_app_invalid_rollback_and_reboot();
            if (rollbackError != ESP_OK) {
                LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Rollback failed: " + intToHexString(rollbackError) + ". Rebooting...");
                doRebootOTA();
            }
            return;
        }

        const esp_err_t otaMarkError = esp_ota_mark_app_valid_cancel_rollback();
        if (otaMarkError != ESP_OK) {
            LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Failed to mark firmware valid. Trying to rollback: " + intToHexString(otaMarkError));
            const esp_err_t rollbackError = esp_ota_mark_app_invalid_rollback_and_reboot();
            if (rollbackError != ESP_OK) {
                LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Rollback failed: " + intToHexString(rollbackError) + ". Rebooting...");
                doRebootOTA();
            }
            return;
        }

        LogFile.writeToFile(ESP_LOG_INFO, TAG, "Firmware verification successful | OTA State: VALID");

        // Update assets when firmware is validated.
        // Note: Firmware remains valid even assetUpdate is failing. Could be resolved with another OTA update.
        updateOtaAssets();
        deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
    }
}
#endif // CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE


// 4. Flash firmware
static bool otaUpdateFirmware(const std::string &filename)
{
    esp_ota_handle_t otaHandle = 0;
    esp_err_t retVal = ESP_OK;
    bool success = false;

    const esp_partition_t *configured = esp_ota_get_boot_partition();
    const esp_partition_t *running = esp_ota_get_running_partition();

    if (!configured || !running) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Failed to get OTA partition information");
        return false;
    }

    LogFile.writeToFile(ESP_LOG_INFO, TAG, "Flashing firmware...");

    if (configured != running) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG,
                            "Configured boot partition (0x" + intToHexString(configured->address) + ") differs from running partition (0x" +
                                intToHexString(running->address) + ")");
    }

    ESP_LOGI(TAG, "Running partition type %d subtype %d (offset 0x%08x)", running->type, running->subtype, (unsigned int)running->address);

    const esp_partition_t *updatePartition = esp_ota_get_next_update_partition(NULL);
    if (!updatePartition) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "otaUpdateFirmware: Target OTA partition not found");
        return false;
    }

    ESP_LOGI(TAG, "Writing to partition subtype %d at offset 0x%x", updatePartition->subtype, (unsigned int)updatePartition->address);

    FILE *file = fopen(filename.c_str(), "rb");
    if (!file) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "otaUpdateFirmware: Failed to open file: " + filename);
        return false;
    }

    // Use a 512-byte buffer for SD card access (newlib default: 128 bytes)
    setvbuf(file, NULL, _IOFBF, 512);

    struct stat st;
    if (fstat(fileno(file), &st) != 0 || st.st_size < 0) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "otaUpdateFirmware: Binary file size eval failed or invalid size on: " + filename);
        fclose(file);
        return false;
    }
    const size_t totalFileSize = (size_t)st.st_size;

    if (totalFileSize == 0) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "otaUpdateFirmware: Binary file is empty (0 bytes)");
        fclose(file);
        return false;
    }

    if (totalFileSize > updatePartition->size) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "otaUpdateFirmware: Firmware too large for OTA partition");
        fclose(file);
        return false;
    }

    char *otaDataBuffer = (char *)malloc(SERVER_OTA_SCRATCH_BUFSIZE);
    if (!otaDataBuffer) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "otaUpdateFirmware: Heap allocation failed for buffer");
        fclose(file);
        return false;
    }

    constexpr size_t headerRequiredSize = sizeof(esp_image_header_t) + sizeof(esp_image_segment_header_t) + sizeof(esp_app_desc_t);
    static_assert(SERVER_OTA_SCRATCH_BUFSIZE >= headerRequiredSize,
                  "SERVER_OTA_SCRATCH_BUFSIZE must be large enough to hold the full image header "
                  "in a single read (see otaUpdateFirmware header-validity check)");


    bool imageHeaderValid = false;
    size_t binaryFileLength = 0;
    size_t bytesRead = fread(otaDataBuffer, 1, SERVER_OTA_SCRATCH_BUFSIZE, file);

    while (bytesRead > 0) {
        if (!imageHeaderValid) {
            if (bytesRead >= headerRequiredSize) {
                esp_app_desc_t newAppInfo;
                memcpy(&newAppInfo, &otaDataBuffer[sizeof(esp_image_header_t) + sizeof(esp_image_segment_header_t)],
                       sizeof(esp_app_desc_t));

                ESP_LOGI(TAG, "New firmware version: %.*s", sizeof(newAppInfo.version), newAppInfo.version);

                esp_app_desc_t runningAppInfo;
                if (esp_ota_get_partition_description(running, &runningAppInfo) == ESP_OK) {
                    ESP_LOGI(TAG, "Running firmware version: %.*s", sizeof(runningAppInfo.version), runningAppInfo.version);
                }

                imageHeaderValid = true;

                retVal = esp_ota_begin(updatePartition, totalFileSize, &otaHandle);
                if (retVal != ESP_OK) {
                    LogFile.writeToFile(ESP_LOG_ERROR, TAG, "otaUpdateFirmware: esp_ota_begin failed | Error: " + intToHexString(retVal));
                    goto cleanup;
                }
                ESP_LOGI(TAG, "esp_ota_begin succeeded");
            }
            else {
                LogFile.writeToFile(ESP_LOG_ERROR, TAG, "otaUpdateFirmware: File header too small: " + std::to_string(bytesRead));
                goto cleanup;
            }
        }

        retVal = esp_ota_write(otaHandle, (const void *)otaDataBuffer, bytesRead);
        if (retVal != ESP_OK) {
            LogFile.writeToFile(ESP_LOG_ERROR, TAG, "otaUpdateFirmware: esp_ota_write failed | Error: " + intToHexString(retVal));
            goto cleanup;
        }

        binaryFileLength += bytesRead;
        bytesRead = fread(otaDataBuffer, 1, SERVER_OTA_SCRATCH_BUFSIZE, file);

        if (bytesRead == 0 && ferror(file)) {
            LogFile.writeToFile(ESP_LOG_ERROR, TAG,
                                "otaUpdateFirmware: fread() failed after " + std::to_string(binaryFileLength) +
                                    " bytes (I/O error, not EOF)");
            goto cleanup;
        }
    }

    if (binaryFileLength != totalFileSize) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG,
                            "otaUpdateFirmware: Incomplete firmware read | Expected: " + std::to_string(totalFileSize) +
                                " | Written: " + std::to_string(binaryFileLength));
        goto cleanup;
    }

    ESP_LOGI(TAG, "Total written image length: %u", (unsigned int)binaryFileLength);

    retVal = esp_ota_end(otaHandle);
    if (retVal != ESP_OK) {
        if (retVal == ESP_ERR_OTA_VALIDATE_FAILED) {
            LogFile.writeToFile(ESP_LOG_ERROR, TAG, "otaUpdateFirmware: Firmware validation failed (corrupt or mismatched chip ID)");
        }
        else {
            LogFile.writeToFile(ESP_LOG_ERROR, TAG, "otaUpdateFirmware: esp_ota_end failed | Error: " + intToHexString(retVal));
        }
        otaHandle = 0; // esp_ota_end already cleaned handle
        goto cleanup;
    }
    otaHandle = 0; // Successfully ended

    retVal = esp_ota_set_boot_partition(updatePartition);
    if (retVal != ESP_OK) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "otaUpdateFirmware: esp_ota_set_boot_partition failed | Error: " + intToHexString(retVal));
        goto cleanup;
    }

    // Required to use goto cleanup
    {
        // Clear Core Dump partition on success
        const esp_partition_t *coredumpPartition = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_COREDUMP,
                                                                            "coredump");
        if (coredumpPartition) {
            const esp_err_t eraseError = esp_partition_erase_range(coredumpPartition, 0, coredumpPartition->size);

            if (eraseError != ESP_OK) {
                LogFile.writeToFile(ESP_LOG_WARN, TAG, "Failed to erase coredump partition | Error: " + intToHexString(eraseError));
            }
        }
    }

    success = true;

cleanup:
    if (file) {
        fclose(file);
    }
    if (otaDataBuffer) {
        free(otaDataBuffer);
    }
    if (!success && otaHandle != 0) {
        esp_ota_abort(otaHandle);
    }

    return success;
}


// 3. Process OTA Update
static bool processOtaUpdate()
{
    const std::string fileType = detectPackageType(FILE_OTA_STAGED_PACKAGE);
    if (fileType == "ZIP") {
        LogFile.writeToFile(ESP_LOG_INFO, TAG, "Processing ZIP file...");

        if (!unzipFile(FILE_OTA_STAGED_PACKAGE, DIR_OTA_STAGED)) {
            LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Failed to unzip files");
            deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
            return false;
        }

        // Configuration Restore Flow
        if (fileExists(FILE_OTA_STAGED_CONFIG_BACKUP_MANIFEST)) {
            LogFile.writeToFile(ESP_LOG_INFO, TAG, "Restoring configuration...");

            bool success = mergeFolder(DIR_OTA_STAGED_CONFIG, DIR_CONFIG_ROOT);
            LogFile.writeToFile(success ? ESP_LOG_INFO : ESP_LOG_ERROR, TAG,
                                success ? "Restore configuration successful" : "Failed to restore configuration");

            deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
            return success;
        }

        // Firmware + WebUI Flow
        if (!fileExists(FILE_OTA_STAGED_FW) || !dirExists(DIR_OTA_STAGED_HTML)) {
            LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Firmware.bin or HTML folder missing");
            deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
            return false;
        }

        if (!otaUpdateFirmware(FILE_OTA_STAGED_FW)) {
            LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Failed to flash firmware");
            deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
            return false;
        }

#ifdef CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE
        // Keep extracted assets until the new firmware has been verified
        deleteFile(FILE_OTA_STAGED_PACKAGE);
#else
        // Legacy bootloader cannot rollback, so promote assets immediately
        updateOtaAssets();
        deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
#endif
        return true;
    }

    if (fileType == "BIN") {
        LogFile.writeToFile(ESP_LOG_INFO, TAG, "Processing BIN file...");

        if (!otaUpdateFirmware(FILE_OTA_STAGED_PACKAGE)) {
            LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Failed to flash firmware");
            deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
            return false;
        }

        deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
        return true;
    }

    LogFile.writeToFile(ESP_LOG_ERROR, TAG, "processOtaUpdate: File type not supported");
    deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
    return false;
}


// 2. OTA update task
static void taskOtaUpdate(void *pvParameter)
{
    setStatusLed(AP_OR_OTA, 1, true);

    if (!processOtaUpdate()) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "OTA update aborted / rejected");
    }

    LogFile.writeToFile(ESP_LOG_INFO, TAG, "Rebooting to finalize process...");

    doRebootOTA();
    vTaskDelete(NULL);
}


// 1. OTA Update Checker
void checkOtaUpdate()
{
    // Finalize pending OTA update tasks and partition ievaluation before checking for new updates
#ifdef CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE
    finalizeOtaUpdate();
#endif // CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE

    // Checking for staged update package
    if (!fileExists(FILE_OTA_STAGED_PACKAGE)) {
        LogFile.writeToFile(ESP_LOG_INFO, TAG, "No pending update");
        return;
    }

    const std::string fileType = detectPackageType(FILE_OTA_STAGED_PACKAGE);
    if (fileType.empty()) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Staged OTA package invalid (supported: ZIP, BIN). Aborting...");
        deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
        return;
    }
    LogFile.writeToFile(ESP_LOG_INFO, TAG, "Preparing OTA process | Type: " + fileType);

    BaseType_t taskCreated = xTaskCreate(&taskOtaUpdate, "taskOTAUpdate", 16384, NULL, tskIDLE_PRIORITY + 5, NULL);
    if (taskCreated != pdPASS) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Failed to create taskOTAUpdate task. Aborting...");
        deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
        doRebootOTA();
        return;
    }

    // 5-minute watchdog block (300,000 ms)
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(300000));

    LogFile.writeToFile(ESP_LOG_ERROR, TAG, "OTA task timed out or failed to reboot after 5 mins. Aborting...");
    deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
    doRebootOTA();

    while (true) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}


// Uploads the OTA package, stages it and reboot
esp_err_t handler_ota(httpd_req_t *req)
{
    static const char *uriPrefix = "/ota/";
    if (strncmp(req->uri, uriPrefix, strlen(uriPrefix)) != 0) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Use POST /ota/<filename.xyz>");
        return ESP_FAIL;
    }

    const std::string sanitizedFile = getFileName(req->uri + strlen(uriPrefix));
    if (sanitizedFile.empty()) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid or missing filename");
        return ESP_FAIL;
    }

    if (req->content_len == 0 || req->content_len > MAX_FILE_SIZE) {
        httpd_resp_send_err(req, HTTPD_413_CONTENT_TOO_LARGE, "Invalid file size, must be > 0 and < " MAX_FILE_SIZE_STR);
        return ESP_FAIL;
    }

    makeDir(DIR_OTA_STAGED);
    deleteAllFilesInDirectory(DIR_OTA_STAGED, true);

    LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "OTA upload | File: " + sanitizedFile);

    if (receiveRequestBodyToFile(req, FILE_OTA_STAGED_PACKAGE) != ESP_OK) {
        deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
        return ESP_FAIL;
    }

    LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "OTA upload completed | File: " + sanitizedFile);

    const std::string fileType = detectPackageType(FILE_OTA_STAGED_PACKAGE);
    if (fileType != "ZIP" && fileType != "BIN") {
        deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Unsupported file type (supported: ZIP, ESP firmware BIN)");
        return ESP_FAIL;
    }

    // Send response before triggering reboot to guarantee delivery
    httpd_resp_sendstr(req, "success: Upload successful. Device reboots to process OTA package");

    vTaskDelay(pdMS_TO_TICKS(500));
    doReboot(); // mandatory reboot before the actual OTA is performed
    return ESP_OK;
}


// ---------------------------------------------------------------------------------------------
// Self update: Download of the release package from GitHub. Afterwards the regular OTA path
// (staged package -> reboot -> checkOtaUpdate() -> processOtaUpdate()) is used, as for a manual upload.
// ---------------------------------------------------------------------------------------------
constexpr size_t SELFUPDATE_MAX_URL_LENGTH = 300;
constexpr size_t SELFUPDATE_MAX_REDIRECTS = 5;
constexpr size_t SELFUPDATE_LOCATION_BUFSIZE = 2048; // CDN redirect URLs carry long signed query strings
constexpr size_t SELFUPDATE_DOWNLOAD_BUFSIZE = 4096;
constexpr uint8_t SELFUPDATE_MAX_READ_RETRIES = 5;
constexpr int SELFUPDATE_TIMEOUT_MS = 15000;

static const char *const SELFUPDATE_ALLOWED_HOSTS[] = {"github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"};

enum class SelfUpdateState : uint8_t { Idle, Downloading, Staging, Done, Error };

static std::atomic<SelfUpdateState> selfUpdateState{SelfUpdateState::Idle};
static std::atomic<int> selfUpdatePercent{0};
static char selfUpdateMessage[96] = "";
static portMUX_TYPE selfUpdateMux = portMUX_INITIALIZER_UNLOCKED;

struct SelfUpdateParams {
    char url[SELFUPDATE_MAX_URL_LENGTH + 1];
};


static void setSelfUpdateMessage(const char *msg)
{
    portENTER_CRITICAL(&selfUpdateMux);
    strlcpy(selfUpdateMessage, msg, sizeof(selfUpdateMessage));
    portEXIT_CRITICAL(&selfUpdateMux);
}


static void setSelfUpdateError(const std::string &msg)
{
    LogFile.writeToFile(ESP_LOG_ERROR, TAG, "Self update failed: " + msg);
    setSelfUpdateMessage(msg.c_str());
    selfUpdateState = SelfUpdateState::Error;
}


static bool isAllowedSelfUpdateHost(const std::string &host)
{
    for (const char *allowed : SELFUPDATE_ALLOWED_HOSTS) {
        if (host == allowed) {
            return true;
        }
    }
    return false;
}


// Splits a https URL into host and path (without query / fragment). Rejects userinfo and explicit ports.
static bool parseHttpsUrl(const std::string &url, std::string &host, std::string &path, std::string &error)
{
    static const char *scheme = "https://";
    if (url.compare(0, strlen(scheme), scheme) != 0) {
        error = "URL scheme must be https";
        return false;
    }

    for (const char c : url) {
        if ((unsigned char)c <= 0x20 || (unsigned char)c >= 0x7F) {
            error = "URL contains invalid characters";
            return false;
        }
    }

    const size_t hostStart = strlen(scheme);
    const size_t hostEnd = url.find_first_of("/?#", hostStart);
    host = toLower(url.substr(hostStart, hostEnd == std::string::npos ? std::string::npos : hostEnd - hostStart));
    if (host.empty() || host.find_first_of("@:") != std::string::npos) {
        error = "Invalid URL host";
        return false;
    }

    if (!isAllowedSelfUpdateHost(host)) {
        error = "Host not allowed: " + host;
        return false;
    }

    path.clear();
    if (hostEnd != std::string::npos && url[hostEnd] == '/') {
        const size_t pathEnd = url.find_first_of("?#", hostEnd);
        path = url.substr(hostEnd, pathEnd == std::string::npos ? std::string::npos : pathEnd - hostEnd);
    }
    return true;
}


// Validates the initial (user supplied) URL: https, allowed host, *.zip, file name matches this board
static bool validateSelfUpdateUrl(const std::string &url, std::string &error)
{
    std::string host, path;
    if (!parseHttpsUrl(url, host, path, error)) {
        return false;
    }

    const std::string pathLower = toLower(path);
    if (pathLower.size() < 5 || pathLower.compare(pathLower.size() - 4, 4, ".zip") != 0) {
        error = "URL path must end in .zip";
        return false;
    }

    const size_t slash = pathLower.find_last_of('/');
    const std::string fileName = slash == std::string::npos ? pathLower : pathLower.substr(slash + 1);
    const std::string boardTag = "__" + toLower(std::string(BOARD_TYPE_NAME)) + "__";
    if (fileName.find(boardTag) == std::string::npos) {
        error = "File name does not match this board (expected '" + boardTag + "' in name)";
        return false;
    }
    return true;
}


struct SelfUpdateHeaderCtx {
    char *location;
    bool locationTooLong;
};


static esp_err_t selfUpdateHttpEvent(esp_http_client_event_t *evt)
{
    SelfUpdateHeaderCtx *ctx = (SelfUpdateHeaderCtx *)evt->user_data;
    if (evt->event_id == HTTP_EVENT_ON_HEADER && ctx && evt->header_key && evt->header_value) {
        if (strcasecmp(evt->header_key, "Location") == 0) {
            if (strlen(evt->header_value) >= SELFUPDATE_LOCATION_BUFSIZE) {
                ctx->locationTooLong = true;
            }
            else {
                strlcpy(ctx->location, evt->header_value, SELFUPDATE_LOCATION_BUFSIZE);
            }
        }
    }
    return ESP_OK;
}


// Downloads the URL into destFile. Returns empty string on success, otherwise an error text.
static std::string downloadSelfUpdatePackage(const std::string &startUrl, const char *destFile)
{
    std::string result;
    char *location = (char *)malloc(SELFUPDATE_LOCATION_BUFSIZE);
    char *buffer = (char *)malloc(SELFUPDATE_DOWNLOAD_BUFSIZE);
    if (!location || !buffer) {
        free(location);
        free(buffer);
        return "Out of memory";
    }
    location[0] = '\0';

    SelfUpdateHeaderCtx headerCtx = {location, false};

    esp_http_client_config_t config = {};
    config.url = startUrl.c_str();
    config.transport_type = HTTP_TRANSPORT_OVER_SSL;
    config.crt_bundle_attach = esp_crt_bundle_attach;
    config.timeout_ms = SELFUPDATE_TIMEOUT_MS;
    config.buffer_size = 4096;           // Long header lines (CDN redirect)
    config.buffer_size_tx = 2048;        // Long request line (CDN URL with signed query)
    config.disable_auto_redirect = true; // Every redirect target is validated manually
    config.event_handler = selfUpdateHttpEvent;
    config.user_data = &headerCtx;

    esp_http_client_handle_t client = esp_http_client_init(&config);
    FILE *file = NULL;
    int64_t contentLength = -1;
    int64_t received = 0;

    if (!client) {
        free(location);
        free(buffer);
        return "HTTP client init failed";
    }

    for (size_t redirects = 0;; ++redirects) {
        location[0] = '\0';
        headerCtx.locationTooLong = false;

        const esp_err_t err = esp_http_client_open(client, 0);
        if (err != ESP_OK) {
            result = std::string("Connection failed: ") + esp_err_to_name(err);
            goto cleanup;
        }

        contentLength = esp_http_client_fetch_headers(client);
        const int status = esp_http_client_get_status_code(client);

        if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
            if (redirects >= SELFUPDATE_MAX_REDIRECTS) {
                result = "Too many redirects";
                goto cleanup;
            }
            if (headerCtx.locationTooLong || location[0] == '\0') {
                result = "Invalid redirect response";
                goto cleanup;
            }

            std::string host, path, error;
            if (!parseHttpsUrl(location, host, path, error)) {
                result = "Redirect rejected: " + error;
                goto cleanup;
            }

            esp_http_client_close(client);
            if (esp_http_client_set_url(client, location) != ESP_OK) {
                result = "Redirect URL rejected";
                goto cleanup;
            }
            continue;
        }

        if (status != 200) {
            result = "Download failed: HTTP status " + std::to_string(status);
            goto cleanup;
        }
        break;
    }

    if (contentLength <= 0 || contentLength > MAX_FILE_SIZE) {
        result = "Invalid content length of download";
        goto cleanup;
    }

    file = fopen(destFile, "wb");
    if (!file) {
        result = "Failed to create file on SD card";
        goto cleanup;
    }

    {
        uint8_t retries = 0;
        int lastPercent = -1;

        while (received < contentLength) {
            const int64_t remaining = contentLength - received;
            const int toRead = (int)(remaining < (int64_t)SELFUPDATE_DOWNLOAD_BUFSIZE ? remaining : (int64_t)SELFUPDATE_DOWNLOAD_BUFSIZE);
            const int n = esp_http_client_read(client, buffer, toRead);

            if (n < 0) {
                if (n == -ESP_ERR_HTTP_EAGAIN && ++retries <= SELFUPDATE_MAX_READ_RETRIES) {
                    continue;
                }
                result = "Download interrupted (read error)";
                goto cleanup;
            }
            if (n == 0) {
                if (esp_http_client_is_complete_data_received(client)) {
                    break;
                }
                if (++retries <= SELFUPDATE_MAX_READ_RETRIES) {
                    continue;
                }
                result = "Download interrupted (connection closed)";
                goto cleanup;
            }

            retries = 0;
            if (fwrite(buffer, 1, n, file) != (size_t)n) {
                result = "Failed to write to SD card (card full?)";
                goto cleanup;
            }
            received += n;

            const int percent = (int)((received * 100) / contentLength);
            selfUpdatePercent = percent;
            if (percent / 10 != lastPercent / 10) {
                ESP_LOGI(TAG, "Self update download: %d%%", percent);
                lastPercent = percent;
            }
        }
    }

    if (received != contentLength) {
        result = "Download incomplete | Received " + std::to_string(received) + " of " + std::to_string(contentLength) + " bytes";
    }

cleanup:
    if (file) {
        fclose(file);
    }
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    free(location);
    free(buffer);

    if (!result.empty()) {
        deleteFile(destFile);
    }
    return result;
}


static void taskSelfUpdate(void *pvParameter)
{
    SelfUpdateParams *params = (SelfUpdateParams *)pvParameter;
    const std::string url(params->url);
    free(params);

    LogFile.writeToFile(ESP_LOG_INFO, TAG, "Self update started");

    makeDir(DIR_OTA_STAGED);
    deleteAllFilesInDirectory(DIR_OTA_STAGED, true);

    const std::string error = downloadSelfUpdatePackage(url, FILE_OTA_STAGED_PACKAGE);
    if (!error.empty()) {
        deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
        setSelfUpdateError(error);
        vTaskDelete(NULL);
        return;
    }

    selfUpdatePercent = 100;
    selfUpdateState = SelfUpdateState::Staging;
    setSelfUpdateMessage("Validating and staging update package");

    // Same checks as the manual upload path: only a ZIP package (firmware + WebUI) is accepted
    if (detectPackageType(FILE_OTA_STAGED_PACKAGE) != "ZIP") {
        deleteAllFilesInDirectory(DIR_OTA_STAGED, true);
        setSelfUpdateError("Downloaded file is not a valid ZIP package");
        vTaskDelete(NULL);
        return;
    }

    LogFile.writeToFile(ESP_LOG_INFO, TAG,
                        "Self update package downloaded | Size: " + std::to_string(getFileSize(FILE_OTA_STAGED_PACKAGE)));

    setSelfUpdateMessage("Download complete. Device reboots to install update");
    selfUpdateState = SelfUpdateState::Done;

    vTaskDelay(pdMS_TO_TICKS(1500)); // Give the WebUI the chance to poll the final state
    doReboot();                      // Mandatory reboot: Package is processed by checkOtaUpdate() during next boot (as for manual upload)
    vTaskDelete(NULL);
}


static esp_err_t sendOtaTextResponse(httpd_req_t *req, const char *status, const char *text)
{
    httpd_resp_set_status(req, status);
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
    httpd_resp_set_type(req, "text/plain");
    httpd_resp_sendstr(req, text);
    return ESP_OK;
}


// GET /ota?task=selfupdate&url=<urlencoded>  |  GET /ota?task=selfupdate_status
esp_err_t handler_ota_selfupdate(httpd_req_t *req)
{
    char query[1100];
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) {
        return sendOtaTextResponse(req, "400 Bad Request", "002: Missing parameter 'task' (selfupdate | selfupdate_status)");
    }

    char task[24];
    if (httpd_query_key_value(query, "task", task, sizeof(task)) != ESP_OK) {
        return sendOtaTextResponse(req, "400 Bad Request", "002: Missing or invalid parameter 'task' (selfupdate | selfupdate_status)");
    }

    if (strcmp(task, "selfupdate_status") == 0) {
        static const char *const stateNames[] = {"idle", "downloading", "staging", "done", "error"};

        char message[sizeof(selfUpdateMessage)];
        portENTER_CRITICAL(&selfUpdateMux);
        strlcpy(message, selfUpdateMessage, sizeof(message));
        portEXIT_CRITICAL(&selfUpdateMux);

        cJSON *json = cJSON_CreateObject();
        if (!json) {
            return sendOtaTextResponse(req, "500 Internal Server Error", "003: Out of memory");
        }
        cJSON_AddStringToObject(json, "state", stateNames[(int)selfUpdateState.load()]);
        cJSON_AddNumberToObject(json, "percent", selfUpdatePercent.load());
        cJSON_AddStringToObject(json, "message", message);
        char *jsonStr = cJSON_PrintUnformatted(json);
        cJSON_Delete(json);
        if (!jsonStr) {
            return sendOtaTextResponse(req, "500 Internal Server Error", "003: Out of memory");
        }

        httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
        httpd_resp_set_type(req, "application/json");
        httpd_resp_sendstr(req, jsonStr);
        cJSON_free(jsonStr);
        return ESP_OK;
    }

    if (strcmp(task, "selfupdate") != 0) {
        return sendOtaTextResponse(req, "400 Bad Request", "002: Unknown task (selfupdate | selfupdate_status)");
    }

    // Encoded value may be up to 3x longer than the decoded URL
    constexpr size_t encodedBufSize = SELFUPDATE_MAX_URL_LENGTH * 3 + 1;
    char *encodedUrl = (char *)malloc(encodedBufSize);
    if (!encodedUrl) {
        return sendOtaTextResponse(req, "500 Internal Server Error", "003: Out of memory");
    }
    const esp_err_t keyErr = httpd_query_key_value(query, "url", encodedUrl, encodedBufSize);
    if (keyErr == ESP_ERR_HTTPD_RESULT_TRUNC) {
        free(encodedUrl);
        return sendOtaTextResponse(req, "400 Bad Request", "002: Parameter 'url' too long");
    }
    if (keyErr != ESP_OK) {
        free(encodedUrl);
        return sendOtaTextResponse(req, "400 Bad Request", "002: Missing parameter 'url'");
    }
    const std::string url = urlDecode(encodedUrl);
    free(encodedUrl);

    if (url.empty() || url.size() > SELFUPDATE_MAX_URL_LENGTH) {
        return sendOtaTextResponse(req, "400 Bad Request", "002: Parameter 'url' empty or too long");
    }

    std::string error;
    if (!validateSelfUpdateUrl(url, error)) {
        LogFile.writeToFile(ESP_LOG_WARN, TAG, "Self update rejected: " + error);
        return sendOtaTextResponse(req, "400 Bad Request", ("002: " + error).c_str());
    }

    if (!getTimeIsSet()) {
        return sendOtaTextResponse(req, "409 Conflict", "004: Device time not set (NTP). Certificate validation requires a valid time");
    }

    // Claim the update slot atomically (only one update at a time). A previous error state may be retried.
    SelfUpdateState expected = selfUpdateState.load();
    if (expected != SelfUpdateState::Idle && expected != SelfUpdateState::Error) {
        return sendOtaTextResponse(req, "409 Conflict", "005: Another update is already running");
    }
    if (!selfUpdateState.compare_exchange_strong(expected, SelfUpdateState::Downloading)) {
        return sendOtaTextResponse(req, "409 Conflict", "005: Another update is already running");
    }
    selfUpdatePercent = 0;
    setSelfUpdateMessage("Download started");

    SelfUpdateParams *params = (SelfUpdateParams *)malloc(sizeof(SelfUpdateParams));
    if (!params) {
        selfUpdateState = SelfUpdateState::Idle;
        return sendOtaTextResponse(req, "500 Internal Server Error", "003: Out of memory");
    }
    strlcpy(params->url, url.c_str(), sizeof(params->url));

    // Modest stack (TLS handshake), low priority: runs next to camera / flow tasks
    if (xTaskCreate(&taskSelfUpdate, "taskSelfUpdate", 10240, params, tskIDLE_PRIORITY + 2, NULL) != pdPASS) {
        free(params);
        setSelfUpdateError("Failed to create update task");
        return sendOtaTextResponse(req, "500 Internal Server Error", "003: Failed to create update task");
    }

    return sendOtaTextResponse(req, "200 OK", "001: Self update started");
}


static void forceReboot()
{
    const esp_task_wdt_config_t twdtConfig = {
        .timeout_ms = 100,
        .idle_core_mask = (1 << SOC_CPU_CORES_NUM) - 1,
        .trigger_panic = true,
    };

    esp_err_t err = esp_task_wdt_init(&twdtConfig);
    if (err == ESP_ERR_INVALID_STATE) { // Already initialized
        err = esp_task_wdt_reconfigure(&twdtConfig);
    }

    if (err != ESP_OK) {
        abort();
    }

    err = esp_task_wdt_add(NULL);
    if (err != ESP_OK) {
        abort();
    }

    while (true) {
        // Wait for watchdog reset
    }
}


static void taskReboot(void *DeleteMainFlow)
{
    markPlannedReboot();

    // Kill main task if executed in extra task, if not don't kill parent task to force reboot
    if ((bool)DeleteMainFlow) {
        deleteMainFlowTask();
    }

/* Stop service tasks */
#ifdef ENABLE_MQTT
    deinitMqttClient(true);
#endif // ENABLE_MQTT

    cameraCtrl.setFlashlight(false);
    forceStatusLedOff();
    cameraCtrl.deinitCam();

    destroyGpioHandler();

    httpd_stop(server);

    vTaskDelay(pdMS_TO_TICKS(3000));
    deinitNetwork();

    vTaskDelay(pdMS_TO_TICKS(1000));
    esp_restart();

    // Only reached if esp_restart() unexpectedly returns.
    vTaskDelay(pdMS_TO_TICKS(5000));
    forceReboot();
}


void doReboot()
{
    LogFile.writeToFile(ESP_LOG_INFO, TAG, "Reboot triggered by software");
    LogFile.writeToFile(ESP_LOG_WARN, TAG, "Reboot in 5 seconds");

    BaseType_t xReturned = xTaskCreate(&taskReboot, "taskReboot", configMINIMAL_STACK_SIZE * 4, (void *)true, 10, NULL);
    if (xReturned != pdPASS) {
        LogFile.writeToFile(ESP_LOG_ERROR, TAG, "taskReboot not created -> force reboot without killing flow");
        taskReboot((void *)false);
    }
}


void doRebootOTA()
{
    LogFile.writeToFile(ESP_LOG_WARN, TAG, "Reboot in 5 seconds");

    markPlannedReboot();

    cameraCtrl.setFlashlight(false);
    forceStatusLedOff();
    cameraCtrl.deinitCam();

    vTaskDelay(5000 / portTICK_PERIOD_MS);
    esp_restart();

    // Only reached if esp_restart() unexpectedly returns
    vTaskDelay(5000 / portTICK_PERIOD_MS);
    forceReboot();
}


esp_err_t handler_reboot(httpd_req_t *req)
{
    LogFile.writeToFile(ESP_LOG_DEBUG, TAG, "handler_reboot");

    httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
    httpd_resp_set_type(req, "text/plain");
    httpd_resp_sendstr(req, "Reboot initiated");

    doReboot();

    return ESP_OK;
}


void registerOtaRebootUri(httpd_handle_t server)
{
    ESP_LOGI(TAG, "Registering URI handlers");

    httpd_uri_t camuri = {};
    camuri.method = HTTP_POST;
    camuri.uri = "/ota/*";
    camuri.handler = HTTP_AUTH_BASIC(handler_ota);
    camuri.user_ctx = httpServerData;
    httpd_register_uri_handler(server, &camuri);

    camuri.method = HTTP_GET;
    camuri.uri = "/ota";
    camuri.handler = HTTP_AUTH_BASIC(handler_ota_selfupdate);
    camuri.user_ctx = NULL;
    httpd_register_uri_handler(server, &camuri);

    camuri.method = HTTP_GET;
    camuri.uri = "/reboot";
    camuri.handler = HTTP_AUTH_BASIC(handler_reboot);
    camuri.user_ctx = NULL;
    httpd_register_uri_handler(server, &camuri);
}
