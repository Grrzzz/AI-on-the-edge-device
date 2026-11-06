# Legacy endpoints used by the Api layer

## system

### system part (system.js / system.css)

## Routes / views
`system-info`, `system-update`, `system-backup`, `system-files`, `system-reboot`. Root gets `sys sys-<view>`; content is wrapped in `.container` (header + `.container-content`) as in the old pages.
- `system-files`: path from `ctx.query.get('path')` (default `/`), navigation via `App.navigate('#/system/files?path=/config/')`. Implements `route(ctx)` so a query change does not need a remount.
- `system-reboot`: `#/system/reboot?now=1` reboots immediately (replaces the old `sys_reboot.html#reboot` hash trigger).
- Backup page link "Open the File Explorer" -> `#/system/files?path=/config/`.

## Api added
- `Api.system`: `info(type, label)` (toast, string|null), `infoQuiet(type)` (throws), `infoAll()` (JSON of `/info`), `coreDump('show'|'clear')`, `coreDumpSaveUrl()`, `reboot()`.
- `Api.files`: `list(dirPath, {all})` -> `[{name,isDir,size,path,protected}]` (array has `.truncated`), `listRecursive(dirPath)`, `downloadUrl(path)`, `read(path,{timeout})` -> Uint8Array, `upload(path,file,onProgress(pct))`, `remove(path,isDir)`.
  Legacy parsing: `GET /fileserver<dir>/?full=true|false` returns HTML; `#files_table` rows are parsed inside `Api.files` (size is KB resolution; `protected` = row without action buttons). `?list_dir=true` JSON has no sizes, so not used. Paths: `dirPath` = `/config/models/` (trailing slash), `entry.path` has no trailing slash (also for dirs).
- `Api.ota`: `latestRelease(repo)` (GitHub), `selfUpdate(url)`, `selfUpdateStatus()`, `upload(file,onProgress(loaded,total))`, `hasLegacyApi()`, `legacyInstall(file,{onPhase,onProgress})` (deprecated fallback kept), `rebootAndWait({interval,firstPollAfter,timeout,onTick,cancelled})` -> 'online'|'timeout'|'cancelled'.

## Endpoints used
`/info`, `/info?type=`, `/coredump?task=show|save|clear`, `/reboot`, `/index.html` (poll), `/ota?task=selfupdate|selfupdate_status|api_check|emptyfirmwaredir|update`, `POST /ota/<name>`, `/upload/firmware/<name>`, `/fileserver<path>`, `POST /upload<path>?overwrite=true`, `POST /delete<path>[?task=deldir]`, GitHub releases API.

## Notes for the lead
- Requires global `loadScript(url)` (Promise) for `/fflate.min.js` (backup, restore validation, ZIP in explorer); `fflate` used afterwards.
- After reboot/update/restore the app does `location.hash='#/dashboard'; location.reload()`.
- Info page: no auto-refresh (as before), single load on mount. `renderRssi()` of global.js is NOT used (it needs fixed ids); signal bars are rendered locally. The old page footer (copyright) is not part of the view.
- Base CSS expected: `.container*`, `.card*`, `.stat*`, `.stack*`, `.chips/.chip`, `.badge*`, `.prog`, `.steps`, `.state-box`, `.pick/.file-row`, `.log-console`, `.note-row`, `.two-col`, `.stat-row`, `.lead`, `.side-body`, `.btn-*`, `.ghost`. The explorer's drop zone/queue/table styles are defined in system.css (`.sys-files ...`), not base.
- `Api.files.list` default `all=false` keeps the device-side cut at 100 items (with a "Load all items" button), like the old explorer. The firmware still serves `sys_fileserver.html` as static prefix of the HTML listing (HTML_FILE_FILESERVER_STATIC); it is only parsed, never displayed, so the file must stay on the SD card (or the C++ side must be changed in phase 2).
- Behaviour changes (small): backup now recurses into nested folders and lists complete folders; explorer table is sortable by clicking headers (default dirs first, then name); explorer ZIP of a truncated listing loads the full listing first; legacy-OTA error paths now re-enable the controls; zip name for the SD root is `sdcard_<timestamp>.zip`.
- Not browser-tested (only `node --check`).

## dashboard

### dashboard part (views `dashboard`, `recognition`)

