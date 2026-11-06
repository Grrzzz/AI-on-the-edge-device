#!/usr/bin/env python3
"""
Generates the icons and state images of the WebUI from one glyph set (meter themes).

Themes: generic (counter), water, gas, energy, temperature, pressure. The theme follows the meter type of the MQTT settings.

Output (sd-card/html):
  - favicon.ico, icon.svg, icon-android-chrome-192x192.png, icon-android-chrome-512x512.png, icon-apple-touch.png  (generic theme)
  - flowstate_<state>.jpg (generic) and flowstate_<theme>_<state>.jpg   (state images of the dashboard, selected by the firmware)
  - the block between "BEGIN METER THEMES" and "END METER THEMES" in app.js (glyphs and colors for logo, favicon, scan icon)

Usage: python tools/webui/make_icons.py [path to the sd-card/html folder]   (needs Pillow)
"""
import json
import math
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'sd-card', 'html')

FONT_B = r"C:\Windows\Fonts\segoeuib.ttf"
FONT_R = r"C:\Windows\Fonts\segoeui.ttf"
if not os.path.exists(FONT_B):  # other systems
    FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
    FONT_R = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

# ---------------------------------------------------------------------------------------------
# Themes: gradient (135 degrees), glyph on a 24 x 24 grid (stroke 1.8, round caps and joins)
# paths: absolute M L H V C Z only, circles [cx, cy, r], rects [x, y, w, h, r]
# ---------------------------------------------------------------------------------------------
THEMES = {
    'generic': {
        'label': 'Meter',
        'colors': ['#5b6cff', '#8b5cf6'],
        'paths': ['M10.2 8V12.5', 'M13.8 8V12.5', 'M7.5 16.6H9.5', 'M14.5 16.6H16.5'],
        'circles': [[12, 16.6, 1.1]],
        'rects': [[3.5, 3.8, 17, 16.4, 3.2], [6.6, 7.6, 10.8, 5.4, 1.2]],
    },
    'water': {
        'label': 'Water',
        'colors': ['#0ea5e9', '#2563eb'],
        'paths': [
            'M12 3C9.6 6 6 9.4 6 13.6C6 17.1 8.7 20 12 20C15.3 20 18 17.1 18 13.6C18 9.4 14.4 6 12 3Z',
            'M9.3 14.2C9.4 15.7 10.4 16.9 11.8 17.2',
        ],
        'circles': [], 'rects': [],
    },
    'gas': {
        'label': 'Gas',
        'colors': ['#f97316', '#ef4444'],
        'paths': [
            'M12 3C12.6 6.2 16.6 8 16.6 13.2C16.6 16.7 14.7 20 12 20C9.3 20 7.4 17.6 7.4 14.6C7.4 12.6 8.4 11.4 9.4 10.3C9.6 11.9 10.4 12.7 11.2 12.9C11.7 9.6 11 6 12 3Z',
        ],
        'circles': [], 'rects': [],
    },
    'energy': {
        'label': 'Energy',
        'colors': ['#d97706', '#f59e0b'],
        'paths': ['M13.2 2.8L5.6 13.2H11.3L10.6 21.2L18.4 10.6H12.7Z'],
        'circles': [], 'rects': [],
    },
    'temperature': {
        'label': 'Temperature',
        'colors': ['#ec4899', '#f43f5e'],
        'paths': [
            'M10 13.3V5.5C10 4.4 10.9 3.5 12 3.5C13.1 3.5 14 4.4 14 5.5V13.3C15.2 14.1 16 15.4 16 17C16 19.2 14.2 21 12 21C9.8 21 8 19.2 8 17C8 15.4 8.8 14.1 10 13.3Z',
            'M12 9V15.6',
        ],
        'circles': [[12, 17, 1.3]], 'rects': [],
    },
    'pressure': {
        'label': 'Pressure',
        'colors': ['#64748b', '#334155'],
        'paths': ['M12 13L16.3 8.7', 'M12 5.8V7.4', 'M5.9 9.7L7.2 10.6', 'M18.1 9.7L16.8 10.6', 'M8.5 21H15.5'],
        'circles': [[12, 12.8, 8.2], [12, 13, 1.2]],
        'rects': [],
    },
}

