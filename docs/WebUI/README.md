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

## Next step: JSON REST backend
The firmware still answers some requests with text or HTML (see `legacy-endpoints.md`). Replacing them with JSON `/api/*`
endpoints only changes the `Api` objects in `app.js`.