Files: `dashboard.js`, `dashboard.css` (all selectors under `.dash` / `.rec`), this file. `node --check` passes (not run against a DOM).

## Routes / views
- `dashboard` (`#/dashboard`): root gets class `dash`. Hero cards per sequence, stat tiles, RSSI, image view, activity console (/log),
  inline fallback value editor, fixed 5 s auto refresh (image only reloaded when cycle/state changed), manual Refresh button, error states unchanged.
  No cycle-start button (the old dashboard had none); the shell button just calls `Api.process.cycleStart()`.
- `recognition` (`#/recognition`): root gets class `rec`. Same markup/look as the former firmware page (cards, ROI tiles, processed image, "waiting for first cycle" notice with Refresh).
  The old page had no auto refresh, neither has this one (Refresh button in the notice; remount reloads). An extra "not available" notice with Refresh appears if the device does not answer.
- Both views clean up on `unmount` (timer cleared, fetches aborted via AbortController) and can be remounted. No `route()` needed.

## Api added
- `Api.process.get(signal?)` -> process_data object or `null`
- `Api.process.log(signal?, maxLines=40)` -> `[{ts,lvl,mod,msg}]` newest first, DBG dropped; `null` = log unavailable; `undefined` = aborted
- `Api.process.cycleStart()` -> `{ok, code}` (code 001/002/003 success, 099 rejected, else null). Shows the same toasts as the old shell. The old shell then reloaded the iframe; the new shell should remount/refresh the current view itself when `ok && code`.
- `Api.process.setFallbackValue(sequence, value)` -> boolean (toasts included)
- `Api.process.imageUrl(nameOrPath)` -> full cache-busted image URL (`'alg_roi.jpg'` or `/img_tmp/...`)
- `Api.process.recognition(signal?)` -> `null` | `{ready:false,state}` | `{ready:true, sequences:[{name,rawValue,actualValue,digit:{enabled,rois:[{value,na,image}]},analog:{...}}], image}`
- `Api.mqtt.publishHaDiscovery()` -> boolean (merged into an existing `Api.mqtt` if another part defines one; shows the same toast as the old shell)

## Legacy endpoints used (replace in phase 2)
- `GET /process_data` (JSON)
- `GET /log` (plain text, regex-parsed in `Api.process.log`)
- `GET /cycle_start` (text, 3-char code)
- `GET /set_fallbackvalue?sequence=&value=`
- `GET /mqtt?task=publish_ha_discovery`
- `GET /recognition_details` (HTML, parsed with DOMParser in `Api.process.recognition`): process_data does not contain per-ROI results, so parsing the
  HTML is the only exact source. Images `/img_tmp/<roi>_org.jpg` and `/img_tmp/alg_roi.jpg`. Phase 2: JSON `/api/recognition` with the shape above.

## Notes for the lead
- RSSI rendering is done inside the view (own `.dash-rssi` svg, no global ids) because global `renderRssi` relies on ids `wlan_rssi`/`rssi_svg`.
- Reused base classes: `card`, `card-header`, `card-body`, `stat*`, `chip(s)`, `button`, `btn-action`, `container-header/title`, `page-sub`, `container-content`,
  `refresh-group`, `refresh-loader`, `loader`, `spinner-svg`, `is-loading` (+ `@keyframes spin`), tokens. These must stay in the merged style.css.
- The old firmware classes `recog-*`, `roi-*`, `notice*`, `image-body` are replaced by `rec-*` in dashboard.css; they can be dropped from the base.
- Uses globals `apiCall`, `apiCallNotify`, `getDomainname`, `formatUptime`, `firework`, `loaderSpinner`, `noImageAvailable`, `App`, `Api`. The old `global.js` `loadImage` global is not used or shadowed.
- Not converted: nothing omitted.

## setup

### setup part (views `setup` and `wizard`)

Files: `setup.js` (one IIFE, only globals: `Api.setup`, `App.setup`), `setup.css` (prefixes `.setup*`, `.wiz*`).
Sources converted: `edit_setup.html` (editor) and `setup.html` (wizard).

