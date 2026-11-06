[Overview](_OVERVIEW.md)

## REST API Endpoints: `api/update` and `api/update/status`

One-click update: the device downloads a release package from GitHub itself and installs it (replaces `/ota?task=selfupdate`).

* `POST /api/update` body `{"url":"https://github.com/<owner>/<repo>/releases/download/<tag>/AI-on-the-edge-device__<board>__<version>.zip"}`.
  Only the hosts `github.com`, `objects.githubusercontent.com` and `release-assets.githubusercontent.com` (HTTPS) are accepted.
  Returns `{"ok":true,"code":"001",...}`; errors: `400 002` invalid URL, `409 004` time not set (needed for the certificate check),
  `409 005` another update runs, `500 003` internal error.
* `GET /api/update/status` returns `{"state":"idle|downloading|staging|done|error","percent":0,"message":""}`. After `staging` / `done`
  the device restarts and installs the package.

Uploading a package from the computer still uses `POST /ota/<filename>` (see [ota.md](ota.md)).
