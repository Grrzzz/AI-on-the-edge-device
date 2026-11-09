[Overview](_OVERVIEW.md)

## REST API Endpoints: `mcp` (MCP server) and `api/mcp`

Optional [Model Context Protocol](https://modelcontextprotocol.io) server on the device (streamable HTTP, JSON-RPC over `POST /mcp`, no
streaming). An AI assistant such as Claude Code can read the device, move alignment markers and regions of interest, change settings
and start cycles. **Off by default.** Switch it on in the WebUI: `System > MCP`.

> **Beta.** The MCP server is new in 2.4. It compiles and the WebUI side is tested against the mock, but it has not run for a long
> time on a device yet. Expect rough edges and report them. The tool set and the answers may still change.

### Access token

* Created by the device (32 bytes from the hardware random generator, hex) when the server is switched on for the first time, or with
  "Create new token". It is shown **once**; the device keeps only its SHA-256 hash in NVS.
* The token survives restarts and power loss. It stays valid until a new one is created (also when the server is switched off and on).
* Every request to `/mcp` needs `Authorization: Bearer <token>`. `/mcp` does not use the HTTP basic authentication of the WebUI.
  Without the token: `401`; server off: `404`. The connection is plain HTTP: use it only in a network you trust.

### `GET /api/mcp`, `POST /api/mcp` (WebUI, HTTP basic auth if configured)

* `GET` returns `{"ok":true,"enabled":false,"allowSystem":false,"tokenSet":true,"endpoint":"/mcp"}`
* `POST` body `{"enabled":true,"allowSystem":false,"regenerate":false}` (all fields optional). When a new token was created the answer
  has the extra field `token`. `allowSystem` enables the tools that delete files, reboot and update.

### `POST /mcp`

Methods: `initialize`, `ping`, `tools/list`, `tools/call`; notifications are answered with `202`. One request at a time (`503` while
another one runs). The tools call the REST endpoints of the device itself, so they behave like the WebUI. Write tools are refused
while a cycle runs.

| Tool | Does |
|---|---|
| `get_status`, `get_live`, `get_recognition` | state, progress of the running cycle, result of the last cycle (values, confidence, rectangles, alignment) |
| `get_config` (`section`) | configuration, e.g. `imagealignment`, `digit`, `analog`, `numbersequences` |
| `get_image` (`name`) | `reference`, `alg`, `alg_roi`, `raw`, `markerN` as a picture |
| `capture_image` | new camera picture (not stored) |
| `get_fallback`, `set_fallback` | fallback value of a sequence |
| `get_log` (`lines`), `list_files` (`path`) | log lines, folder listing |
| `save_config` (`config`, `apply`) | partial configuration; arrays (markers, regions) are replaced as a whole; `apply` re-initializes and starts a cycle |
| `start_cycle`, `set_paused` | start a cycle, pause or resume the countdown |
| `cut_marker`, `copy_file`, `upload_file` | marker templates and files in `/config/` and `/img_tmp/` |
| `get_update_status` | state of a firmware update |
| `delete_file`, `reboot`, `start_update` | **system actions**, only with "System actions" |

### Automatic marker placement (example)

`get_image reference` → the assistant looks at the picture and proposes marker positions → `save_config` with the `imagealignment`
markers → `cut_marker` + `copy_file` for the marker images → `start_cycle` → `get_recognition` (alignment `ok`, rotation, shift,
confidence of the regions) → adjust and repeat.

### Connect Claude

The WebUI page `System > MCP` shows both snippets with the device address filled in.

* Claude Code: `claude mcp add --transport http ai-on-the-edge http://<device>/mcp --header "Authorization: Bearer <token>"`
* Claude Desktop (`claude_desktop_config.json`, needs Node.js; `mcp-remote` bridges to the HTTP server, the token goes through an environment
  variable because spaces in arguments are a problem on Windows):

```json
{
  "mcpServers": {
    "ai-on-the-edge": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://<device>/mcp", "--allow-http", "--header", "Authorization:${AI_TOKEN}"],
      "env": { "AI_TOKEN": "Bearer <token>" }
    }
  }
}
```

The web version of Claude (claude.ai) cannot reach a device in a home network. The Claude Desktop snippet is the usual `mcp-remote` pattern
and has not been tried against a device yet.
