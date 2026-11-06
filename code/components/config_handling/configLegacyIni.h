#ifndef CONFIG_LEGACY_INI_H
#define CONFIG_LEGACY_INI_H

#include <string>

// Migration of the configuration of firmware v16 (config/config.ini) to the JSON configuration (config/config.json).
//
// Called while the configuration is loaded: If no config.json exists but a config.ini does, the settings of the ini file
// are converted to a JSON document that is processed like a regular config.json.
//
// Converted: operation, camera, alignment, digit / analog regions, post-processing, MQTT, hostname, WLAN (/sdcard/wlan.ini, otherwise the
// credentials stored in the NVS are kept), GPIO and log level. Not converted: InfluxDB, Webhook.

#define LEGACY_INI_FILE "/sdcard/config/config.ini"
#define LEGACY_INI_FILE_MIGRATED "/sdcard/config/config.ini.migrated"
#define LEGACY_WLAN_FILE "/sdcard/wlan.ini"
#define LEGACY_PREVALUE_FILE "/sdcard/config/prevalue.ini"
#define LEGACY_PREVALUE_FILE_MIGRATED "/sdcard/config/prevalue.ini.migrated"

// Converts config/config.ini to a JSON configuration string. Returns false if there is no (usable) ini file.
bool legacyIniToJson(std::string &json);

// Finishes the migration after the converted configuration was applied and saved:
// copies the alignment marker images (ref0/ref1.jpg -> marker1/2.jpg), takes over the last valid value (prevalue.ini)
// and renames the ini files to *.migrated so that the migration runs only once.
void legacyIniFinishMigration();

#endif // CONFIG_LEGACY_INI_H
