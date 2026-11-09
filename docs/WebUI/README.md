# WebUI structure

Single page app, three files in `sd-card/html/`:

| File | Content |
|---|---|
| `index.html` | Shell: sidebar, theme switch, view host |
| `app.js` | Toasts, helpers, core (`Api`, `App` router/theme/navigation), views, boot |
| `style.css` | Tokens, shell, design system, toasts, one section per view |

Routing is hash based: `#/dashboard`, `#/recognition`, `#/config[/image|markers|digits|analog]` (Configuration: reference image, markers, regions), `#/wizard`,
`#/system/setup[/general|network|recognition|mqtt|camera|gpio]` (Setup: device, network, MQTT), `#/system/mcp` (optional MCP server, beta), `#/system/info|update|backup|files|reboot`.
The wizard opens automatically when the device is called without a route while the operation mode is `Setup`.

## Conventions
- A view is registered with `App.register(name, { title, mount(root, ctx), route?(ctx), unmount() })`.
  `route` handles sub routes without remounting. `unmount` must clear timers, listeners and the save bar.
- Views never call endpoints. They use `Api.<domain>` objects (`Api.system`, `Api.files`, `Api.ota`, `Api.process`,
  `Api.mqtt`, `Api.setup`, `Api.config`) that return clean data and parse the legacy firmware responses internally.
- No inline handlers, no globals except `Api.*` and `App.*`; ids and classes carry the view prefix
  (`sys-`, `dash-`, `rec-`, `setup-`, `wiz-`, `cfg-`).

## Backend (JSON REST)
The Api objects talk to JSON endpoints (details in `docs/API/REST`): `GET /info`, `GET|POST /config`, `GET /process_data`,
`GET /wlan?task=scan`, `GET /api/status`, `POST /api/cycle`, `GET|POST /api/fallback`, `GET /api/recognition`,
`POST /api/flow/copy|cutref`, `POST /api/reboot`, `POST /api/update`, `GET /api/update/status`, `POST /api/mqtt/discovery|deviceinfo`,
`GET /fileserver/<dir>/?format=json`.
Endpoints that deliver files or streams stay as they are: `/log`, `/data` (log files), `/camera` (images), `/coredump` (binary),
`/upload`, `/delete`, `/ota/<file>` (uploads) and the scalar text variants `/info?type=` and `/process_data?type=` for integrations.
Moving another endpoint to JSON only changes its `Api` method in `app.js`.

## Configuration editor (`#/config`)

One control layer for all widths; the original fields of the editor stay in the DOM (hidden with `.m-hide`) and keep the data logic.

- **Number sequence** combo above the tabs (rename, delete, add inline), switches for digit and analog processing. A switched-off kind greys out the
  controls of its tab.
- **Region / marker combo** in the image card (`mComboRender`): preview canvas, move up / down, copy, delete, inline add.
- **Position** (pad, jog stick, "move by") and **Size** (steppers) cards; dragging in the image moves the selected region.
- **Image overlays** share one look (`drawRoiMark`, `drawBadge`): soft fill, frame, rounded name badge; the selected item is solid with a halo, the others
  are transparent. "Zoom in" scales the canvas with a CSS transform (lines and text keep their size).
- **Image tab**: the camera values are custom controls (`camPanelMarkup`, `CAM_UI`) that drive the native inputs (`data-param`), which stay the source of
  truth. Advanced values sit behind a switch kept in `localStorage` (`camAdvanced`). The settings are blurred until a picture was taken.
