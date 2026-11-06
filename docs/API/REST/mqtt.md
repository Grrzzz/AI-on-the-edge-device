[Overview](_OVERVIEW.md)

## REST API Endpoints: `api/mqtt/discovery` and `api/mqtt/deviceinfo`

* `POST /api/mqtt/discovery` schedules the publication of the Home Assistant discovery topics (during state "Publish to MQTT").
* `POST /api/mqtt/deviceinfo` schedules the publication of the device info topics.

Response: `{"ok":true,"code":"001","message":"..."}`
