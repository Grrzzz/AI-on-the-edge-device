[Overview](_OVERVIEW.md) 

## REST API Endpoint: `ota` (self update)

`http://IP-ADDRESS/ota?task=selfupdate&url=...`

Perform a one-click Over-The-Air (OTA) update: The device downloads the release package (`.zip`) 
**itself** from GitHub and installs it the same way as a manually uploaded package 
(see [ota](ota.md)): The package is staged on the SD card, the device reboots, then flashes the 
firmware and replaces the WebUI files.

### Request

- **Method:** `GET`
- **Endpoint:** `/ota`

| Parameter | Description |
|---|---|
| `task=selfupdate` | Start the download and update in a background task |
| `task=selfupdate_status` | Get the current state of the self update |
| `url` | (only `selfupdate`) URL-encoded `https` URL of the release package ZIP (max. 300 characters, decoded) |

Examples:
```
/ota?task=selfupdate&url=https%3A%2F%2Fgithub.com%2FOWNER%2FREPO%2Freleases%2Fdownload%2Fv1.0.0%2FAI-on-the-edge-device__esp32cam__SLFork_v1.0.0.zip
/ota?task=selfupdate_status
```

#### URL requirements (`selfupdate`)

- Scheme `https`, no user info, no explicit port
- Host is one of `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`
- Path ends in `.zip`
- File name contains `__<board name>__` of this device (case-insensitive), e.g. `__esp32cam__`. 
  The board name is the build environment name of the firmware (see `board_type` in [info](info.md)). 
  Release packages are named `AI-on-the-edge-device__<board>__SLFork_v<version>.zip`.
- Device time must be set (NTP), as the TLS certificate validation needs a valid time
- No other update is running

GitHub redirects release assets to a CDN host. Every redirect target is checked against the same 
host list (`https` only, max. 5 redirects). The server certificate is validated with the 
ESP-IDF certificate bundle.

### Response `selfupdate`

- Content type: `text/plain`
- Content:
  - On success (`200`): `001: Self update started`
  - `400`: `002: <reason>` (missing / too long url, scheme not https, host not allowed, 
    not a `.zip`, file name does not match the board)
  - `409`: `004: Device time not set ...` or `005: Another update is already running`
  - `500`: `003: <reason>` (out of memory, task creation failed)

The request returns immediately; the download runs in the background (low priority task). 
After a successful and complete download the package is validated (ZIP) and the device reboots 
automatically to install the update. Partial files are deleted on any error.

### Response `selfupdate_status`

- Content type: `application/json`
- Content:
```json
{"state":"downloading","percent":42,"message":"Download started"}
```

| Field | Description |
|---|---|
| `state` | `idle`, `downloading`, `staging`, `done` (reboot follows), `error` |
| `percent` | Download progress 0 - 100 |
| `message` | Human readable info / error reason |

The status is kept in RAM only: It is reset by the reboot. After a failed update (`state` = `error`) 
a new update can be started.
