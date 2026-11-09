FILE(GLOB_RECURSE app_sources ${CMAKE_CURRENT_SOURCE_DIR}/*.cpp ${CMAKE_CURRENT_SOURCE_DIR}/*.c)

idf_component_register(SRCS ${app_sources}
                    INCLUDE_DIRS "."
                    REQUIRES esp_http_server esp_http_client cjson mbedtls nvs_flash esp_hw_support esp_netif
                             config_handling logfile_handling webserver_softap misc_helper)
