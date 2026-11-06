#ifndef SERVEROTA_H
#define SERVEROTA_H

#include <esp_http_server.h>


void checkOtaUpdate();

void doReboot();
void doRebootOTA();

esp_err_t handler_ota(httpd_req_t *req);
esp_err_t handler_api_update(httpd_req_t *req);
esp_err_t handler_api_update_status(httpd_req_t *req);
esp_err_t handler_api_reboot(httpd_req_t *req);
void registerOtaRebootUri(httpd_handle_t server);

#endif // SERVEROTA_H
