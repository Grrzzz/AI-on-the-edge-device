"""Mock of the device HTTP API to try the WebUI without a device (data of a gas meter, blurred images).

Usage: python tools/webui/mock/mock_server.py [html_dir] [port] [host]   (default: sd-card/html, port 8099, host 0.0.0.0 = also reachable in the LAN)
Open http://127.0.0.1:8099/ (or http://<IPv4 of this computer>:8099/ from a phone in the same network) - "Start cycle" simulates a cycle of about 12 s incl. /api/live.
"""
import json, sys, os, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else os.path.join(REPO, 'sd-card', 'html')
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8099
HOST = sys.argv[3] if len(sys.argv) > 3 else os.environ.get('MOCK_HOST', '0.0.0.0')  # 127.0.0.1: this computer only
START = time.time()
STATE = {"fallback": "46107.499"}
import json as _json

_CFG_SRC = os.path.join(REPO, "code", "test", "components", "config_handling", "config_json_default_expected.txt")


def build_config():
    s = open(_CFG_SRC, encoding="utf-8").read()
    cfg = _json.loads(s[s.index("\n{\n") + 1:])
    cfg["webui"]["autorefresh"] = {"dashboard": {"enabled": True, "refreshtime": 5}}
    cfg["operationmode"]["opmode"] = 1
    cfg["mqtt"]["enabled"] = True
    cfg["mqtt"]["homeassistant"]["discoveryenabled"] = True
    cfg["imagealignment"]["marker"] = [{"x": 240, "y": 312}, {"x": 440, "y": 193}]
    cfg["imagealignment"]["imagerotation"] = "0.0"
    cfg["mqtt"]["homeassistant"]["metertype"] = 5
    cfg["mqtt"]["maintopic"] = "gasmeter"
    cfg["mqtt"]["uri"] = "mqtt://mqtt.local:1883"
    cfg["network"]["hostname"] = "gasmeter"
    cfg["digit"]["sequence"][0]["roi"] = [{"x": a, "y": b, "dx": c, "dy": d} for a, b, c, d in [(93, 183, 30, 54), (137, 183, 30, 54), (179, 183, 30, 54), (221, 183, 30, 54), (261, 183, 30, 54), (303, 183, 30, 54), (341, 183, 30, 54), (387, 183, 30, 54)]]
    cfg["analog"]["sequence"][0]["roi"] = []
    cfg["analog"]["enabled"] = False
    return cfg


REF_SVG = """<svg xmlns='http://www.w3.org/2000/svg' width='640' height='480' viewBox='0 0 640 480'>
<rect width='640' height='480' fill='#d6d6d0'/><rect x='30' y='20' width='580' height='440' rx='40' fill='#2a2a2a'/>
<rect x='180' y='50' width='260' height='92' rx='6' fill='#e8e8e2'/>
<g font-family='monospace' font-size='70' fill='#222' text-anchor='middle'><text x='212' y='118'>0</text><text x='260' y='118'>0</text><text x='308' y='118'>5</text><text x='356' y='118'>3</text><text x='404' y='118'>0</text></g>
<g fill='#f4f4ee' stroke='#555' stroke-width='3'><circle cx='150' cy='300' r='44'/><circle cx='270' cy='360' r='44'/><circle cx='390' cy='300' r='44'/><circle cx='500' cy='360' r='44'/></g>
<g stroke='#b33' stroke-width='5' stroke-linecap='round'><line x1='150' y1='300' x2='122' y2='318'/><line x1='270' y1='360' x2='282' y2='322'/><line x1='390' y1='300' x2='418' y2='322'/><line x1='500' y1='360' x2='498' y2='320'/></g>
<rect x='45' y='45' width='30' height='30' fill='#fff'/><circle cx='60' cy='60' r='8' fill='#222'/>
<rect x='525' y='385' width='30' height='30' fill='#fff'/><circle cx='540' cy='400' r='8' fill='#222'/></svg>""".encode()

MARKER_SVG = """<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'><rect width='60' height='60' fill='#d6d6d0'/>
<rect x='10' y='10' width='40' height='40' fill='#fff'/><circle cx='30' cy='30' r='11' fill='#222'/></svg>""".encode()


IMG = b"""<svg xmlns='http://www.w3.org/2000/svg' width='800' height='560' viewBox='0 0 800 560'>
<rect width='800' height='560' fill='#d9d9d6'/><rect x='60' y='60' width='680' height='440' rx='40' fill='#2b2b2b'/>
<g fill='#eee' font-family='monospace' font-size='90'><text x='170' y='190'>0 0 5 3 0</text></g>
<g fill='none' stroke='#2ecc40' stroke-width='5'><rect x='320' y='110' width='90' height='110'/><rect x='410' y='110' width='90' height='110'/><rect x='500' y='110' width='90' height='110'/>
<circle cx='250' cy='380' r='80'/><circle cx='400' cy='430' r='80'/><circle cx='550' cy='380' r='80'/></g></svg>"""

INFO = {
    "hostname": "gasmeter", "board_type": "esp32cam", "firmware_version": "v2.3.0-Grrzzz Mock", "html_version": "v2.3.0-Grrzzz Mock",
    "mqtt_status": "Connected",  # dashboard badge (the full /info list below has the same service states)
}
CONFIG = {"webui": {"autorefresh": {"dashboard": {"enabled": True, "refreshtime": 5}}}, "mqtt": {"enabled": True, "homeassistant": {"discoveryenabled": True}}}