STATES = {
    'take_image': ('Taking image ...', 'The camera captures the picture', 'accent'),
    'initialization': ('Initializing ...', 'Loading models and configuration', 'accent'),
    'initialization_delayed': ('Initialization delayed', 'Starting after a restart caused by an error', '#f59e0b'),
    'setup_mode': ('Setup mode', 'Finish the setup to start the readings', '#f59e0b'),
    'idle_autostart': ('Waiting for the next cycle', 'The next reading starts automatically', '#10b981'),
    'idle_no_autostart': ('Ready', 'A reading starts when you trigger it', '#10b981'),
}


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# ---------------------------------------------------------------------------------------------
# path sampling for PIL
# ---------------------------------------------------------------------------------------------
def sample_path(d):
    """Absolute M L H V C Z -> list of polylines (list of (x, y))"""
    tokens = re.findall(r'[MLHVCZ]|-?\d*\.?\d+', d)
    polys, cur, i, pos, start = [], [], 0, (0, 0), (0, 0)
    cmd = None
    while i < len(tokens):
        t = tokens[i]
        if t in 'MLHVCZ':
            cmd = t
            i += 1
            if cmd == 'Z':
                if cur:
                    cur.append(start)
                    polys.append(cur)
                    cur = []
            continue
        if cmd == 'M':
            if cur:
                polys.append(cur)
            pos = (float(tokens[i]), float(tokens[i + 1]))
            start = pos
            cur = [pos]
            i += 2
            cmd = 'L'
        elif cmd == 'L':
            pos = (float(tokens[i]), float(tokens[i + 1]))
            cur.append(pos)
            i += 2
        elif cmd == 'H':
            pos = (float(tokens[i]), pos[1])
            cur.append(pos)
            i += 1
        elif cmd == 'V':
            pos = (pos[0], float(tokens[i]))
            cur.append(pos)
            i += 1
        elif cmd == 'C':
            p1 = (float(tokens[i]), float(tokens[i + 1]))
            p2 = (float(tokens[i + 2]), float(tokens[i + 3]))
            p3 = (float(tokens[i + 4]), float(tokens[i + 5]))
            for n in range(1, 25):
                u = n / 24
                x = (1 - u) ** 3 * pos[0] + 3 * (1 - u) ** 2 * u * p1[0] + 3 * (1 - u) * u ** 2 * p2[0] + u ** 3 * p3[0]
                y = (1 - u) ** 3 * pos[1] + 3 * (1 - u) ** 2 * u * p1[1] + 3 * (1 - u) * u ** 2 * p2[1] + u ** 3 * p3[1]
                cur.append((x, y))
            pos = p3
            i += 6
        else:
            i += 1
    if cur:
        polys.append(cur)
    return polys


def draw_glyph(draw, theme, ox, oy, size, stroke, color=(255, 255, 255, 255)):
    """glyph grid 24 x 24 scaled to `size` pixels, top left at (ox, oy); stroke in pixels"""
    k = size / 24.0
    w = max(1, int(round(stroke)))

    def pt(p):
        return (ox + p[0] * k, oy + p[1] * k)

    def polyline(points):
        pts = [pt(p) for p in points]
        draw.line(pts, fill=color, width=w, joint='curve')
        for x, y in pts[:: max(1, len(pts) // 12)] + [pts[0], pts[-1]]:
            draw.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=color)

    for d in theme['paths']:
        for poly in sample_path(d):
            polyline(poly)
    for cx, cy, r in theme['circles']:
        x, y = pt((cx, cy))
        draw.ellipse((x - r * k - w / 2, y - r * k - w / 2, x + r * k + w / 2, y + r * k + w / 2), outline=color, width=w)
    for x, y, rw, rh, rr in theme['rects']:
        x0, y0 = pt((x, y))
        draw.rounded_rectangle((x0 - w / 2, y0 - w / 2, x0 + rw * k + w / 2, y0 + rh * k + w / 2), radius=rr * k, outline=color, width=w)


def gradient(size_w, size_h, c0, c1):
    side = max(size_w, size_h)
    h = Image.linear_gradient('L').resize((side, side))
    g = Image.blend(h, h.rotate(90), 0.5).crop((0, 0, size_w, size_h))
    return ImageOps.colorize(g, c0, c1).convert('RGBA')


def tile(theme, size, glyph_ratio=0.56, stroke_units=1.8):
    """rounded tile with gradient and white glyph (Doorbell style: radius 30 percent, glyph 55 percent)"""
    ss = 6
    S = size * ss
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=S * 0.3, fill=255)
    img.paste(gradient(S, S, *theme['colors']), (0, 0), mask)
    d = ImageDraw.Draw(img)
    g = S * glyph_ratio
    draw_glyph(d, theme, (S - g) / 2, (S - g) / 2, g, g / 24.0 * stroke_units)
    return img.resize((size, size), Image.LANCZOS)


