# WebUI mock server

Runs the WebUI without a device. Python 3, no dependencies.

```
python tools/webui/mock/mock_server.py [html_dir] [port]     # default: sd-card/html, port 8099
```

Serves the files of `sd-card/html` and answers the JSON and legacy endpoints with the data of a (blurred) gas meter: `/api/status`,
`/api/cycle` (start and pause), `/api/live` (a simulated cycle of about 12 s), `/api/recognition`, `/config`, `/fileserver/...`
(including a data log for the readings plot), update and reboot simulation. `assets/` holds the images. Keep the mock in sync when an
endpoint is added or changed.

## Design proofs of concept

`poc/*.html` are served by the mock under `/poc/` (they are not part of the firmware package), for example
`http://127.0.0.1:8099/poc/config-digits-mobile.html`: the Digits tab of the Configuration built for a phone (open it with a narrow window or the
mobile viewport of the browser tools).

## From a phone (same network)

The mock listens on all interfaces (`0.0.0.0`) and prints its LAN addresses at the start, for example `http://192.168.1.20:8099/`. Open that
address on the phone. Windows may block incoming connections of Python (the Wi-Fi is often a "public" network): allow Python in the firewall
when asked, or start the mock with `127.0.0.1` as third argument (`python tools/webui/mock/mock_server.py "" 8099 127.0.0.1`) to keep it local.