DIGITS = ["4", "6", "1", "0", "7", "4", "9", "9"]
ANALOG = []


def roi_svg(name):
    """ROI crop: digit tile or analog dial"""
    if name.startswith("d"):
        d = DIGITS[int(name[1:]) % len(DIGITS)]
        return (f"<svg xmlns='http://www.w3.org/2000/svg' width='60' height='96' viewBox='0 0 60 96'><rect width='60' height='96' fill='#dcdcd6'/>"
                f"<text x='30' y='70' font-size='72' text-anchor='middle' font-family='monospace' fill='#222'>{d}</text></svg>").encode()
    val = dict(ANALOG).get(name, "0")
    import math
    ang = math.radians(float(val) / 10 * 360 - 90)
    x, y = 48 + 34 * math.cos(ang), 48 + 34 * math.sin(ang)
    return (f"<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><rect width='96' height='96' fill='#e6e6e0'/>"
            f"<circle cx='48' cy='48' r='42' fill='#fff' stroke='#555' stroke-width='3'/><line x1='48' y1='48' x2='{x:.1f}' y2='{y:.1f}' stroke='#b33' stroke-width='6' stroke-linecap='round'/>"
            f"<circle cx='48' cy='48' r='6' fill='#333'/></svg>").encode()


def roi_section(title, rois):
    h = f'<div class="roi-block"><div class="roi-title">{title}</div><div class="roi-grid">'
    for name, res in rois:
        h += f'<div class="roi-tile"><div class="roi-value">{res}</div><img class="roi-img" src="/img_tmp/{name}_org.jpg"></div>'
    return h + "</div></div>"


def recognition_page():
    # same markup as handler_recognition_details() in MainFlowControl.cpp
    head = """<!DOCTYPE html><html><head><title>Recognition Details</title><meta charset="UTF-8"><meta name="viewport" content="width=720" />
<script>(function () { let theme; try { theme = localStorage.getItem('theme'); } catch (e) { }
 if (theme !== 'light' && theme !== 'dark') { try { theme = document.cookie.match(/(?:^|; )theme=(light|dark)/)?.[1]; } catch (e) { }
 if (!theme) theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
 document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme); })();</script>
<link rel="stylesheet" href="/style-iframe.css"></head><body>
<div class="container"><div class="container-header"><div class="container-title">Recognition</div>
<div class="page-sub">Result of the last completed recognition cycle.</div></div><div class="container-content">"""
    seq = '<div class="card"><div class="card-header">Sequence &middot; main</div><div class="card-body recog-body">'
    seq += ('<div class="recog-values">'
            '<div class="stat"><div class="stat-label">Raw value</div><div class="stat-value">00530.0080</div></div>'
            f'<div class="stat"><div class="stat-label">Actual value</div><div class="stat-value">{STATE["fallback"]}</div></div></div>')
    seq += roi_section("Digit ROIs", [(f"d{i}", d) for i, d in enumerate(DIGITS)])
    seq += roi_section("Analog ROIs", [(n, v) for n, v in ANALOG])
    seq += "</div></div>"
    img = '<div class="card"><div class="card-header">Processed image</div><div class="card-body image-body"><img class="recog-img" src="/img_tmp/alg_roi.jpg"></div></div>'
    return head + seq + img + "</div></div></body></html>"



CYCLE = {"n": 842, "t0": 0.0, "idle_since": time.time() - 35, "queued": False, "paused": False, "frozen": 0}
LAST_OK = time.time() - 7 * 60 - 12
import datetime as _dt
def _status(age):
    h = age.total_seconds() / 3600
    if 2.0 < h < 2.6 or 30 < h < 30.5:
        return "W01"
    if 8.0 < h < 9.0 or 60 < h < 64:
        return "E92"
    if 15.0 < h < 15.3:
        return "E99"
    return "000"
def _make_data():
    now = _dt.datetime.now().replace(microsecond=0)
    files = {}
    t = now - _dt.timedelta(days=35)
    val = 46107.499 - 35 * 12.0
    while t <= now:
        files.setdefault("data_%s.csv" % t.strftime("%Y-%m-%d"), []).append(
            "%s,main,%.3f,%.3f,%.3f,0.0,0.0,%s" % (t.strftime("%Y-%m-%dT%H:%M:%S+0100"), val, val, val, _status(now - t)))
        step = _dt.timedelta(minutes=5)
        h = t.hour
        val += (0.18 if 6 <= h < 9 or 17 <= h < 22 else 0.03) * (0.6 + 0.8 * ((t.minute * 7 + t.day) % 10) / 10)
        t += step
    return files
DATA_FILES = _make_data()


