[Overview](_OVERVIEW.md)

## REST API Endpoint: `api/status`

`GET http://IP-ADDRESS/api/status`

State of the main process (used by the cycle display of the WebUI).

```json
{"api_name":"status:v1","state":"Idle - Waiting For Autostart","stateCode":7,"stateSeconds":42,"cycle":842,
 "autoStart":true,"running":false,"cycleStart":"ready","processInterval":5,"processTime":12,"uptime":123456,"error":0}
```

| Field | Description |
|---|---|
| `state` | Process state as text |
| `stateCode` | 0 init delayed, 1 init, 2 setup mode, 3 idle (manual), 4 image processing, 5 publish data, 6 additional tasks, 7 idle (automatic) |
| `stateSeconds` | Seconds since the state was entered |
| `cycle` | Number of the current / last cycle |
| `running` | A cycle is being processed |
| `cycleStart` | `ready` (a start triggers a cycle right away), `queued` (a start is executed after the running cycle), `unavailable` |
| `error` | 0 none, -1 / -2 error (in a row), 1 / 2 deviation (in a row) |