## Routes / views
| Route | View | Notes |
|---|---|---|
| `#/setup`, `#/setup/image`, `#/setup/markers`, `#/setup/digits`, `#/setup/analog` | `setup` | `ctx.parts[0]` selects the tab (`digit` is accepted as alias of `digits`). Without a part: first enabled ROI type, else markers (as before). `route(ctx)` switches the tab without remounting; if the user cancels the "discard changes" dialog the URL is restored with `history.replaceState`. When the digit/analog check boxes flip the tab, the URL is synced via `replaceState` (no routing). |
| `#/wizard` | `wizard` | Step is kept in `sessionStorage['setupStep']` (same key as before). Steps 0..5 and 99 (abort). |

Both views set `root.classList.add('setup' | 'wiz')` themselves.

## Reusable editor component
```js
App.setup.mountEditor(root, tab, opts) -> { unmount(), isDirty(), save(), setTab(tab), getTab(), ready }
```
`tab`: `image|markers|digit(s)|analog` (optional). `opts`:
`tabs` (tab bar, default true), `header` (title/subtitle, default true), `helpOpen`, `saveBar` (`'global'` = core `SaveBar`, `'inline'` = bar inside the editor, `'none'`),
`onNavigate(tab)` (tab bar click, host routes; without it the editor switches itself), `onTabChange(tab)`, `onDirtyChange(dirty)`.
All state (config copy, delta, ROI selection, locks, canvas, image, dirty snapshot, blob URLs, theme subscription) lives in the per-mount closure; markup uses `data-ref` / `data-click` / `data-change` hooks, no ids.
`unmount()` removes listeners, revokes blob URLs, unsubscribes `App.onThemeChange`, hides the global SaveBar (`SaveBar.set({dirty:false})`) and empties `root`.

The wizard mounts it into steps 2 (image), 3 (markers), 4 (digit) with `{header:false, helpOpen:true, saveBar:'inline'}` (the global SaveBar is fixed at the bottom and would collide with the wizard action bar). Before leaving a step (Next/Back/Abort) the wizard asks for confirmation when `isDirty()`.

## Api.setup (legacy endpoints are documented in the code comment)
| Method | Returns | Legacy endpoint |
|---|---|---|
| `getConfig()` | cached config object or null | sessionStorage `jsonConfigData` (filled by core `loadConfig`/`saveConfig`) |
| `loadConfig()` / `ensureConfig()` | config object (throws + toast on failure) | `GET /config` |
| `saveConfig(delta, reload=true)` | void (throws) | `POST /config?reload=true` |
| `capture(params)` | `{ok, blob}` | `GET /camera?task=capture&flashtime=..&...` (toasts "Capturing image...") |
| `capturePreview(flashTimeMs)` | Blob or null | `GET /camera?task=capture` (403 -> camera hint toast) |
| `uploadReferenceImage(blob)` | boolean | `POST /upload/config/reference.jpg?overwrite=true` |
| `referenceImageUrl()`, `markerImageUrl(n, pending)` | URL strings (cache busted) | `/fileserver/config/reference.jpg`, `/fileserver/{config,img_tmp}/markerN.jpg` |
| `cutMarker(n, roi)` | boolean | `GET /editflow?task=cutref&in=/config/reference.jpg&out=/img_tmp/markerN.jpg&x&y&dx&dy` (405 -> "IDLE state only" toast) |
| `commitMarker(n)` | void (throws) | `GET /editflow?task=copy&in=/img_tmp/markerN.jpg&out=/config/markerN.jpg` |
| `getLog()` | string | `GET /log` (wizard log dialog) |

