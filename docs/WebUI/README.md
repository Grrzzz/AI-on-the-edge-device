# WebUI structure

Single page app, three files in `sd-card/html/`:

| File | Content |
|---|---|
| `index.html` | Shell: sidebar, theme switch, view host |
| `app.js` | Toasts, helpers, core (`Api`, `App` router/theme/navigation), views, boot |
| `style.css` | Tokens, shell, design system, toasts, one section per view |

Routing is hash based: `#/dashboard`, `#/recognition`, `#/setup[/image|markers|digits|analog]`, `#/wizard`,
`#/config[/general|network|recognition|mqtt|camera|gpio]`, `#/system/info|update|backup|files|reboot`.
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