def api_status():
    now = time.time()
    running = CYCLE["t0"] and now - CYCLE["t0"] < 12.5
    if CYCLE["t0"] and not running:  # cycle finished
        global LAST_OK
        LAST_OK = now
        CYCLE["t0"] = 0.0
        CYCLE["idle_since"] = now
        if CYCLE["queued"]:
            CYCLE["queued"] = False
            CYCLE["n"] += 1
            CYCLE["t0"] = now
            running = True
    if running:
        _t = now - CYCLE["t0"]
        phase = "Take Image" if _t < 3.2 else "Alignment" if _t < 5.2 else "Digitization of Digit Recognition" if _t < 11.2 else "Post-Processing" if _t < 11.9 else "Publish to MQTT"
        return {"api_name": "status:v1", "state": phase, "stateCode": 4, "stateSeconds": int(now - CYCLE["t0"]), "cycle": CYCLE["n"],
                "autoStart": True, "running": True, "cycleStart": "unavailable" if CYCLE["queued"] else "queued", "processInterval": 5.0,
                "processTime": 12, "cycleSeconds": int(now - CYCLE["t0"]), "uptime": int(now - START) + 35, "error": 0,
                "nextRunSeconds": -1, "paused": CYCLE["paused"], "lastSuccessSeconds": int(now - LAST_OK),
                "lastSuccess": time.strftime("%Y-%m-%dT%H:%M:%S+0100", time.localtime(LAST_OK))}
    waited = int(now - CYCLE["idle_since"])
    if CYCLE["paused"] and not CYCLE["frozen"]:
        CYCLE["frozen"] = waited
    if not CYCLE["paused"]:
        CYCLE["frozen"] = 0
    left = 300 - (CYCLE["frozen"] if CYCLE["paused"] else waited)
    if left <= 0 and not CYCLE["paused"]:  # the countdown is over: the device starts the next cycle by itself
        CYCLE["n"] += 1
        CYCLE["t0"] = now
        return api_status()
    return {"api_name": "status:v1", "state": "Idle - Waiting For Autostart", "stateCode": 7, "stateSeconds": waited,
            "cycle": CYCLE["n"], "autoStart": True, "running": False, "cycleStart": "ready", "processInterval": 5.0, "processTime": 12, "cycleSeconds": 0,
            "uptime": int(now - START) + 35, "error": 0, "nextRunSeconds": max(0, left), "paused": CYCLE["paused"],
            "lastSuccessSeconds": int(now - LAST_OK), "lastSuccess": time.strftime("%Y-%m-%dT%H:%M:%S+0100", time.localtime(LAST_OK))}


def api_live():
    st = api_status()
    now = time.time()
    t = (now - CYCLE["t0"]) if st["running"] else 999
    rec = api_recognition()
    seq = rec["sequences"][0]
    rois = []
    nd = len(seq["digit"]["rois"])
    for kind, group, start in (("digit", seq["digit"]["rois"], 5.6), ("analog", seq["analog"]["rois"], 5.6 + 0.5 * nd)):
        for i, r in enumerate(group):
            if t >= start + 0.5 * (i + 1):
                v = r["value"]
                rois.append({"seq": "main", "kind": kind, "name": r["name"], "value": v if kind == "analog" else v + ".0",
                             "confidence": r.get("confidence"), "rejected": False})
    return {"api_name": "live:v1", "running": bool(st["running"]), "state": st["state"], "cycle": CYCLE["n"], "raw": t >= 3.2,
            "alignment": rec["alignment"] if t >= 4.8 else None, "rois": rois}


def api_post(path, body):
    """returns (code, json) for the POST /api/* endpoints"""
    try:
        data = json.loads(body.decode() or "{}")
    except Exception:
        return 400, {"ok": False, "code": "E91", "message": "Request body is not a valid JSON object"}
    now = time.time()
    if path == "/api/cycle" and "paused" in data:
        CYCLE["paused"] = bool(data["paused"])
        if not CYCLE["paused"]:
            CYCLE["idle_since"] = now - (CYCLE["frozen"] or 0)
        return 200, {"ok": True, "code": "004" if CYCLE["paused"] else "005", "message": "ok"}
    if path == "/api/cycle":
        st = api_status()
        if st["cycleStart"] == "ready":
            CYCLE["n"] += 1
            CYCLE["t0"] = now
            return 200, {"ok": True, "code": "001", "message": "Cycle start triggered"}
        if st["cycleStart"] == "queued":
            CYCLE["queued"] = True
            return 200, {"ok": True, "code": "002", "message": "Cycle start scheduled, starts after the running cycle"}
        return 409, {"ok": False, "code": "E90", "message": "Main task not initialized. Request rejected"}
    if path == "/api/fallback":
        if not data.get("sequence"):
            return 400, {"ok": False, "code": "E91", "message": "Parameter 'sequence' missing"}
        if "value" in data:
            STATE["fallback"] = str(data["value"])
        return 200, {"ok": True, "sequence": data["sequence"], "value": STATE["fallback"]}
    if path == "/api/reboot":
        return 200, {"ok": True, "code": "001", "message": "Reboot initiated"}
    if path in ("/api/mqtt/discovery", "/api/mqtt/deviceinfo"):
        return 200, {"ok": True, "code": "001", "message": "Publication scheduled"}
    if path == "/api/flow/copy":
        return 200, {"ok": True, "code": "001", "message": "Copy done"}
    if path == "/api/flow/cutref":
        return 200, {"ok": True, "code": "001", "message": "Cut image done"}
    if path == "/api/update":
        url = data.get("url", "")
        if not url.startswith("https://github.com/"):
            return 400, {"ok": False, "code": "002", "message": "Host not allowed"}
        STATE["su"] = {"t0": now, "url": url}
        return 200, {"ok": True, "code": "001", "message": "Self update started"}
    return 404, {"ok": False, "code": "E90", "message": "not found"}