## What the lead must know
* Needs core globals unchanged: `loadConfig`, `saveConfig`, `apiCall`, `apiCallNotify`, `apiCopy`, `withDomain`, `getDomainname`, `getTestEnvironmentActive`, `deepMergeObjects`, `deepSet`, `confirmDialog`, `promptDialog`, `SaveBar`, `firework`, `loaderSpinner`, `noImageAvailable`, `App.onThemeChange`, `App.esc`, `App.navigate`. The editor no longer touches the global `jsonConfig` / `jsonConfigModifiedDelta`.
* CSS variables used: `--bg`, `--text-main` (histogram colors read via `getComputedStyle(documentElement)`), plus the base tokens. Base classes reused: `.container-header/.container-title/.page-sub/.container-content`, `.editor-layout`, `.editor-side`, `.canvas-wrap`, `.side-body`, `.field`, `.field-grid`, `.btn-row`(`.grid2`), `.check`, `.help-panel/.help-item`, `.card*`, `.info-box`, `.warning-box`, `.button*`, `dialog.dlg`, `.hidden`.
* The old `#desc_details...` ID rules of `style-iframe.css` are replaced by `.setup .setup-desc` rules in `setup.css`; the base `.steps` (update progress) class was NOT reused for the wizard (it collided), the wizard uses `.wiz-step`/`.wiz-stepper`.
* `#tooltip-portal { width: 325px }` (old edit_setup.html) is not in `setup.css` (global id, not my prefix): put it into the base css if wanted. Tooltips: the placeholder cells `$TOOLTIP_x` are emitted directly as `<td><div class="tooltip-trigger" data-help="x"></div></td>`; `tools/webui/generate_param_tooltips.py` no longer needs `edit_setup.html` / `setup.html` in `pagesToUpdate`.
* Wizard action bar is `position: sticky; bottom: 0` inside the view (not `fixed`) so it does not cover the shell navigation; the wizard is meant to be shown with the normal shell.
* After "Complete / Abort" the wizard waits 7 s (toast visible) and reloads the SPA at `#/dashboard` (`location.hash` + `reload()`; for the localhost dev setup `location.assign(deviceUrl + '/#/dashboard')`). This single timer is intentionally not cancelled on unmount.
* Pointer input uses Pointer Events (mouse, pen, touch) with pointer capture; positions are scaled to canvas pixels as before. The canvas gets `touch-action: none` on the marker / ROI tabs.
* Tested with jsdom against the mock device (mount/unmount, all four tabs, ROI create/drag/discard/save, marker update, camera capture + save, wizard steps 0-5, GPIO section): no errors, `delta` posted for markers/ROIs keeps real arrays.

## Not converted 1:1 (and why)
* `getCoords()` (dead code, result unused) dropped; mouse events -> Pointer Events (touch support, drag outside canvas no longer sticks).
* `typeSelection` (hidden `<select id=roiTypeSelection>`) -> variable `roiType`. While loading the data the editor no longer flips tabs temporarily (`initializing` flag); user toggles of "Process digit/analog ROIs" still switch the tab as before.
* `saveconfig` / `savereference` hidden buttons and their `MutationObserver` removed: dirty state is derived (`imagePending` for the image tab, snapshot compare for the others); behaviour of the save bar is the same.
* `refreshTheme()` -> `App.onThemeChange`. `window.parent.postMessage('iframe-ready')` and all iframe handling (`resizeIframe`, `#frameModal`) removed.
* Marker form names `imagealignment.marker.N.x` (vestigial renaming in `markerSelectionChanged`) dropped; markers/ROIs are never gathered by `gatherChangedParameter`/`mergeParam`, they are copied as whole arrays from the config clone (`structuredClone`) into the delta. Camera and GPIO parameters use `mergeParam` (= `deepMergeObjects(delta, deepSet({}, name, value, int))`), which still turns the `gpio.gpiopin` array into an object keyed by index exactly like `gatherChangedParameter` did (the firmware accepted that before).
* `setVariableInputLimits`: the old code dispatched fake `change` events, which also polluted the delta when merely showing the reference image; now the delta is only updated when the user changes the zoom factor, otherwise only min/max/outputs are refreshed.
* Marker size after loading the marker image uses `naturalWidth/Height` instead of the CSS-scaled `width/height` (same for normal marker sizes). The histogram is guarded against empty images and tainted canvases.
* Wizard: the brand bar theme switch and RSSI indicator are not part of the view any more (the shell has theme and RSSI; `renderRssi()` relies on global ids). The "Further actions" iframe modal is replaced by `App.navigate` to `#/system/backup|update|files|info|reboot`; only **Log** opens a small `dialog.dlg` (log text from `Api.setup.getLog()`, last 100 kB), the only custom dialog (there is no confirm/prompt equivalent for showing text). The cookie `page=dashboard.html` is no longer written (no shell cookie routing in the SPA).
* Wizard GPIO section: the visibility cascade (customization -> pin -> mode -> logic/smartled rows) is computed from the current control values in one place (`updateGpioUi`); the old code relied on a jQuery `.trigger('onchange')` that never fired the inline handlers, so pin-dependent rows could stay visible although the pin was disabled. Field recording is unchanged (every pin parameter also records `gpionumber`; selecting a pin records its `pinenabled`).
* Password toggle: the Font Awesome eye icon (`fa fa-eye`, font not shipped) became a text button "Show/Hide".
* Wizard step change with unsaved editor changes now asks for confirmation (the iframe was silently discarded before).

