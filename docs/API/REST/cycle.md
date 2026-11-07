[Overview](_OVERVIEW.md)

## REST API Endpoint: `api/cycle`

`POST http://IP-ADDRESS/api/cycle` (no body)

Triggers a cycle (flow) start. Replaces `/cycle_start`.

| HTTP | `code` | Meaning |
|---|---|---|
| 200 | `001` | Cycle start triggered |
| 200 | `002` | Scheduled, starts after the running cycle |
| 200 | `003` | Initialization delay aborted |
| 409 | `E90` | Main task not initialized, request rejected |

Response: `{"ok":true,"code":"001","message":"Cycle start triggered (12:00:01)"}`

### Pause the countdown (config mode)

`POST http://IP-ADDRESS/api/cycle` with body `{"paused":true}` or `{"paused":false}`

Stops (or resumes) the countdown to the next automatic cycle, for example while the camera is adjusted. A running cycle is finished, manual starts still work. The state is not stored and is reset by a reboot. The current state is reported by [status](status.md) (`paused`).

| HTTP | `code` | Meaning |
|---|---|---|
| 200 | `004` | Countdown paused |
| 200 | `005` | Countdown resumed |
| 400 | `E91` | Parameter `paused` (boolean) missing |
