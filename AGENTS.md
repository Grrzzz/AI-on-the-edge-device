# AGENTS.md - briefing for AI assistants working on this repository

Read this first. It describes the project, the current state (release **2.4.1 "Grrzzz"**, tag `v2.4.1-Grrzzz`), how to build and test, the
rules of the owner and the pitfalls we already ran into. The owner speaks **German**: answer in German, keep code, commit messages and
documentation in English.

## What this is

Personal fork of [Slider0007's SLFork](https://github.com/Slider0007/AI-on-the-edge-device) (which continues
[jomjol's AI-on-the-Edge Device](https://github.com/jomjol/AI-on-the-edge-device)): ESP32-CAM firmware that reads water, gas and electricity
meters with TensorFlow Lite on the device. Owner: Grrzzz (`github.com/Grrzzz/AI-on-the-edge-device`). Release name **"Grrzzz"**, versions
`vX.Y.Z-Grrzzz` (the Grrzzz line ranks above the legacy 17.x/18.x numbers in the update check).

What this fork changed: a new single page WebUI (Doorbell look, see the owner's FingerprintDoorbell fork), a JSON REST backend, one-click
update from GitHub, only the `esp32cam` board, automatic migration of a v16 `config.ini`, meter type themes, a live picture animation of the
running cycle (needs firmware support, see `docs/API/REST/live.md`).

The owner runs two productive ESP32-CAM devices (a gas meter and a water meter). Ask the owner before touching them; the owner often flashes
them personally.

## Repository layout

| Path | Content |
|---|---|
| `code/` | Firmware (ESP-IDF 6.1 via PlatformIO, env `esp32cam`). Components in `code/components/` (`mainprocess_ctrl` = flow, API handlers, `config_handling`, `fileserver_ota`, `image_handling`, `mqtt_ctrl`, ...) |
| `sd-card/html/` | The WebUI: `index.html`, `app.js` (about 12k lines), `style.css`, generated icons/state images. Everything the SD card serves |
| `tools/webui/` | `make_icons.py` (generates icons, `flowstate_*.jpg` and the theme block of `app.js`: run it after changing themes), `generate_param_tooltips.py`, **`mock/`** (mock server, see below) |
| `docs/` | `API/REST/*.md` (endpoint docs, keep them in sync), `WebUI/README.md` (WebUI conventions - read it), `Installation`, `Development`, `images/ui-*.png` (README screenshots) |
| `.builds/` | Build output (zip packages), not committed |

## Git and branches

- `develop` is the main line and the target of releases. Work on a branch `feat/<topic>` / `fix/<topic>` off `develop` and tell the owner;
  do not work directly on `develop` or `feat/webui-sidebar-design` when another assistant is active (that branch equals `develop` now).
- Commit author: **Grrzzz**. Add a trailer naming the assistant, e.g. `Co-Authored-By: <your name> <noreply@...>`. Never use an empty or
  generic e-mail like `noreply@users.noreply.github.com` as author (GitHub maps it to a foreign account). Small commits, imperative English
  subject (`feat(webui): ...`, `fix: ...`, `docs: ...`).
- **Ask before** `git push`, creating tags/releases, force pushes, deploying to a device and any other outward-facing action. The owner
  approves each of them. Credentials come from the Git Credential Manager; never write tokens into files, logs or messages and never reuse a
  token the owner pasted into a chat.

## Build and test

Firmware and packaged WebUI:
```
cd code
platformio run -e esp32cam            # RELEASE_VERSION=v2.4.1 builds .builds/AI-on-the-edge-device__esp32cam__grrzzz_release_v2.4.1.zip
```
- The firmware version string comes from `git describe --exact-match --tags` at configure time: a build on an untagged commit reports
  `Develop: <branch> @ <hash>`, a dirty tree adds `+`. After tagging or when the string is stale, `touch code/main/CMakeLists.txt`.
- New `.cpp` files are found by `GLOB_RECURSE`: `touch` the component's `CMakeLists.txt` after adding files.
- The WebUI needs no build: copy/serve `sd-card/html`. `post_build_tasks.py` stamps `$COMMIT_HASH` into `index.html` and builds the zip.
- Compiling takes 3 to 5 minutes. A successful build is **not** a tested firmware: say so when you did not run it on a device.

WebUI without a device - the mock server (no dependencies except Python 3):
```
python tools/webui/mock/mock_server.py            # serves sd-card/html on http://127.0.0.1:8099/ and in the LAN (prints the addresses)
```
It answers the JSON endpoints with the data of a gas meter (blurred images), simulates a cycle of about 12 s for "Start cycle" including
`/api/live` and a data log for the readings plot. **When you add or change an endpoint, update the mock too** (`api_status`, `api_live`,
`api_recognition`, `api_post`, `do_GET`). Headless checks with Playwright + Edge worked well (screenshots, timing, console errors);
Playwright is not part of the repo.

README screenshots (`docs/images/ui-*.png`) are taken from the mock; no real IPs, serial numbers or credentials may be visible.

## WebUI architecture (short)

Single page app, hash routes, no framework. Read `docs/WebUI/README.md`. Key parts of `app.js`:
- `Api.*` (`system`, `files`, `ota`, `process`, `mqtt`, `setup`, `config`): the only place that knows endpoints; views never call fetch.
- `App`: router, theme (light/dark), `MeterTheme` (icons follow the meter type, main color = color theme: blue default, orange, amber, pink,
  slate; override in Setup > General), `setTitle`/`setTitleBadge` (tab title starts with the host name), `writeFavicon`.
- `CycleMonitor` (sidebar: state, countdown, pause, last success; polls `/api/status` every 2 s, event `cycle-status`), `UpdateHint`
  (newer release hint), `createUpdateOverlay` (update/reboot screens).
- Dashboard: hero counter, readings plot from the data log (`createReadingsPlot`), recognition card, and the **picture animation**
  `createImageReveal` (state machine: stage, reveal from the scan icon, hold, rotate, align, regions, zoom, recog, zoom out; driven by
  `GET /api/live`, falls back to a replay when the firmware has no `/api/live`).
- Setup (schema driven, `SCHEMA`), Configuration editor (image, markers, digits, analog), wizard, file explorer, backup/restore, v16 import
  (`LegacyImport`).
Configuration editor (all widths): a control layer (`.m-only`: sequence bar, region combo with move, copy and delete per entry, pad with jog, zoom switch over the image, steppers, options) drives the same
functions as the original fields (`onValueManualChanged`, `markerValueChanged`, ...); the original cards are hidden by `.m-hide` but still work. The canvas moves
the selected region by dragging, the size is changed with the steppers. Below 1256 px the image stays in view (sticky), below 860 px tabs and the image tab are
compacted. Design proof: `tools/webui/mock/poc/config-digits-mobile.html`.
Conventions: no emojis, no inline handlers, ids/classes carry the view prefix (`dash-`, `rec-`, `setup-`, `cfg-`, `sys-`), tokens in
`:root` (light/dark) in `style.css`, mobile breakpoint 860 px (menu) / 1156 px (dashboard layout).

## Firmware and API notes

- REST docs in `docs/API/REST` are the contract: `status` (incl. `nextRunSeconds`, `paused`, `lastSuccess*`), `cycle` (start or
  `{"paused":true|false}`), `live` (progress of the running cycle), `recognition` (results, `alignment`, per ROI `confidence` and `rect`),
  `fallback`, `flow`, `update`, `reboot`, `mqtt`, `fileserver`.
- `LiveFlow` (`code/components/mainprocess_ctrl/ClassFlowLive.*`): flow task writes, web server task reads (mutex). While a web interface
  asks for `/api/status` or `/api/live` the process **pauses after each step** (`stepPause`) so the live view can follow; nothing is slowed
  down without a web interface.
- The alignment is reported as: aligned image = rotate the raw image by `rotation` degrees around the center (positive clockwise), then
  shift by `dx`, `dy`. Raw image `/img_tmp/raw.jpg` lives in RAM (about 190 KB PSRAM).
- The ESP32 is busy while it processes: HTTP answers can take seconds. The WebUI therefore keeps the last state and treats a missing answer
  as "busy" (never as "not supported"); do not poll faster than every 1 to 2 s and keep one request in flight.
- `max_uri_handlers` is 50 (`webserver.cpp`); a new endpoint may need a higher value.
- Optional MCP server (`code/components/mcp_ctrl`, docs `docs/API/REST/mcp.md`): `POST /mcp` JSON-RPC with a bearer token (device-generated,
  only the SHA-256 hash lives in NVS namespace `mcp`, survives reboot), switched on under System > MCP. The tools call the device's own
  REST endpoints over loopback from a worker task (the request is detached with `httpd_req_async_handler_begin`, otherwise the single web server
  task would deadlock). When a REST endpoint changes, check the tool of the same name. The mock simulates it (`/mcp`, `/api/mcp`).
  mbedTLS 4: hashing goes through PSA (`psa_hash_compute`), `mbedtls/sha256.h` is not public any more.
- Secrets (WLAN, MQTT passwords) live in NVS (`parseSecretParameter`); the v16 migration (`configLegacyIni.cpp`) copies them.
- Confidence: the class100 models (`dig-class100*`, `ana-class100*`) end with a fully connected layer **without softmax** (checked in the
  .tflite files), their outputs are raw logits. The confidence therefore applies a softmax first (`ClassFlowCNNGeneral.cpp`); the earlier
  sum of the raw outputs gave 0 % for digits and 100 % for analog. `dig-class11` and `dig-cont` have a softmax. Not yet verified on a device.
- Open questions: analog ROIs of the live view are only tested with the mock. The MCP server is marked **beta** (tested on a device with mcp-remote since 2.4.1, but never run for a longer time); the configuration editor was only tested in the mock (phone width in the browser, not on a real touch screen).

## Releasing (only when the owner asks)

1. Add a "What is new in X.Y" section to `README.md`, refresh `docs/images/ui-*.png` from the mock.
2. Commit, tag `vX.Y.Z-Grrzzz` (annotated), `touch code/main/CMakeLists.txt`, build with `RELEASE_VERSION=vX.Y.Z`; check that the zip's
   `firmware.bin` contains the version string.
3. After the owner's OK: push `develop` and the tag, create the GitHub release (title `X.Y Grrzzz`, notes, zip
   `AI-on-the-edge-device__esp32cam__grrzzz_release_vX.Y.Z.zip` as asset). The device update page asks GitHub `releases/latest`.
4. Dev builds (untagged or dirty) must always be able to update to the official release (`isNewer()` in `app.js`).

Details that were unclear before:
- Releases are built **locally**, not by CI. The GitHub workflow (release-please) is not used for the published releases; do not wait for it.
- Naming: tag `vX.Y.Z-Grrzzz` (annotated), release title `X.Y.Z Grrzzz` style as in earlier releases, zip `..._grrzzz_release_vX.Y.Z.zip` (no `-Grrzzz` suffix), `RELEASE_VERSION=vX.Y.Z` without suffix.
- Release notes live in `.builds/release_notes_XY.md` (ignored by git, pattern: first line "X.Y.Z Grrzzz - summary", "What is new", "Installation"). Pass them to `gh release create --notes-file`.
- Order: merge the feature branch into `develop`, README section and notes, tag, `touch code/main/CMakeLists.txt`, build, check `firmware.bin`, then (after the OK) push `develop` and the tag and create the release.
- PlatformIO is not on PATH here: `python -m pip install platformio`, then run `python -m platformio run -e esp32cam` in `code/` (3 to 5 minutes, log to a file).
- The tag must sit on the **last commit** (HEAD) that is built: commit everything first, then tag, then `touch` and build. A commit after tagging makes the build report `Develop: <branch> @ <hash>`. The check is not only that the version appears in `firmware.bin`: `Develop: . @ .` is always in the binary as a format string, but the stamped values must read `<hash>.<branch>.vX.Y.Z-Grrzzz` (the tag as last value, with the hash of HEAD).
- If a tag has to move after publishing: `git push --force origin vX.Y.Z-Grrzzz`, delete the release asset through the API and upload the rebuilt zip.
- A build and a release are not a device test: say so in the release notes and to the owner.
## Owner's preferences

- Look and feel like the FingerprintDoorbell fork: calm, flat, no emojis, no "standard" icon sets; small, quiet help texts.
- Meter type drives icons; the theme only drives the main color. Mobile matters (floating top bar, cards stack).
- Prefers working things over explanations; wants honest statements about what was tested and what not.
- Ideas the owner collects are only built when told ("auf Go"). Do not release or deploy on your own initiative.

## Pitfalls we hit

- Many C++ files use **CRLF**; keep line endings of existing files (edit scripts must normalize and restore them). `app.js`/`style.css`
  are edited with LF in the working copy; Git may warn about CRLF conversion, that is fine.
- Writing C++/JS through Python heredocs with backslashes (`'\0'`, `\n`, `\d`) corrupted files twice: write patch scripts to a file with
  an editor tool instead and run them.
- `sendProcessImages` serves `alg.jpg`, `alg_roi.jpg`, `raw.jpg`, `*_org.jpg` from RAM; the SD files in `/img_tmp/` may be stale.
- The firmware serves `.svg`/`.webmanifest` with explicit content types (`server_help.cpp`); a wrong type breaks icons.
- A background browser tab does not poll: never treat that as a lost connection.
- Do not put real IP addresses, serial numbers (the demo images have the serial number blurred) or passwords into docs, screenshots or commits.