## config

### config part (prefix `cfg-`)

Files: `config.js`, `config.css`, `gen_config_schema.py` (generator, already run). Source: `edit_configuration.html` (3874 lines).

## Routes / view
- View name `config`, title "Configuration". Sub routes by `ctx.parts[0]`: `general` (default), `network`, `recognition`, `mqtt`,
  `camera` (advanced), `gpio` (advanced). Implements `route(ctx)`, so the router must NOT remount on a `parts` change.
- `#/config` without part opens the last used section (sessionStorage `cfgSection2`), else `general`.
  A direct link to `camera` / `gpio` switches "Advanced settings" on (remembered in localStorage `cfgAdvanced`); switching it off while on an advanced section navigates to `#/config/general`.
- `?description` in the hash query opens "How it works" (old `#description`).
- Nav clicks call `App.navigate('#/config/<section>')`; the content switches in `route()`.

## Api.config (defined in config.js)
| Method | Legacy endpoint (global.js helper) | Returns |
|---|---|---|
| `load()` | `GET /config` (`loadConfig` + `getConfigFromStorage(0)`) | config object |
| `save(delta, reload)` | `POST /config[?reload=true]` (`saveConfig`) | resolves, throws on failure (toast already shown) |
| `reload()` | `GET /config?task=reload` (`reloadConfig`) | not used by the view, provided |
| `wlanScan()` | `GET /wlan?task=scan` (`getWlanNetworks`) | `[{ssid,rssi,channel,authmode}]` |
| `models()` | `GET /fileserver/config/models/?list_dir=true` | sorted lower case file names |
| `certs()` | `GET /fileserver/config/certs/?list_dir=true` | sorted file names |

Timezones: the old page only links `timezones.html` (new tab); the link is kept, so the lead must keep serving `timezones.html`.

## What the lead must know
- **Reboot**: when a reboot-needing parameter changed (network opmode/hostname/WLAN/AP/ethernet, CPU frequency) the save bar says "Save and restart", the config is saved without reload, and after 500 ms the view calls `App.navigate('#/system/reboot?reboot=1')`.
  The old page opened `sys_reboot.html#reboot`; **the system reboot view must start the reboot immediately when `ctx.query.has('reboot')`** (or change the constant `REBOOT_ROUTE` in config.js to whatever the system part uses).
- Uses `SaveBar` (set/busy), `firework.launch`, `App.el/navigate/register/onThemeChange`, `validateIpMasks`, `validateDateTimeMasks`, `deepSet`, `deepMergeObjects`, `jsonObjectKeyify`, `loadConfig/saveConfig/reloadConfig/getConfigFromStorage`, `getWlanNetworks/getTfliteFileList/getCertFileList`. No new globals (checked in a jsdom run), only `Api.config`.
- Needs base classes `.card .card-header .card-body .button .btn-action .ghost .chip(s) .help-panel .container* .page-sub dialog.dlg .dlg-body .dlg-actions`. Document level listeners use an AbortController, the help popover (`.cfg-help-pop`) is appended to `<body>` and removed on unmount; `unmount` also hides the save bar.
- Discard (save bar) reloads the configuration from the device and rebuilds the form (old page: `location.reload()`).
- The sprite for the WLAN signal icons is inlined in config.css (dark theme: class `cfg-dark` on the root via `App.onThemeChange`).

## Architecture
- `SCHEMA` (between `// BEGIN GENERATED SCHEMA` and `// END GENERATED SCHEMA` in config.js): `groups -> sections -> card ids`, `rules` (visibility conditions), `cards -> rows`.
  Row keys: `id` (old control id without `_value`), `name` (JSON path with dots; `{i}` = index placeholder for `postprocessing.sequence.N` and `gpio.gpiopin.N`),
  `label`, `lvl` (indent), `t` (text number password ip datetime select switch cards multi info), `def/min/max/step/ph/maxlen/minlen/pattern/req/auto/unit/opts/wide/strong`,
  `int` (integer flag of old `gatherChangedParameter(form,true)`), `reboot`, `with` (extra forms gathered together, e.g. gpio pin number, sequence name), `withWhen` (mqtt TLS), `show` (visibility classes),
  `adv` / `hide:'dup'|'obsolete'` (lists from the old page script), `ix`/`sel` (index variable, selector row), `scan`, `link`, `usageWarn`, `noload`.