def api_recognition():
    RECTS = [(93, 183, 30, 54), (137, 183, 30, 54), (179, 183, 30, 54), (221, 183, 30, 54), (261, 183, 30, 54), (303, 183, 30, 54), (341, 183, 30, 54), (387, 183, 30, 54)]
    CONF = [99, 99, 98, 99, 71, 97, 99, 38]

    def group(rois):
        out = []
        for i, (n, v) in enumerate(rois):
            r = {"name": n, "valid": True, "value": str(v), "image": f"/img_tmp/{n}_org.jpg"}
            if n.startswith("d") and i < len(RECTS):
                r["confidence"] = CONF[i]
                r["rect"] = {"x": RECTS[i][0], "y": RECTS[i][1], "w": RECTS[i][2], "h": RECTS[i][3]}
            elif n.startswith("a"):
                r["confidence"] = [95, 55][i] if i < 2 else 90
                r["rect"] = {"x": 470 + 70 * i, "y": 300, "w": 56, "h": 56}
            out.append(r)
        return {"enabled": True, "rois": out}
    return {"api_name": "recognition:v3", "state": "Idle - Waiting For Autostart", "ready": True, "image": "/img_tmp/alg_roi.jpg",
            "alignment": {"rawImage": "/img_tmp/raw.jpg", "ok": True, "rotation": -3.2, "scale": 1, "dx": 22, "dy": -16,
                          "markers": [{"x": 240, "y": 312, "w": 56, "h": 34}, {"x": 440, "y": 193, "w": 55, "h": 44}]},
            "sequences": [{"name": "main", "rawValue": "46107.499", "actualValue": STATE["fallback"],
                           "digit": group([(f"d{i}", d) for i, d in enumerate(DIGITS)]), "analog": group([(n, v) for n, v in ANALOG])}]}


def fs_json(dirpath):
    d = fs_norm(dirpath)
    rows = FS.get(d, [])
    return {"path": dirpath, "truncated": False,
            "entries": [{"name": n, "isDir": isdir, "size": 0 if isdir else size, "protected": isdir and d in PROTECTED_DIR_LISTINGS} for n, isdir, size in rows]}


FS = {
    "/": [("config", True, 0), ("html", True, 0), ("log", True, 0)],
    "/config": [("models", True, 0), ("certs", True, 0), ("config.json", False, 9800), ("reference.jpg", False, 54200),
                ("marker1.jpg", False, 1100), ("marker2.jpg", False, 1000)],
    "/config/models": [("ana-class100_0171_s1_q.tflite", False, 133784), ("ana-class100_0201_s1_q.tflite", False, 133504),
                       ("ana-cont_1901_s0_q.tflite", False, 187792), ("dig-class100_0182_s2_q.tflite", False, 226656),
                       ("dig-class11_2000_s2_q.tflite", False, 97192), ("dig-cont_0900_s3_q.tflite", False, 315544),
                       ("dig-own-meter_q.tflite", False, 120000)],
    "/config/certs": [],
    "/html": [("index.html", False, 14500), ("style-iframe.css", False, 31000), ("global.js", False, 30500)],
    "/log": [("message", True, 0), ("data", True, 0)],
    "/log/message": [("log_2026-11-06.txt", False, 82000), ("log_2026-11-05.txt", False, 91000)],
    "/log/data": [],
}
FS["/log/data"] = [(n, False, len("\n".join(r)) + 1) for n, r in sorted(DATA_FILES.items())]
PROTECTED_DIR_LISTINGS = {"/", "/config", "/log"}


def fs_norm(path):
    path = "/" + path.strip("/")
    return path


def fs_fmt(n):
    if n >= 1048576:
        return f"{n / 1048576:.1f} MB"
    if n >= 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n} B"


def fs_page(dirpath):
    d = fs_norm(dirpath)
    tpl = open(os.path.join(ROOT, "sys_fileserver.html"), encoding="utf-8").read()
    rows = FS.get(d, [])
    uripath = ("" if d == "/" else d) + "/"
    body = ('<table id="files_table" class="sortable"><col><col style="width:110px"><col style="width:110px">'
            '<col style="min-width:100px; width:100px"><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Actions</th></tr></thead><tbody>\n')
    for name, isdir, size in rows:
        href = "/fileserver" + uripath + name + ("/?full=false" if isdir else "")
        body += f'<tr><td><a href="{href}">{name}{"/" if isdir else ""}</a></td><td>{"Directory" if isdir else "File"}</td><td>{"-" if isdir else fs_fmt(size)}</td>'
        if isdir and d in PROTECTED_DIR_LISTINGS:
            body += '<td>-</td>'
        else:
            deltask = "?task=deldir" if isdir else ""
            body += ('<td class="action-td">'
                     f'<button class="button action-button" data-name="{name}" data-path="{uripath}" data-isdir="{deltask}" '
                     'onclick="deleteEntry(this.dataset.name, this.dataset.path + this.dataset.name + this.dataset.isdir)" title="Delete file">Delete</button>'
                     f'<button class="button action-button" data-name="{name}" data-path="{uripath}" '
                     'onclick="downloadEntry(this.dataset.name, this.dataset.path + this.dataset.name)" title="Download/Save file">Download</button></td>')
        body += '</tr>\n'
    body += '</tbody></table>'
    marker = '      <!-- The the remaining part of body is injected by firmware (server_file.cpp) -->'
    return tpl.replace(marker, marker + body, 1)


