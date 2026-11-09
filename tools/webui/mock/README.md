# WebUI mock server

Runs the WebUI without a device. Python 3, no dependencies.

```
python tools/webui/mock/mock_server.py [html_dir] [port]     # default: sd-card/html, port 8099
```

Serves the files of `sd-card/html` and answers the JSON and legacy endpoints with the data of a (blurred) gas meter: `/api/status`,
`/api/cycle` (start and pause), `/api/live` (a simulated cycle of about 12 s), `/api/recognition`, `/config`, `/fileserver/...`
(including a data log for the readings plot), update and reboot simulation. `assets/` holds the images. Keep the mock in sync when an
endpoint is added or changed.