- Regenerate with `python gen_config_schema.py` (rewrites only the schema block; fills the PARAM_HELP block only while the `/*@HELP_PLACEHOLDER@*/` placeholder is there, so help text can be edited in config.js afterwards).
- Visibility: instead of inline `onchange="setClassVisibility(...)"` the rule table maps each `classvisibility_*` class to a condition (`==, ===, !=, >, >=, <, <=, in, prefix, all, any`, JS loose-equality semantics as before).
  A row is shown when ALL its classes are true (classes without rule are true) and, for `adv` rows/cards, the advanced switch is on. Headings and cards without any visible row hide themselves. Rules are re-evaluated after every edit, so cascades (MQTT enable -> authmode -> TLS) need no trigger chains.
  Hand written rules (PATCH_* in the generator, from functions of the old page): network operation mode, MQTT auth mode, manual time, all GPIO pin mode dependent rows (virtual ids `@anypwm`, `@anysmartled` = any pin with that default usage).
- Save semantics unchanged: per edit the changed row(s) are merged into the delta via `deepSet(...)` / `deepMergeObjects(...)` (string values stay strings unless the row has the old integer flag; 'true'/'false' become booleans), delta only is POSTed, reload flag = `!reboot`. Number inputs clamp to min/max on change.
- Controls: Disabled/Enabled selects became switches (also card header enable switches), operation mode = option cards, passwords have Show/Hide, SSID has "Find networks" (scan dialog, sanitised via textContent), model/cert lists are filled from `Api.config.models()/certs()` (digit/analog split by `dig`/`ana` prefix, same rules as before), ethernet options appear when `network.ethernet` exists.
- PARAM_HELP registry, `describeModel`, popover (hover, focus, click to pin, Esc, scroll closes, live refresh while editing) are kept; help buttons only appear for ids that have an entry. `$TOOLTIP_*` cells are gone.
- General summary ("This device" chips) kept.

## Differences to the old page (intended)
- Only user edits mark the form as changed. The old page also added values as a side effect of `.trigger('onchange')` cascades (e.g. enabling digit recognition also queued `digit.model`, switching the GPIO pin queued `pinenabled` of the new pin, network mode change queued `networkconfig`). Not needed any more; the explicit extra gathers (pin number, sequence name, MQTT TLS files) are kept.
- WLAN scan selection now fires a change event (the old page set the SSID without registering the change).
- Model / certificate file list failures no longer block the whole page (the API layer still shows the toast).
- Rows in the schema flagged `hide` (DUPLICATE: camera image settings that live in Setup > Image, OBSOLETE: dashboard auto refresh) are kept in the schema but not rendered, and so the old `setVariableInputLimits()` (min/max of those hidden zoom / exposure fields by camera model, "Camera model unknown" toast) is dropped. The "Open Setup" note now navigates to `#/setup/image`.
- Pins/sequences: values of the other pins/sequences come from an internal value store, so switching shows what was edited (old page showed the saved config values again).
- Text of the legacy font-awesome icons (eye / search) replaced by "Show/Hide" and "Find networks" buttons.

## Verification (scratchpad/cfgtest/verify.js, jsdom against the mock server, nothing saved)
- `node --check config.js`: OK.
- All 118 legacy control ids (`*_value`) and all 118 legacy `name=` JSON paths exist in the schema: 0 mismatches. Schema has 120 ids (the extra ones are the combined row id of the RGB row and the pin/sequence unit ids of non-control rows).
- Schema names not reported by the mock config (device config may not have them): `network.ethernet.ipv4.networkconfig`, `network.ethernet.ipv4.ipaddress`, `network.time.timesetmanual` (the last never was filled from config in the old page either: `noload`).
- jsdom smoke test: mount, opmode cards, network/GPIO/sequence/MQTT visibility, pin switch, clamp, delta JSON (`gpio.gpiopin.5...`, `postprocessing.sequence.0...`), reboot save flow, discard, remount, popover, unmount: OK. No new globals besides `Api.config`.
- Not tested in a real browser (lead owns the browser pane): visual layout / CSS.