# ---- MCP (optional server on the device): token handling like the firmware, a subset of the tools ---------
import hashlib as _hashlib, secrets as _secrets, base64 as _b64
MCP = {"enabled": False, "allowSystem": False, "hash": ""}


def mcp_state(token=None):
    d = {"ok": True, "enabled": MCP["enabled"], "allowSystem": MCP["allowSystem"], "tokenSet": bool(MCP["hash"]), "endpoint": "/mcp"}
    if token:
        d["token"] = token
    return d


def mcp_api(method, body):
    """GET/POST /api/mcp: state, on/off, system actions, new token (returned once, only its hash is kept)"""
    if method == "GET":
        return 200, mcp_state()
    try:
        data = json.loads(body.decode() or "{}")
    except Exception:
        return 400, {"ok": False, "message": "Body must be a JSON object"}
    token = None
    if isinstance(data.get("enabled"), bool):
        MCP["enabled"] = data["enabled"]
    if isinstance(data.get("allowSystem"), bool):
        MCP["allowSystem"] = data["allowSystem"]
    if data.get("regenerate") is True or (MCP["enabled"] and not MCP["hash"]):
        token = _secrets.token_hex(32)
        MCP["hash"] = _hashlib.sha256(token.encode()).hexdigest()
    return 200, mcp_state(token)


MCP_TOOLS = [
    ("get_status", "State of the device and the process.", {}, []),
    ("get_live", "Progress of the running cycle.", {}, []),
    ("get_recognition", "Result of the last cycle: regions with value, confidence and rectangle, plus the alignment.", {}, []),
    ("get_config", "The configuration as JSON, optionally one section.", {"section": {"type": "string"}}, []),
    ("get_fallback", "Fallback value of a number sequence.", {"sequence": {"type": "string"}}, []),
    ("get_log", "The last lines of the device log.", {"lines": {"type": "integer"}}, []),
    ("list_files", "Lists a folder of the SD card.", {"path": {"type": "string"}}, []),
    ("get_image", "Returns an image: reference, alg, alg_roi, raw or markerN.", {"name": {"type": "string"}}, ["name"]),
    ("save_config", "Changes configuration parameters (partial configuration).", {"config": {"type": "object"}, "apply": {"type": "boolean"}}, ["config"]),
    ("start_cycle", "Starts a cycle now.", {}, []),
    ("set_paused", "Pauses or resumes the countdown.", {"paused": {"type": "boolean"}}, ["paused"]),
    ("set_fallback", "Sets the fallback value.", {"sequence": {"type": "string"}, "value": {"type": "number"}}, ["value"]),
    ("cut_marker", "Cuts an area out of an image (alignment marker).", {"out": {"type": "string"}, "x": {"type": "integer"}, "y": {"type": "integer"}, "dx": {"type": "integer"}, "dy": {"type": "integer"}}, ["out", "x", "y", "dx", "dy"]),
    ("copy_file", "Copies a file on the SD card.", {"in": {"type": "string"}, "out": {"type": "string"}}, ["in", "out"]),
    ("delete_file", "Deletes a file. System action.", {"path": {"type": "string"}}, ["path"]),
    ("reboot", "Restarts the device. System action.", {}, []),
]
MCP_SYSTEM = {"delete_file", "reboot"}


def mcp_text(t, err=False):
    return {"content": [{"type": "text", "text": t}], "isError": err}


def mcp_call(name, args):
    if name in MCP_SYSTEM and not MCP["allowSystem"]:
        return mcp_text("System actions are disabled. Switch on 'System actions' on the MCP page (System > MCP).", True)
    if name == "get_status":
        return mcp_text(json.dumps(api_status()))
    if name == "get_live":
        return mcp_text(json.dumps(api_live()))
    if name == "get_recognition":
        return mcp_text(json.dumps(api_recognition()))
    if name == "get_config":
        cfg = build_config()
        sec = args.get("section")
        return mcp_text(json.dumps(cfg.get(sec) if sec else cfg)) if not sec or sec in cfg else mcp_text("Section '%s' not found" % sec, True)
    if name == "get_fallback":
        return mcp_text(json.dumps({"ok": True, "sequence": args.get("sequence", "main"), "value": STATE["fallback"]}))
    if name == "get_log":
        return mcp_text("[00:00:12] 2026-11-09 10:00:00 <INF> [MAIN] Mock log line")
    if name == "list_files":
        return mcp_text(json.dumps({"path": args.get("path", "/"), "entries": []}))
    if name == "get_image":
        files = {"reference": "reference.jpg", "alg": "alg.jpg", "alg_roi": "alg_roi.jpg", "raw": "raw.jpg", "marker1": "marker1.jpg", "marker2": "marker2.jpg"}
        f = files.get(args.get("name", ""))
        path = os.path.join(HERE, "assets", f) if f else None
        if not path or not os.path.exists(path):
            return mcp_text("Unknown image. Use reference, alg, alg_roi, raw or marker1, marker2, ...", True)
        data = open(path, "rb").read()
        return {"content": [{"type": "image", "mimeType": "image/jpeg", "data": _b64.b64encode(data).decode()},
                            {"type": "text", "text": "JPEG image, %d bytes" % len(data)}], "isError": False}
    if name == "start_cycle":
        c, d = api_post("/api/cycle", b"{}")
        return mcp_text(json.dumps(d), c >= 400)
    if name == "set_paused":
        c, d = api_post("/api/cycle", json.dumps({"paused": bool(args.get("paused", True))}).encode())
        return mcp_text(json.dumps(d), c >= 400)
    if name == "set_fallback":
        c, d = api_post("/api/fallback", json.dumps({"sequence": args.get("sequence", "main"), "value": args.get("value")}).encode())
        return mcp_text(json.dumps(d), c >= 400)
    if name == "save_config":
        if api_status()["running"]:
            return mcp_text("A cycle is running. Wait until it has finished (get_status: running=false) and try again.", True)
        STATE.setdefault("posts", []).append(json.dumps(args.get("config"))[:4000])
        return mcp_text("Configuration saved (mock: not applied to the shown configuration).")
    if name in ("cut_marker", "copy_file"):
        return mcp_text(json.dumps({"ok": True, "code": "001", "message": "Done (mock)"}))
    if name in ("delete_file", "reboot"):
        return mcp_text("Done (mock: nothing happened).")
    return mcp_text("Unknown tool", True)