# ---------------------------------------------------------------------------------------------
# state images
# ---------------------------------------------------------------------------------------------
def state_image(theme, state, path):
    title, sub, accent = STATES[state]
    W, H = 640, 480
    accent_rgb = hex_rgb(theme['colors'][0]) if accent == 'accent' else hex_rgb(accent)
    img = gradient(W, H, '#f6f7fd', '#e4e7f7')

    cx, cy = W // 2, 190
    for rad, alpha in ((128, 22), (104, 34), (82, 48)):
        ring = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(ring).ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=accent_rgb + (alpha,))
        img = Image.alpha_composite(img, ring)

    t = tile(theme, 132, glyph_ratio=0.58, stroke_units=1.9)
    img.alpha_composite(t, (cx - 66, cy - 66))

    d = ImageDraw.Draw(img)
    if state == 'take_image':  # viewfinder corners around the tile
        a, w = 86, 6
        for sx in (-1, 1):
            for sy in (-1, 1):
                x, y = cx + sx * a, cy + sy * a
                d.line([(x, y - sy * 26), (x, y), (x - sx * 26, y)], fill=accent_rgb + (255,), width=w, joint='curve')
                for px, py in ((x, y - sy * 26), (x, y), (x - sx * 26, y)):
                    d.ellipse((px - w / 2, py - w / 2, px + w / 2, py + w / 2), fill=accent_rgb + (255,))

    f_title = ImageFont.truetype(FONT_B, 36)
    f_sub = ImageFont.truetype(FONT_R, 20)
    tw = d.textlength(title, font=f_title)
    d.text(((W - tw) / 2, 336), title, font=f_title, fill=(17, 24, 39, 255))
    sw = d.textlength(sub, font=f_sub)
    d.text(((W - sw) / 2, 388), sub, font=f_sub, fill=(100, 116, 139, 255))
    img.convert('RGB').save(path, quality=88, optimize=True)


# ---------------------------------------------------------------------------------------------
# JS block for app.js
# ---------------------------------------------------------------------------------------------
def js_block():
    data = {k: {'label': v['label'], 'colors': v['colors'], 'paths': v['paths'], 'circles': v['circles'], 'rects': v['rects']} for k, v in THEMES.items()}
    body = json.dumps(data, indent=2).replace('"', "'")
    # meter type of the MQTT settings (mqtt.homeassistant.metertype) -> theme
    types = {0: 'generic', 1: 'water', 2: 'water', 3: 'water', 4: 'water', 15: 'water', 16: 'water', 5: 'gas', 6: 'gas',
             7: 'energy', 8: 'energy', 9: 'energy', 10: 'energy', 11: 'temperature', 12: 'temperature', 13: 'pressure', 14: 'pressure'}
    return ("// BEGIN METER THEMES (generated by tools/webui/make_icons.py)\n"
            f"const METER_THEMES = {body};\n"
            f"const METER_TYPE_THEME = {json.dumps(types)};\n"
            "// END METER THEMES\n")


def main():
    os.makedirs(OUT, exist_ok=True)
    generic = THEMES['generic']

    # static icons (generic theme)
    tile(generic, 512).save(os.path.join(OUT, 'icon-android-chrome-512x512.png'))
    tile(generic, 192).save(os.path.join(OUT, 'icon-android-chrome-192x192.png'))
    apple = Image.new('RGB', (180, 180), hex_rgb(generic['colors'][0]))
    apple.paste(gradient(180, 180, *generic['colors']).convert('RGB'))
    big = tile(generic, 180, glyph_ratio=0.5)
    ai = Image.new('RGBA', (180, 180), (0, 0, 0, 0))
    ai.alpha_composite(big, (0, 0))
    apple_full = gradient(180, 180, *generic['colors'])
    d = ImageDraw.Draw(apple_full)
    draw_glyph(d, generic, 45, 45, 90, 90 / 24.0 * 1.9)
    apple_full.convert('RGB').save(os.path.join(OUT, 'icon-apple-touch.png'))
    tile(generic, 256, glyph_ratio=0.64, stroke_units=2.2).save(os.path.join(OUT, 'favicon.ico'),
                                                                sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    # icon.svg (generic theme)
    t = generic
    shapes = ''.join(f'<path d="{p}"/>' for p in t['paths'])
    shapes += ''.join(f'<circle cx="{c[0]}" cy="{c[1]}" r="{c[2]}"/>' for c in t['circles'])
    shapes += ''.join(f'<rect x="{r[0]}" y="{r[1]}" width="{r[2]}" height="{r[3]}" rx="{r[4]}"/>' for r in t['rects'])
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
           f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{t["colors"][0]}"/>'
           f'<stop offset="1" stop-color="{t["colors"][1]}"/></linearGradient></defs>'
           '<rect width="64" height="64" rx="19" fill="url(#g)"/>'
           f'<g transform="translate(13 13) scale(1.5833)" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">{shapes}</g></svg>\n')
    open(os.path.join(OUT, 'icon.svg'), 'w', encoding='utf-8').write(svg)

    # state images
    for state in STATES:
        for name, theme in THEMES.items():
            file = f'flowstate_{state}.jpg' if name == 'generic' else f'flowstate_{name}_{state}.jpg'
            state_image(theme, state, os.path.join(OUT, file))

    # JS block
    p = os.path.join(OUT, 'app.js')
    s = open(p, encoding='utf-8', newline='').read()
    crlf = '\r\n' in s
    s = s.replace('\r\n', '\n')
    block = js_block()
    pattern = re.compile(r'// BEGIN METER THEMES.*?// END METER THEMES\n', re.S)
    if pattern.search(s):
        s = pattern.sub(lambda m: block, s, count=1)
        open(p, 'w', encoding='utf-8', newline='').write(s.replace('\n', '\r\n') if crlf else s)
        print('app.js updated')
    else:
        print('markers not found in app.js, block not written')
    print('done')


if __name__ == '__main__':
    main()