def mcp_rpc(body, headers):
    """POST /mcp (JSON-RPC). returns (http code, payload or None)"""
    if not MCP["enabled"]:
        return 404, "Not found"
    auth = headers.get("Authorization", "")
    ok = auth.startswith("Bearer ") and MCP["hash"] and _secrets.compare_digest(_hashlib.sha256(auth[7:].encode()).hexdigest(), MCP["hash"])
    if not ok:
        return 401, {"error": "Access token missing or wrong"}
    try:
        msg = json.loads(body.decode())
    except Exception:
        return 400, {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
    if "id" not in msg or "method" not in msg:
        return 202, None
    mid, method, params = msg["id"], msg["method"], msg.get("params") or {}

    def result(r):
        return 200, {"jsonrpc": "2.0", "id": mid, "result": r}
    if method == "initialize":
        pv = params.get("protocolVersion")
        return result({"protocolVersion": pv if pv in ("2025-03-26", "2024-11-05", "2025-06-18") else "2025-06-18",
                       "capabilities": {"tools": {"listChanged": False}}, "serverInfo": {"name": "ai-on-the-edge", "version": "1.0 (mock)"}})
    if method == "ping":
        return result({})
    if method == "tools/list":
        return result({"tools": [{"name": n, "description": d + (" (disabled: 'System actions' is off on the MCP page)" if n in MCP_SYSTEM and not MCP["allowSystem"] else ""),
                                  "inputSchema": {"type": "object", "properties": p, "required": r}} for n, d, p, r in MCP_TOOLS]})
    if method == "tools/call":
        if params.get("name") not in [t[0] for t in MCP_TOOLS]:
            return 200, {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": "Unknown tool"}}
        return result(mcp_call(params["name"], params.get("arguments") or {}))
    return 200, {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "Method not found"}}


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def _send(self, body, ctype="application/json", code=200):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(n) if n else b""
        if u.path.startswith("/ota/"):
            time.sleep(1.5)
            return self._send("success: package staged", "text/plain")
        if u.path == "/mcp":
            code, payload = mcp_rpc(body, self.headers)
            if payload is None:
                self.send_response(202)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            return self._send(payload, code=code)
        if u.path == "/api/mcp":
            code, payload = mcp_api("POST", body)
            return self._send(payload, code=code)
        if u.path.startswith("/api/"):
            code, payload = api_post(u.path, body)
            return self._send(payload, code=code)
        if u.path == "/config":
            STATE.setdefault("posts", []).append(body.decode("utf-8", "replace")[:4000])
            return self._send(build_config())
        if u.path.startswith("/upload"):
            STATE.setdefault("uploads", []).append((u.path, len(body)))
            target = fs_norm(u.path[len("/upload"):])
            folder, name = target.rsplit("/", 1)
            folder = folder or "/"
            rows = FS.setdefault(folder, [])
            FS[folder] = [r for r in rows if r[0] != name] + [(name, False, len(body))]
            return self._send("OK", "text/plain")
        if u.path.startswith("/delete"):
            STATE.setdefault("deletes", []).append(u.path + ("?" + u.query if u.query else ""))
            target = fs_norm(u.path[len("/delete"):])
            folder, name = target.rsplit("/", 1)
            folder = folder or "/"
            FS[folder] = [r for r in FS.get(folder, []) if r[0] != name]
            FS.pop(target, None)
            return self._send("OK", "text/plain")
        return self._send("OK", "text/plain")

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        p = u.path
        if p.startswith("/poc/") and ".." not in p:  # design proofs of concept (not part of the firmware package)
            f = os.path.join(HERE, "poc", p[len("/poc/"):])
            if os.path.isfile(f):
                return self._send(open(f, "rb").read(), "text/html; charset=utf-8" if f.endswith(".html") else "application/octet-stream")
            return self._send("Not found", "text/plain", 404)
        if p == "/api/mcp":
            code, payload = mcp_api("GET", b"")
            return self._send(payload, code=code)
        if p == "/mcp":
            return self._send({"error": "POST only"}, code=405 if MCP["enabled"] else 404)
        if p == "/info" and "type" in q:
            return self._send(INFO.get(q["type"][0], "?"), "text/plain")
        if p == "/info":
            now = time.strftime("%Y-%m-%dT%H:%M:%S+0100")
            up = int(time.time() - START) + 3600 * 51
            return self._send({
                "process_status": "Processing", "process_interval": 5, "process_time": 12.4, "cycle_counter": 842,
                "datalogging_sdcard_status": "Enabled", "mqtt_status": "Connected (broker.local)", "influxdbv1_status": "Disabled",
                "influxdbv2_status": "Enabled", "webhook_status": "Disabled", "ntp_syncstatus": "Synchronized",
                "device_starttime": now, "current_time": now, "device_uptime": up,
                "network_opmode": "WLAN Station", "connection_status": "Connected", "wlan_ssid": "HomeNet", "wlan_rssi": -52,
                "wlan_channel": 6, "mac_address": "A4:CF:12:9B:7E:10", "network_config": "DHCP", "ipv4_address": "192.168.1.50",
                "netmask_address": "255.255.255.0", "gateway_address": "192.168.1.1", "dns_address": "192.168.1.1", "hostname": "gasmeter",
                "board_type": "esp32cam", "chip_model": "ESP32", "chip_cores": 2, "chip_revision": "0.2",
                "chip_frequency": 240, "chip_temp": 41.5, "camera_type": "OV2640", "camera_frequency": 20,
                "sd_name": "SD32G", "sd_manufacturer": "SanDisk", "sd_capacity": 29.7, "sd_sector_size": 512,
                "sd_partition_alloc_size": 32768, "sd_partition_size": 29.5, "sd_partition_free": 27.1,
                "heap_total_free": 8123456, "heap_spiram_free": 7900000, "heap_spiram_largest_free": 7800000, "heap_spiram_min_free": 7500000,
                "heap_internal_free": 223456, "heap_internal_largest_free": 110000, "heap_internal_min_free": 90000,
                "firmware_version": "v2.3.0-Grrzzz Mock", "html_version": "v2.3.0-Grrzzz Mock", "build_time": "2026-11-05 10:12", "config_version": 3, "idf_version": "v6.1.0"})
        if p == "/log":
            lines = [
                ("INF", "FLOWCTRL", "Cycle 842 finished, value 530.0080"),
                ("DBG", "CAM", "Frame captured"),
                ("INF", "MQTT", "Published 4 topics to broker.local"),
                ("WRN", "POSTPROC", "Value status: Rate too high, using fallback"),
                ("INF", "FLOWCTRL", "Status: Take image"),
                ("ERR", "WIFI", "Connection lost, reconnecting (attempt 1)"),
                ("INF", "WIFI", "Connected, RSSI -52 dBm"),
                ("INF", "SYSTEM", "Time synchronized with pool.ntp.org"),
            ]
            now = time.time()
            out = ""
            for i, (lvl, mod, msg) in enumerate(lines):
                t = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(now - (len(lines) - i) * 47))
                out += f"[0d02h{i:02d}m00s] {t}\t<{lvl}>\t[{mod}] {msg}\n"
            return self._send(out, "text/plain")
        if p == "/wlan":
            nets = [("_(-_-)_/_IoT", -52, 6, "WPA2_PSK"), ("Delle-Guest", -58, 11, "WPA2_PSK"), ("Shelly1Mini-543204BAE408", -70, 1, "OPEN"),
                    ("", -74, 6, "WPA2_PSK"), ("_(-_-)_/_IoT", -81, 36, "WPA2_PSK"), ("Heisslampe", -88, 3, "WPA2_PSK")]
            return self._send({"networks": {str(i): {"ssid": a, "rssi": b, "channel": c, "authmode": d} for i, (a, b, c, d) in enumerate(nets)}})
        if p == "/config":
            return self._send(build_config())
        if p == "/set_fallbackvalue":
            if "value" in q:
                STATE["fallback"] = q["value"][0]
            return self._send(STATE["fallback"], "text/plain")
        if p == "/process_data":
            # the reading advances with every cycle that was started here (shows the rolling counter in the dashboard)
            # while a cycle runs, the new value only appears after it has finished
            done = CYCLE["n"] - 842 - (1 if CYCLE["t0"] else 0)
            val = "%.3f" % (46107.499 + 0.017 * max(0, done))
            return self._send({
                "actual_value": {"main": val}, "fallback_value": {"main": STATE["fallback"]},
                "raw_value": {"main": val}, "value_status": {"main": "000 Valid"},
                "timestamp_fallbackvalue": {"main": "2026-11-05T12:21:57"},
                "process_state": "[" + time.strftime("%H:%M:%S") + "] " + api_status()["state"], "process_error": 0,
                "device_uptime": int(time.time() - START) + 35, "cycle_counter": 2, "wlan_rssi": -36})
        if p.startswith("/camera"):
            return self._send(REF_SVG, "image/svg+xml")
        if False:
            return self._send(MARKER_SVG, "image/svg+xml")
        if p.startswith("/fileserver/config/models/") and "list_dir" in u.query:
            return self._send({"files": ["ana-class100_0171_s1_q.tflite", "ana-class100_0201_s1_q.tflite", "ana-cont_1901_s0_q.tflite",
                                         "dig-class100_0182_s2_q.tflite", "dig-class11_2000_s2_q.tflite", "dig-cont_0900_s3_q.tflite",
                                         "dig-own-meter_q.tflite"], "folders": []})
        if p.startswith("/fileserver/config/certs/") and "list_dir" in u.query:
            return self._send({"files": ["ca.pem", "client.crt", "client.key"], "folders": []})
        if p == "/ota" and q.get("task") == ["selfupdate"]:
            url = (q.get("url") or [""])[0]
            if not url.startswith("https://github.com/"):
                return self._send("400: url not allowed", "text/plain", 400)
            STATE["su"] = {"t0": time.time(), "url": url}
            return self._send("001: Self update started", "text/plain")
        if p == "/ota" and q.get("task") == ["selfupdate_status"]:
            su = STATE.get("su")
            if not su:
                return self._send({"state": "idle", "percent": 0, "message": ""})
            e = time.time() - su["t0"]
            pct = min(100, int(e / 6 * 100))
            if pct >= 100:
                return self._send({"state": "done", "percent": 100, "message": "Package installed"})
            return self._send({"state": "downloading", "percent": pct, "message": "Downloading package"})
        if p.startswith("/fileserver/log/data/data_") and p.endswith(".csv"):
            return self._send("\n".join(DATA_FILES.get(p.rsplit("/", 1)[-1], [])) + "\n", "text/csv")
        if p.startswith("/fileserver/") and p.endswith("/") and "format=json" in u.query:
            return self._send(fs_json(p[len("/fileserver"):]))
        _assets = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
        _map = {"/img_tmp/alg_roi.jpg": "alg_roi.jpg", "/img_tmp/alg.jpg": "alg.jpg", "/img_tmp/raw.jpg": "raw.jpg", "/fileserver/config/reference.jpg": "reference.jpg",
                "/fileserver/config/marker1.jpg": "marker1.jpg", "/fileserver/config/marker2.jpg": "marker2.jpg",
                "/fileserver/img_tmp/marker1.jpg": "marker1.jpg", "/fileserver/img_tmp/marker2.jpg": "marker2.jpg"}
        _name = _map.get(p)
        if _name is None and p.startswith("/img_tmp/d") and p.endswith("_org.jpg"):
            _name = p.rsplit("/", 1)[-1]
        if _name is None and p.startswith("/img_tmp/a") and p.endswith("_org.jpg"):
            _name = "d4_org.jpg"
        if _name and os.path.exists(os.path.join(_assets, _name)):
            return self._send(open(os.path.join(_assets, _name), "rb").read(), "image/jpeg")
        if p == "/api/status":
            return self._send(api_status())
        if p == "/api/live":
            return self._send(api_live())
        if p == "/api/fallback":
            return self._send({"ok": True, "sequence": (q.get("sequence") or ["main"])[0], "value": STATE["fallback"]})
        if p == "/api/update/status":
            su = STATE.get("su")
            if not su:
                return self._send({"state": "idle", "percent": 0, "message": ""})
            e = time.time() - su["t0"]
            pct = min(100, int(e / 6 * 100))
            if pct >= 100:
                return self._send({"state": "done", "percent": 100, "message": "Package installed"})
            return self._send({"state": "downloading", "percent": pct, "message": "Downloading package"})
        if p == "/api/recognition":
            return self._send(api_recognition())
        if p.startswith("/fileserver/") and p.endswith("/") and "list_dir" not in u.query:
            return self._send(fs_page(p[len("/fileserver"):]), "text/html")
        if p.startswith("/fileserver/") and not p.endswith("/") and "list_dir" not in u.query and p.split("/")[-1] not in ("reference.jpg",) and not p.startswith("/fileserver/config/marker"):
            name = p.split("/")[-1]
            STATE.setdefault("downloads", []).append(p)
            body = f"mock content of {name}\n".encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", f'attachment; filename="{name}"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if p == "/editflow":
            return self._send("OK", "text/plain")
        if p == "/_debug":
            return self._send(STATE)
        if p == "/recognition_details":
            if q.get("type") == ["api_name"]:
                return self._send("recognition_details:v2", "text/plain")
            return self._send(recognition_page(), "text/html")
        if p.startswith("/img_tmp/"):
            name = p.rsplit("/", 1)[-1]
            if name.endswith("_org.jpg"):
                return self._send(roi_svg(name[:-8]), "image/svg+xml")
            return self._send(IMG, "image/svg+xml")
        # the firmware serves *.gz files with Content-Encoding: gzip -> do the same
        fp = os.path.join(ROOT, p.lstrip("/"))
        if not os.path.isfile(fp) and os.path.isfile(fp + ".gz"):
            if True:
                body = open(fp + ".gz", "rb").read()
                ctype = "text/javascript" if p.endswith(".js") else "text/css" if p.endswith(".css") else "application/octet-stream"
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
        return super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def _lan_addresses():
    """IPv4 addresses of this computer (for the start message)"""
    import socket
    found = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            if not info[4][0].startswith("127."):
                found.add(info[4][0])
    except OSError:
        pass
    try:  # the address that would be used to reach the LAN
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sck:
            sck.connect(("192.0.2.1", 9))
            found.add(sck.getsockname()[0])
    except OSError:
        pass
    return sorted(found)


print("Mock server: http://127.0.0.1:%d/" % PORT, flush=True)
if HOST in ("0.0.0.0", ""):
    for a in _lan_addresses():
        print("             http://%s:%d/   (LAN)" % (a, PORT), flush=True)
ThreadingHTTPServer((HOST, PORT), H).serve_forever()
