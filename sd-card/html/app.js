/* AI-on-the-Edge Device WebUI (single page app). Sections: toasts, helpers, core (Api/App), views, boot. */

/* ========================================================================== */
/* Toasts                                                                     */
/* ========================================================================== */

const firework = {
  init() {
    if (!document.getElementById('fw-container')) {
      const container = document.createElement('div');
      container.id = 'fw-container';

      // Special case: index.html
      if (document.querySelector('.menu')) {
        Object.assign(container.style, { left: '300px' });
      }

      document.body.appendChild(container);
    }
  },

  /**
   * @param msg      string
   * @param type     string
   * @param duration number
   * @param updateId string (Optional: if provided, will update existing toast with this ID)
   */
  launch(msg, type = 'default', duration = 3000, updateId = null) {
    this.init();

    // 1. Check if we are updating an existing toast
    if (updateId) {
      const existing = document.getElementById(updateId);
      if (existing) {
        existing.querySelector('.fw-body').innerHTML = msg;
        existing.className = `firework-toast is-active ${type}`;

        // Reset the timer if a new duration is provided
        if (duration > 0) {
          clearTimeout(existing.dataset.timerId);
          const newTimer = setTimeout(() => this.dismiss(existing), duration);
          existing.dataset.timerId = newTimer;
        }
        return updateId;
      }
    }

    // 2. Otherwise, create a new one
    const container = document.getElementById('fw-container');
    const fid = updateId || 'fw-' + Date.now();
    const toast = document.createElement('div');
    toast.id = fid;
    toast.className = `firework-toast ${type}`;
    toast.innerHTML = `
            <div class="fw-body">${msg}</div>
            <button class="fw-close">&times;</button>
        `;

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-active'));

    // Set the auto-dismiss timer
    if (duration > 0) {
      const timerId = setTimeout(() => this.dismiss(toast), duration);
      toast.dataset.timerId = timerId; // Store timer ID on the element
    }

    toast.querySelector('.fw-close').onclick = () => this.dismiss(toast);
    return fid;
  },

  sticky(m, t = 'default', l = 3000) {
    const payload = JSON.stringify({ message: m, type: t, display: l });
    // Sets cookie valid for current session, path root
    document.cookie = `firework=${encodeURIComponent(payload)}; path=/; SameSite=Lax`;
  },

  checkCookies() {
    const name = 'firework=';
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = document.cookie.split(';');

    for (let i = 0; i < ca.length; i++) {
      let c = ca[i].trim();
      if (c.indexOf(name) === 0) {
        try {
          const data = JSON.parse(decodeURIComponent(c.substring(name.length)));
          // Launch with a slight delay so the user sees the page load first
          setTimeout(() => {
            this.launch(data.message, data.type, data.display || 4000);
          }, 500);
          // Clear cookie after reading
          document.cookie = 'firework=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        } catch (e) {
          console.error('Firework: Invalid cookie JSON');
        }
      }
    }
  },

  dismiss(el) {
    if (typeof el === 'string') {
      el = document.getElementById(el);
    }

    if (!el || !(el instanceof Element)) return;

    // Stop any pending auto-dismiss timers for this element
    if (el.dataset.timerId) {
      clearTimeout(el.dataset.timerId);
    }

    // Start the fade-out animation
    el.classList.remove('is-active');

    if (!el.parentNode) return;

    // Clean removal after animation
    const handler = (event) => {
      if (event.target !== el) return;
      el.removeEventListener('transitionend', handler);
      el.remove();
    };

    el.addEventListener('transitionend', handler);

    // Fallback: Force remove
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 600);
  },
};

document.addEventListener('DOMContentLoaded', () => firework.checkCookies());


/* ========================================================================== */
/* Environment                                                                */
/* ========================================================================== */

/* The WebUI can also be served from a local webserver for development (e.g. python -m http.server on http://localhost:8000)
 * and talk to a physical device: run localStorage.setItem('deviceIp', '192.168.2.20') in the browser console and reload.
 * Remove the entry to use the page origin again. You might have to disable CORS in your browser.
 * Without the entry (regular operation, also http://localhost:<port> served by the device or a mock) the page origin is used.
 */
let testEnvironmentActive = false;

/* Returns the domainname with prepended protocol.
 * E.g. http://watermeter.fritz.box or http://192.168.1.5
 */
function getDomainname() {
  let deviceIp = null;
  try { deviceIp = localStorage.getItem('deviceIp'); } catch (e) { }

  if (deviceIp && window.location.hostname === 'localhost') {
    testEnvironmentActive = true;
    return 'http://' + deviceIp;
  }

  return window.location.origin; // protocol + hostname + optional port
}

function getTestEnvironmentActive() {
  return testEnvironmentActive;
}



/* ========================================================================== */
/* Formatting + DOM helpers                                                   */
/* ========================================================================== */

const isObj = (v) => v !== null && typeof v === 'object';
const resolveEl = (el) => (typeof el === 'string' ? document.querySelector(el) : el);

function addZero(i) {
  return i < 10 ? '0' + i : i;
}

function formatUptime(uptime) {
  const s = Math.floor(uptime);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);

  return `${days}d ${addZero(hours)}h ${addZero(minutes)}m ${addZero(s % 60)}s`;
}

function renderRssi(value) {
  const output = document.getElementById('wlan_rssi');
  if (!output) return;

  const bars = document.querySelectorAll('#rssi_svg .bar');
  const setBars = (count, dimOpacity) =>
    bars.forEach((bar, i) => {
      const active = i < count;
      bar.style.opacity = active ? '1' : dimOpacity;
      bar.style.fill = active ? 'var(--primary)' : 'currentColor';
    });

  if (value === null || isNaN(value)) {
    output.textContent = 'Offline';
    setBars(0, '0.1');
  } else if (value <= -255) {
    output.textContent = 'Disconnected';
    setBars(0, '0.1');
  } else {
    const label = value >= -55 ? 'Excellent' : value >= -67 ? 'Good' : value >= -78 ? 'Fair' : value >= -85 ? 'Weak' : 'Unreliable';
    output.textContent = `${label} (${value}dBm)`;
    const RSSI_THRESHOLDS = [-85, -78, -67, -55]; // Weak, Fair, Good, Excellent
    setBars(RSSI_THRESHOLDS.filter((t) => value >= t).length, '0.2');
  }
}

// Remove hidden class (show elements) when condition is TRUE
function setClassVisibility(classname, condition) {
  const show = condition === 'true' || condition === true;
  for (const el of document.getElementsByClassName(classname)) {
    el.classList.toggle('hidden', !show);
  }
}

// Show element (clear hidden attribute) when condition is TRUE
function setElVisibility(el, condition, fade = false) {
  const root = resolveEl(el);
  if (!root) return;

  root.hidden = !condition;

  if (fade) {
    root.querySelectorAll('*').forEach((node) => {
      node.style.transition = 'opacity 250ms';
      node.style.opacity = condition ? '1' : '0';
    });
  }
}

// Enable all inputs/buttons/selects in tree when condition is not false/'false'
function setTreeEnabled(el, condition, fade = false) {
  const root = resolveEl(el);
  if (!root) return;

  const enable = !(condition == false || condition == 'false');
  root.querySelectorAll('input,button,select').forEach((node) => {
    node.disabled = !enable;
  });

  root.querySelectorAll('*').forEach((node) => {
    node.style.transition = 'opacity 400ms';
    node.style.opacity = enable ? '1' : fade ? '0' : '0.85';
  });
}

// Remove disabled class + disabled attribute on all interactive children when condition is TRUE
function setClassEnabled(classname, condition) {
  const enable = condition === 'true' || condition === true;

  for (const container of document.getElementsByClassName(classname)) {
    container.classList.toggle('disabled', !enable);
    container.querySelectorAll('input, select, textarea, button, output').forEach((input) => {
      input.disabled = !enable; // reflects to the attribute
    });
  }
}

function triggerClassElementOnChange(classname) {
  Array.from(document.getElementsByClassName(classname))
    .reverse()
    .forEach((el) => {
      if (typeof el.onchange === 'function') el.onchange();
    });
}


/* ========================================================================== */
/* Input masks                                                                */
/* ========================================================================== */

// Helper: Backspace right behind a separator removes the separator itself
function eraseSeparatorOnBackspace(input, separators) {
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Backspace') return;

    const { selectionStart: pos, selectionEnd, value } = e.target;
    if (pos === selectionEnd && pos > 0 && separators.includes(value[pos - 1])) {
      e.preventDefault();
      e.target.value = value.slice(0, pos - 1) + value.slice(pos);
      e.target.setSelectionRange(pos - 1, pos - 1);
    }
  });
}

function validateIpMasks(ipInputs) {
  ipInputs.forEach((input) => {
    input.setAttribute('maxlength', '15');
    input.setAttribute('autocomplete', 'off');

    // Digits and dots only, max 4 octets, each 0-255 / 3 digits
    input.addEventListener('input', (e) => {
      e.target.value = e.target.value
        .replace(/[^0-9.]/g, '')
        .split('.')
        .slice(0, 4)
        .map((octet) => {
          const o = octet.slice(0, 3);
          return parseInt(o, 10) > 255 ? '255' : o;
        })
        .join('.');
    });

    eraseSeparatorOnBackspace(input, ['.']);
  });
}

// YYYY-MM-DD HH:mm:ss
const DATETIME_SEGMENTS = [
  { len: 4, sep: '' },
  { len: 2, sep: '-', min: 1, max: 12 },
  { len: 2, sep: '-', min: 1, max: 31 },
  { len: 2, sep: ' ', min: 0, max: 23 },
  { len: 2, sep: ':', min: 0, max: 59 },
  { len: 2, sep: ':', min: 0, max: 59 },
];

function formatDateTimeDigits(digits) {
  let pos = 0;
  let out = '';

  for (const { len, sep, min, max } of DATETIME_SEGMENTS) {
    const part = digits.slice(pos, pos + len);
    if (!part) break;

    // Clamp only completed segments that have a range
    const clamped = part.length === len && max !== undefined ? String(Math.min(Math.max(+part, min), max)).padStart(len, '0') : part;
    out += sep + clamped;
    pos += len;
  }

  return out;
}

function validateDateTimeMasks(datetimeInputs) {
  datetimeInputs.forEach((input) => {
    input.setAttribute('maxlength', '19');
    input.setAttribute('placeholder', input.getAttribute('placeholder') || 'YYYY-MM-DD HH:mm:ss');
    input.setAttribute('autocomplete', 'off');

    input.addEventListener('input', (e) => {
      e.target.value = formatDateTimeDigits(e.target.value.replace(/\D/g, ''));
    });

    eraseSeparatorOnBackspace(input, ['-', ' ', ':']);
  });
}


/* ========================================================================== */
/* API core                                                                   */
/* ========================================================================== */

/**
 * @typedef {Object} ApiResult
 * @property {boolean} ok
 * @property {number|null} status
 * @property {Headers|null} headers
 * @property {*} data
 * @property {'timeout'|'network'|null} error
 */

function resolveApiUrl(endpoint) {
  if (typeof endpoint !== 'string') {
    return String(endpoint);
  }
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }
  const origin = getDomainname();
  if (endpoint.startsWith(origin)) {
    return endpoint;
  }
  if (!endpoint.startsWith('/')) {
    return `${origin}/${endpoint}`;
  }
  return `${origin}${endpoint}`;
}

function classifyFetchError(error, signal) {
  if (error?.name === 'TimeoutError') return 'timeout'; // AbortSignal.timeout()

  if (signal?.aborted) {
    return signal.reason?.name === 'TimeoutError' ? 'timeout' : 'aborted';
  }

  return error?.name === 'AbortError' ? 'aborted' : 'network';
}

// Member of a JSON response text (e.g. 'code', 'message'), null if the text is no JSON object or lacks the member
function jsonField(data, key) {
  if (typeof data !== 'string' || data[0] !== '{') return null;
  try {
    const value = JSON.parse(data)[key];
    return value === undefined ? null : value;
  } catch (e) {
    return null;
  }
}

function plainTextSnippet(data) {
  if (typeof data !== 'string') {
    return '';
  }
  const message = jsonField(data, 'message');
  if (message) data = String(message);
  const trimmed = data.trim();
  if (!trimmed || trimmed.startsWith('<')) {
    return '';
  }
  return trimmed.length > 180 ? trimmed.slice(0, 180) + 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦' : trimmed;
}

function launchNotifyEntry(entry, fallbackType, fallbackDuration) {
  if (!entry) {
    return;
  }
  if (typeof entry === 'string') {
    firework.launch(entry, fallbackType, fallbackDuration);
    return;
  }
  firework.launch(entry.msg, entry.type || fallbackType, entry.time || fallbackDuration);
}

/**
 * Thin fetch: device URL, credentials, cache no-store, 10s timeout.
 * Pass native RequestInit only. Use signal: null to disable the default timeout.
 * @param {string} endpoint
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
async function fetchWrapper(endpoint, init = {}) {
  const { timeout = 15000, ...rest } = init;
  const options = { credentials: 'include', cache: 'no-store', ...rest };

  if (options.signal === undefined) {
    options.signal = AbortSignal.timeout(timeout);
  } else if (options.signal === null) {
    delete options.signal;
  } else {
    options.signal = AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]);
  }
  return fetch(resolveApiUrl(endpoint), options);
}

/**
 * API call without toast message
 * Never throws. Reads the body even when !ok.
 * @param {string} endpoint
 * @param {RequestInit} [init]
 * @param {{ parseType?: 'text'|'json'|'blob' }} [extras]
 * @returns {Promise<ApiResult>}
 */
async function apiCall(endpoint, init = {}, extras = {}) {
  const parseType = extras.parseType || 'text';
  try {
    const response = await fetchWrapper(endpoint, init);
    if (parseType === 'blob') {
      const data = await response.blob();
      return { ok: response.ok, status: response.status, headers: response.headers, data, error: null };
    }

    const text = await response.text();
    if (parseType === 'json' && response.ok) {
      try {
        const data = text ? JSON.parse(text) : null;
        return { ok: true, status: response.status, headers: response.headers, data, error: null };
      } catch (error) {
        return { ok: false, status: response.status, headers: response.headers, data: error.message, error: null };
      }
    }

    return { ok: response.ok, status: response.status, headers: response.headers, data: text, error: null };
  } catch (error) {
    return { ok: false, status: null, headers: null, data: error.message, error: classifyFetchError(error, init.signal) };
  }
}

/**
 * API call with toast message for user-initiated actions
 * @param {string} endpoint
 * @param {RequestInit} [init]
 * @param {{ action?: string, resultMsg?: string|Object, loadingMsg?: string, loadingIcon?: 'scan', parseType?: 'text'|'json'|'blob', httpObj?: Object }} [notify]
 * @returns {Promise<ApiResult>}
 */
async function apiCallNotify(endpoint, init = {}, notify = {}) {
  const { action = 'Request', resultMsg, loadingMsg, loadingIcon, parseType, httpObj } = notify;
  const loadingId = loadingMsg ? firework.launch((loadingIcon === 'scan' ? scanIconHtml(20) + ' ' : '') + loadingMsg, 'success', 120000) : null;
  const res = await apiCall(endpoint, init, { parseType });
  firework.dismiss(loadingId);

  if (res.error === 'aborted') // manual abort, do nothing
    return res;

  if (res.error === 'timeout') {
    firework.launch(`${action} timed out`, 'danger', 30000);
    console.error(`${action} timed out`, res.error, res.data);
    return res;
  }

  if (res.error === 'network') {
    firework.launch(`${action} failed. Server closed the connection abruptly`, 'danger', 30000);
    console.error(`${action} failed`, res.error, res.data);
    return res;
  }

  if (!res.ok) {
    if (httpObj && httpObj[res.status]) {
      const entry = httpObj[res.status];
      launchNotifyEntry(typeof entry === 'function' ? entry(res) : entry, 'danger', 30000);
    } else if (res.status === 403) {
      firework.launch(`${action} rejected. Process not (yet) initialized. Repeat action or check logs.`, 'warning', 5000);
    } else {
      const snippet = plainTextSnippet(res.data);
      let msg = `${action} failed (Status: ${res.status})`;
      if (snippet) {
        msg += ` | ${snippet}`;
      }
      firework.launch(msg, 'danger', 30000);
    }
    console.error(`${action} rejected`, res.status, res.data);
    return res;
  }

  if (typeof resultMsg === 'string') {
    firework.launch(resultMsg, 'success', 3000);
  } else if (resultMsg && typeof resultMsg === 'object') {
    const code = typeof res.data === 'string' ? (jsonField(res.data, 'code') ?? res.data.substring(0, 3)) : '';
    if (resultMsg[code]) {
      launchNotifyEntry(resultMsg[code], 'success', 3000);
    } else {
      firework.launch(`${action} rejected. Reason: ${res.data || 'Unknown'}`, 'danger', 30000);
    }
  }

  return res;
}


/* ========================================================================== */
/* API calls                                                                  */
/* ========================================================================== */

const withDomain = (domainname, endpoint) => (domainname ? domainname + endpoint : endpoint);
const apiError = (message, res) => Object.assign(new Error(message), { status: res.status, error: res.error });

// GET + parse JSON. Toasts and throws on failure
async function fetchJson(endpoint, action) {
  const res = await apiCallNotify(endpoint, {}, { action, parseType: 'json' });
  if (!res.ok) throw new Error(`${action} failed`);
  return res.data;
}

const getWlanNetworks = () => fetchJson('/wlan?task=scan', 'WLAN scan request');
const getLogFileList = () => fetchJson('/log?type=list_dir', 'Log files request');
const getDataFileList = () => fetchJson('/data?type=list_dir', 'Data files request');
const getTfliteFileList = () => fetchJson('/fileserver/config/models/?list_dir=true', 'TFLite files request');
const getCertFileList = () => fetchJson('/fileserver/config/certs/?list_dir=true', 'Cert files request');

async function apiCopy(_source, _target, async = false) {
  const res = await Api.post('/api/flow/copy', { in: _source, out: _target }, { action: 'Copy file request' }, { signal: async ? undefined : null });
  if (!res.ok) throw apiError('Copy file request failed', res);
  return 'Copy file request successful';
}

/* ========================================================================== */
/* Config                                                                     */
/* ========================================================================== */

let jsonConfig = {}; // Config: Object in JSON notation
let jsonConfigModifiedDelta = {}; // Config: Object in JSON notation (modified parameter only)

// Reload code -> notify entry
const APPLIED = { msg: 'Configuration saved and applied successfully', type: 'success', time: 3000 };
const DEFERRED = { msg: 'Configuration saved. Will apply after current cycle', type: 'success', time: 3000 };
const NOT_APPLIED = { msg: 'Configuration saved, but failed to apply: Process uninitialized', type: 'danger', time: 10000 };
const RELOAD_NOTIFY = { '001': APPLIED, '002': APPLIED, '003': APPLIED, '004': DEFERRED, '099': NOT_APPLIED, E90: NOT_APPLIED };

function processReloadFeedback(code) {
  launchNotifyEntry(RELOAD_NOTIFY[code], 'success', 3000);
}

async function reloadConfig() {
  await apiCallNotify('/config?task=reload', {}, { action: 'Configuration update', resultMsg: RELOAD_NOTIFY });
}

async function saveConfig(data, reload = false) {
  const res = await apiCallNotify(
    reload ? '/config?reload=true' : '/config',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data },
    {
      action: 'Save config',
      loadingMsg: 'Save and apply configuration...',
      resultMsg: reload ? undefined : 'Configuration saved successfully',
    },
  );

  if (!res.ok) throw apiError(`Save config failed (${res.error ?? `Status: ${res.status}`})`, res);

  sessionStorage.setItem('jsonConfigData', res.data);
  MeterTheme.applyFromConfig(); // the meter type may have changed
  if (reload) processReloadFeedback(res.headers.get('X-Reload-Code'));
}

async function loadConfig() {
  const res = await apiCallNotify('/config', {}, { action: 'Loading config', parseType: 'json' });
  if (!res.ok || !res.data) throw apiError(`Loading config failed (${res.error ?? `Status: ${res.status}`})`, res);

  try {
    sessionStorage.setItem('jsonConfigData', JSON.stringify(res.data));
  } catch (e) {
    console.warn('Config cache not updated:', e);
  }
}

// type: 0 = config, 1 = keyified [path, value] pairs, 2 = [config, keyified]
function getConfigFromStorage(type = 0) {
  jsonConfig = JSON.parse(sessionStorage.getItem('jsonConfigData'));
  if (type === 0) return jsonConfig;

  const keyified = jsonObjectKeyify(jsonConfig);
  return type === 1 ? keyified : type === 2 ? [jsonConfig, keyified] : undefined;
}

function noConfigInStorage() {
  return sessionStorage.getItem('jsonConfigData') === null;
}

// { a: { b: 1 } } -> [['a_b', 1]]
function jsonObjectKeyify(obj) {
  const flatten = (v, path = []) => (Object(v) === v ? Object.entries(v).flatMap(([k, child]) => flatten(child, [...path, k])) : [[path.join('_'), v]]);
  return flatten(obj);
}

function deepMergeObjects(obj1, obj2) {
  if (Array.isArray(obj2)) return structuredClone(obj2); // arrays (markers, ROIs) are taken as a whole
  const result = {};

  for (const key of Object.keys(obj2)) {
    result[key] = isObj(obj2[key]) && isObj(obj1[key]) && !Array.isArray(obj2[key]) ? deepMergeObjects(obj1[key], obj2[key]) : obj2[key];
  }
  for (const key of Object.keys(obj1)) {
    if (!(key in result)) result[key] = isObj(obj1[key]) && !Array.isArray(obj1[key]) ? deepMergeObjects(obj1[key], {}) : obj1[key];
  }

  return result;
}

// Based on https://stackoverflow.com/a/54733755/5459839
function deepSet(obj, path, value, integer) {
  if (Object(obj) !== obj) return obj;

  const keys = Array.isArray(path) ? [...path] : path.toString().match(/[^.[\]]+/g) || [];
  const last = keys.pop();

  const target = keys.reduce((acc, key, i) => {
    if (Object(acc[key]) !== acc[key]) {
      // next key is an array index -> create array, else object
      const next = keys[i + 1] ?? last;
      acc[key] = Math.abs(next) >> 0 === +next ? [] : {};
    }
    return acc[key];
  }, obj);

  target[last] = integer ? parseInt(value) : value === 'true' ? true : value === 'false' ? false : value;
  return obj;
}

function gatherChangedParameter(form, integer = false) {
  const data = {};
  for (const [path, value] of new FormData(form)) {
    deepSet(data, path, value, integer);
  }
  jsonConfigModifiedDelta = deepMergeObjects(jsonConfigModifiedDelta, data);
}

function parseCurrentParametrization(paramsKeyified) {
  for (const [key, value] of paramsKeyified) {
    const el = document.getElementById(`${key}_value`.toLowerCase());
    if (!el) continue;

    if (el.tagName === 'SELECT') {
      const valueLowerCase = String(value).toLowerCase();
      const idx = Array.from(el.options).findIndex((o) => o.value.toLowerCase() === valueLowerCase);
      if (idx >= 0) el.selectedIndex = idx;
    } else {
      el.value = value;
    }
  }
}


/* ========================================================================== */
/* Images                                                                     */
/* ========================================================================== */
// ---------------------------------------------------------------------------------------------
// Meter themes: logo, favicon and the animated scan icon follow the meter type of the MQTT settings
// (water, gas, energy, temperature, pressure, generic counter). Glyphs: 24 x 24 grid, drawn with round line caps.
// ---------------------------------------------------------------------------------------------
// BEGIN METER THEMES (generated by tools/webui/make_icons.py)
const METER_THEMES = {
  'generic': {
    'label': 'Meter',
    'colors': [
      '#0ea5e9',
      '#2563eb'
    ],
    'primary': '#2563eb',
    'paths': [
      'M10.2 8V12.5',
      'M13.8 8V12.5',
      'M7.5 16.6H9.5',
      'M14.5 16.6H16.5'
    ],
    'circles': [
      [
        12,
        16.6,
        1.1
      ]
    ],
    'rects': [
      [
        3.5,
        3.8,
        17,
        16.4,
        3.2
      ],
      [
        6.6,
        7.6,
        10.8,
        5.4,
        1.2
      ]
    ]
  },
  'water': {
    'label': 'Water',
    'colors': [
      '#0ea5e9',
      '#2563eb'
    ],
    'primary': '#2563eb',
    'paths': [
      'M12 3C9.6 6 6 9.4 6 13.6C6 17.1 8.7 20 12 20C15.3 20 18 17.1 18 13.6C18 9.4 14.4 6 12 3Z',
      'M9.3 14.2C9.4 15.7 10.4 16.9 11.8 17.2'
    ],
    'circles': [],
    'rects': []
  },
  'gas': {
    'label': 'Gas',
    'colors': [
      '#f97316',
      '#ef4444'
    ],
    'primary': '#ea580c',
    'paths': [
      'M12 3C12.6 6.2 16.6 8 16.6 13.2C16.6 16.7 14.7 20 12 20C9.3 20 7.4 17.6 7.4 14.6C7.4 12.6 8.4 11.4 9.4 10.3C9.6 11.9 10.4 12.7 11.2 12.9C11.7 9.6 11 6 12 3Z'
    ],
    'circles': [],
    'rects': []
  },
  'energy': {
    'label': 'Energy',
    'colors': [
      '#d97706',
      '#f59e0b'
    ],
    'primary': '#d97706',
    'paths': [
      'M13.2 2.8L5.6 13.2H11.3L10.6 21.2L18.4 10.6H12.7Z'
    ],
    'circles': [],
    'rects': []
  },
  'temperature': {
    'label': 'Temperature',
    'colors': [
      '#ec4899',
      '#f43f5e'
    ],
    'primary': '#db2777',
    'paths': [
      'M10 13.3V5.5C10 4.4 10.9 3.5 12 3.5C13.1 3.5 14 4.4 14 5.5V13.3C15.2 14.1 16 15.4 16 17C16 19.2 14.2 21 12 21C9.8 21 8 19.2 8 17C8 15.4 8.8 14.1 10 13.3Z',
      'M12 9V15.6'
    ],
    'circles': [
      [
        12,
        17,
        1.3
      ]
    ],
    'rects': []
  },
  'pressure': {
    'label': 'Pressure',
    'colors': [
      '#64748b',
      '#334155'
    ],
    'primary': '#475569',
    'paths': [
      'M12 13L16.3 8.7',
      'M12 5.8V7.4',
      'M5.9 9.7L7.2 10.6',
      'M18.1 9.7L16.8 10.6',
      'M8.5 21H15.5'
    ],
    'circles': [
      [
        12,
        12.8,
        8.2
      ],
      [
        12,
        13,
        1.2
      ]
    ],
    'rects': []
  }
};
const METER_TYPE_THEME = {"0": "generic", "1": "water", "2": "water", "3": "water", "4": "water", "15": "water", "16": "water", "5": "gas", "6": "gas", "7": "energy", "8": "energy", "9": "energy", "10": "energy", "11": "temperature", "12": "temperature", "13": "pressure", "14": "pressure"};
// END METER THEMES

// Color themes of the interface (named by color). The meter type picks one (generic: blue), the setup can override it.
const COLOR_THEMES = {
  blue: { label: 'Blue (default)', primary: '#2563eb' },
  orange: { label: 'Orange', primary: '#ea580c' },
  amber: { label: 'Amber', primary: '#d97706' },
  pink: { label: 'Pink', primary: '#db2777' },
  slate: { label: 'Slate', primary: '#475569' },
};
const THEME_COLOR = { generic: 'blue', water: 'blue', gas: 'orange', energy: 'amber', temperature: 'pink', pressure: 'slate' }; // meter theme -> color theme
let meterThemeId = 'generic'; // icon theme: ALWAYS the meter type of the device
let deviceThemeId = 'generic'; // theme of the meter type
let themeOverride = ''; // color theme chosen manually in the setup ('' = no override: the colors follow the meter type)
try {
  const saved = localStorage.getItem('uiThemeOverride') || '';
  themeOverride = COLOR_THEMES[saved] ? saved : THEME_COLOR[saved] || ''; // older versions stored the meter theme
} catch (e) { }
const meterTheme = () => METER_THEMES[meterThemeId] || METER_THEMES.generic; // icons, logo, favicon, scan icon
const colorThemeId = () => (COLOR_THEMES[themeOverride] ? themeOverride : THEME_COLOR[deviceThemeId] || 'blue');

// main color of the interface: the primary color of the theme, lighter in the dark mode
const mixHex = (hex, other, amount) => {
  const c = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
  const a = c(hex);
  const b = c(other);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('');
};

// SVG elements of the glyph (to be placed inside a group with stroke attributes)
const glyphMarkup = (t) =>
  t.paths.map((d) => `<path d="${d}"/>`).join('') +
  t.circles.map((c) => `<circle cx="${c[0]}" cy="${c[1]}" r="${c[2]}"/>`).join('') +
  t.rects.map((r) => `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="${r[4]}"/>`).join('');

let logoCounter = 0;
// Doorbell style tile: gradient, radius 30 percent, white line glyph
// stateKind (favicon only): '' = no badge, otherwise a status dot in the corner ('ok', 'warn', 'error', 'paused', 'offline')
const FAVICON_DOT = { ok: '#22c55e', warn: '#f59e0b', error: '#ef4444', paused: '#94a3b8', offline: '#64748b' };
function logoSvg(themeId, size, stateKind = '') {
  const t = METER_THEMES[themeId] || METER_THEMES.generic;
  const id = `mt-g-${++logoCounter}`;
  const offline = stateKind === 'offline';
  const dot = FAVICON_DOT[stateKind]
    ? `<circle cx="50" cy="50" r="13" fill="#fff"/><circle cx="50" cy="50" r="10" fill="${FAVICON_DOT[stateKind]}"/>` +
      (stateKind === 'paused' ? '<path d="M47.5 45.5V54.5M52.5 45.5V54.5" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>' : '')
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"${size ? ` width="${size}" height="${size}"` : ''} aria-hidden="true">` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.colors[0]}"/><stop offset="1" stop-color="${t.colors[1]}"/></linearGradient></defs>` +
    `<g${offline ? ' opacity="0.45"' : ''}><rect width="64" height="64" rx="19" fill="${offline ? '#94a3b8' : `url(#${id})`}"/>` +
    `<g transform="translate(13 13) scale(1.5833)" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${glyphMarkup(t)}</g></g>${dot}</svg>`
  );
}

// Tab title badge ("(!) Dashboard | gasmeter") and favicon status dot, driven by the cycle monitor
let titleBadge = '';
let titleHost = '';
let titlePage = '';
let faviconState = '';

// Tab title: host name first (several devices in narrow tabs stay distinguishable), then the status badge and the page
function refreshTitle() {
  document.title = `${titleHost || 'AI-on-the-Edge'}${titleBadge ? ` ${titleBadge}` : ''}${titlePage ? ` | ${titlePage}` : ''}`;
}
function setTitleBadge(badge) {
  badge = badge.trim();
  if (badge === titleBadge) return;
  titleBadge = badge;
  refreshTitle();
}

// The favicon link is replaced as a whole: browsers reliably pick up a new element, but often ignore a changed href.
// The static .ico link is dropped, otherwise some browsers keep showing it instead of the SVG.
function writeFavicon(svg) {
  document.head.querySelectorAll('link[rel~="icon"]').forEach((l) => l.remove());
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.sizes = 'any';
  link.id = 'favicon-svg';
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  document.head.append(link);
}
function setFaviconState(kind) {
  if (kind === faviconState) return;
  faviconState = kind;
  writeFavicon(logoSvg(meterThemeId, 64, kind));
}

// "4 min ago" for the age of the last successful cycle [s]
function formatAgo(sec) {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return 'just now';
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${String(m % 60).padStart(2, '0')} min ago` : `${Math.floor(h / 24)} days ago`;
}

// {text, title} for the last successful cycle of an /api/status answer (ageOffset: seconds since the answer was received)
function formatLastSuccess(status, ageOffset = 0) {
  if (!status || !(status.lastSuccessSeconds >= 0)) return { text: 'none since start', title: 'No cycle completed without error since the device started' };
  const stamp = String(status.lastSuccess || '');
  const age = status.lastSuccessSeconds + ageOffset;
  let when = '';
  if (stamp.length >= 19) when = age < 86400 ? stamp.substring(11, 19) : `${stamp.substring(0, 10)} ${stamp.substring(11, 16)}`;
  return { text: when ? `${when} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${formatAgo(age)}` : formatAgo(age), title: stamp.length >= 19 ? `${stamp.substring(0, 10)} ${stamp.substring(11, 19)}` : '' };
}

const SCAN_CORNERS = 'M11 21V11h10M43 11h10v10M53 43v10H43M21 53H11V43';

// Animated scan icon (viewfinder around the glyph of the meter + scan line): loading indicator while the camera takes a picture
function buildLoaderSpinner() {
  const t = meterTheme();
  return `data:image/svg+xml;base64,${btoa(`
  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" color="${t.colors[0]}">
    <style>
      .c, .g { transform-origin: 32px 32px; }
      .c { animation: b 1.3s ease-in-out infinite; }
      .g { animation: q 1.3s ease-in-out infinite; }
      .s { animation: w 1.3s ease-in-out infinite alternate; }
      @keyframes b { 0%, 100% { transform: scale(1); } 50% { transform: scale(0.88); } }
      @keyframes q { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.12); opacity: 0.6; } }
      @keyframes w { from { transform: translateY(-18px); opacity: 0.2; } 50% { opacity: 1; } to { transform: translateY(18px); opacity: 0.2; } }
    </style>
    <g class="c" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="${SCAN_CORNERS}"/></g>
    <g class="g"><g transform="translate(18 18) scale(1.1667)" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${glyphMarkup(t)}</g></g>
    <rect class="s" x="12" y="30" width="40" height="3.5" rx="1.75" fill="currentColor"/>
  </svg>
`)}`;
}
let loaderSpinner = buildLoaderSpinner();

// Inline variant (colored by --meter-accent, animated by the .scan-icon styles)
const scanIconHtml = (size = 20) =>
  `<svg class="scan-icon" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">` +
  `<g class="scan-corners" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="${SCAN_CORNERS}"/></g>` +
  `<g class="scan-glyph"><g transform="translate(18 18) scale(1.1667)" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${glyphMarkup(meterTheme())}</g></g>` +
  '<rect class="scan-line" x="12" y="30" width="40" height="3.5" rx="1.75" fill="currentColor"/></svg>';

const MeterTheme = {
  get id() {
    return meterThemeId;
  },

  get override() {
    return themeOverride;
  },

  get deviceId() {
    return deviceThemeId;
  },

  // theme whose colors are in use
  get colorId() {
    return colorThemeId();
  },

  // manual choice in the setup: theme id or '' (no override). Stored in this browser. Only the colors change, never the icons.
  setOverride(id) {
    themeOverride = COLOR_THEMES[id] ? id : '';
    try { localStorage.setItem('uiThemeOverride', themeOverride); } catch (e) { }
    this.render();
  },

  // theme id ('water') or meter type number of the MQTT settings (5 -> 'gas'): the theme of the device (used by 'auto')
  apply(typeOrId) {
    let id = typeof typeOrId === 'number' || /^\d+$/.test(String(typeOrId)) ? METER_TYPE_THEME[Number(typeOrId)] : typeOrId;
    if (!METER_THEMES[id]) id = 'generic';
    deviceThemeId = id;
    try { localStorage.setItem('meterTheme', id); } catch (e) { }
    this.render();
  },

  render() {
    const id = deviceThemeId;
    meterThemeId = id;

    const t = meterTheme(); // icons
    const ct = COLOR_THEMES[colorThemeId()]; // colors of the interface
    const root = document.documentElement;
    root.style.setProperty('--meter-accent', t.colors[0]);
    root.style.setProperty('--theme-primary', ct.primary);
    root.style.setProperty('--theme-primary-dark', mixHex(ct.primary, '#ffffff', 0.32));
    root.dataset.meter = id;
    const logo = document.getElementById('brand-logo');
    if (logo) logo.innerHTML = logoSvg(id);
    writeFavicon(logoSvg(id, 64, faviconState));
    const scan = document.getElementById('cycle-scan');
    if (scan) scan.innerHTML = scanIconHtml(20);
    loaderSpinner = buildLoaderSpinner();
    window.dispatchEvent(new CustomEvent('meter-theme', { detail: { id, color: colorThemeId(), device: deviceThemeId } }));
  },

  applyFromConfig() {
    try {
      const type = getConfigFromStorage(0)?.mqtt?.homeassistant?.metertype;
      if (type !== undefined && type !== null) this.apply(Number(type));
    } catch (e) { }
  },
};

const noImageAvailable = `data:image/svg+xml;utf8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
    <rect width="400" height="300" fill="#f0f0f0" rx="10"/>
    <g stroke="#999" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <rect x="150" y="80" width="100" height="80" rx="4" />
      <path d="M150 140 L180 110 L210 140 L230 120 L250 150" />
      <circle cx="220" cy="105" r="5" fill="#999" stroke="none" />
    </g>
    <text x="200" y="220" font-family="sans-serif" font-size="22" fill="#666" text-anchor="middle" font-weight="bold">
      No Image Available
    </text>
  </svg>
`)}`;

// Loads url; falls back to altUrl on error/abort/10s timeout
function loadImage(url, altUrl) {
  const img = new Image();
  let timer;

  const fallback = () => {
    clearTimeout(timer);
    img.onload = img.onabort = img.onerror = null;
    img.src = altUrl;
  };

  img.onerror = img.onabort = fallback;
  img.onload = () => clearTimeout(timer);
  img.src = url;
  timer = setTimeout(fallback, 15000);
  return img;
}


/* ========================================================================== */
/* Dialogs + save bar (shared by all pages)                                   */
/* ========================================================================== */

/**
 * Modal confirmation (replaces window.confirm).
 * @param {{title?: string, text?: string, okLabel?: string, cancelLabel?: string, danger?: boolean}} opts
 * @returns {Promise<boolean>} true = confirmed
 */
function confirmDialog({ title = 'Are you sure?', text = '', okLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg';

    const body = document.createElement('div');
    body.className = 'dlg-body';
    const h = document.createElement('h2');
    h.textContent = title;
    body.append(h);
    if (text) {
      const p = document.createElement('p');
      p.textContent = text;
      body.append(p);
    }

    const actions = document.createElement('div');
    actions.className = 'dlg-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button ghost';
    cancel.textContent = cancelLabel;
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'button ' + (danger ? 'danger-solid' : 'btn-action');
    ok.textContent = okLabel;
    actions.append(cancel, ok);
    body.append(actions);
    dlg.append(body);

    // Settle right when the user decides. Waiting for the 'close' event alone is not reliable
    // (it can be delayed or missing, e.g. in frames that are not rendered), the event only covers Esc.
    let result = false;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(result);
    };
    ok.onclick = () => {
      result = true;
      settle();
    };
    cancel.onclick = settle;
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) settle(); // backdrop
    });
    dlg.addEventListener('close', settle);

    document.body.append(dlg);
    dlg.showModal();
    (danger ? cancel : ok).focus();
  });
}

/**
 * Copy button that shows its result without changing size: all three texts (label, "Copied" with a check mark, "Copy failed") are
 * stacked in one grid cell, so the button always has the width of the widest one and only the visible one changes.
 */
function prepareCopyButton(btn) {
  if (btn.querySelector('.btn-states')) return btn;
  const label = btn.textContent;
  const wrap = document.createElement('span');
  wrap.className = 'btn-states';
  wrap.dataset.state = 'label';
  const mk = (state, ...nodes) => {
    const el = document.createElement('span');
    el.dataset.s = state;
    el.append(...nodes);
    return el;
  };
  const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  check.setAttribute('viewBox', '0 0 24 24');
  check.setAttribute('class', 'copy-check');
  check.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
  check.append(path);
  wrap.append(mk('label', label), mk('ok', check, 'Copied'), mk('fail', 'Copy failed'));
  btn.textContent = '';
  btn.append(wrap);
  return btn;
}

/** Copies text and shows the result on the button for a moment: green with a check mark, or "Copy failed" if the browser refused. */
async function copyWithFeedback(btn, text) {
  prepareCopyButton(btn);
  const wrap = btn.querySelector('.btn-states');
  clearTimeout(btn._copyTimer);
  let ok = true;
  try { await navigator.clipboard.writeText(text); } catch (e) { ok = false; }
  btn.classList.toggle('is-copied', ok);
  wrap.dataset.state = ok ? 'ok' : 'fail';
  btn._copyTimer = setTimeout(() => {
    btn.classList.remove('is-copied');
    wrap.dataset.state = 'label';
  }, 1800);
}

/**
 * Modal that shows a secret once (e.g. a new access token): the value, copy buttons, a single close button.
 * The value only lives in this dialog and is gone when it is closed.
 * @param {{title?: string, text?: string, token: string, copies?: Array<{label: string, text: string}>, closeLabel?: string}} opts
 * @returns {Promise<void>} resolves when the dialog is closed
 */
function tokenDialog({ title = 'Access token', text = '', token, copies = [], closeLabel = 'Done' } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg dlg-token';
    const body = document.createElement('div');
    body.className = 'dlg-body';
    const h = document.createElement('h2');
    h.textContent = title;
    body.append(h);
    if (text) {
      const p = document.createElement('p');
      p.textContent = text;
      body.append(p);
    }
    const code = document.createElement('code');
    code.className = 'dlg-code';
    code.textContent = token;
    body.append(code);

    const buttons = document.createElement('div');
    buttons.className = 'dlg-copies';
    for (const item of [{ label: 'Copy token', text: token }, ...copies]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'button';
      b.textContent = item.label;
      b.onclick = () => copyWithFeedback(b, item.text);
      prepareCopyButton(b);
      buttons.append(b);
    }
    body.append(buttons);

    const actions = document.createElement('div');
    actions.className = 'dlg-actions';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'button btn-action';
    close.textContent = closeLabel;
    actions.append(close);
    body.append(actions);
    dlg.append(body);

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve();
    };
    close.onclick = settle;
    dlg.addEventListener('close', settle);
    // no backdrop click: the value must not vanish by accident before it was copied
    document.body.append(dlg);
    dlg.showModal();
    close.focus();
  });
}

/**
 * Modal text input (replaces window.prompt).
 * @returns {Promise<string|null>} entered text, null if cancelled
 */
function promptDialog({ title = 'Enter a value', text = '', value = '', okLabel = 'OK', cancelLabel = 'Cancel', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg';

    const body = document.createElement('div');
    body.className = 'dlg-body';
    const h = document.createElement('h2');
    h.textContent = title;
    body.append(h);
    if (text) {
      const p = document.createElement('p');
      p.textContent = text;
      body.append(p);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    body.append(input);

    const actions = document.createElement('div');
    actions.className = 'dlg-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button ghost';
    cancel.textContent = cancelLabel;
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'button btn-action';
    ok.textContent = okLabel;
    actions.append(cancel, ok);
    body.append(actions);
    dlg.append(body);

    let result = null;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(result);
    };
    const submit = () => {
      result = input.value;
      settle();
    };
    ok.onclick = submit;
    cancel.onclick = settle;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) settle();
    });
    dlg.addEventListener('close', settle);

    document.body.append(dlg);
    dlg.showModal();
    input.focus();
    input.select();
  });
}

/**
 * Save bar: appears at the bottom only while there are unsaved changes.
 *   SaveBar.set({ dirty, saveLabel, text, onSave, onDiscard })   (all optional)
 *   SaveBar.busy(true|false)                                    (disables the buttons while saving)
 */
const SaveBar = (() => {
  let bar = null;
  let textEl = null;
  let discardBtn = null;
  let saveBtn = null;
  let handlers = { onSave: null, onDiscard: null };

  function ensure() {
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'savebar';
    bar.hidden = true;

    textEl = document.createElement('span');
    textEl.className = 'savebar-text';
    textEl.textContent = 'Unsaved changes';

    const actions = document.createElement('span');
    actions.className = 'savebar-actions';
    discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = 'button ghost';
    discardBtn.textContent = 'Discard';
    discardBtn.onclick = () => handlers.onDiscard?.();
    saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'button btn-action';
    saveBtn.textContent = 'Save';
    saveBtn.onclick = () => handlers.onSave?.();
    actions.append(discardBtn, saveBtn);

    bar.append(textEl, actions);
    document.body.append(bar);
  }

  return {
    set({ dirty = true, saveLabel, text, discardLabel, onSave, onDiscard } = {}) {
      ensure();
      if (onSave) handlers.onSave = onSave;
      if (onDiscard) handlers.onDiscard = onDiscard;
      if (saveLabel) saveBtn.textContent = saveLabel;
      if (discardLabel) discardBtn.textContent = discardLabel;
      if (text) textEl.textContent = text;
      discardBtn.hidden = !handlers.onDiscard;
      bar.hidden = !dirty;
      document.documentElement.classList.toggle('has-savebar', !!dirty);
    },
    busy(flag) {
      ensure();
      discardBtn.disabled = !!flag;
      saveBtn.disabled = !!flag;
    },
    isVisible() {
      return !!bar && !bar.hidden;
    },
  };
})();


/* ========================================================================== */
/* Core                                                                       */
/* ========================================================================== */

/* ========================================================================== */
/* Core: Api, App (theme, router, navigation)                                 */
/* ========================================================================== */

/**
 * Loads a script once (used for rarely needed libraries such as fflate).
 * @param {string} url
 * @returns {Promise<void>}
 */
const loadScript = (() => {
  const cache = new Map();
  return (url) => {
    if (!cache.has(url)) {
      cache.set(
        url,
        new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = url;
          s.onload = () => resolve();
          s.onerror = () => {
            cache.delete(url);
            reject(new Error(`Failed to load ${url}`));
          };
          document.head.append(s);
        }),
      );
    }
    return cache.get(url);
  };
})();

/**
 * Backend access. The views only know the domain objects (Api.system, Api.files, Api.ota, Api.process,
 * Api.setup, Api.config, ...). They are defined next to the view that needs them and translate the
 * firmware endpoints to clean data. Phase 2 moves the firmware to JSON /api/* endpoints, only the
 * Api objects change then.
 */
const Api = {
  /** GET without toast. @returns {Promise<ApiResult>} */
  get: (endpoint, parseType = 'text', init = {}) => apiCall(endpoint, init, { parseType }),

  /** POST with toast on failure. body: string | Blob | FormData | plain object (sent as JSON) */
  post: (endpoint, body, notify = {}, init = {}) => {
    const isPlain = isObj(body) && !(body instanceof Blob) && !(body instanceof FormData) && !(body instanceof ArrayBuffer);
    const headers = isPlain ? { 'Content-Type': 'application/json', ...init.headers } : init.headers;
    return apiCallNotify(endpoint, { ...init, method: 'POST', headers, body: isPlain ? JSON.stringify(body) : body }, notify);
  },
};

/** MCP server of the device (optional): state and access token. GET/POST /api/mcp */
Api.mcp = {
  /** @returns {Promise<null | {enabled:boolean, allowSystem:boolean, tokenSet:boolean, endpoint:string}>} null: firmware without MCP */
  async get() {
    const res = await apiCall('/api/mcp', { timeout: 8000 }, { parseType: 'json' });
    return res.ok && res.data && res.data.ok ? res.data : null;
  },
  /** change: {enabled?, allowSystem?, regenerate?}. A new token is only in this answer (field `token`), the device keeps just its hash */
  async set(change) {
    const res = await Api.post('/api/mcp', change, { action: 'MCP settings' });
    if (!res.ok) return null;
    let d = res.data;
    try { if (typeof d === 'string') d = JSON.parse(d); } catch (e) { d = null; }
    return d && d.ok ? d : null;
  },
};


/* ========================================================================== */
/* App                                                                        */
/* ========================================================================== */

const App = (() => {
  const views = new Map();
  const themeListeners = new Set();
  let current = null; // { key, view, ctx }
  let hostname = '';

  const hostEl = () => document.getElementById('view');

  /* ---------------------------------------------------------- DOM helpers */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // Parses a trusted HTML string, returns the first element (or a fragment if there are several)
  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.childElementCount === 1 ? t.content.firstElementChild : t.content;
  }

  /* ----------------------------------------------------------------- theme */
  const systemPrefersDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

  function themeMode() {
    let mode = null;
    try { mode = localStorage.getItem('theme'); } catch (e) { }
    return mode === 'light' || mode === 'dark' ? mode : 'auto';
  }

  function setTheme(mode) {
    const dark = mode === 'auto' ? systemPrefersDark() : mode === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);

    try {
      if (mode === 'auto') localStorage.removeItem('theme');
      else localStorage.setItem('theme', mode);
    } catch (e) { }

    // Firmware generated pages read the cookie
    if (mode === 'auto') document.cookie = 'theme=;path=/;max-age=0;SameSite=Lax';
    else document.cookie = `theme=${mode};path=/;max-age=${60 * 60 * 24 * 400};SameSite=Lax`;

    document.querySelectorAll('.theme-seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    themeListeners.forEach((fn) => {
      try { fn(dark); } catch (e) { console.error(e); }
    });
  }

  function onThemeChange(fn) {
    themeListeners.add(fn);
    return () => themeListeners.delete(fn);
  }

  /* ---------------------------------------------------------------- router */
  function register(name, view) {
    views.set(name, view);
  }

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs = ''] = raw.split('?');
    const segs = path.split('/').filter(Boolean).map(decodeURIComponent);

    let key = segs[0] || 'dashboard';
    let parts = segs.slice(1);
    if (key === 'system') {
      key = `system-${segs[1] || 'info'}`;
      parts = segs.slice(2);
    }
    // links of earlier versions: #/setup[/tab] is now #/config, the old configuration sections moved to #/system/setup
    if (key === 'recognition') key = 'dashboard'; // the results are part of the dashboard
    if (key === 'setup') key = 'config';
    else if (key === 'config' && ['general', 'network', 'recognition', 'mqtt', 'camera', 'gpio'].includes(parts[0])) key = 'system-setup';
    if (!views.has(key)) {
      key = 'dashboard';
      parts = [];
    }
    return { key, parts, query: new URLSearchParams(qs), route: location.hash || '#/dashboard' };
  }

  // Which sidebar entry is highlighted for a view
  const navKeyOf = (key) => (key === 'wizard' ? 'config' : key);

  function updateNav(key) {
    const navKey = navKeyOf(key);
    let activeGroup = null;
    document.querySelectorAll('[data-route]').forEach((node) => {
      const on = node.dataset.route === navKey;
      node.classList.toggle('active', on);
      if (on) activeGroup = node.closest('.nav-group');
    });
    document.querySelectorAll('.nav-group').forEach((g) => g.classList.toggle('open', g === activeGroup));
  }

  function setTitle(title) {
    const t = title || 'AI-on-the-Edge';
    titleHost = hostname;
    titlePage = t;
    refreshTitle();
    const bar = document.getElementById('topbar-title');
    if (bar) bar.textContent = hostname || t;
  }

  function unmountCurrent() {
    if (!current) return;
    try {
      current.view.unmount?.();
    } catch (e) {
      console.error(`Unmounting view '${current.key}' failed`, e);
    }
    SaveBar.set({ dirty: false });
    current = null;
  }

  function mount(ctx) {
    const view = views.get(ctx.key);
    unmountCurrent();

    const root = hostEl();
    root.textContent = '';
    const section = el('section', `view view-${ctx.key}`);
    root.append(section);
    document.querySelector('.content')?.scrollTo(0, 0);

    current = { key: ctx.key, view, ctx };
    setTitle(view.title);
    updateNav(ctx.key);
    document.getElementById('app')?.classList.toggle('wizard-mode', ctx.key === 'wizard'); // the wizard has the whole screen: no menu

    try {
      view.mount(section, ctx);
    } catch (e) {
      console.error(`Mounting view '${ctx.key}' failed`, e);
      section.append(h(`<div class="container"><div class="warning-box"><strong>This page failed to load.</strong> ${esc(e.message)}</div></div>`));
    }
  }

  // A device in operation mode "Setup" shows the wizard only: every other route leads back to it until the setup is left
  let setupLeft = false;
  const inSetupMode = () => {
    if (setupLeft) return false;
    try {
      return Number(getConfigFromStorage()?.operationmode?.opmode) === -1;
    } catch (e) {
      return false;
    }
  };

  function onRoute() {
    let ctx = parseHash();
    if (ctx.key !== 'wizard' && inSetupMode()) {
      history.replaceState(null, '', '#/wizard');
      ctx = parseHash();
    }
    if (current && current.key === ctx.key && typeof current.view.route === 'function') {
      current.ctx = ctx; // same view, only the sub route changed
      current.view.route(ctx);
      return;
    }
    mount(ctx);
  }

  function navigate(hash) {
    const target = hash.startsWith('#') ? hash : `#${hash}`;
    if (location.hash === target) {
      onRoute();
      return;
    }
    location.hash = target; // fires hashchange -> onRoute
  }

  /* ------------------------------------------------------------- shell UI */
  const closeNav = () => document.getElementById('app')?.classList.remove('nav-open');
  const toggleNav = () => document.getElementById('app')?.classList.toggle('nav-open');

  function bindShell() {
    document.querySelectorAll('.theme-seg button').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.mode)));
    document.getElementById('nav-toggle')?.addEventListener('click', toggleNav);
    document.getElementById('nav-scrim')?.addEventListener('click', closeNav);

    // Floating menu button (narrow screens): hidden while scrolling down, back after scrolling up a little (not only at the top)
    const content = document.querySelector('.content');
    const topbar = document.querySelector('.topbar');
    if (content && topbar) {
      let lastY = content.scrollTop;
      let upDistance = 0;
      content.addEventListener('scroll', () => {
        const y = content.scrollTop;
        const dy = y - lastY;
        lastY = y;
        if (y < 48) {
          topbar.classList.remove('is-hidden'); // at the top
          upDistance = 0;
        } else if (dy > 0) {
          upDistance = 0;
          topbar.classList.add('is-hidden');
        } else if (dy < 0) {
          upDistance -= dy;
          if (upDistance > 36) topbar.classList.remove('is-hidden'); // a short scroll up is enough
        }
      }, { passive: true });
    }

    // Accordion: one group open at a time
    document.querySelectorAll('.nav-parent').forEach((btn) =>
      btn.addEventListener('click', () => {
        const group = btn.closest('.nav-group');
        const willOpen = !group.classList.contains('open');
        document.querySelectorAll('.nav-group').forEach((g) => g.classList.remove('open'));
        group.classList.toggle('open', willOpen);
      }),
    );

    document.querySelectorAll('[data-route]').forEach((btn) => {
      if (btn.classList.contains('nav-parent')) return;
      btn.addEventListener('click', (e) => {
        // the entries are real links: middle click, Ctrl/Shift/Cmd + click and the context menu open a new tab / window
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(btn.dataset.href);
        closeNav();
      });
    });

    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (themeMode() === 'auto') setTheme('auto');
    });
  }

  async function loadDeviceInfo() {
    const info = await Api.system.infoAll(); // GET /info (JSON)
    if (!info) return;

    if (info.hostname) {
      hostname = String(info.hostname).trim();
      const name = document.getElementById('device-name');
      if (name) name.textContent = hostname;
      setTitle(current?.view.title);
    }
    const label = document.getElementById('fw-version');
    if (label && info.firmware_version) label.textContent = info.firmware_version;
    if (info.firmware_version) UpdateHint.check(info.firmware_version);

    const fw = info.firmware_version;
    const ui = info.html_version;
    if (fw && ui && !String(ui).startsWith('?') && fw !== ui) {
      firework.launch(
        "Web interface version does not match the firmware version. It's strongly advised to use matching version. Check logs for more details.",
        'warning',
        10000,
      );
    }
  }

  async function start() {
    setTheme(themeMode());
    bindShell();
    window.addEventListener('hashchange', onRoute);

    loadDeviceInfo().catch((e) => console.error('Failed to load device info', e));

    // The config is cached in sessionStorage for the views. A device in operation mode 'Setup' opens the wizard
    // when the page is called without a route (this replaces the former firmware redirect to setup.html).
    let storedTheme = 'generic';
    try { storedTheme = localStorage.getItem('meterTheme') || 'generic'; } catch (e) { }
    MeterTheme.apply(storedTheme); // last known theme, no flash while the config loads
    const configLoaded = loadConfig().then(() => MeterTheme.applyFromConfig()).catch((e) => console.error('Failed to load config', e));
    await configLoaded; // the route decides with the operation mode (setup: wizard only)
    if (!location.hash) {
      let setupMode = false;
      try { setupMode = Number(getConfigFromStorage()?.operationmode?.opmode) === -1; } catch (e) { }
      history.replaceState(null, '', setupMode ? '#/wizard' : '#/dashboard');
    }
    onRoute();
  }

  return { register, navigate, go: navigate, leaveSetup() { setupLeft = true; }, theme: { mode: themeMode, set: setTheme }, onThemeChange, el, h, esc, start };
})();


/* ========================================================================== */
/* Docs tooltips (parameter help from tooltips.json, trigger: .tooltip-trigger[data-help]) */
/* ========================================================================== */

(function () {
  let helpData = null;
  let showTimeout;
  let hideTimeout;
  let portal;
  let showToken = 0;

  // Initialization: Create portal if it doesn't exist
  function initPortal() {
    // If portal variable is set AND it's actually in the body, stop here.
    if (portal && document.getElementById('tooltip-portal')) return;

    // Otherwise, create it
    portal = document.createElement('div');
    portal.id = 'tooltip-portal';
    portal.classList.add('rst-content', 'tooltiptext');

    // Apply critical base styles via JS to ensure it works even if CSS loads late
    Object.assign(portal.style, { position: 'fixed', zIndex: '99999', display: 'none', pointerEvents: 'auto' });

    document.body.appendChild(portal);
  }

  async function getHelp(key) {
    if (!helpData) {
      const res = await apiCall('/tooltips.json', {}, { parseType: 'json' });

      if (!res.ok) {
        const corrupted = res.status >= 200 && res.status < 300;
        console.error('Failed to load tooltips.json | ', corrupted ? res.data : (res.error ?? res.status));
        return corrupted ? 'Error: Tooltip data is corrupted' : `Error ${res.error ?? res.status}: Could not load tooltip`;
      }

      if (!res.data) return 'Error: Tooltip data is corrupted'; // empty body parses to null
      helpData = res.data;
    }

    return helpData[key] || 'No description found for: ' + key;
  }

  function positionTooltip(trigger) {
    const rect = trigger.getBoundingClientRect();

    let left = rect.right - portal.offsetWidth - 25;
    let top = rect.bottom + 5;

    if (left < 10) left = rect.right + 5;

    // Clamp left position to stay within the viewport bounds
    const maxLeft = window.innerWidth - portal.offsetWidth - 10;
    left = Math.max(10, Math.min(left, maxLeft));

    if (top + portal.offsetHeight > window.innerHeight) {
      top = rect.top - portal.offsetHeight - 5;
    }

    if (top < 0) top = 5;

    portal.style.left = left + 'px';
    portal.style.top = top + 'px';
  }

  // Global Listeners
  document.addEventListener('mouseover', async (e) => {
    const trigger = e.target.closest('.tooltip-trigger');
    const onPortal = e.target.closest('#tooltip-portal');

    if (trigger || onPortal) {
      clearTimeout(hideTimeout);
      initPortal();

      if (trigger) {
        showTimeout = setTimeout(async () => {
          const token = ++showToken;
          const key = trigger.getAttribute('data-help');
          const html = await getHelp(key);

          // If token changed (mouse left or new hover started), discard result
          if (token !== showToken) return;

          portal.innerHTML = html;
          portal.style.display = 'block';
          portal.style.visibility = 'hidden';

          requestAnimationFrame(() => {
            positionTooltip(trigger);
            portal.style.visibility = 'visible';
          });
        }, 500);
      }
    }
  });

  document.addEventListener('mouseout', (e) => {
    const toElement = e.relatedTarget;
    showToken++;
    clearTimeout(hideTimeout);
    clearTimeout(showTimeout);

    if (toElement && (toElement.closest('#tooltip-portal') || toElement.closest('.tooltip-trigger'))) {
      return;
    }

    hideTimeout = setTimeout(() => {
      showToken++;
      if (portal) {
        portal.style.display = 'none';
        portal.style.visibility = 'hidden';
      }
    }, 100);
  });
})();

/* ========================================================================== */
/* View: system                                                               */
/* ========================================================================== */

/* ==========================================================================
   System area: views system-info, system-update, system-backup, system-files, system-mcp, system-reboot
   Api layer:   Api.system, Api.files, Api.ota
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------------ */
  /* Shared helpers                                                           */
  /* ------------------------------------------------------------------------ */

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const esc = (text) => App.esc(text);
  const pad2 = (n) => String(n).padStart(2, '0');

  const describeError = (res) => [res.error ?? `HTTP ${res.status}`, plainTextSnippet(res.data)].filter(Boolean).join(' | ');

  // Collect all elements carrying data-r="name" into { name: element }
  function collectRefs(root) {
    const refs = {};
    root.querySelectorAll('[data-r]').forEach((node) => {
      refs[node.dataset.r] = node;
    });
    return refs;
  }

  function timestampNow() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`;
  }

  function downloadBlob(data, filename, type = 'application/zip') {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // After a reboot or an update the app is reloaded from scratch and opens the dashboard
  function reloadApp() {
    App.leaveSetup();
    window.location.hash = '#/dashboard';
    window.location.reload();
  }

  function pickSize(n) {
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  function listSize(n) {
    if (n === null || n === undefined) return '-';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }

  // encode every path segment but keep the slashes
  const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

  // XMLHttpRequest as promise (needed for upload progress and timeout extension). Never rejects.
  function xhrRequest(method, url, { body = null, onUpload, onDownload, timeout = 0, responseType = '' } = {}) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.withCredentials = true;
      if (responseType) xhr.responseType = responseType;
      if (timeout) xhr.timeout = timeout;
      if (onUpload) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) onUpload(e.loaded, e.total);
        });
      }
      if (onDownload) xhr.addEventListener('progress', () => onDownload(xhr));

      const finish = (type) =>
        resolve({
          type,
          status: xhr.status,
          statusText: xhr.statusText,
          ok: type === 'load' && xhr.status >= 200 && xhr.status < 300,
          text: responseType ? '' : xhr.responseText || '',
          response: xhr.response,
        });
      xhr.addEventListener('load', () => finish('load'));
      xhr.addEventListener('error', () => finish('network'));
      xhr.addEventListener('abort', () => finish('abort'));
      xhr.addEventListener('timeout', () => finish('timeout'));
      xhr.send(body);
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Api.system                                                               */
  /* ------------------------------------------------------------------------ */

  Api.system = {
    // GET /info?type=<type> (legacy: plain text value). Toast on error, returns string or null
    async info(type, label = type) {
      const res = await apiCallNotify(`/info?type=${type}`, {}, { action: `Loading ${label}` });
      return res.ok ? String(res.data).trim() : null;
    },

    // Same without toast, throws Error with a description
    async infoQuiet(type) {
      const res = await apiCall(`/info?type=${type}`);
      if (!res.ok) throw new Error(describeError(res));
      return String(res.data).trim();
    },

    // GET /info (JSON object with all device values) or null
    async infoAll() {
      const res = await apiCallNotify('/info', {}, { action: 'Loading info', parseType: 'json' });
      return res.ok && res.data ? res.data : null;
    },

    // GET /coredump?task=show|clear -> { ok, text }
    async coreDump(task) {
      const res = await apiCallNotify(`/coredump?task=${task}`, {}, {
        action: 'Core dump request',
        httpObj: { 404: 'Core dump request failed. Status: 404 - Not found' },
      });
      return { ok: res.ok, text: res.ok ? String(res.data) : '' };
    },

    coreDumpSaveUrl() {
      return getDomainname() + '/coredump?task=save';
    },

    // POST /api/reboot -> true when the device accepted the request
    async reboot() {
      const res = await Api.post('/api/reboot', undefined, { action: 'Reboot request' });
      return res.ok;
    },
  };

  /* ------------------------------------------------------------------------ */
  /* Api.files                                                                */
  /*   GET /fileserver<dir>/?format=json[&full=true] (server_file.cpp):       */
  /*   {path, truncated, entries:[{name, isDir, size, protected}]}            */
  /* ------------------------------------------------------------------------ */

  Api.files = {
    // dirPath: '/config/models/' (leading and trailing slash). Throws Error on failure.
    // Returns [{ name, isDir, size, path, protected }], array property `truncated` is true for a cut listing
    async list(dirPath, { all = false } = {}) {
      const res = await apiCall(`/fileserver${encodePath(dirPath)}?format=json&full=${all ? 'true' : 'false'}`, { timeout: 30000 }, { parseType: 'json' });
      if (!res.ok || !res.data) {
        const err = new Error(describeError(res));
        err.status = res.status;
        throw err;
      }
      const entries = res.data.entries.map((e) => ({
        name: e.name,
        isDir: e.isDir,
        size: e.isDir ? null : e.size, // bytes, null for directories
        path: dirPath + e.name, // no trailing slash, also for directories
        protected: e.protected, // root folders that cannot be deleted
      }));
      entries.truncated = !!res.data.truncated; // the device cuts the listing at 100 items unless full=true
      return entries;
    },

    // Recursive file list (no directories) below dirPath: [{ name, size, path }]
    async listRecursive(dirPath) {
      const result = [];
      const entries = await this.list(dirPath, { all: true });
      for (const entry of entries) {
        if (entry.isDir) result.push(...(await this.listRecursive(entry.path + '/')));
        else result.push(entry);
      }
      return result;
    },

    // Absolute URL to download/open a file, path: '/config/config.json'
    downloadUrl(path) {
      return getDomainname() + '/fileserver' + encodePath(path);
    },

    // Read a file as Uint8Array. The timeout is extended while data arrives. Throws Error(reason)
    async read(path, { timeout = 15000 } = {}) {
      const res = await xhrRequest('GET', this.downloadUrl(path), {
        responseType: 'arraybuffer',
        timeout,
        onDownload: (xhr) => {
          xhr.timeout += 500;
        },
      });
      if (res.type === 'network') throw new Error('network error');
      if (res.type === 'timeout') throw new Error('timeout');
      if (res.type === 'abort') throw new Error('aborted');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(res.response);
    },

    // POST /upload<path>?overwrite=true -> { ok, message }
    async upload(path, file, onProgress) {
      const res = await xhrRequest('POST', getDomainname() + '/upload' + encodePath(path) + '?overwrite=true', {
        body: file,
        timeout: 120000,
        onUpload: (loaded, total) => onProgress?.(Math.round((loaded / total) * 100)),
      });
      if (res.ok) return { ok: true, message: '' };
      if (res.type === 'load') {
        const detail = res.text.trim().split('\n')[0].slice(0, 80);
        return { ok: false, message: detail || `Failed (HTTP ${res.status})` };
      }
      return { ok: false, message: res.type === 'timeout' ? 'Timed out' : 'Network error' };
    },

    // POST /delete<path>[?task=deldir] with toasts -> true when deleted
    async remove(path, isDir = false) {
      const res = await apiCallNotify('/delete' + encodePath(path) + (isDir ? '?task=deldir' : ''), {
        method: 'POST',
        timeout: isDir ? 120000 : 20000,
      }, {
        action: 'Deletion',
        loadingMsg: isDir ? 'Deleting folder. Please wait...' : 'Deleting file...',
      });
      return res.ok;
    },
  };

  /* ------------------------------------------------------------------------ */
  /* Api.ota                                                                  */
  /* ------------------------------------------------------------------------ */

  const uploadMessage = (res) => (res.text.trim().length > 0 ? res.text.trim() : `HTTP ${res.status} ${res.statusText || ''}`.trim());

  Api.ota = {
    // GitHub (asked by the browser, not by the device): latest release or null when none is published. Throws on error
    async latestRelease(repo) {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store',
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
      const rel = await res.json();
      return {
        tag: rel.tag_name,
        htmlUrl: rel.html_url,
        assets: (rel.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
      };
    },

    // POST /api/update {url} (the device downloads the package) -> { ok, unsupported, message }
    async selfUpdate(url) {
      const res = await apiCall('/api/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      if (res.ok) return { ok: true, unsupported: false, message: '' };
      const detail = plainTextSnippet(res.data) || `HTTP ${res.status ?? 'error'}`;
      return { ok: false, unsupported: res.status === 404 || res.status === 405, message: detail }; // old firmware has no /api/update
    },

    // GET /api/update/status -> { state, percent, message } or null (device not reachable, e.g. restarting)
    async selfUpdateStatus() {
      const res = await apiCall('/api/update/status', { timeout: 4000 }, { parseType: 'json' });
      return res.ok && res.data ? res.data : null;
    },

    // POST /ota/<name> (package or backup ZIP) -> { ok } or { ok:false, type:'http'|'response'|'network'|'abort', message }
    async upload(file, onProgress) {
      const res = await xhrRequest('POST', getDomainname() + '/ota/' + encodeURIComponent(file.name), {
        body: file,
        onUpload: (loaded, total) => onProgress?.(loaded, total),
      });
      if (res.type === 'load') {
        if (!res.ok) return { ok: false, type: 'http', message: uploadMessage(res) };
        if (!res.text.startsWith('success')) return { ok: false, type: 'response', message: res.text.trim() || 'Unexpected server response' };
        return { ok: true };
      }
      if (res.type === 'abort') return { ok: false, type: 'abort', message: 'Upload aborted' };
      return { ok: false, type: 'network', message: 'Network error' };
    },

    // @Deprecated: Remove legacy OTA support once old API versions are no longer supported
    // true when the device runs the old OTA handler (rejects the unknown task with 400)
    async hasLegacyApi() {
      try {
        const response = await fetch(getDomainname() + '/ota?task=api_check', { method: 'GET', credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(2000) });
        return response.status === 400;
      } catch {
        return false; // device unreachable, API version unknown
      }
    },

    // @Deprecated: Legacy OTA fallback (firmware downgrades). Prepare, upload, process and reboot.
    // onPhase(text) gets the status text, onProgress(loaded, total) the upload progress.
    // -> { ok } or { ok:false, type:'prepare'|'process'|'http'|'network'|'abort', message }
    async legacyInstall(file, { onPhase, onProgress } = {}) {
      const base = getDomainname();

      onPhase?.('Preparing device...');
      const prep = await xhrRequest('GET', base + '/ota?task=emptyfirmwaredir');
      if (!prep.ok) {
        const message = prep.status === 0 ? 'Server closed the connection abruptly' : 'An error occurred: ' + prep.text;
        return { ok: false, type: 'prepare', message };
      }
      await xhrRequest('POST', base + '/delete/.ota_staged/?task=deldir'); // result does not matter

      onPhase?.('Uploading...');
      const up = await xhrRequest('POST', base + '/upload/firmware/' + encodeURIComponent(file.name), { body: file, onUpload: onProgress });
      if (!up.ok) {
        if (up.type === 'load') return { ok: false, type: 'http', message: uploadMessage(up) };
        if (up.type === 'abort') return { ok: false, type: 'abort', message: 'Upload aborted' };
        return { ok: false, type: 'network', message: 'Network error (Legacy API)' };
      }

      onPhase?.('Processing on device...');
      const proc = await xhrRequest('GET', base + '/ota?task=update&file=' + encodeURIComponent(file.name));
      if (!proc.ok) {
        const message = proc.status >= 400 ? 'An error occurred: ' + proc.text : 'Server closed the connection abruptly';
        return { ok: false, type: 'process', message };
      }
      if (!proc.text.startsWith('reboot')) return { ok: false, type: 'process', message: 'Unexpected server response' };

      xhrRequest('GET', base + '/reboot'); // fire and forget
      return { ok: true };
    },

    // Waits until the device answers again after a restart/update.
    // -> 'online' | 'timeout' | 'cancelled'
    async rebootAndWait({ interval = 2500, firstPollAfter = 8000, timeout = 120000, onTick, cancelled } = {}) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        await sleep(interval);
        if (cancelled?.()) return 'cancelled';
        const elapsed = Date.now() - start;
        onTick?.(elapsed);
        if (elapsed < firstPollAfter) continue; // start polling after ~8 seconds
        const res = await apiCall('/index.html', { timeout: 2000 });
        if (res.ok) return 'online';
      }
      return 'timeout';
    },
  };

  /* ------------------------------------------------------------------------ */
  /* Shared UI: file picker (drop zone) used by Update and Backup             */
  /* ------------------------------------------------------------------------ */

  function pickerHtml({ title, sub, label, accept }) {
    return `
      <div class="pick" data-r="pickZone" tabindex="0" role="button" aria-label="${esc(label)}">
        <div class="pick-icon"></div>
        <div class="pick-title">${esc(title)}</div>
        <div class="pick-sub">${sub}</div>
      </div>
      <input type="file" accept="${esc(accept)}" data-r="fileSelector" hidden />
      <div class="file-row" data-r="fileInfo" hidden>
        <div class="fi"></div>
        <div class="fn"><b data-r="fileName"></b><span data-r="fileSize"></span></div>
        <span class="badge" data-r="fileBadge"></span>
        <button class="button" type="button" data-r="fileClear" data-action="clear-file">Remove</button>
      </div>`;
  }

  // refs: collectRefs() of the view. onChange(): called when a file was chosen or dropped
  function setupPicker(r, onChange) {
    const zone = r.pickZone;
    const input = r.fileSelector;
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
    zone.addEventListener('drop', (e) => {
      if (!e.dataTransfer.files.length) return;
      input.files = e.dataTransfer.files;
      onChange();
    });
    input.addEventListener('change', onChange);

    return {
      show(file, badgeText, badgeClass) {
        r.fileInfo.hidden = !file;
        if (!file) return;
        r.fileName.textContent = file.name;
        r.fileSize.textContent = pickSize(file.size);
        r.fileBadge.className = 'badge ' + (badgeClass || '');
        r.fileBadge.textContent = badgeText || '';
      },
      clear() {
        input.value = '';
        this.show(null);
      },
      setBusy(busy) {
        zone.classList.toggle('disabled', busy);
        r.fileClear.disabled = busy;
        input.disabled = busy;
      },
      file: () => input.files[0] || null,
    };
  }

  function viewHeader(title, sub) {
    return `
      <div class="container-header">
        <div class="container-title">${esc(title)}</div>
        <div class="page-sub">${esc(sub)}</div>
      </div>`;
  }

  /* ======================================================================== */
  /* View: system-info                                                        */
  /* ======================================================================== */

  const BADGE_CLASSES = ['badge-success', 'badge-warning', 'badge-error', 'badge-disabled'];

  function setBadge(node, text, cls) {
    if (!node) return;
    node.textContent = text;
    node.classList.remove(...BADGE_CLASSES);
    if (cls) node.classList.add(cls);
  }

  // Badge from a status text. rules: [[match(value), cls], ...], unknown values get ' (Unknown Status)'
  function setStatusBadge(node, value, rules) {
    const rule = rules.find(([test]) => test(value));
    if (rule) setBadge(node, value, rule[1]);
    else setBadge(node, value + ' (Unknown Status)', 'badge-error');
  }

  function formatIsoDatetime(value) {
    if (typeof value !== 'string' || value.length < 24) return value || 'Unknown';
    return value.substring(0, 10) + ' ' + value.substring(11, 19) + ' (UTC' + value.substring(19, 24) + ')';
  }

  function formatBytes(b) {
    if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
    return b + ' B';
  }

  function formatMB(mb) {
    return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(1) + ' MB';
  }

  // Version text, optionally with links to the GitHub commit / release tag
  function renderVersionField(target, versionValue, linkify = true) {
    if (!target) return;
    target.textContent = '';
    const val = versionValue != null ? String(versionValue).trim() : '';

    if (!val || val === '?') {
      target.textContent = 'Unknown';
      return;
    }
    if (!linkify) {
      target.textContent = val;
      return;
    }

    const makeLink = (href, text) => {
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = text;
      return link;
    };

    if (val.includes(' @ ')) {
      const parts = val.split(' @ ');
      const commit = parts[1].trim();
      if (commit.endsWith('+') || commit === 'N/A') {
        target.textContent = val; // dirty or unknown: plain text
      } else {
        target.append(document.createTextNode(parts[0] + ' @ '), makeLink(`https://github.com/Slider0007/AI-on-the-edge-device/commit/${commit}`, commit));
      }
    } else if (val.endsWith('+') || val === 'N/A') {
      target.textContent = val;
    } else {
      target.append(makeLink(`https://github.com/Slider0007/AI-on-the-edge-device/releases/tag/${val}`, val));
    }
  }

  // Stacked bar: segments = [{ label, value, cls }], format(value) -> text
  function renderStack(host, title, total, segments, format, note) {
    if (!host) return;
    host.textContent = '';

    const sum = total || segments.reduce((acc, s) => acc + (s.value > 0 ? s.value : 0), 0);
    if (!(sum > 0)) return;

    const head = App.el('div', 'stack-title');
    head.append(App.el('span', '', title), App.el('span', '', format(sum)));

    const bar = App.el('div', 'stack-bar');
    const legend = App.el('div', 'stack-legend');

    for (const seg of segments) {
      const v = Math.max(0, seg.value);
      const pct = (v / sum) * 100;
      const part = App.el('div', `stack-seg ${seg.cls}`);
      part.style.width = pct + '%';
      part.title = `${seg.label}: ${format(v)}`;
      bar.append(part);

      const item = document.createElement('span');
      const dot = App.el('i', seg.cls);
      const strong = App.el('b', '', format(v));
      item.append(dot, `${seg.label} `, strong, ` (${pct.toFixed(0)}%)`);
      legend.append(item);
    }

    host.append(head, bar, legend);
    if (note) host.append(App.el('div', 'stack-note', note));
  }

  const kv = (label, field) => `<div><span class="sys-k">${label}</span><output data-r="${field}"></output></div>`;

  function infoTemplate() {
    const tile = (label, field, badge) =>
      `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value small"><output${badge ? ' class="badge"' : ''} data-r="${field}">-</output></div></div>`;

    return `
      <div class="container">
        ${viewHeader('System Info', 'The essentials at a glance, all details underneath.')}
        <div class="container-content">
          <div class="sys-stats">
            ${tile('Status', 'tile_status', true)}
            ${tile('Uptime', 'tile_uptime')}
            ${tile('Wi-Fi signal', 'tile_wifi')}
            ${tile('Firmware', 'tile_fw')}
            ${tile('SD card free', 'tile_sd')}
            ${tile('Memory free', 'tile_mem')}
          </div>

          <div class="sys-grid">
            <section class="card sys-card sys-span2">
              <div class="card-header"><span>Network</span><output class="badge" data-r="connection_status"></output></div>
              <div class="sys-net-hero">
                <div>
                  <div class="sys-hero-label">IPv4 address</div>
                  <output class="sys-hero-num sys-mono" data-r="ipv4_address"></output>
                  <div class="chips">
                    <span class="chip"><b>Host</b><output data-r="hostname"></output></span>
                    <span class="chip"><b>Mode</b><output data-r="network_opmode"></output></span>
                    <span class="chip"><b>Config</b><output data-r="network_config"></output></span>
                  </div>
                </div>
                <div class="sys-net-signal" data-r="box_rssi">
                  <svg data-r="rssi_svg" width="34" height="26" viewBox="0 0 24 16" fill="currentColor" style="overflow: visible">
                    <rect class="bar" x="1" y="12" width="3" height="4" rx="1" />
                    <rect class="bar" x="7" y="8" width="3" height="8" rx="1" />
                    <rect class="bar" x="13" y="4" width="3" height="12" rx="1" />
                    <rect class="bar" x="19" y="0" width="3" height="16" rx="1" />
                  </svg>
                  <div>
                    <div class="sys-hero-label">Signal</div>
                    <output data-r="wlan_rssi"></output>
                  </div>
                </div>
              </div>
              <div class="sys-kv-grid">
                <div data-r="box_ssid"><span class="sys-k">Network name</span><output data-r="wlan_ssid"></output></div>
                <div data-r="box_channel"><span class="sys-k">Channel</span><output data-r="wlan_channel"></output></div>
                ${kv('Netmask', 'netmask_address')}
                ${kv('Gateway', 'gateway_address')}
                ${kv('DNS', 'dns_address')}
                ${kv('MAC address', 'mac_address')}
              </div>
            </section>

            <section class="card sys-card">
              <div class="card-header"><span>Firmware</span><span class="chip"><b>WebUI</b><output data-r="html_version"></output></span></div>
              <div class="sys-hero-block">
                <div class="sys-hero-label">Version</div>
                <output class="sys-hero-num" data-r="firmware_version"></output>
              </div>
              <div class="sys-kv-grid">
                ${kv('Build time', 'build_time')}
                ${kv('ESP-IDF', 'idf_version')}
                ${kv('Config version', 'config_version')}
              </div>
              <div class="sys-diag">
                <div class="sys-diag-row">
                  <span class="sys-k">Core dump</span>
                  <span class="sys-diag-actions">
                    <button class="button" type="button" data-action="coredump-show">Show</button>
                    <button class="button" type="button" data-action="coredump-save" data-r="coredump_save" disabled>Save</button>
                    <button class="button" type="button" data-action="coredump-clear" data-r="coredump_clear" disabled>Clear</button>
                  </span>
                </div>
                <div class="sys-coredump" data-r="coredump_box" hidden>
                  <textarea data-r="coredump_text" readonly></textarea>
                </div>
              </div>
            </section>

            <section class="card sys-card">
              <div class="card-header"><span>Device</span><span class="chip"><b>Board</b><output data-r="board_type"></output></span></div>
              <div class="sys-hero-block">
                <div class="sys-hero-label">Chip</div>
                <output class="sys-hero-num" data-r="chip_model"></output>
                <div class="chips">
                  <span class="chip"><b>Cores</b><output data-r="chip_cores"></output></span>
                  <span class="chip"><b>Revision</b><output data-r="chip_revision"></output></span>
                  <span class="chip"><b>Clock</b><output data-r="chip_frequency"></output></span>
                </div>
              </div>
              <div class="sys-temp">
                <div class="sys-temp-head"><span class="sys-k">Temperature</span><output data-r="chip_temp"></output></div>
                <div class="sys-meter"><i data-r="temp_fill"></i></div>
              </div>
            </section>

            <section class="card sys-card">
              <div class="card-header"><span>SD card</span><span class="chip"><output data-r="sd_manufacturer"></output>&nbsp;<output data-r="sd_name"></output></span></div>
              <div class="stack" data-r="sd_stack"></div>
              <div class="sys-kv-grid">
                ${kv('Capacity', 'sd_capacity')}
                ${kv('Partition', 'sd_partition_size')}
                ${kv('Partition free', 'sd_partition_free')}
                ${kv('Sector size', 'sd_sector_size')}
                ${kv('Allocation size', 'sd_partition_alloc_size')}
              </div>
            </section>

            <section class="card sys-card">
              <div class="card-header"><span>Memory</span><span class="chip"><b>Free</b><output data-r="heap_total_free"></output></span></div>
              <div class="stack" data-r="heap_internal_stack"></div>
              <div class="stack" data-r="heap_spiram_stack"></div>
              <div class="sys-kv-grid">
                ${kv('Internal free', 'heap_internal_free')}
                ${kv('Internal largest block', 'heap_internal_largest_free')}
                ${kv('Internal minimum', 'heap_internal_min_free')}
                ${kv('External free', 'heap_spiram_free')}
                ${kv('External largest block', 'heap_spiram_largest_free')}
                ${kv('External minimum', 'heap_spiram_min_free')}
              </div>
            </section>

            <section class="card sys-card">
              <div class="card-header"><span>Process</span><output class="badge" data-r="process_status"></output></div>
              <div class="sys-mini-stats">
                <div class="sys-mini"><span class="sys-k">Interval</span><output data-r="process_interval"></output></div>
                <div class="sys-mini"><span class="sys-k">Last run</span><output data-r="process_time"></output></div>
                <div class="sys-mini"><span class="sys-k">Cycles</span><output data-r="cycle_counter"></output></div>
              </div>
            </section>

            <section class="card sys-card">
              <div class="card-header"><span>Time</span><output class="badge" data-r="ntp_syncstatus"></output></div>
              <div class="sys-hero-block">
                <div class="sys-hero-label">Device time</div>
                <output class="sys-hero-num sys-small" data-r="current_time"></output>
              </div>
              <div class="sys-kv-grid">
                ${kv('Started', 'device_starttime')}
                ${kv('Uptime', 'device_uptime')}
              </div>
            </section>

            <section class="card sys-card">
              <div class="card-header"><span>Services</span></div>
              <div class="sys-svc-list">
                <div class="sys-svc"><span>Data logging (SD card)</span><output class="badge" data-r="datalogging_sdcard_status"></output></div>
                <div class="sys-svc"><span>MQTT</span><output class="badge" data-r="mqtt_status"></output></div>
              </div>
            </section>

            <section class="card sys-card">
              <div class="card-header"><span>Camera</span></div>
              <div class="sys-kv-grid">
                ${kv('Sensor', 'camera_type')}
                ${kv('Clock', 'camera_frequency')}
              </div>
            </section>
          </div>
        </div>
      </div>`;
  }

  App.register('system-info', {
    title: 'System Info',

    mount(root) {
      root.classList.add('sys', 'sys-info');
      root.innerHTML = infoTemplate();
      const r = collectRefs(root);
      let alive = true;
      this._stop = () => { alive = false; };

      const set = (name, text) => {
        if (r[name]) r[name].textContent = text;
      };

      // signal bars + label in the network card
      const renderSignal = (value) => {
        const bars = r.rssi_svg.querySelectorAll('.bar');
        const setBars = (count, dimOpacity) =>
          bars.forEach((bar, i) => {
            const active = i < count;
            bar.style.opacity = active ? '1' : dimOpacity;
            bar.style.fill = active ? 'var(--primary)' : 'currentColor';
          });

        if (value === null || isNaN(value)) {
          r.wlan_rssi.textContent = 'Offline';
          setBars(0, '0.1');
        } else if (value <= -255) {
          r.wlan_rssi.textContent = 'Disconnected';
          setBars(0, '0.1');
        } else {
          const label = value >= -55 ? 'Excellent' : value >= -67 ? 'Good' : value >= -78 ? 'Fair' : value >= -85 ? 'Weak' : 'Unreliable';
          r.wlan_rssi.textContent = `${label} (${value}dBm)`;
          const thresholds = [-85, -78, -67, -55]; // Weak, Fair, Good, Excellent
          setBars(thresholds.filter((t) => value >= t).length, '0.2');
        }
      };

      const renderBars = (d) => {
        // SD card: partition usage plus capacity which is not part of the partition
        const cap = Number(d.sd_capacity);
        const part = Number(d.sd_partition_size);
        const free = Number(d.sd_partition_free);
        if (cap > 0 && part > 0 && free >= 0) {
          const segs = [
            { label: 'Used', value: Math.max(0, part - free), cls: 'seg-1' },
            { label: 'Free', value: free, cls: 'seg-2' },
          ];
          if (cap - part > 1) segs.push({ label: 'Outside partition', value: cap - part, cls: 'seg-3' });
          renderStack(r.sd_stack, 'Card capacity', cap, segs, formatMB);
        }

        // Heap: free memory split into the largest contiguous block and the fragmented rest
        const heap = (host, title, freeBytes, largestBytes, minFree) => {
          const f = Number(freeBytes);
          const l = Number(largestBytes);
          if (!(f > 0) || !(l >= 0)) return;
          renderStack(host, title, f, [
            { label: 'Largest free block', value: l, cls: 'seg-1' },
            { label: 'Fragmented', value: Math.max(0, f - l), cls: 'seg-2' },
          ], formatBytes, `Lowest free level since boot: ${formatBytes(Number(minFree))}`);
        };
        heap(r.heap_internal_stack, 'Internal RAM, free', d.heap_internal_free, d.heap_internal_largest_free, d.heap_internal_min_free);
        heap(r.heap_spiram_stack, 'PSRAM, free', d.heap_spiram_free, d.heap_spiram_largest_free, d.heap_spiram_min_free);
      };

      // Overview tiles at the top
      const renderTiles = (d) => {
        setBadge(r.tile_status, d.process_status ?? '-', String(d.process_status ?? '').startsWith('Processing') ? 'badge-success' : 'badge-error');
        set('tile_uptime', formatUptime(d.device_uptime));
        set('tile_wifi', d.wlan_rssi != -255 && d.wlan_rssi !== undefined ? `${d.wlan_rssi} dBm` : 'n/a');
        set('tile_fw', d.firmware_version ?? '-');
        set('tile_sd', Number(d.sd_partition_free) >= 0 ? formatMB(Number(d.sd_partition_free)) : '-');
        set('tile_mem', Number(d.heap_total_free) > 0 ? formatBytes(Number(d.heap_total_free)) : '-');

        // memory values in a readable unit
        ['heap_total_free', 'heap_internal_free', 'heap_internal_largest_free', 'heap_internal_min_free',
          'heap_spiram_free', 'heap_spiram_largest_free', 'heap_spiram_min_free'].forEach((name) => {
          const v = Number(d[name]);
          if (!Number.isNaN(v)) set(name, formatBytes(v));
        });

        if (d.wlan_rssi !== undefined && d.wlan_rssi != -255) renderSignal(Number(d.wlan_rssi));

        // temperature meter (20 - 80 degrees C)
        const temp = parseFloat(d.chip_temp);
        if (!Number.isNaN(temp)) {
          r.temp_fill.style.width = Math.max(4, Math.min(100, ((temp - 20) / 60) * 100)) + '%';
          r.temp_fill.className = temp >= 70 ? 'hot' : temp >= 55 ? 'warm' : '';
        }
      };

      const render = (d) => {
        setBadge(r.process_status, d.process_status, String(d.process_status).startsWith('Processing') ? 'badge-success' : 'badge-error');
        set('process_interval', d.process_interval + ' Minutes');
        set('process_time', d.process_time + ' Seconds');
        set('cycle_counter', d.cycle_counter);

        setStatusBadge(r.datalogging_sdcard_status, d.datalogging_sdcard_status, [
          [(v) => v === 'Enabled', 'badge-success'],
          [(v) => v === 'Disabled', 'badge-disabled'],
        ]);
        setStatusBadge(r.mqtt_status, d.mqtt_status, [
          [(v) => String(v).startsWith('Connected'), 'badge-success'],
          [(v) => v === 'Disconnected', 'badge-error'],
          [(v) => v === 'Disabled', 'badge-disabled'],
        ]);
        setStatusBadge(r.ntp_syncstatus, d.ntp_syncstatus, [
          [(v) => v === 'Synchronized', 'badge-success'],
          [(v) => v === 'Not Synchronized', 'badge-warning'],
          [(v) => v === 'Disabled', 'badge-disabled'],
        ]);

        set('device_starttime', formatIsoDatetime(d.device_starttime));
        set('current_time', formatIsoDatetime(d.current_time));
        set('device_uptime', formatUptime(d.device_uptime));

        set('network_opmode', d.network_opmode);
        setBadge(r.connection_status, d.connection_status, d.connection_status === 'Connected' ? 'badge-success' : 'badge-error');

        // Show only if info relevant (connected via WLAN)
        if (d.wlan_ssid != 'undefined') set('wlan_ssid', d.wlan_ssid);
        else r.box_ssid.hidden = true;
        if (d.wlan_rssi != -255) set('wlan_rssi', d.wlan_rssi + ' dBm');
        else r.box_rssi.hidden = true;
        if (d.wlan_channel != -1) set('wlan_channel', d.wlan_channel);
        else r.box_channel.hidden = true;

        set('mac_address', d.mac_address);
        set('network_config', d.network_config);
        set('ipv4_address', d.ipv4_address);
        set('netmask_address', d.netmask_address);
        set('gateway_address', d.gateway_address);
        set('dns_address', d.dns_address);
        set('hostname', d.hostname);

        set('board_type', d.board_type);
        set('chip_model', d.chip_model);
        set('chip_cores', d.chip_cores);
        set('chip_revision', d.chip_revision);
        set('chip_frequency', d.chip_frequency + ' Mhz');
        set('chip_temp', d.chip_temp + ' ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°C');

        set('camera_type', d.camera_type);
        set('camera_frequency', d.camera_frequency + '  Mhz');

        set('sd_name', d.sd_name);
        set('sd_manufacturer', d.sd_manufacturer);
        set('sd_capacity', d.sd_capacity + ' MB');
        set('sd_sector_size', d.sd_sector_size + ' byte');
        set('sd_partition_alloc_size', d.sd_partition_alloc_size + ' byte');
        set('sd_partition_size', d.sd_partition_size + ' MB');
        set('sd_partition_free', d.sd_partition_free + ' MB');

        ['heap_total_free', 'heap_internal_free', 'heap_internal_largest_free', 'heap_internal_min_free',
          'heap_spiram_free', 'heap_spiram_largest_free', 'heap_spiram_min_free'].forEach((name) => set(name, d[name] + ' byte'));

        renderBars(d);
        renderTiles(d);

        renderVersionField(r.firmware_version, d.firmware_version);
        renderVersionField(r.html_version, d.html_version, false);

        set('build_time', formatIsoDatetime(d.build_time));
        set('config_version', d.config_version);
        set('idf_version', d.idf_version);
      };

      const setCoreDumpAvailable = (available, text = '') => {
        r.coredump_box.hidden = !available;
        if (available) r.coredump_text.textContent = text;
        r.coredump_save.disabled = !available;
        r.coredump_clear.disabled = !available;
      };

      const coreDump = async (task) => {
        const res = await Api.system.coreDump(task);
        if (!res.ok || !alive) return;
        if (task === 'show') {
          const available = res.text !== 'No core dump available';
          setCoreDumpAvailable(available, res.text);
          firework.launch(available ? 'Show core dump backtrace summary' : 'No core dump available', 'success', 2000);
        } else if (task === 'clear') {
          setCoreDumpAvailable(false);
          firework.launch('Core dump partition cleared', 'success', 2000);
        }
      };

      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn || btn.disabled) return;
        switch (btn.dataset.action) {
          case 'coredump-show': coreDump('show'); break;
          case 'coredump-clear': coreDump('clear'); break;
          case 'coredump-save':
            window.open(Api.system.coreDumpSaveUrl(), '_self');
            firework.launch('Core dump info saved', 'success', 2000);
            break;
        }
      });

      Api.system.infoAll().then((data) => {
        if (data && alive) render(data);
      });
    },

    unmount() {
      this._stop?.();
    },
  });

  /* ======================================================================== */
  /* View: system-update                                                      */
  /* ======================================================================== */

  const UPDATE_REPO = 'Grrzzz/AI-on-the-edge-device'; // GitHub repository that publishes the release packages
  const UPDATE_MAX_FILE_SIZE = 8000 * 1024;

  // Versions of the Grrzzz line (e.g. v2.0.0-Grrzzz) rank above all older SLFork versions (v17.x, v18.x), then by number
  function parseVersion(v) {
    const text = String(v || '');
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
    return m ? [/grrzzz/i.test(text) ? 1 : 0, Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }

  function isNewer(candidate, installed) {
    const a = parseVersion(candidate);
    const b = parseVersion(installed);
    if (!a) return false;
    // Development builds ("Develop: branch @ hash", no release tag) and modified builds (version + "+") can always be replaced
    // by an official release
    if (!b) return true;
    for (let i = 0; i < 4; i++) {
      if (a[i] !== b[i]) return a[i] > b[i];
    }
    return /\+\s*$/.test(String(installed || ''));
  }

  // Newer release? Used by the sidebar hint. The browser asks GitHub (at most every 6 hours, the answer is remembered), errors stay silent.
  // Resolves to { tag, url } when the release is newer than the installed version, otherwise null.
  window.UpdateCheck = {
    async newer(installed) {
      const KEY = 'latestRelease';
      const TTL = 6 * 3600 * 1000;
      let rel = null;
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (saved && Date.now() - saved.at < TTL) rel = saved;
      } catch (e) { }
      if (!rel) {
        try {
          const latest = await Api.ota.latestRelease(UPDATE_REPO);
          rel = { at: Date.now(), tag: latest ? latest.tag : '', url: latest ? latest.htmlUrl : '' };
        } catch (e) {
          rel = { at: Date.now() - TTL + 10 * 60 * 1000, tag: '', url: '' }; // failed: try again in 10 minutes
        }
        try { localStorage.setItem(KEY, JSON.stringify(rel)); } catch (e) { }
      }
      return rel.tag && isNewer(rel.tag, installed) ? { tag: rel.tag, url: rel.url } : null;
    },
  };

  function updateTemplate() {
    return `
      <div class="container">
        ${viewHeader('Update', 'Install new firmware and WebUI versions.')}
        <div class="container-content">
          <div class="stat-row">
            <div class="stat"><div class="stat-label">Installed</div><div class="stat-value" data-r="firmware">Unknown</div></div>
            <div class="stat"><div class="stat-label">Latest release</div><div class="stat-value" data-r="latest">Not checked</div></div>
            <div class="stat"><div class="stat-label">Board</div><div class="stat-value small" data-r="board">Unknown</div></div>
          </div>

          <div class="card">
            <div class="card-header">
              <span>Online update</span>
              <button class="button sys-btn-inline" type="button" data-r="checkBtn" data-action="check">Check for update</button>
            </div>

            <div class="state-box">
              <div class="state-main">
                <span class="badge" data-r="badge">Not checked</span>
                <div class="state-text" data-r="text">Look on GitHub for a newer release. The device then downloads and installs it by itself.</div>
              </div>
              <button class="button btn-action" type="button" data-r="start" data-action="self-update" hidden>Update now</button>
            </div>
            <div class="sys-spacer"></div>
          </div>

          <div class="card">
            <div class="card-header"><span>Manual update</span></div>
            <div class="card-pad">
              <div class="lead">
                Install a release package for your board (<b>*.zip</b>) or a <b>firmware.bin</b> from this computer. Your settings are kept.
                Create a backup under <b>System &rarr; Backup / Restore</b> from time to time.
              </div>
              ${pickerHtml({
                title: 'Drop a package here',
                sub: 'or <b>browse</b> your computer &middot; *.zip, *.bin, max. 8 MB',
                label: 'Choose a package or drop it here',
                accept: '.bin,.zip',
              })}
              <button class="button btn-wide btn-action" type="button" data-r="install" data-action="install" disabled>Install</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  /**
   * Full screen progress of an update (upload / download, installation, restart), like the updater of the Doorbell:
   * dimmed page, title, text, three steps, progress bar and elapsed time. The page reloads when the device is back.
   */
  function createUpdateOverlay() {
    let el = null;
    let timer = null;
    let t0 = 0;
    let refs = {};
    let expected = 0; // expected total duration [s] of the whole process (0: only the elapsed time is shown)

    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

    const build = () => {
      el = App.h(`
        <div class="sys-ov" role="alertdialog" aria-modal="true" aria-live="polite">
          <div class="sys-ov-body">
            <div class="sys-ov-spin" data-o="spin"></div>
            <h2 class="sys-ov-title" data-o="title"></h2>
            <p class="sys-ov-text" data-o="text"></p>
            <ol class="sys-ov-steps" data-o="steps" hidden></ol>
            <div class="sys-ov-bar" data-o="bar" hidden><i data-o="fill"></i></div>
            <div class="sys-ov-meta"><span data-o="left"></span><span data-o="right"></span></div>
            <button class="button sys-ov-close" type="button" data-o="close" hidden>Close</button>
          </div>
        </div>`);
      el.querySelectorAll('[data-o]').forEach((n) => { refs[n.dataset.o] = n; });
      document.body.append(el);
    };

    const api = {
      // opts.expected: total duration in seconds (countdown and time based bar over the whole process, e.g. 60 for an update)
      open(title, text, stepLabels, opts = {}) {
        if (!el) build();
        expected = opts.expected || 0;
        el.classList.remove('sys-ov-fail');
        refs.spin.hidden = false;
        refs.close.hidden = true;
        refs.title.textContent = title;
        refs.text.textContent = text;
        refs.left.textContent = '';
        refs.right.textContent = '';
        refs.bar.hidden = true;
        refs.steps.textContent = '';
        refs.steps.hidden = !stepLabels;
        (stepLabels || []).forEach((label, i) => refs.steps.append(App.el('li', '', `${i + 1} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${label}`)));
        t0 = Date.now();
        clearInterval(timer);
        const tick = () => {
          const elapsed = (Date.now() - t0) / 1000;
          if (!expected) {
            refs.right.textContent = `Elapsed ${fmt(elapsed)}`;
            return;
          }
          // total countdown: the bar and the remaining time cover download/upload, installation and restart together
          refs.bar.hidden = false;
          const left = expected - elapsed;
          refs.bar.classList.toggle('sys-ov-indeterminate', left <= 0);
          if (left > 0) refs.fill.style.width = `${Math.min(99, (elapsed / expected) * 100)}%`;
          else refs.fill.style.width = '';
          refs.right.textContent = left > 0 ? `About ${fmt(Math.ceil(left))} left` : 'Finishing ...';
        };
        timer = setInterval(tick, 1000);
        tick();
        if (!expected) refs.right.textContent = 'Elapsed 0:00';
        el.hidden = false;
      },
      title(t) { refs.title.textContent = t; },
      text(t) { refs.text.textContent = t; },
      // current step 1..n (earlier ones are done)
      step(n) {
        [...refs.steps.children].forEach((li, i) => { li.className = i + 1 < n ? 'done' : i + 1 === n ? 'active' : ''; });
      },
      // pct: 0..100, null = unknown (animated bar)
      progress(pct, left = '') {
        refs.bar.hidden = false;
        if (expected) {
          refs.left.textContent = left; // the bar shows the total countdown, the step detail stays as text
          return;
        }
        refs.bar.classList.toggle('sys-ov-indeterminate', pct === null);
        refs.fill.style.width = pct === null ? '' : `${Math.max(0, Math.min(100, pct))}%`;
        refs.left.textContent = left;
      },
      fail(title, message, onClose) {
        clearInterval(timer);
        el.classList.add('sys-ov-fail');
        refs.spin.hidden = true;
        refs.bar.hidden = true;
        refs.title.textContent = title;
        refs.text.textContent = message;
        refs.right.textContent = '';
        refs.close.hidden = false;
        refs.close.onclick = () => { api.close(); onClose?.(); };
      },
      close() {
        clearInterval(timer);
        el?.remove();
        el = null;
        refs = {};
      },
    };
    return api;
  }

  App.register('system-update', {
    title: 'Update',

    mount(root) {
      root.classList.add('sys', 'sys-update');
      root.innerHTML = updateTemplate();
      const r = collectRefs(root);
      let alive = true;
      const overlay = createUpdateOverlay();
      this._stop = () => { alive = false; overlay.close(); };

      let latestRelease = null;
      let boardType = '';
      let firmwareVersion = '';

      const picker = setupPicker(r, () => validateFile());

      // kind: '' (neutral), 'busy', 'ok', 'new', 'err'
      const setUpdateText = (html, showStart = false, kind = '') => {
        const badges = {
          '': ['Not checked', ''],
          busy: ['Checking', ''],
          ok: ['Up to date', 'badge-success'],
          new: ['Update available', 'badge-warning'],
          err: ['Not possible', 'badge-error'],
        };
        const [label, cls] = badges[kind] || badges[''];
        r.badge.textContent = label;
        r.badge.className = 'badge ' + cls;
        r.text.innerHTML = html; // callers escape all dynamic parts
        r.start.hidden = !showStart;
      };

      const unlock = () => {
        picker.setBusy(false);
        r.checkBtn.disabled = false;
        r.install.disabled = !picker.file();
      };

      // Step 2 (install) lasts while the device installs and restarts; step 3 once it is back, then the app reloads
      const waitForDevice = async () => {
        overlay.step(2); // the package is installed while the device is away: that is the install step
        overlay.title('Installing ...');
        overlay.text('The device installs the update and restarts. This page reloads automatically. Do not unplug the device.');
        overlay.progress(null);
        const result = await Api.ota.rebootAndWait({ cancelled: () => !alive });
        if (!alive) return;
        if (result === 'online') {
          overlay.step(3);
          overlay.title('Update installed');
          overlay.text('Reloading ...');
          reloadApp();
        } else if (result === 'timeout') {
          overlay.fail('Restart takes unusually long', 'Reload this page or power cycle the device.', unlock);
        }
      };

      const checkForUpdate = async () => {
        r.checkBtn.disabled = true;
        setUpdateText('Asking GitHub for the latest release ...', false, 'busy');
        latestRelease = null;

        try {
          // the browser asks GitHub, the device does not need internet access for this step
          const rel = await Api.ota.latestRelease(UPDATE_REPO);
          if (!rel) {
            r.latest.textContent = 'None published';
            setUpdateText('No release has been published yet.', false, 'err');
            return;
          }
          r.latest.textContent = rel.tag;

          const board = boardType.trim().toLowerCase();
          const asset = rel.assets.find((a) => {
            const n = a.name.toLowerCase();
            return n.startsWith('ai-on-the-edge-device__' + board + '__') && n.endsWith('.zip');
          });
          const link = `<a href="${esc(rel.htmlUrl)}" target="_blank" rel="noopener noreferrer">release notes</a>`;

          if (!isNewer(rel.tag, firmwareVersion)) {
            setUpdateText(`This device runs the newest version. (${link})`, false, 'ok');
            return;
          }
          if (!asset) {
            setUpdateText(`<b>${esc(rel.tag)}</b> is available, but it has no package for board <b>${esc(board)}</b>. (${link})`, false, 'err');
            return;
          }

          latestRelease = { tag: rel.tag, url: asset.url, size: asset.size };
          const mb = asset.size ? ` &middot; ${(asset.size / 1048576).toFixed(1)} MB` : '';
          setUpdateText(`Version <b>${esc(rel.tag)}</b>${mb} is ready to install. (${link})`, true, 'new');
        } catch (e) {
          console.error('Update check failed:', e);
          setUpdateText('Could not reach GitHub. This browser needs internet access to look for updates. You can still install a package manually.', false, 'err');
        } finally {
          r.checkBtn.disabled = false;
        }
      };

      const startSelfUpdate = async () => {
        if (!latestRelease) return;
        if (!(await confirmDialog({
          title: `Update to ${latestRelease.tag}?`,
          text: 'The device downloads the package itself and restarts afterwards. This takes a few minutes. Do not unplug it meanwhile.',
          okLabel: 'Update',
        }))) return;

        r.start.hidden = true;
        r.checkBtn.disabled = true;
        picker.setBusy(true);
        r.install.disabled = true;
        overlay.open(`Updating to ${latestRelease.tag}`, 'Starting ...', ['Download', 'Install', 'Restart'], { expected: 60 });
        overlay.step(1);
        overlay.progress(0);

        const res = await Api.ota.selfUpdate(latestRelease.url);
        if (!res.ok) {
          const text = res.unsupported
            ? 'This firmware does not support one-click updates yet. Install the package manually below.'
            : `Update could not be started: ${res.message}`;
          setUpdateText(esc(text), false, 'err');
          overlay.fail('Update not started', text, unlock);
          return;
        }

        pollSelfUpdate();
      };

      const pollSelfUpdate = async () => {
        let failures = 0;

        while (alive) {
          await sleep(1500);
          if (!alive) return;
          const status = await Api.ota.selfUpdateStatus();
          if (!status) {
            // the device may already be restarting
            if (++failures >= 4) {
              waitForDevice();
              return;
            }
            continue;
          }
          failures = 0;

          const { state, percent, message } = status;
          overlay.progress(percent || 0, percent ? `${percent} %` : '');
          overlay.text(message || state);

          if (state === 'done' || state === 'staging') {
            overlay.step(2);
            overlay.title('Installing ...');
            overlay.text('The package is installed during the restart.');
            overlay.progress(null);
            waitForDevice();
            return;
          }
          if (state === 'error') {
            const text = `Update failed: ${message || 'unknown error'}`;
            setUpdateText(esc(text), false, 'err');
            overlay.fail('Update failed', message || 'unknown error', unlock);
            return;
          }
        }
      };

      // ---------------------------------------------------------------- manual update
      const validateFile = () => {
        r.install.disabled = true;

        const file = picker.file();
        if (!file) {
          picker.show(null);
          return;
        }
        const filename = file.name;
        const bad = (msg) => picker.show(file, msg, 'badge-error');

        if (file.size > UPDATE_MAX_FILE_SIZE) return bad('Larger than 8 MB');
        if (filename.length > 255) return bad('File name too long');
        if (filename.includes(' ')) return bad('Name contains spaces');

        if (/(^AI-on-the-edge-device__)[a-zRC0-9()_\-.]*(\.zip$)/i.test(filename)) {
          if (boardType.trim().toLowerCase() === filename.split('__')[1].toLowerCase()) {
            picker.show(file, 'Matches this board', 'badge-success');
          } else {
            picker.show(file, 'Other board', 'badge-warning');
          }
        } else if (filename === 'firmware.bin') {
          picker.show(file, 'Firmware only', 'badge-success');
        } else if (filename.endsWith('.zip') || filename.endsWith('.bin')) {
          picker.show(file, 'Unexpected name', 'badge-warning');
        } else {
          return bad('Not a package');
        }

        r.install.disabled = false;
      };

      const uploadFailed = (message) => {
        console.error('OTA upload failed:', message);
        overlay.fail('Upload failed', message, unlock);
      };

      const onUploadProgress = (loaded, total) => {
        const percent = Math.round((loaded / total) * 100);
        overlay.progress(percent, `${(loaded / 1048576).toFixed(2)} of ${(total / 1048576).toFixed(2)} MB`);
        overlay.text(`${percent} % uploaded. Please wait ...`);
      };

      // upload done: the device stages the package and installs it during the restart
      const installDone = () => {
        overlay.step(2);
        overlay.title('Installing ...');
        overlay.text('The package is staged and installed during the restart.');
        overlay.progress(null);
        waitForDevice();
      };

      const startInstall = async () => {
        const file = picker.file();
        const name = file?.name || 'the selected package';
        if (!file || !(await confirmDialog({
          title: 'Install this package?',
          text: `${name} is installed and the device restarts. Do not unplug it meanwhile.`,
          okLabel: 'Install',
        }))) return;

        r.install.disabled = true;
        r.checkBtn.disabled = true;
        picker.setBusy(true);
        overlay.open(`Installing ${name}`, 'Uploading ...', ['Upload', 'Install', 'Restart'], { expected: 60 });
        overlay.step(1);
        overlay.progress(0);

        const res = await Api.ota.upload(file, onUploadProgress);
        if (res.ok) {
          installDone();
          return;
        }

        // @Deprecated: Remove legacy OTA support once old API versions are no longer supported
        // --------------------------------------------------------------------------------
        if (res.type === 'network' && (await Api.ota.hasLegacyApi())) {
          overlay.text('Network error. Retry with legacy OTA API ...');
          const legacy = await Api.ota.legacyInstall(file, {
            onPhase: (text) => overlay.text(text),
            onProgress: onUploadProgress,
          });
          if (legacy.ok) {
            installDone();
          } else if (legacy.type === 'prepare' || legacy.type === 'process') {
            overlay.fail('Update not possible', legacy.message, unlock);
          } else {
            uploadFailed(legacy.message);
          }
          return;
        }
        // --------------------------------------------------------------------------------

        uploadFailed(res.message);
      };

      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn || btn.disabled) return;
        switch (btn.dataset.action) {
          case 'check': checkForUpdate(); break;
          case 'self-update': startSelfUpdate(); break;
          case 'install': startInstall(); break;
          case 'clear-file':
            picker.clear();
            r.install.disabled = true;
            break;
        }
      });

      const boardLoaded = Api.system.info('board_type', 'board type').then((v) => {
        if (v === null || !alive) return;
        boardType = v;
        r.board.textContent = v;
      });
      const firmwareLoaded = Api.system.info('firmware_version', 'firmware version').then((v) => {
        if (v === null || !alive) return;
        firmwareVersion = v;
        r.firmware.textContent = v;
      });
      // look for a newer release right away (board and installed version are needed for the comparison)
      Promise.all([boardLoaded, firmwareLoaded]).then(() => {
        if (alive && boardType && firmwareVersion) checkForUpdate();
      });
    },

    unmount() {
      this._stop?.();
    },
  });

  /* ======================================================================== */
  /* Import of backups from firmware v16 (config.ini)                         */
  /* ======================================================================== */

  /**
   * Firmware v16 stored the configuration in config/config.ini, firmware v17 and newer use config/config.json.
   * This converter turns the ini file of a v16 backup into a configuration delta for POST /config.
   * Not converted (the device keeps its values): network / WLAN, hostname, GPIO, log levels, InfluxDB, Webhook.
   */
  const LegacyImport = (() => {
    const METER_TYPES = { water_m3: 1, water_l: 2, water_gal: 3, water_ft3: 4, gas_m3: 5 }; // see mqtt.homeassistant.metertype

    const basename = (p) => String(p || '').trim().split('/').pop();
    const bool = (v) => String(v).trim().toLowerCase() === 'true';
    const num = (v) => {
      if (v === undefined || v === null || String(v).trim() === '') return null;
      const n = Number(String(v).trim());
      return Number.isFinite(n) ? n : null;
    };

    // Sections -> { values: { key: [value, ...] }, lines: [[token, ...]] }. Commented lines (;) are ignored,
    // a commented section header (";[Analog]") means the section is switched off.
    function parseIni(text) {
      const sections = {};
      let cur = null;
      for (const raw of String(text).replace(/\r/g, '').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith(';')) continue;
        const header = /^\[(.+)\]$/.exec(line);
        if (header) {
          cur = sections[header[1]] = { values: {}, lines: [] };
          continue;
        }
        if (!cur) continue;
        const eq = line.indexOf('=');
        const first = line.split(/\s+/)[0];
        if (eq > 0 && !/\s/.test(line.slice(0, eq).trim())) {
          const key = line.slice(0, eq).trim().toLowerCase();
          (cur.values[key] ||= []).push(line.slice(eq + 1).trim());
        } else if (first) {
          cur.lines.push(line.split(/\s+/));
        }
      }
      return sections;
    }

    const first = (sec, key) => sec?.values[key.toLowerCase()]?.[0];

    // The Digits section of some backups contains the analog model key (commented analog header): take the model by its prefix
    const modelOf = (sec, prefix) => (sec?.values.model || []).map(basename).find((m) => m.toLowerCase().startsWith(prefix));

    /**
     * @param {string} iniText content of config.ini
     * @param {string} [prevalueText] content of prevalue.ini
     * @returns {{delta:object, markers:Array<{x:number,y:number}>, models:string[], fallback:{sequence:string,value:string}|null, notes:string[]}}
     */
    function convert(iniText, prevalueText = '') {
      const ini = parseIni(iniText);
      const notes = [];
      const delta = {};
      const set = (path, value) => {
        if (value === undefined || value === null || value === '') return;
        const keys = path.split('.');
        let o = delta;
        keys.slice(0, -1).forEach((k) => (o = o[k] ||= {}));
        o[keys[keys.length - 1]] = value;
      };

      // ---- operation
      const timer = ini.AutoTimer;
      if (timer && num(first(timer, 'Interval')) > 0) {
        set('operationmode.opmode', 1);
        set('operationmode.automaticprocessinterval', num(first(timer, 'Interval')).toFixed(2));
      }
      const demo = first(ini.TakeImage, 'Demo');
      if (demo !== undefined) set('operationmode.usedemoimages', bool(demo));

      // ---- camera and flash
      const t = ini.TakeImage;
      if (t) {
        const wait = num(first(t, 'WaitBeforeTakingPicture'));
        if (wait !== null) set('takeimage.flashlight.flashtime', Math.round(wait * 1000));
        const led = num(first(t, 'LEDIntensity'));
        if (led !== null) set('takeimage.flashlight.flashintensity', led);
        for (const [key, name] of [['CamBrightness', 'brightness'], ['CamContrast', 'contrast'], ['CamSaturation', 'saturation'], ['CamSharpness', 'sharpness']]) {
          const v = num(first(t, key));
          if (v !== null) set('takeimage.camera.' + name, v);
        }
        const quality = num(first(t, 'CamQuality'));
        if (quality !== null) set('takeimage.camera.imagequality', quality);
        if (first(t, 'CamHmirror') !== undefined) set('takeimage.camera.mirrorimage', bool(first(t, 'CamHmirror')));
        if (first(t, 'CamVflip') !== undefined) set('takeimage.camera.flipimage', bool(first(t, 'CamVflip')));
        if (first(t, 'CamAec') !== undefined) {
          const auto = bool(first(t, 'CamAec'));
          set('takeimage.camera.exposurecontrolmode', auto ? 1 : 0);
          if (auto) set('takeimage.camera.autoexposurelevel', num(first(t, 'CamAeLevel')) ?? 0);
          else set('takeimage.camera.manualexposurevalue', num(first(t, 'CamAecValue')) ?? 300);
        }
        if (first(t, 'CamAgc') !== undefined) {
          const auto = bool(first(t, 'CamAgc'));
          set('takeimage.camera.gaincontrolmode', auto ? 1 : 0);
          if (!auto) set('takeimage.camera.manualgainvalue', num(first(t, 'CamAgcGain')) ?? 0);
        }
        if (bool(first(t, 'CamZoom') ?? 'false')) notes.push('Digital zoom of v16 is not converted. Set the zoom under Configuration > Image.');
      }

      // ---- alignment
      const a = ini.Alignment;
      const markers = [];
      if (a) {
        set('imagealignment.imagerotation', (num(first(a, 'InitialRotate')) ?? 0).toFixed(1));
        set('imagealignment.searchfield.x', num(first(a, 'SearchFieldX')));
        set('imagealignment.searchfield.y', num(first(a, 'SearchFieldY')));
        set('imagealignment.alignmentalgo', 0); // v16 "default" = rotate + align, red channel
        for (const tokens of a.lines) {
          if (/ref\d\.jpg$/i.test(tokens[0])) {
            markers.push({ x: Number(tokens[1]), y: Number(tokens[2]) });
          }
        }
        if (markers.length === 2 && markers.every((m) => Number.isFinite(m.x) && Number.isFinite(m.y))) {
          set('imagealignment.marker', markers);
        } else {
          notes.push('Alignment markers not found in config.ini. Set them under Configuration > Markers.');
        }
      }

      // ---- digit / analog ROIs
      const models = [];
      const parseRois = (sec, kind) => {
        const bySequence = {};
        for (const tok of sec?.lines || []) {
          const m = /^([^.]+)\.(dig|ana)\d+$/i.exec(tok[0]);
          if (!m || m[2].toLowerCase() !== kind) continue;
          const [x, y, dx, dy] = tok.slice(1, 5).map(Number);
          if (![x, y, dx, dy].every(Number.isFinite)) continue;
          const roi = { x, y, dx, dy };
          if (kind === 'ana') roi.ccw = bool(tok[5] ?? 'false');
          (bySequence[m[1]] ||= []).push(roi);
        }
        return bySequence;
      };
      const sequenceBlocks = (bySequence) => {
        const names = Object.keys(bySequence);
        if (names.length > 1) notes.push(`Only the first number sequence ("${names[0]}") is imported, found: ${names.join(', ')}.`);
        return names.slice(0, 1).map((name, i) => ({ sequenceid: i, sequencename: name, roi: bySequence[name] }));
      };

      const digits = parseRois(ini.Digits, 'dig');
      const analog = parseRois(ini.Analog, 'ana');
      set('digit.enabled', Object.keys(digits).length > 0);
      set('analog.enabled', !!ini.Analog && Object.keys(analog).length > 0);

      const digitModel = modelOf(ini.Digits, 'dig');
      if (digitModel) {
        set('digit.model', digitModel);
        models.push(digitModel);
      }
      set('digit.cnngoodthreshold', num(first(ini.Digits, 'CNNGoodThreshold'))?.toFixed(2));
      if (Object.keys(digits).length) set('digit.sequence', sequenceBlocks(digits));

      if (ini.Analog && Object.keys(analog).length) {
        const analogModel = modelOf(ini.Analog, 'ana');
        if (analogModel) {
          set('analog.model', analogModel);
          models.push(analogModel);
        }
        set('analog.sequence', sequenceBlocks(analog));
      }

      // ---- post-processing (first sequence)
      const p = ini.PostProcessing;
      const seqName = Object.keys(digits)[0] || Object.keys(analog)[0] || 'main';
      if (p) {
        const key = (name) => first(p, `${seqName}.${name}`);
        const post = { sequencename: seqName };
        if (num(key('DecimalShift')) !== null) post.decimalshift = num(key('DecimalShift'));
        if (key('ExtendedResolution') !== undefined) post.extendedresolution = bool(key('ExtendedResolution'));
        if (key('IgnoreLeadingNaN') !== undefined) post.ignoreleadingnan = bool(key('IgnoreLeadingNaN'));
        if (key('CheckDigitIncreaseConsistency') !== undefined) post.checkdigitincreaseconsistency = bool(key('CheckDigitIncreaseConsistency'));
        if (key('AllowNegativeRates') !== undefined) post.allownegativerate = bool(key('AllowNegativeRates'));
        if (num(key('MaxRateValue')) !== null) {
          post.maxrate = num(key('MaxRateValue')).toFixed(3);
          // v16 "AbsoluteChange" (default) = limit per interval, "RateChange" = per minute
          post.maxratechecktype = /^ratechange$/i.test(key('MaxRateType') || '') ? 1 : 2;
        }
        if (first(p, 'PreValueUse') !== undefined) post.usefallbackvalue = bool(first(p, 'PreValueUse'));
        if (num(first(p, 'PreValueAgeStartup')) !== null) post.fallbackvalueagestartup = num(first(p, 'PreValueAgeStartup'));
        delta.postprocessing = { sequence: { 0: post } };
      }

      // ---- MQTT
      const m = ini.MQTT;
      if (m && first(m, 'Uri')) {
        set('mqtt.enabled', true);
        set('mqtt.uri', first(m, 'Uri'));
        set('mqtt.maintopic', first(m, 'MainTopic'));
        set('mqtt.clientid', first(m, 'ClientID'));
        set('mqtt.authmode', first(m, 'user') ? 1 : 0);
        set('mqtt.username', first(m, 'user'));
        set('mqtt.processdatanotation', 1); // v16 published single topics
        if (first(m, 'RetainMessages') !== undefined) set('mqtt.retainprocessdata', bool(first(m, 'RetainMessages')));
        if (first(m, 'ValidateServerCert') !== undefined) set('mqtt.tls.servercertverification', bool(first(m, 'ValidateServerCert')) ? 2 : 0);
        set('mqtt.tls.cacert', basename(first(m, 'CACert')));
        set('mqtt.tls.clientcert', basename(first(m, 'ClientCert')));
        set('mqtt.tls.clientkey', basename(first(m, 'ClientKey')));
        if (first(m, 'HomeassistantDiscovery') !== undefined) set('mqtt.homeassistant.discoveryenabled', bool(first(m, 'HomeassistantDiscovery')));
        const type = String(first(m, 'MeterType') || '').toLowerCase();
        if (type in METER_TYPES) set('mqtt.homeassistant.metertype', METER_TYPES[type]);
        else if (type) notes.push(`Home Assistant meter type "${type}" is not converted. Set it under System > Setup > MQTT.`);
        if (first(m, 'user')) notes.push('The MQTT password is not part of the backup. Enter it under System > Setup > MQTT.');
      }

      // ---- system and logging
      set('system.cpufrequency', num(first(ini.System, 'CPUFrequency')));
      set('network.time.timezone', first(ini.System, 'TimeZone'));
      if (first(ini.DataLogging, 'DataLogActive') !== undefined) set('log.data.enabled', bool(first(ini.DataLogging, 'DataLogActive')));
      set('log.data.datafilesretention', num(first(ini.DataLogging, 'DataFilesRetention')));
      set('log.debug.logfilesretention', num(first(ini.Debug, 'LogfilesRetention')));

      // ---- last valid value (prevalue.ini: "<sequence> <timestamp> <value>")
      let fallback = null;
      const pv = String(prevalueText).replace(/\r/g, '').split('\n').map((l) => l.trim().split(/\s+/)).find((tok) => tok.length >= 3);
      if (pv && num(pv[pv.length - 1]) !== null) fallback = { sequence: pv[0], value: pv[pv.length - 1] };

      return { delta, markers, models: [...new Set(models)], fallback, notes };
    }

    // Looks into an unzipped backup: { ini, prevalue, file(name) } or null if it is no v16 backup
    function detect(zip) {
      const find = (name) => zip[name] || zip['config/' + name];
      const ini = find('config.ini');
      if (!ini || zip['meta.json']) return null;
      const dec = (u8) => (u8 ? new TextDecoder().decode(u8) : '');
      return { ini: dec(ini), prevalue: dec(find('prevalue.ini')), file: (name) => find(name) || null };
    }

    return { convert, detect, parseIni };
  })();

  /* ======================================================================== */
  /* View: system-backup                                                      */
  /* ======================================================================== */

  const BACKUP_MAX_RETRIES = 5;
  const BACKUP_RETRY_TIMEOUTS = [2000, 5000, 10000, 20000, 30000]; // ms per attempt, the last one repeats
  const BACKUP_BASE_PATH = '/config/';
  const BACKUP_MAX_FILE_SIZE = 16000 * 1024;
  const BACKUP_APP_NAME = 'AI-on-the-Edge Device [SLFork]';

  function backupTemplate() {
    return `
      <div class="container">
        ${viewHeader('Backup / Restore', 'Save the device configuration to your computer and bring it back.')}
        <div class="container-content">
          <div class="two-col">
            <div class="card">
              <div class="card-header"><span>Backup</span></div>
              <div class="card-pad">
                <div class="lead">
                  Downloads the whole configuration as one ZIP file: settings, reference image, alignment markers and models.
                  Create one before every update.
                </div>
                <div class="prog sys-prog-flat" data-r="backupProg" hidden>
                  <progress data-r="backupBar" value="0" max="100"></progress>
                  <div class="prog-meta"><span data-r="backupState">Idle</span><span data-r="backupCount"></span></div>
                </div>
                <button class="button btn-wide btn-action" type="button" data-r="startBackup" data-action="backup">Create backup</button>
                <div class="log-console" data-r="log"></div>
              </div>
            </div>

            <div data-r="restoreHost"></div>
          </div>

          <div class="note-row">
            <span>Only need single files, for example one reference image or a model?</span>
            <a href="#/system/files?path=/config/" data-action="open-files">Open the File Explorer</a>
          </div>
        </div>
      </div>`;
  }

  /** The restore card (backup of this application or of firmware v16). `onImported` runs after a v16 import, a normal restore reloads the app. */
  function mountRestore(host, { onImported } = {}) {
    host.innerHTML = `
    <div class="card">
      <div class="card-header"><span>Restore</span></div>
      <div class="card-pad">
        <div class="lead">
          Restores a backup created here. The existing configuration is replaced and the device restarts.
          Backups of firmware v16 (with a config.ini) are converted and imported.
        </div>
        ${pickerHtml({
          title: 'Drop a backup here',
          sub: 'or <b>browse</b> your computer &middot; *.zip, max. 16 MB',
          label: 'Choose a backup file or drop it here',
          accept: '.zip',
        })}
        <button class="button btn-wide btn-action" type="button" data-r="startRestore" data-action="restore" disabled>Restore</button>
      </div>
    </div>`;
    const r = collectRefs(host);
    let alive = true;
    const picker = setupPicker(r, () => validateFile());
    const overlay = createUpdateOverlay(); // restore and import show the same full screen progress as an update
    const unlock = () => {
      r.startRestore.disabled = false;
      picker.setBusy(false);
    };

    // ---------------------------------------------------------------- restore
    let legacy = null; // unzipped v16 backup (config.ini), imported instead of restored

    const validateFile = async () => {
      r.startRestore.disabled = true;
      legacy = null;

      const file = picker.file();
      if (!file) {
        picker.show(null);
        return;
      }
      const filename = file.name;
      const bad = (msg) => picker.show(file, msg, 'badge-error');

      if (file.size > BACKUP_MAX_FILE_SIZE) return bad('Larger than 16 MB');
      if (filename.length > 255) return bad('File name too long');
      if (filename.includes(' ')) return bad('Name contains spaces');
      if (!filename.toLowerCase().endsWith('.zip')) return bad('Not a ZIP file');

      picker.show(file, 'Checking ...');
      try {
        await loadScript('/fflate.min.js');
        const zip = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()));

        legacy = LegacyImport.detect(zip);
        if (legacy) {
          picker.show(file, 'v16 backup, will be converted', 'badge-warning');
          r.startRestore.disabled = false;
          return;
        }
        if (!zip['meta.json']) return bad('Not a backup (meta.json missing)');
        const meta = JSON.parse(new TextDecoder().decode(zip['meta.json']));
        if (!meta.app || meta.app.toLowerCase() !== BACKUP_APP_NAME.toLowerCase()) return bad('Backup of another application');

        const when = String(meta.timestamp || '').replace('_', ' ').replace(/-(\d\d)-(\d\d)$/, ':$1:$2');
        picker.show(file, 'Valid backup', 'badge-success');
        if (when) r.fileSize.textContent = pickSize(file.size) + ' ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· created ' + when;
        r.startRestore.disabled = false;
      } catch (err) {
        console.error('ZIP validation error:', err);
        bad('Damaged ZIP file');
      }
    };

    const runLegacyImport = async () => {
      const c = LegacyImport.convert(legacy.ini, legacy.prevalue);
      const notes = [...c.notes];
      const setStatus = (text) => overlay.text(text);
      const importFailed = (message) => {
        console.error('Import failed:', message);
        overlay.fail('Import failed', message, unlock);
      };
      overlay.open('Importing backup', 'Uploading files ...', ['Files', 'Configuration', 'Finish']);
      overlay.step(1);
      overlay.progress(0);

      // 1. images and models
      const uploads = [];
      const add = (path, name) => {
        const data = legacy.file(name);
        if (data) uploads.push([path, data]);
        else notes.push(`File ${name} is missing in the backup.`);
      };
      add('/config/reference.jpg', 'reference.jpg');
      add('/config/marker1.jpg', 'ref0.jpg');
      add('/config/marker2.jpg', 'ref1.jpg');
      c.models.forEach((m) => add('/config/models/' + m, m));

      for (let i = 0; i < uploads.length; i++) {
        const [path, data] = uploads[i];
        setStatus(`Uploading ${path.split('/').pop()} (${i + 1}/${uploads.length}) ...`);
        overlay.progress(Math.round((i / (uploads.length + 2)) * 100), `${i + 1} of ${uploads.length} files`);
        const res = await Api.files.upload(path, data);
        if (!res.ok) return importFailed(`${path}: ${res.message}`);
      }

      // 2. configuration
      overlay.step(2);
      setStatus('Saving the configuration ...');
      overlay.progress(Math.round((uploads.length / (uploads.length + 2)) * 100));
      try {
        await Api.config.save(c.delta, true);
      } catch (e) {
        return importFailed('Configuration could not be saved: ' + e.message);
      }

      // 3. last valid value, once the process is initialized
      overlay.step(3);
      if (c.fallback) {
        setStatus('Setting the last valid value ...');
        overlay.progress(null);
        let done = false;
        for (let attempt = 0; attempt < 24 && alive && !done; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          const res = await apiCall('/api/fallback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sequence: c.fallback.sequence, value: c.fallback.value }),
          });
          done = res.ok;
        }
        if (!done) notes.push(`The last valid value (${c.fallback.value}) could not be set. Set it on the dashboard.`);
      }

      overlay.close();
      picker.setBusy(false);
      firework.launch('Backup of firmware v16 imported', 'success', 5000);
      notes.push('Check the result under Configuration (markers, regions) and System > Setup.');
      await confirmDialog({ title: 'Import finished', text: notes.join('\n'), okLabel: 'OK', cancelLabel: 'Close' });
      onImported?.();
    };

    const startRestore = async () => {
      const file = picker.file();
      if (file && legacy) {
        if (!(await confirmDialog({
          title: 'Import this v16 backup?',
          text: 'The settings of config.ini are converted and written to the device. Images and models are copied, network settings stay as they are.',
          okLabel: 'Import',
        }))) return;
        r.startRestore.disabled = true;
        picker.setBusy(true);
        await runLegacyImport();
        return;
      }
      if (!file || !(await confirmDialog({
        title: 'Restore this backup?',
        text: 'The existing configuration is overwritten by the selected backup and the device restarts.',
        okLabel: 'Restore',
        danger: true,
      }))) return;

      r.startRestore.disabled = true;
      picker.setBusy(true);
      overlay.open('Restoring backup', 'Uploading ...', ['Upload', 'Restore', 'Restart'], { expected: 60 });
      overlay.step(1);
      overlay.progress(0);

      const res = await Api.ota.upload(file, (loaded, total) => {
        const percent = Math.round((loaded / total) * 100);
        overlay.progress(percent, `${(loaded / 1048576).toFixed(2)} of ${(total / 1048576).toFixed(2)} MB`);
        overlay.text(`${percent} % uploaded. Please wait ...`);
      });
      if (!alive) return;
      if (!res.ok) {
        console.error('OTA upload failed:', res.message);
        overlay.fail('Upload failed', res.message, unlock);
        return;
      }

      // the package is processed during the restart: that is the restore step, the restart is over when the device answers again
      overlay.step(2);
      overlay.title('Restoring ...');
      overlay.text('The device restores the configuration and restarts. This page reloads automatically. Do not unplug the device.');
      overlay.progress(null);

      const result = await Api.ota.rebootAndWait({ cancelled: () => !alive });
      if (!alive) return;
      if (result === 'online') {
        overlay.step(3);
        overlay.title('Backup restored');
        overlay.text('Reloading ...');
        reloadApp();
      } else if (result === 'timeout') {
        overlay.fail('Restore takes unusually long', 'Reload this page or power cycle the device.', unlock);
      }
    };

    const onClick = (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'restore') {
        if (!btn.disabled) startRestore();
      } else if (btn.dataset.action === 'clear-file') {
        picker.clear();
        r.startRestore.disabled = true;
      }
    };
    host.addEventListener('click', onClick);
    return {
      destroy() {
        alive = false;
        overlay.close();
        host.removeEventListener('click', onClick);
        host.textContent = '';
      },
    };
  }

  App.mountRestore = mountRestore; // the wizard offers the same restore at its start

  App.register('system-backup', {
    title: 'Backup / Restore',

    mount(root) {
      root.classList.add('sys', 'sys-backup');
      root.innerHTML = backupTemplate();
      const r = collectRefs(root);
      let alive = true;
      this._stop = () => { alive = false; };

      const restore = mountRestore(r.restoreHost);
      this._restore = restore;

      const log = (text, cls = '') => {
        const line = App.el('div', cls ? `sys-log-${cls}` : '', String(text));
        r.log.append(line);
        r.log.scrollTop = r.log.scrollHeight;
      };

      const backupProgress = (done, total, label) => {
        r.backupProg.hidden = false;
        r.backupBar.value = total ? Math.round((done / total) * 100) : 0;
        r.backupState.textContent = label;
        r.backupCount.textContent = total ? `${done} of ${total} files` : '';
      };

      const failBackup = (msg) => {
        log(msg, 'err');
        r.backupState.textContent = 'Failed';
        r.startBackup.disabled = false;
      };

      // Read one file with growing timeouts, gives up after BACKUP_MAX_RETRIES
      const fetchWithRetry = async (path, name, index, total) => {
        for (let retry = 0; ; retry++) {
          if (!alive) throw new Error('cancelled');
          if (retry === 0) log(`- ${name} (${index + 1}/${total})`);
          else log(`   Retrying (${retry})...`, 'dim');
          backupProgress(index, total, (retry === 0 ? 'Reading ' : 'Retrying ') + name);

          try {
            return await Api.files.read(path, { timeout: BACKUP_RETRY_TIMEOUTS[Math.min(retry, BACKUP_RETRY_TIMEOUTS.length - 1)] });
          } catch (e) {
            console.error(`Failed to fetch ${path}: ${e.message}`);
            if (retry >= BACKUP_MAX_RETRIES) throw new Error(`Failed to fetch ${name} (${e.message})`);
          }
        }
      };

      const startBackup = async () => {
        r.startBackup.disabled = true;
        r.log.textContent = '';
        backupProgress(0, 0, 'Collecting files ...');

        let hostname;
        try {
          hostname = await Api.system.infoQuiet('hostname');
        } catch (e) {
          return failBackup(`Failed to get hostname. Error: ${e.message}`);
        }

        log('Getting file list...');
        let files;
        try {
          files = await Api.files.listRecursive(BACKUP_BASE_PATH);
        } catch (e) {
          return failBackup(`Failed to get file list. Error: ${e.message}`);
        }

        if (files.length === 0) {
          log('No files', 'err');
          r.backupState.textContent = 'No files found';
          r.startBackup.disabled = false;
          return;
        }

        log('Processing files...');
        const zipFiles = {};
        try {
          for (let i = 0; i < files.length; i++) {
            const rel = files[i].path.substring(BACKUP_BASE_PATH.length); // relative to /config/
            zipFiles['config/' + rel] = await fetchWithRetry(files[i].path, rel, i, files.length);
          }
        } catch (e) {
          if (!alive) return;
          log(`Backup failed. Error: ${e.message}`, 'err');
          r.backupState.textContent = 'Failed';
          r.startBackup.disabled = false;
          return;
        }
        log('All files processed');

        log('Creating zip file...');
        try {
          await loadScript('/fflate.min.js');
          const timestamp = timestampNow();
          zipFiles['meta.json'] = new TextEncoder().encode(JSON.stringify({ app: BACKUP_APP_NAME, timestamp }, null, 2));
          const zipData = fflate.zipSync(zipFiles, { level: 6 });
          const backupFileName = `${hostname}_${timestamp}.zip`;
          downloadBlob(zipData, backupFileName);
          backupProgress(files.length, files.length, 'Done: ' + backupFileName);
          log(`Backup completed: ${backupFileName}`);
          firework.launch(`Backup completed: ${backupFileName}`, 'success', 5000);
          r.startBackup.disabled = false;
        } catch (err) {
          console.error('ZIP creation error:', err);
          log('Failed to create ZIP file. Error: ' + err.message, 'err');
          r.backupState.textContent = 'Failed';
          r.startBackup.disabled = false;
        }
      };

      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        switch (btn.dataset.action) {
          case 'backup': if (!btn.disabled) startBackup(); break;
          case 'open-files':
            e.preventDefault();
            App.navigate('#/system/files?path=' + BACKUP_BASE_PATH);
            break;
        }
      });
    },

    unmount() {
      this._stop?.();
      this._restore?.destroy();
    },
  });

  /* ======================================================================== */
  /* View: system-files                                                       */
  /* ======================================================================== */

  const FILES_MAX_FILE_SIZE = 16000 * 1024;
  const FILES_MAX_PATH_LENGTH = 100;

  function filesTemplate() {
    return `
      <div class="container">
        ${viewHeader('File Explorer', 'Browse, upload and download files on the SD card.')}
        <div class="container-content">
          <div class="card">
            <div class="sys-bar">
              <button class="button ghost" type="button" data-r="up" data-action="up" disabled>Up</button>
              <nav class="sys-crumbs" data-r="crumbs" aria-label="Path"></nav>
              <span class="sys-grow"></span>
              <input type="text" data-r="filter" placeholder="Filter files" autocomplete="off" />
              <button class="button" type="button" data-r="zip" data-action="zip" title="Save all files in actual path as ZIP file">Save all (ZIP)</button>
            </div>
          </div>

          <div class="card sys-dz-card">
            <div class="sys-dropzone" data-r="dropZone" tabindex="0" role="button" aria-label="Upload files: drop files here or press Enter to browse">
              <div class="sys-dz-icon"></div>
              <div class="sys-dz-title">Drop files here</div>
              <div class="sys-dz-sub">or <span class="sys-dz-link">browse</span> &middot; uploads to <b data-r="dzTarget">/</b></div>
              <div class="sys-dz-hint">Up to 16 MB per file. Existing files with the same name are replaced.</div>
              <input type="file" data-r="newfile" multiple hidden />
            </div>
            <div class="sys-queue" data-r="queue" hidden></div>
          </div>

          <div class="sys-list" data-r="list"></div>
        </div>
      </div>`;
  }

  function normalizeDirPath(p) {
    let path = String(p || '/').trim().replace(/^\/fileserver(?=\/|$)/, '');
    const parts = path.split('/').filter((s) => s && s !== '.' && s !== '..');
    return parts.length ? '/' + parts.join('/') + '/' : '/';
  }

  const filesHash = (dirPath) => '#/system/files?path=' + encodeURIComponent(dirPath).replace(/%2F/g, '/');

  App.register('system-files', {
    title: 'File Explorer',

    mount(root, ctx) {
      root.classList.add('sys', 'sys-files');
      root.innerHTML = filesTemplate();
      const r = collectRefs(root);

      const cleanups = []; // document listeners, timers
      let alive = true;
      let loadToken = 0;
      let uploading = false;
      let dirPath = '/';
      let entries = [];
      let truncated = false;
      let sort = { key: 'type', dir: 1 };
      let listError = '';
      let loading = false;

      this._stop = () => {
        alive = false;
        cleanups.forEach((fn) => fn());
        cleanups.length = 0;
      };

      const uploadQueue = [];

      // ------------------------------------------------------------------ breadcrumbs
      const renderBreadcrumb = () => {
        r.crumbs.textContent = '';
        const parts = dirPath.split('/').filter(Boolean);

        const addLink = (text, path) => {
          const a = App.el('a', '', text);
          a.href = filesHash(path);
          a.dataset.action = 'open';
          a.dataset.path = path;
          r.crumbs.append(a);
        };
        const addCurrent = (text) => r.crumbs.append(App.el('span', 'sys-crumb-current', text));
        const addSep = () => r.crumbs.append(App.el('span', 'sys-crumb-sep', '/'));

        if (parts.length === 0) {
          addCurrent('SD card');
        } else {
          addLink('SD card', '/');
          let acc = '/';
          parts.forEach((part, i) => {
            addSep();
            acc += part + '/';
            if (i === parts.length - 1) addCurrent(part);
            else addLink(part, acc);
          });
        }

        r.up.disabled = parts.length === 0;
        r.dzTarget.textContent = dirPath;
      };

      // ------------------------------------------------------------------ list
      const sortedEntries = () => {
        const q = r.filter.value.trim().toLowerCase();
        const list = entries.filter((e) => !q || e.name.toLowerCase().includes(q));
        const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        const cmp = {
          name: byName,
          type: (a, b) => (a.isDir === b.isDir ? byName(a, b) : a.isDir ? -1 : 1),
          size: (a, b) => (a.size ?? -1) - (b.size ?? -1) || byName(a, b),
        }[sort.key];
        return list.sort((a, b) => cmp(a, b) * sort.dir);
      };

      const renderList = () => {
        r.list.textContent = '';

        if (loading) {
          r.list.append(App.el('div', 'sys-empty', 'Loading ...'));
          return;
        }
        if (listError) {
          r.list.append(App.el('div', 'sys-empty', listError));
          return;
        }

        const rows = sortedEntries();
        if (rows.length === 0) {
          r.list.append(App.el('div', 'sys-empty', entries.length ? 'No files match the filter.' : 'This folder is empty.'));
        } else {
          const table = document.createElement('table');
          table.className = 'sys-table';
          const head = table.createTHead().insertRow();
          [['name', 'Name'], ['type', 'Type'], ['size', 'Size']].forEach(([key, label]) => {
            const th = document.createElement('th');
            th.textContent = label + (sort.key === key ? (sort.dir > 0 ? ' ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â´' : ' ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾') : '');
            th.dataset.action = 'sort';
            th.dataset.key = key;
            head.append(th);
          });
          head.append(App.el('th', '', 'Actions'));

          const body = table.createTBody();
          for (const entry of rows) {
            const tr = body.insertRow();

            const nameCell = tr.insertCell();
            const a = App.el('a', 'sys-name' + (entry.isDir ? ' sys-dir' : ''), entry.name);
            if (entry.isDir) {
              a.href = filesHash(entry.path + '/');
              a.dataset.action = 'open';
              a.dataset.path = entry.path + '/';
            } else {
              a.href = Api.files.downloadUrl(entry.path);
              a.target = '_blank';
              a.rel = 'noopener noreferrer';
            }
            nameCell.append(a);

            const typeCell = tr.insertCell();
            typeCell.append(App.el('span', 'chip', entry.isDir ? 'directory' : 'file'));

            tr.insertCell().textContent = entry.isDir ? '-' : listSize(entry.size);

            const actions = tr.insertCell();
            if (entry.protected) {
              actions.textContent = '-';
            } else {
              actions.className = 'sys-actions';
              const del = App.el('button', 'button sys-act sys-act-delete', 'Delete');
              del.type = 'button';
              del.title = entry.isDir ? 'Delete folder' : 'Delete file';
              del.dataset.action = 'delete';
              del.dataset.path = entry.path;
              del.dataset.isdir = entry.isDir ? '1' : '';
              del.dataset.name = entry.name;
              const dl = App.el('button', 'button sys-act', 'Download');
              dl.type = 'button';
              dl.title = 'Download/Save file';
              dl.dataset.action = 'download';
              dl.dataset.path = entry.path;
              dl.dataset.name = entry.name;
              dl.dataset.isdir = entry.isDir ? '1' : '';
              actions.append(del, dl);
            }
          }
          r.list.append(table);
        }

        if (truncated) {
          const note = App.el('div', 'sys-trunc');
          note.append('Directory listing is truncated to 100 items. ');
          const btn = App.el('button', 'button btn-wide', 'Load all items (Be patient, it might take longer!)');
          btn.type = 'button';
          btn.dataset.action = 'load-all';
          note.append(btn);
          r.list.append(note);
        }
      };

      const refresh = async ({ all = false } = {}) => {
        const token = ++loadToken;
        loading = true;
        listError = '';
        renderBreadcrumb();
        renderList();

        try {
          const list = await Api.files.list(dirPath, { all });
          if (!alive || token !== loadToken) return;
          entries = list;
          truncated = !!list.truncated;
        } catch (e) {
          if (!alive || token !== loadToken) return;
          entries = [];
          truncated = false;
          listError = `Could not open this folder: ${e.message}`;
          console.error('Directory listing failed', e);
          firework.launch(`Loading directory failed: ${e.message}`, 'danger', 10000);
        }
        loading = false;
        r.zip.disabled = false;
        renderList();
      };

      const setPath = (p) => {
        dirPath = normalizeDirPath(p);
        r.filter.value = '';
        r.dzTarget.textContent = dirPath;
      };

      // ------------------------------------------------------------------ actions
      const zipAll = async () => {
        const toastId = firework.launch('Saving all listed files. Please wait...', 'warning', 120000);
        r.zip.disabled = true;
        const zipFiles = {};
        let skipped = 0;

        try {
          await loadScript('/fflate.min.js');
          const files = (truncated ? await Api.files.list(dirPath, { all: true }) : entries).filter((e) => !e.isDir);
          for (const file of files) {
            try {
              zipFiles[file.name] = await Api.files.read(file.path, { timeout: 60000 });
            } catch (e) {
              skipped++;
              console.error(`Failed to fetch ${file.name}:`, e.message);
            }
          }

          if (Object.keys(zipFiles).length === 0) {
            firework.launch('No files to save in this folder', 'warning', 5000);
            return;
          }

          const zipData = fflate.zipSync(zipFiles, { level: 6 });
          const base = dirPath.replace(/^\/+|\/+$/g, '').replace(/\//g, '_') || 'sdcard';
          const filename = `${base}_${timestampNow()}.zip`;

          downloadBlob(zipData, filename);
          firework.launch(`Archive saved: ${filename}`, 'success', 3000);
          if (skipped) firework.launch(`${skipped} file(s) could not be fetched and are missing in the archive`, 'warning', 10000);
        } catch (err) {
          console.error('Error creating ZIP:', err);
          firework.launch('Failed to create ZIP file', 'danger', 30000);
        } finally {
          firework.dismiss(toastId);
          if (alive) r.zip.disabled = false;
        }
      };

      const deleteEntry = async (name, path, isDir) => {
        if (!(await confirmDialog({
          title: isDir ? 'Delete folder?' : 'Delete file?',
          text: isDir
            ? `'${name}' and everything in it will be removed. This can take a while.`
            : `'${name}' will be removed from the SD card.`,
          okLabel: 'Delete',
          danger: true,
        }))) return;

        if (await Api.files.remove(path, isDir)) {
          firework.sticky('Deletion completed', 'success', 2000);
          if (alive) refresh();
        }
      };

      const downloadEntry = (name, path) => {
        const link = document.createElement('a');
        link.href = Api.files.downloadUrl(path);
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        firework.launch(`File saved: ${name}`, 'success', 3000);
      };

      // ------------------------------------------------------------------ upload: drag and drop, queue with progress
      const addToQueue = (file) => {
        const item = { file, name: file.name, status: 'waiting' };

        const row = App.el('div', 'sys-q-row');
        const name = App.el('span', 'sys-q-name');
        const size = App.el('span', 'sys-q-size', listSize(file.size));
        const status = App.el('span', 'sys-q-status');
        const bar = App.el('div', 'sys-q-bar');
        const fill = document.createElement('i');
        bar.append(fill);
        row.append(name, size, status, bar);

        item.setStatus = (text, cls = '') => {
          status.textContent = text;
          status.className = 'sys-q-status ' + cls;
          row.classList.toggle('done', cls === 'done');
          row.classList.toggle('error', cls === 'error');
        };
        item.setName = (text) => {
          name.textContent = text;
          name.title = text;
        };
        item.setProgress = (pct) => {
          fill.style.width = pct + '%';
        };

        item.setName(file.name);
        item.setStatus('Waiting');
        uploadQueue.push(item);

        r.queue.hidden = false;
        r.queue.append(row);
        return item;
      };

      const uploadOne = async (item) => {
        // spaces are not allowed in paths on the device
        if (item.name.includes(' ')) {
          item.name = item.name.replace(/\s+/g, '_');
          item.setName(item.name + ' (renamed)');
        }
        const remotePath = dirPath + item.name;

        if (item.file.size > FILES_MAX_FILE_SIZE) {
          item.setStatus('Larger than 16 MB', 'error');
          item.status = 'error';
          return;
        }
        if (remotePath.length > FILES_MAX_PATH_LENGTH) {
          item.setStatus('Path too long (max. 100 characters)', 'error');
          item.status = 'error';
          return;
        }

        item.setStatus('Uploading 0 %');
        const res = await Api.files.upload(remotePath, item.file, (pct) => {
          item.setProgress(pct);
          item.setStatus('Uploading ' + pct + ' %');
        });
        if (res.ok) {
          item.setProgress(100);
          item.setStatus('Done', 'done');
          item.status = 'done';
        } else {
          item.setStatus(res.message, 'error');
          item.status = 'error';
        }
      };

      const processQueue = async () => {
        if (uploading) return;
        uploading = true;
        for (const item of uploadQueue.filter((i) => i.status === 'waiting')) {
          await uploadOne(item);
        }
        uploading = false;

        const done = uploadQueue.filter((i) => i.status === 'done').length;
        if (done > 0) {
          firework.launch(done === 1 ? 'Upload completed' : done + ' files uploaded', 'success', 2500);
          const timer = setTimeout(() => {
            r.queue.textContent = '';
            r.queue.hidden = true;
            uploadQueue.length = 0;
            if (alive) refresh();
          }, 1200);
          cleanups.push(() => clearTimeout(timer));
        }
      };

      const addFiles = (files) => {
        for (const file of files) addToQueue(file);
        processQueue();
      };

      const setupDropZone = () => {
        const zone = r.dropZone;
        const input = r.newfile;

        zone.addEventListener('click', () => input.click());
        input.addEventListener('click', (e) => e.stopPropagation());
        zone.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            input.click();
          }
        });
        input.addEventListener('change', () => {
          addFiles([...input.files]);
          input.value = '';
        });

        // the whole page accepts drops, the zone lights up
        const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
        let depth = 0;
        const onDragEnter = (e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          depth++;
          zone.classList.add('over');
        };
        const onDragOver = (e) => {
          if (hasFiles(e)) e.preventDefault();
        };
        const onDragLeave = () => {
          depth = Math.max(0, depth - 1);
          if (depth === 0) zone.classList.remove('over');
        };
        const onDrop = (e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          depth = 0;
          zone.classList.remove('over');

          const files = [];
          const items = [...(e.dataTransfer.items || [])];
          let folders = 0;
          if (items.length && items[0].webkitGetAsEntry) {
            items.forEach((it) => {
              const entry = it.webkitGetAsEntry();
              if (entry && entry.isDirectory) folders++;
              else if (it.getAsFile()) files.push(it.getAsFile());
            });
          } else {
            files.push(...e.dataTransfer.files);
          }
          if (folders) firework.launch('Folders cannot be uploaded. Drop files only', 'warning', 5000);
          if (files.length) addFiles(files);
        };

        const handlers = { dragenter: onDragEnter, dragover: onDragOver, dragleave: onDragLeave, drop: onDrop };
        for (const [ev, fn] of Object.entries(handlers)) {
          document.addEventListener(ev, fn);
          cleanups.push(() => document.removeEventListener(ev, fn));
        }
      };

      // ------------------------------------------------------------------ events
      root.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target || target.disabled) return;
        const d = target.dataset;
        switch (d.action) {
          case 'open':
            e.preventDefault();
            App.navigate(filesHash(d.path));
            break;
          case 'up': {
            const parts = dirPath.split('/').filter(Boolean);
            parts.pop();
            App.navigate(filesHash(parts.length ? '/' + parts.join('/') + '/' : '/'));
            break;
          }
          case 'sort':
            sort = sort.key === d.key ? { key: d.key, dir: -sort.dir } : { key: d.key, dir: 1 };
            renderList();
            break;
          case 'zip': zipAll(); break;
          case 'delete': deleteEntry(d.name, d.path, !!d.isdir); break;
          case 'download': downloadEntry(d.name, d.path); break;
          case 'load-all': refresh({ all: true }); break;
        }
      });
      r.filter.addEventListener('input', renderList);

      setupDropZone();
      setPath(ctx.query.get('path'));
      refresh();

      // sub route handler: only the query changed
      this._route = (newCtx) => {
        setPath(newCtx.query.get('path'));
        refresh();
      };
    },

    // router calls route(ctx) when the view stays mounted
    route(ctx) {
      this._route?.(ctx);
    },

    unmount() {
      this._stop?.();
    },
  });

  /* ======================================================================== */
  /* View: system-mcp (optional MCP server of the device for AI assistants)   */
  /* ======================================================================== */

  App.register('system-mcp', {
    title: 'MCP',

    mount(root) {
      root.classList.add('cfg', 'sys', 'sys-mcp');
      const url = `${location.origin}/mcp`;
      const switchRow = (label, ref, textRef, hint = '') => `
        <div class="cfg-row cfg-l0">
          <div class="cfg-label"><span>${label}</span></div>
          <div class="cfg-ctl">
            <span class="cfg-switch-wrap">
              <label class="cfg-switch"><input type="checkbox" data-r="${ref}" aria-label="${label}" /><span></span></label>
              <span class="cfg-switch-text" data-r="${textRef}">Off</span>
            </span>
            ${hint ? `<span class="mcp-hint">${hint}</span>` : ''}
          </div>
        </div>`;
      root.innerHTML = `
        <div class="container">
          ${viewHeader('MCP', 'Let an AI assistant such as Claude work with this device (beta).')}
          <div class="container-content">

            <div class="card cfg-card">
              <div class="card-header"><span class="cfg-card-title">MCP server</span><span class="beta-pill">Beta</span></div>
              <div class="card-body cfg-body">
                <div class="mcp-note"><b>Beta:</b> new, first tested on a device (reading, moving a region) but not yet over a longer time. The assistant can read the device, move alignment markers and regions, change settings and start cycles.
                  It is off by default. Everyone with the token has this access, so use it only in a network you trust.</div>
                ${switchRow('Server', 'on', 'onText')}
                ${switchRow('System actions', 'sys', 'sysText', 'delete files, reboot, update')}
                <div class="cfg-row cfg-l0">
                  <div class="cfg-label"><span>Access token</span></div>
                  <div class="cfg-ctl">
                    <span class="mcp-hint" data-r="tokenText"></span>
                    <button class="button" type="button" data-r="renew">Create new token</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="card cfg-card">
              <div class="card-header"><span class="cfg-card-title">Connect an assistant</span></div>
              <div class="card-body cfg-body">
                <div class="mcp-step">
                  <div class="mcp-step-title">Endpoint</div>
                  <div class="mcp-snippet"><code class="mcp-code" data-r="endpoint"></code><button class="button" type="button" data-copy="endpoint">Copy</button></div>
                </div>
                <div class="mcp-step">
                  <div class="mcp-step-title">Claude Code <span class="mcp-hint">(terminal)</span></div>
                  <div class="mcp-snippet"><code class="mcp-code" data-r="cc"></code><button class="button" type="button" data-copy="cc">Copy</button></div>
                </div>
                <div class="mcp-step">
                  <div class="mcp-step-title">Claude Desktop <span class="mcp-hint">(add to claude_desktop_config.json, needs Node.js)</span></div>
                  <div class="mcp-snippet"><code class="mcp-code mcp-pre" data-r="desktop"></code><button class="button" type="button" data-copy="desktop">Copy</button></div>
                </div>
                <div class="mcp-hint" data-r="snippetNote"></div>
                <div class="mcp-hint">The web version of Claude (claude.ai) cannot reach a device in your home network. Other MCP clients: server type
                  "streamable HTTP", header <code>Authorization: Bearer &lt;token&gt;</code>.</div>
              </div>
            </div>

            <div class="card cfg-card">
              <div class="card-header"><span class="cfg-card-title">What the assistant can do</span></div>
              <div class="card-body cfg-body">
                <div class="mcp-tools">
                  <div><b>Read</b><span>status, live progress, recognition with confidence, configuration, images (reference, aligned, regions, markers), camera picture, log, files</span></div>
                  <div><b>Change</b><span>settings, alignment markers and regions, marker images, fallback value, start a cycle, pause the countdown</span></div>
                  <div><b>System</b><span>delete files, reboot, firmware update (only with "System actions")</span></div>
                </div>
                <div class="mcp-hint">Changes are refused while a cycle runs. Example: the assistant looks at the reference image, places the markers, starts a cycle and
                  checks the alignment result until it fits.</div>
              </div>
            </div>

          </div>
        </div>`;
      const r = collectRefs(root);
      let alive = true;
      let st = null; // state of the device
      this._stop = () => { alive = false; };

      r.endpoint.textContent = url;

      const snippetsFor = (t) => {
        const cc = `claude mcp add --transport http ai-on-the-edge ${url} --header "Authorization: Bearer ${t}"`;
        const desktop = [
          '{',
          '  "mcpServers": {',
          '    "ai-on-the-edge": {',
          '      "command": "npx",',
          `      "args": ["-y", "mcp-remote", "${url}", "--allow-http", "--header", "Authorization:\${AI_TOKEN}"],`,
          `      "env": { "AI_TOKEN": "Bearer ${t}" }`,
          '    }',
          '  }',
          '}',
        ].join('\n');
        return { cc, desktop };
      };
      const snippets = () => {
        const sn = snippetsFor('<token>');
        r.cc.textContent = sn.cc;
        r.desktop.textContent = sn.desktop;
        r.snippetNote.textContent = 'Replace <token> with your access token. The device shows it only once, when it is created.';
      };

      const sync = () => {
        r.on.checked = !!st?.enabled;
        r.on.disabled = !st;
        r.onText.textContent = st?.enabled ? 'On' : 'Off';
        r.sys.checked = !!st?.allowSystem;
        r.sys.disabled = !st?.enabled;
        r.sysText.textContent = st?.allowSystem ? 'On' : 'Off';
        r.renew.disabled = !st || (!st.enabled && !st.tokenSet);
        r.tokenText.textContent = !st
          ? 'Not available: the firmware has no MCP server.'
          : st.tokenSet ? 'A token is set. It stays valid after a restart.' : 'No token yet. It is created when you switch the server on.';
        snippets();
      };

      const apply = async (change) => {
        const next = await Api.mcp.set(change);
        if (!alive) return;
        if (next) {
          st = next;
        }
        sync();
        if (next?.token) {
          // the new token is shown in a dialog, not on the page: it is gone when the dialog is closed
          await tokenDialog({
            title: 'Your new access token',
            text: 'Copy it now. It is shown only once; the device keeps just a hash of it.',
            token: next.token,
          });
        }
      };

      root.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const text = btn.dataset.copy ? r[btn.dataset.copy].textContent : null;
        if (text === null) return;
        await copyWithFeedback(btn, text);
      });
      r.on.addEventListener('change', async () => {
        await apply({ enabled: r.on.checked });
      });
      r.sys.addEventListener('change', async () => {
        if (r.sys.checked && !(await confirmDialog({
          title: 'Allow system actions?',
          text: 'The AI assistant can then delete files and folders on the SD card, restart the device and start a firmware update.',
          okLabel: 'Allow',
          danger: true,
        }))) {
          r.sys.checked = false;
          return;
        }
        await apply({ allowSystem: r.sys.checked });
      });
      r.renew.addEventListener('click', async () => {
        if (!(await confirmDialog({
          title: 'Create a new token?',
          text: 'The current token stops working at once. Every AI client has to be set up again with the new token.',
          okLabel: 'Create new token',
          danger: true,
        }))) return;
        await apply({ regenerate: true });
      });

      root.querySelectorAll('[data-copy]').forEach(prepareCopyButton);
      sync();
      Api.mcp.get().then((s) => { if (!alive) return; st = s; sync(); });
    },

    unmount() {
      this._stop?.();
    },
  });

  /* ======================================================================== */
  /* View: system-reboot                                                      */
  /* ======================================================================== */

  App.register('system-reboot', {
    title: 'Reboot',

    mount(root, ctx) {
      root.classList.add('sys', 'sys-reboot');
      root.innerHTML = `
        <div class="container">
          ${viewHeader('Reboot', 'Restart the device. Your settings are kept.')}
          <div class="container-content">
            <div class="card" data-r="request">
              <div class="card-header"><span>Reboot device</span></div>
              <div class="side-body">
                <div class="sys-muted">The device is not reachable for about 10 to 20 seconds. This page opens the dashboard again as soon as it is back.</div>
                <div class="btn-row">
                  <button class="button btn-action" type="button" data-r="reboot" data-action="reboot">Reboot now</button>
                </div>
              </div>
            </div>

          </div>
        </div>`;
      const r = collectRefs(root);
      let alive = true;
      let inFlight = false;
      const overlay = createUpdateOverlay();
      this._stop = () => {
        alive = false;
        overlay.close();
      };

      const unlock = () => {
        inFlight = false;
        r.reboot.disabled = false;
      };

      // wait until the device is back, then reload the app
      const rebootChecker = async () => {
        const result = await Api.ota.rebootAndWait({ interval: 2000, cancelled: () => !alive });
        if (!alive) return;

        if (result === 'online') {
          overlay.title('Device is back');
          overlay.text('Reloading ...');
          reloadApp();
          return;
        }
        // 120 seconds elapsed but device is not ready yet
        overlay.fail('Reboot takes unusually long', 'Retry the reboot or power cycle the device.', unlock);
      };

      const doReboot = async () => {
        if (inFlight) return;
        inFlight = true;
        r.reboot.disabled = true;

        if (await Api.system.reboot()) {
          if (!alive) return;
          overlay.open('Rebooting ...', 'The device restarts and is not reachable for about 10 to 20 seconds. This page reloads automatically.');
          overlay.progress(null);
          rebootChecker();
        } else if (alive) {
          unlock();
        }
      };

      const requestReboot = async () => {
        if (await confirmDialog({
          title: 'Reboot device?',
          text: 'The device is not reachable for about 10 to 20 seconds.',
          okLabel: 'Reboot',
        })) doReboot();
      };

      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="reboot"]')) requestReboot();
      });

      // Trigger the reboot directly with #/system/reboot?now=1
      if (ctx?.query?.get('now') === '1') doReboot();
    },

    unmount() {
      this._stop?.();
    },
  });
})();

/* ========================================================================== */
/* View: dashboard                                                            */
/* ========================================================================== */

/* ==========================================================================
   Dashboard part: views `dashboard` and `recognition`, Api.process, Api.mqtt
   ========================================================================== */
(function () {
  'use strict';

  // ------------------------------------------------------------------------
  // Api layer (the only place that knows the legacy firmware endpoints)
  // ------------------------------------------------------------------------
  const CYCLE_START_NOTIFY = {
    '001': { msg: 'Cycle start triggered', type: 'success', time: 2000 },
    '002': { msg: 'Cycle start scheduled. Start new cycle after actual cycle is completed', type: 'success', time: 3000 },
    '003': { msg: "Cycle start triggered. Restore from state 'Initialization Delayed'", type: 'success', time: 3000 },
    '099': { msg: 'Cycle start rejected. Process not (yet) initialized', type: 'danger', time: 30000 },
  };

  // /log line: [x] 2024-01-01T12:00:00 <INF> [module] message
  const LOG_REGEX = /^(\[.*?\])\s+(.*?)\s+<(.*?)>\s+\[(.*?)\]\s+(.*)/;
  const LOG_MAX_LINES = 40;

  Api.process = {
    /**
     * Live process data. Legacy endpoint: GET /process_data (JSON).
     * @param {AbortSignal} [signal]
     * @returns {Promise<object|null>} null when the device does not answer
     */
    async get(signal) {
      const res = await apiCall('/process_data', { signal }, { parseType: 'json' });
      if (!res.ok || !res.data) {
        if (res.error !== 'aborted') console.warn('Process data request failed:', res.error ?? res.status);
        return null;
      }
      return res.data;
    },

    /**
     * Latest log entries, newest first, debug lines dropped. Legacy endpoint: GET /log (plain text).
     * @returns {Promise<Array<{ts:string,lvl:string,mod:string,msg:string}>|null>} null = log not available
     */
    async log(signal, maxLines = LOG_MAX_LINES) {
      const res = await apiCall('/log', { signal });
      if (!res.ok || typeof res.data !== 'string') return res.error === 'aborted' ? undefined : null;

      const entries = [];
      const lines = res.data.split('\n');
      for (let i = lines.length - 1; i >= 0 && entries.length < maxLines; i--) {
        const m = lines[i].match(LOG_REGEX);
        if (!m || m[3] === 'DBG') continue;
        entries.push({ ts: m[2].replace('T', ' ').substring(0, 19), lvl: m[3], mod: m[4], msg: m[5] });
      }
      return entries;
    },

    /**
     * Manual cycle start. POST /api/cycle -> {ok, code, message}.
     * @returns {Promise<{ok:boolean, code:string|null}>} code 001 started, 002 queued, 003 init delay aborted
     */
    async cycleStart() {
      const res = await Api.post('/api/cycle', undefined, { action: 'Cycle start request', resultMsg: CYCLE_START_NOTIFY });
      if (!res.ok) return { ok: false, code: null };
      const code = jsonField(res.data, 'code');
      return { ok: true, code: CYCLE_START_NOTIFY[code] ? code : null };
    },

    /**
     * Pause or resume the countdown to the next automatic cycle (config mode). POST /api/cycle {paused}
     * @returns {Promise<boolean>}
     */
    async setPaused(paused) {
      const res = await Api.post('/api/cycle', { paused: !!paused }, {
        action: 'Pause request',
        resultMsg: {
          '004': { msg: 'Countdown paused. No automatic cycles until you resume', type: 'success', time: 3000 },
          '005': { msg: 'Countdown resumed', type: 'success', time: 2000 },
        },
      });
      return !!res.ok;
    },

    /**
     * Progress of the running cycle. GET /api/live
     * @returns {Promise<null | {running:boolean, state:string, cycle:number, raw:boolean, alignment:Object|null,
     *   rois:Array<{seq:string, kind:'digit'|'analog', name:string, value:string, confidence?:number, rejected:boolean}>}>} null: not available (older firmware)
     */
    async live(signal) {
      const res = await apiCall('/api/live', { signal, timeout: 8000 }, { parseType: 'json' });
      if (res.ok && res.data && res.data.api_name) return res.data;
      return res.status === 404 || res.status === 405 ? 'unsupported' : null; // null: no answer (the device is busy)
    },

    /**
     * State of the main process. GET /api/status
     * @returns {Promise<null | {state:string, stateCode:number, stateSeconds:number, cycle:number, autoStart:boolean,
     *   running:boolean, cycleStart:'ready'|'queued'|'unavailable', processInterval:number, processTime:number, uptime:number, error:number,
     *   nextRunSeconds:number (-1: not waiting), paused:boolean, lastSuccessSeconds:number (-1: none), lastSuccess:string}>}
     */
    async status(signal) {
      const res = await apiCall('/api/status', { signal, timeout: 8000 }, { parseType: 'json' });
      return res.ok && res.data ? res.data : null;
    },

    /**
     * Set the fallback value of a sequence. POST /api/fallback {sequence, value}
     * @returns {Promise<boolean>}
     */
    async setFallbackValue(sequence, value) {
      const res = await Api.post('/api/fallback', { sequence, value: String(value) }, {
        action: 'Fallback value update',
        loadingMsg: 'Updating fallback value...',
        resultMsg: 'Fallback value successfully updated',
      });
      return !!res.ok;
    },

    /**
     * Full URL of an image of the last cycle (cache busted). Legacy: /img_tmp/<name>.
     * @param {string} name e.g. 'alg_roi.jpg' or a src returned by recognition()
     */
    imageUrl(name) {
      const path = String(name).startsWith('/') ? name : `/img_tmp/${name}`;
      return `${getDomainname()}${path}?v=${Date.now()}`;
    },

    /**
     * Result of the last completed recognition cycle. GET /api/recognition (MainFlowControl.cpp).
     * @returns {Promise<null | {ready:false, state:string} | {ready:true, sequences:Array<{
     *   name:string, rawValue:string, actualValue:string,
     *   digit:{enabled:boolean, rois:Array<{value:string, na:boolean, image:string|null}>},
     *   analog:{enabled:boolean, rois:Array<{value:string, na:boolean, image:string|null}>}
     * }>, image:string|null}>} null = request failed
     */
    async recognition(signal) {
      const res = await apiCall('/api/recognition', { signal }, { parseType: 'json' });
      if (!res.ok || !res.data) return null;
      const d = res.data;
      if (!d.ready) return { ready: false, state: d.state ?? '' };

      // optional per ROI: confidence (0 to 100) and rect {x, y, w, h} in the aligned image (otherwise the configuration is used)
      const rois = (g) => ({
        enabled: !!g?.enabled,
        rois: (g?.rois ?? []).map((r) => ({
          value: r.valid ? r.value : 'N/A',
          na: !r.valid,
          image: r.valid ? r.image : null,
          confidence: typeof r.confidence === 'number' ? r.confidence : null,
          rect: r.rect && typeof r.rect.x === 'number' ? r.rect : null,
        })),
      });
      return {
        ready: true,
        sequences: d.sequences.map((s) => ({ name: s.name, rawValue: s.rawValue, actualValue: s.actualValue, digit: rois(s.digit), analog: rois(s.analog) })),
        image: d.image ?? null,
        // optional: raw camera image and the pose of the raw image against the aligned image (rotation in degrees, scale, shift in pixels)
        alignment: d.alignment && d.alignment.rawImage ? d.alignment : null,
      };
    },
  };

  Api.mqtt = Object.assign(Api.mqtt ?? {}, {
    /**
     * Schedule publishing of the Home Assistant discovery topics. POST /api/mqtt/discovery
     * @returns {Promise<boolean>}
     */
    async publishHaDiscovery() {
      const res = await Api.post('/api/mqtt/discovery', undefined, { action: 'HA discovery request' });
      if (!res.ok) return false;
      firework.launch("Publishing Home Assistant discovery topics scheduled. Will be processed during state 'Publish to MQTT'", 'success', 5000);
      return true;
    },
  });

  // ------------------------------------------------------------------------
  // Shared helpers
  // ------------------------------------------------------------------------
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const show = (v) => (v === null || v === undefined || v === '' ? '--' : String(v));

  // Status of a recognized ROI: ok / warn (uncertain) / err (not recognized or low confidence)
  const roiStatus = (roi) => (roi.na ? 'err' : roi.confidence === null || roi.confidence === undefined ? 'ok' : roi.confidence >= 90 ? 'ok' : roi.confidence >= 60 ? 'warn' : 'err');

  // Result tiles of one ROI kind (digit / analog): value of the recognition and the cut-out image
  const recRoiSection = (title, block, kind = '') => {
    const wrap = el('div', 'rec-roi-block');
    wrap.append(el('div', 'rec-roi-title', title));
    if (block.enabled && block.rois.length) {
      const grid = el('div', `rec-roi-grid${kind ? ` is-${kind}` : ''}`);
      for (const roi of block.rois) {
        const tile = el('div', 'rec-roi-tile');
        tile.dataset.status = roiStatus(roi);
        tile.dataset.roi = kind;
        if (!roi.na && roi.image) {
          const img = el('img', 'rec-roi-img');
          img.src = Api.process.imageUrl(roi.image);
          img.alt = `ROI ${roi.value}`;
          tile.append(el('div', 'rec-roi-value', roi.value), img);
        } else {
          tile.append(el('div', 'rec-roi-value na', 'N/A'), el('div', 'rec-roi-noimg', 'No image'));
        }
        grid.append(tile);
      }
      wrap.append(grid);
    } else {
      wrap.append(el('div', 'rec-roi-disabled', 'Disabled'));
    }
    return wrap;
  };

  // The reading as a counter: black wheels for the whole numbers, red wheels for the decimals ('N' = digit not recognized)
  // With the previous reading (`prev`) the wheels that changed roll on like an odometer: from the old digit up to the new one.
  const meterEl = (value, prev) => {
    const text = String(value).trim().replace(',', '.');
    const m = /^(-?)([0-9N]+)(?:\.([0-9N]+))?$/.exec(text);
    if (!m) return el('div', 'dash-hero-value', value); // not a number (e.g. 'Outdated'): plain text
    const meter = el('div', 'dash-meter');
    meter.setAttribute('role', 'img');
    meter.setAttribute('aria-label', `Meter reading ${text}`);
    const old = prev ? /^-?([0-9N]+)(?:\.([0-9N]+))?$/.exec(String(prev).trim().replace(',', '.')) : null;
    const oldDigits = old ? old[1] + (old[2] ?? '') : '';
    const newDigits = m[2] + (m[3] ?? '');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let pos = 0; // wheels counted from the left
    const wheels = (digits, cls) => {
      for (const d of digits) {
        const w = el('span', `dash-wheel ${cls}${d === 'N' ? ' dash-wheel-na' : ''}`);
        const from = oldDigits.length === newDigits.length ? oldDigits[pos] : undefined; // different length: no animation
        if (!reduce && from !== undefined && from !== d && /[0-9]/.test(from) && /[0-9]/.test(d)) {
          const steps = (Number(d) - Number(from) + 10) % 10; // 1..9: always forward
          const strip = el('span', 'dash-wheel-strip');
          for (let i = 0; i <= steps; i++) strip.append(el('span', '', String((Number(from) + i) % 10)));
          strip.style.setProperty('--steps', steps);
          strip.style.animationDelay = `${(newDigits.length - pos - 1) * 70}ms`; // the last wheel starts first
          strip.style.animationDuration = `${700 + steps * 90}ms`;
          w.classList.add('is-rolling');
          w.append(strip);
        } else {
          w.textContent = d;
        }
        meter.append(w);
        pos++;
      }
    };
    if (m[1]) meter.append(el('span', 'dash-meter-sign', 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢'));
    wheels(m[2], '');
    if (m[3]) {
      meter.append(el('span', 'dash-meter-dot'));
      wheels(m[3], 'dash-wheel-red');
    }
    return meter;
  };

  // ------------------------------------------------------------------------
  // View: dashboard
  // ------------------------------------------------------------------------
  const AUTO_REFRESH_MS = 5000; // fixed refresh interval (no user setting)

  const STATUS_TEXT = {
    '000': ['Valid'],
    W01: ['Empty / Invalid Data'],
    E91: ['Rate Negative', 'Use Fallback Value'],
    E92: ['Rate Too High (<)', 'Use Fallback Value'],
    E93: ['Rate Too High (>)', 'Use Fallback Value'],
  };

  const ERROR_STATES = [
    'initialization - delayed',
    'initialization failed',
    'setup mode',
    'idle - no autostart',
    'idle - waiting for autostart',
  ];

  const RSSI_THRESHOLDS = [-85, -78, -67, -55]; // Weak, Fair, Good, Excellent

  const DASH_HTML = `
    <div class="dash-syncbar" aria-hidden="true"></div>
    <header class="dash-head">
      <div>
        <div class="container-title">Dashboard</div>
        <div class="page-sub">Live reading and process state of your meter.</div>
      </div>
      <span class="dash-sync" role="status">Updating ...</span>
    </header>

    <main class="dash-grid">
      <div class="dash-side">
        <div class="dash-sequences" data-ref="sequences">
          <div class="card dash-hero">
            <div class="dash-hero-label">Sequence</div>
            <div class="dash-hero-value">--</div>
          </div>
        </div>

        <div class="dash-stats">
          <div class="stat wide">
            <div class="stat-label dash-state-head">
              <span>Process state</span>
              <span class="dash-pill" data-ref="stateTimer" hidden></span>
            </div>
            <div class="stat-value small" data-ref="state">--</div>
            <div class="dash-process-error" data-ref="error"></div>
          </div>
          <div class="stat wide">
            <div class="stat-label">Last successful run</div>
            <div class="stat-value small"><output data-ref="lastRun">--</output></div>
          </div>
          <div class="stat">
            <div class="stat-label dash-state-head">
              <span>Uptime</span>
              <span class="dash-pill" data-ref="cyclesPill" title="Cycles since the start" hidden></span>
            </div>
            <div class="stat-value"><output data-ref="uptime">--</output></div>
          </div>
          <div class="stat">
            <div class="stat-label">Services</div>
            <div class="dash-services">
              <div class="dash-service" data-ref="mqttBox" hidden><span>MQTT</span><span class="badge" data-ref="mqtt"></span></div>
              <div class="dash-service" data-ref="mcpBox" hidden><span>MCP</span><span class="badge" data-ref="mcp"></span></div>
              <div class="dash-service-none" data-ref="noServices">None active</div>
            </div>
          </div>
          <div class="stat wide" data-ref="rssiBox">
            <div class="stat-label">Wi-Fi signal</div>
            <div class="stat-value small">
              <svg class="dash-rssi" data-ref="rssiSvg" width="20" height="16" viewBox="0 0 24 16" fill="currentColor" style="overflow: visible">
                <rect class="bar" x="1" y="12" width="3" height="4" rx="1" />
                <rect class="bar" x="7" y="8" width="3" height="8" rx="1" />
                <rect class="bar" x="13" y="4" width="3" height="12" rx="1" />
                <rect class="bar" x="19" y="0" width="3" height="16" rx="1" />
              </svg>
              <output data-ref="rssi">-</output>
            </div>
          </div>
        </div>
      </div>

      <div class="card dash-image" data-ref="imageCard">
        <img class="dash-bg" data-ref="imgBg" alt="" aria-hidden="true" />
        <canvas class="dash-bg dash-bg-canvas" data-ref="bgCanvas" hidden aria-hidden="true"></canvas>
        <div class="dash-shade"></div>
        <img class="dash-img is-loading" data-ref="img" alt="Image view" />
        <canvas class="dash-canvas" data-ref="canvas" hidden></canvas>
        <div class="dash-stage" data-ref="stage" hidden></div>
        <button class="dash-replay" data-ref="replay" type="button" hidden title="Replay the reading" aria-label="Replay the reading">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5" /></svg>
        </button>
      </div>
    </main>

    <div class="dash-row">
      <section class="card dash-rec rec">
        <div class="card-header"><span>Recognition</span></div>
        <div class="dash-activity-sub">Result of the last completed cycle: what the AI read in each region.</div>
        <div class="rec-body" data-ref="recBody"><span class="dash-log-empty">Loading ...</span></div>
      </section>

      <section class="card dash-plot" data-ref="plotCard" hidden>
        <div class="card-header">
          <span>Readings</span>
          <div class="plot-range" data-ref="plotRange" role="group" aria-label="Time range"></div>
        </div>
        <div class="plot-body" data-ref="plotBody"></div>
      </section>
    </div>

    <section class="card dash-activity">
      <div class="card-header"><span>Activity</span></div>
      <div class="dash-activity-sub">Latest messages from the device.</div>
      <div class="dash-console" data-ref="log" aria-live="polite"><span class="dash-log-empty">Loading ...</span></div>
    </section>`;

  let dashSeq = 0;
  let dashActive = null; // state of the mounted dashboard view

  // ------------------------------------------------------------------------
  // Picture animation of the dashboard image card, in sync with the running cycle:
  // "Taking image" scene -> raw image grows out of the scan icon (as soon as the device has it) -> markers searched ->
  // image rotation -> alignment (shift) -> regions of interest -> zoom -> every region takes the color of its status as the
  // device evaluates it (the recognized digit pops up) -> zoom out. Everything is calculated in the browser.
  // The animation is a state machine: a step starts when its data is available (GET /api/live) and its minimum time is over.
  // Without live data (older firmware) and for the replay all data is there at once and the steps simply follow each other.
  // ------------------------------------------------------------------------
  function createImageReveal({ card, canvas, bgCanvas, stage }) {
    const ctx = canvas.getContext('2d');
    const bgCtx = bgCanvas.getContext('2d');
    const clamp = (t) => Math.max(0, Math.min(1, t));
    const lerp = (a, b, t) => a + (b - a) * t;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
    const loadImg = (src) => new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = src;
    });
    const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

    // minimum durations [ms] of the steps
    const DUR = { stage: 900, replayStage: 2600, reveal: 1700, hold: 700, rotate: 1300, align: 1300, regions: 800, zoom: 1700, recog: 1200, zoomout: 1200 };
    const POP = 700; // time a frame needs to take its status color
    const SETTLE = 900; // time the last result stays before the zoom out

    let d = null; // resting data: { alg, raw, pose, rois, W, H }
    let S = null; // running animation (state machine)
    let lay = null;
    let geo = null;
    let raf = 0;
    let colors = {};
    const api = { playing: false, ready: false, liveActive: false };

    // ---- resting data ------------------------------------------------------------
    function layout(W, H) {
      const cw = card.clientWidth;
      const ch = card.clientHeight;
      if (!cw || !ch || !W) return false;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      const k = Math.min(cw / W, ch / H);
      lay = { cw, ch, dpr, k, vx: (cw - W * k) / 2, vy: (ch - H * k) / 2 };
      bgCanvas.width = 160; // blurred fill: low resolution is enough
      bgCanvas.height = Math.max(1, Math.round((160 * ch) / cw));
      return true;
    }

    function ensureColors() {
      colors = { ok: css('--success') || '#10b981', warn: css('--warning') || '#f59e0b', err: css('--error') || '#ef4444', accent: css('--meter-accent') || css('--primary') || '#2563eb' };
    }
    const statusColor = (st) => (st === 'err' ? colors.err : st === 'warn' ? colors.warn : colors.ok);

    // label and status of an evaluated ROI
    function evalRoi(kind, value, confidence, rejected) {
      const num = parseFloat(value);
      let label = String(value ?? '');
      let status = 'ok';
      if (Number.isNaN(num)) {
        label = 'N';
        status = 'err';
      } else if (kind === 'digit') {
        label = String(Math.round(num) % 10); // dig-class100 / dig-cont give e.g. 3.9: the digit is 4
      } else {
        label = num.toFixed(1); // analog pointer: position 0.0 to 9.9
      }
      const c = typeof confidence === 'number' ? confidence : null;
      if (status === 'ok' && (rejected || (c !== null && c < 60))) status = 'err';
      else if (status === 'ok' && c !== null && c < 90) status = 'warn';
      return { label, status, pct: status !== 'ok' && c !== null ? `${Math.round(c)}%` : '' };
    }

    // ---- drawing -----------------------------------------------------------------
    // blurred fill of the card: the picture in its current state, covering the whole card
    // it follows the zoom of the picture: when the regions are zoomed in, the fill behind is the blurred zoomed view, not the whole picture
    function drawBg(P, W, H, pose, raw, alg, zoom) {
      const bw = bgCanvas.width, bh = bgCanvas.height;
      bgCtx.setTransform(1, 0, 0, 1, 0, 0);
      bgCtx.clearRect(0, 0, bw, bh);
      const cover = Math.max(lay.cw / W, lay.ch / H); // card pixels per picture pixel when the picture covers the card
      const sCard = Math.max(cover, lerp(cover, lay.k * zoom.k, P.z));
      const kc = sCard * (bw / lay.cw);
      let cx = lerp(W / 2, zoom.c[0], P.z);
      let cy = lerp(H / 2, zoom.c[1], P.z);
      const hw = bw / 2 / kc, hh = bh / 2 / kc; // keep the view inside the picture: no empty edges
      cx = hw < W / 2 ? Math.max(hw, Math.min(cx, W - hw)) : W / 2;
      cy = hh < H / 2 ? Math.max(hh, Math.min(cy, H - hh)) : H / 2;
      const base = () => {
        bgCtx.translate(bw / 2, bh / 2);
        bgCtx.scale(kc, kc);
        bgCtx.translate(-cx, -cy);
      };
      if (pose && raw && P.algMix < 1) {
        bgCtx.save();
        base();
        bgCtx.translate(pose.dx * P.shift, pose.dy * P.shift);
        bgCtx.translate(W / 2, H / 2);
        bgCtx.rotate(pose.theta * P.rot);
        bgCtx.translate(-W / 2, -H / 2);
        bgCtx.globalAlpha = P.bg * (1 - P.algMix);
        bgCtx.drawImage(raw, 0, 0, W, H);
        bgCtx.restore();
      }
      if (alg && (!pose || !raw || P.algMix > 0)) {
        bgCtx.save();
        base();
        bgCtx.globalAlpha = P.bg * (pose && raw ? P.algMix : 1);
        bgCtx.drawImage(alg, 0, 0, W, H);
        bgCtx.restore();
      }
    }

    function draw(P, D) {
      const { W, H, pose, rois } = D;
      const raw = D.raw, alg = D.alg;
      if (!lay) return;
      // zoom target: the regions of interest
      const have = rois.length > 0;
      const bx0 = have ? Math.min(...rois.map((r) => r.x)) : 0, bx1 = have ? Math.max(...rois.map((r) => r.x + r.w)) : W;
      const by0 = have ? Math.min(...rois.map((r) => r.y)) : 0, by1 = have ? Math.max(...rois.map((r) => r.y + r.h)) : H;
      const zoomK = Math.min(((lay.cw / lay.k) * 0.9) / (bx1 - bx0), ((lay.ch / lay.k) * 0.8) / (by1 - by0 + 30));
      const zc = [(bx0 + bx1) / 2, (by0 + by1) / 2];

      drawBg(P, W, H, pose, raw, alg, { k: zoomK, c: zc });
      ctx.setTransform(lay.dpr, 0, 0, lay.dpr, 0, 0);
      ctx.clearRect(0, 0, lay.cw, lay.ch);
      ctx.setTransform(lay.dpr * lay.k, 0, 0, lay.dpr * lay.k, lay.dpr * lay.vx, lay.dpr * lay.vy);

      const win = P.reveal < 1 ? { cx: lerp(geo.cx, W / 2, P.reveal), cy: lerp(geo.cy, H / 2, P.reveal), w: lerp(geo.sq, W, P.reveal), h: lerp(geo.sq, H, P.reveal) } : null;
      ctx.save();
      if (win) {
        ctx.beginPath();
        ctx.rect(win.cx - win.w / 2, win.cy - win.h / 2, win.w, win.h);
        ctx.clip();
      }
      ctx.translate(W / 2, H / 2);
      const sc = lerp(1, zoomK, P.z);
      ctx.scale(sc, sc);
      ctx.translate(-lerp(W / 2, zc[0], P.z), -lerp(H / 2, zc[1], P.z));
      if (win) {
        ctx.translate(win.cx, win.cy);
        const rs = lerp(geo.sq / H, 1, P.reveal);
        ctx.scale(rs, rs);
        ctx.translate(-W / 2, -H / 2);
      }

      // picture: the device first rotates the raw image around its center, then shifts it
      ctx.save();
      if (pose) {
        ctx.translate(pose.dx * P.shift, pose.dy * P.shift);
        ctx.translate(W / 2, H / 2);
        ctx.rotate(pose.theta * P.rot);
        ctx.translate(-W / 2, -H / 2);
      }
      if (raw && (!pose || P.algMix < 1 || !alg)) {
        ctx.globalAlpha = P.imgAlpha;
        ctx.drawImage(raw, 0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      // reference markers: they sit where the device found them in the raw image and travel onto the reference position
      if (pose && P.markers > 0 && pose.markers.length) {
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.rotate(-pose.theta);
        ctx.translate(-W / 2, -H / 2);
        ctx.translate(-pose.dx, -pose.dy);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = `rgba(239,68,68,${(0.55 + 0.45 * (0.5 + 0.5 * Math.sin(P.t / 140))) * P.markers})`;
        for (const m of pose.markers) ctx.strokeRect(m.x, m.y, m.w, m.h);
        ctx.restore();
      }
      ctx.restore();
      // the aligned picture of the device replaces the moved raw image (cross-fade), at the end only it is shown
      if (alg && (!raw || !pose || P.algMix > 0)) {
        ctx.globalAlpha = P.imgAlpha * (raw && pose ? P.algMix : 1);
        ctx.drawImage(alg, 0, 0, W, H);
        ctx.globalAlpha = 1;
      }

      // soft picture edges: fade the outer 10 percent
      if (P.edge > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        const fx = W * 0.1, fy = H * 0.1;
        const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
          const g = ctx.createLinearGradient(x0, y0, x1, y1);
          g.addColorStop(0, `rgba(0,0,0,${P.edge})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(rx, ry, rw, rh);
        };
        edge(0, 0, fx, 0, 0, 0, fx, H);
        edge(W, 0, W - fx, 0, W - fx, 0, fx, H);
        edge(0, 0, 0, fy, 0, 0, W, fy);
        edge(0, H, 0, H - fy, 0, H - fy, W, fy);
        ctx.restore();
      }

      // regions of interest (digit and analog): white frames; evaluated ones take the color of their status and show the result
      if (P.regions > 0) {
        const firstPending = rois.findIndex((r, i) => P.q[i] <= 0);
        rois.forEach((r, i) => {
          const appear = clamp(P.regions * 1.6 - i * 0.08);
          const q = P.q[i];
          const col = q > 0.15 ? statusColor(r.status) : '#f8fafc';
          const flash = q > 0 && q < 1 ? Math.sin(q * Math.PI) : 0;
          // the region the device works on right now breathes
          const scan = q <= 0 && P.scanning && i === firstPending ? 0.5 + 0.5 * Math.sin(P.t / 120) : 0;
          ctx.save();
          ctx.globalAlpha = appear * (q > 0.15 ? 0.16 + flash * 0.25 : 0.1 + scan * 0.18);
          ctx.fillStyle = col;
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.restore();
          ctx.globalAlpha = appear;
          ctx.lineWidth = 2 + flash * 2 + scan;
          ctx.strokeStyle = col;
          ctx.strokeRect(r.x - flash * 1.5, r.y - flash * 1.5, r.w + flash * 3, r.h + flash * 3);
          if (q > 0) {
            const pop = q < 0.5 ? easeOutBack(q * 2) : 1;
            ctx.save();
            ctx.translate(r.x + r.w / 2, r.y - 6);
            ctx.scale(pop, pop);
            // result in the badge, a smaller confidence next to it (bad recognitions only)
            ctx.font = '700 11px system-ui, sans-serif';
            const w1 = ctx.measureText(r.label).width;
            ctx.font = '600 7px system-ui, sans-serif';
            const w2 = r.pct ? ctx.measureText(r.pct).width + 2 : 0;
            const tw = w1 + w2 + 8;
            ctx.fillStyle = col;
            ctx.globalAlpha = 1;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(-tw / 2, -16, tw, 16, 5);
            else ctx.rect(-tw / 2, -16, tw, 16);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'left';
            ctx.font = '700 11px system-ui, sans-serif';
            ctx.fillText(r.label, -tw / 2 + 4, -4);
            if (r.pct) {
              ctx.font = '600 7px system-ui, sans-serif';
              ctx.globalAlpha = 0.92;
              ctx.fillText(r.pct, -tw / 2 + 4 + w1 + 2, -4.5);
            }
            ctx.restore();
          }
        });
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // corner brackets of the scan icon stay around the opening window (same line width and arm length at the start)
      if (P.bracket > 0) {
        const sw = lerp(geo.sw, 3.5 / lay.k, P.reveal), o = sw / 2, a = lerp(geo.arm, 40 / lay.k, P.reveal);
        const cxw = lerp(geo.cx, W / 2, P.reveal), cyw = lerp(geo.cy, H / 2, P.reveal), ww = lerp(geo.sq, W, P.reveal), hw = lerp(geo.sq, H, P.reveal);
        const x0 = cxw - ww / 2 - o, y0 = cyw - hw / 2 - o, x1 = cxw + ww / 2 + o, y1 = cyw + hw / 2 + o;
        ctx.globalAlpha = P.bracket;
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = sw;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(x0, y0 + a); ctx.lineTo(x0, y0); ctx.lineTo(x0 + a, y0);
        ctx.moveTo(x1 - a, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + a);
        ctx.moveTo(x1, y1 - a); ctx.lineTo(x1, y1); ctx.lineTo(x1 - a, y1);
        ctx.moveTo(x0 + a, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - a);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // resting state: aligned picture, all frames in their status color with the result
    function drawFinal() {
      if (!d || !layout(d.W, d.H)) return;
      ensureColors();
      geo = geo || { cx: d.W / 2, cy: d.H / 2, sq: d.H * 0.2, sw: 6, arm: 12 };
      draw({ reveal: 1, rot: 1, shift: 1, regions: 1, q: d.rois.map(() => 1), z: 1, edge: 0, imgAlpha: 1, bg: 1, algMix: 1, markers: 0, bracket: 0, scanning: false, t: 0 }, d);
    }

    // ---- icon geometry -----------------------------------------------------------
    // viewfinder (corner brackets) of the scan icon in image coordinates, with the size it has right now
    function measureIcon(W, H) {
      const svg = stage.querySelector('svg.scan-icon');
      if (!svg || !lay) return { cx: W / 2, cy: H / 2, sq: H * 0.2, sw: 6, arm: 12 };
      const r = svg.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      let sc = 1;
      try {
        sc = new DOMMatrix(getComputedStyle(svg.querySelector('.scan-corners')).transform).a || 1;
      } catch (e) { }
      const u = (r.width / 64) * sc; // css px per svg unit
      return {
        cx: (r.left + r.width / 2 - c.left - lay.vx) / lay.k,
        cy: (r.top + r.height / 2 - c.top - lay.vy) / lay.k,
        sq: ((53 - 11 - 5) * u) / lay.k, // inner edge of the corner brackets
        sw: (5 * u) / lay.k,
        arm: (10 * u) / lay.k,
      };
    }

    // ---- state machine -----------------------------------------------------------
    const poseOf = (al) => (al && al.ok !== false ? { theta: ((al.rotation || 0) * Math.PI) / 180, dx: al.dx || 0, dy: al.dy || 0, markers: Array.isArray(al.markers) ? al.markers : [] } : null);

    function go(phase, now) {
      S.phase = phase;
      S.t = now;
      if (phase === 'reveal') {
        S.W = S.W || (S.alg || S.raw).naturalWidth;
        S.H = S.H || (S.alg || S.raw).naturalHeight;
        layout(S.W, S.H);
        S.revealGeo = measureIcon(S.W, S.H);
        geo = S.revealGeo;
        stage.classList.add('handoff'); // the corner brackets are drawn by the canvas from now on
        canvas.hidden = false;
      }
    }

    // next step when its data is available and the minimum time of the current one is over
    function advance(now) {
      const e = now - S.t;
      if (!S.pose && S.alignment && S.raw) {
        S.pose = poseOf(S.alignment); // known as soon as the device reports the alignment: the markers show while we wait
        S.hasPose = !!S.pose;
      }
      const roisDone = S.rois.length > 0 && S.rois.every((r) => r.doneAt !== null);
      const shiftSig = S.pose && Math.abs(S.pose.dx) + Math.abs(S.pose.dy) >= 1;
      const rotSig = S.pose && Math.abs(S.pose.theta) >= 0.0017; // 0.1 degree
      switch (S.phase) {
        case 'stage':
          if (e >= (S.replay ? DUR.replayStage : DUR.stage) && (S.raw || (S.alg && S.alignment))) go('reveal', now);
          break;
        case 'reveal':
          if (e >= DUR.reveal) go(S.raw ? 'hold' : 'regions', now);
          break;
        case 'hold':
          if (e >= DUR.hold && S.alignment && S.alg) {
            go(S.pose && rotSig ? 'rotate' : S.pose && shiftSig ? 'align' : 'regions', now);
          }
          break;
        case 'rotate':
          if (e >= DUR.rotate) go(shiftSig ? 'align' : 'regions', now);
          break;
        case 'align':
          if (e >= DUR.align) go('regions', now);
          break;
        case 'regions':
          if (e >= DUR.regions) go(S.rois.length ? 'zoom' : 'done', now);
          break;
        case 'zoom':
          if (e >= DUR.zoom) {
            go('recog', now);
            if (S.stagger) S.rois.forEach((r, i) => { r.doneAt = now + i * 160; S.hooks.onRoi?.(i, r, i * 160); }); // complete data: results follow each other
          }
          break;
        case 'recog':
          if (e >= DUR.recog && S.cycleDone) {
            const lastDone = roisDone ? Math.max(...S.rois.map((r) => r.doneAt)) : null;
            const settled = lastDone !== null && now - lastDone >= SETTLE;
            const stuck = now - S.cycleDoneAt > 4000; // a region without result must not hold the animation
            if (settled || stuck) go('done', now); // stays zoomed in: the resting state is the zoomed view
          }
          break;
        case 'zoomout':
          if (e >= DUR.zoomout) go('done', now);
          break;
        default:
          break;
      }
    }

    function params(now) {
      const e = now - S.t;
      const ph = S.phase;
      const order = ['stage', 'reveal', 'hold', 'rotate', 'align', 'regions', 'zoom', 'recog', 'zoomout', 'done'];
      const at = (p) => order.indexOf(ph) >= order.indexOf(p); // phase p reached
      const prog = (p, dur) => (ph === p ? clamp(e / dur) : at(p) && order.indexOf(ph) > order.indexOf(p) ? 1 : 0);
      const reveal = ease(prog('reveal', DUR.reveal));
      const hasPose = !!S.pose && !!S.raw;
      return {
        reveal,
        imgAlpha: ease(clamp(prog('reveal', DUR.reveal) * 2.4)),
        bg: reveal,
        rot: hasPose ? ease(prog('rotate', DUR.rotate)) : 0,
        shift: hasPose ? ease(prog('align', DUR.align)) : 0,
        regions: prog('regions', DUR.regions),
        algMix: hasPose ? (ph === 'regions' ? ease(clamp(e / DUR.regions)) : at('zoom') ? 1 : 0) : 1,
        z: ph === 'zoom' ? ease(clamp(e / DUR.zoom)) : ph === 'recog' ? 1 : ph === 'zoomout' ? 1 - ease(clamp(e / DUR.zoomout)) : 0,
        edge: ph === 'zoomout' ? ease(clamp(e / DUR.zoomout)) : 0,
        q: S.rois.map((r) => (r.doneAt === null ? 0 : clamp((now - r.doneAt) / POP))),
        scanning: ph === 'recog' && !S.cycleDone,
        // markers search the raw image while the device aligns it, then fade out
        markers: S.alignment && hasPose ? (ph === 'hold' || ph === 'rotate' || ph === 'align' ? 1 : ph === 'regions' ? 1 - clamp(e / DUR.regions) : 0) : 0,
        bracket: ph === 'reveal' ? 1 : ph === 'hold' ? Math.max(0, 1 - e / 450) : 0,
        t: now,
      };
    }

    function frame(now) {
      if (!S) return;
      advance(now);
      if (S.phase === 'done') {
        finish();
        return;
      }
      if (S.phase !== 'stage') {
        draw(params(now), { W: S.W, H: S.H, raw: S.raw, alg: S.alg, pose: S.raw ? S.pose : null, rois: S.rois });
      }
      raf = requestAnimationFrame(frame);
    }

    function finish() {
      cancelAnimationFrame(raf);
      const done = S;
      S = null;
      api.playing = false;
      api.liveActive = false;
      stage.hidden = true;
      stage.textContent = '';
      stage.classList.remove('handoff');
      if (done.alg) {
        d = { alg: done.alg, raw: done.hasPose ? done.raw : null, pose: done.hasPose ? done.pose : null, rois: done.rois.map((r) => ({ ...r, doneAt: undefined })), W: done.W, H: done.H };
        api.ready = true;
      }
      drawFinal();
      canvas.hidden = false;
      done.hooks.onDone?.();
    }

    function newSession(mode, hooks) {
      cancelAnimationFrame(raf);
      ensureColors();
      api.playing = true;
      api.liveActive = mode === 'live';
      return {
        mode, phase: 'stage', t: performance.now(), hooks: hooks || {},
        raw: null, alg: null, pose: null, hasPose: false, alignment: null, rois: [], W: 0, H: 0,
        cycleDone: false, cycleDoneAt: 0, replay: false, stagger: false,
      };
    }

    function restartStageAnimation() {
      stage.querySelectorAll('*').forEach((n) => { n.style.animation = 'none'; });
      void stage.offsetHeight;
      stage.querySelectorAll('*').forEach((n) => { n.style.animation = ''; });
    }

    Object.assign(api, {
      // ---- resting data and replay -------------------------------------------------
      // rec: Api.process.recognition(), cfg: configuration (ROI geometry if the device does not send it)
      async prepare(rec, cfg) {
        const seq = rec?.sequences?.[0];
        if (!seq) return false;
        const list = [];
        for (const [kind, block] of [['digit', seq.digit], ['analog', seq.analog]]) {
          if (!block.enabled) continue;
          for (let i = 0; i < block.rois.length; i++) {
            const r = block.rois[i];
            let rect = r.rect;
            if (!rect) {
              const c = cfg?.[kind]?.sequence?.[0]?.roi?.[i];
              if (c && typeof c.x === 'number' && typeof c.dx === 'number') rect = { x: c.x, y: c.y, w: c.dx, h: c.dy };
            }
            if (!rect) return false; // no geometry: the plain image view is used
            const ev = r.na ? { label: 'N', status: 'err', pct: '' } : evalRoi(kind, r.value, r.confidence, false);
            list.push({ kind, x: rect.x, y: rect.y, w: rect.w, h: rect.h, ...ev, doneAt: null });
          }
        }
        if (!list.length) return false;
        const al = rec.alignment;
        const [alg, raw] = await Promise.all([loadImg(Api.process.imageUrl('alg.jpg')), al ? loadImg(Api.process.imageUrl(al.rawImage)) : Promise.resolve(null)]);
        if (!alg) return false;
        const pose = raw ? poseOf(al) : null;
        d = { alg, raw: pose ? raw : null, pose, rois: list, W: alg.naturalWidth, H: alg.naturalHeight };
        api.ready = true;
        return true;
      },

      showFinal() {
        if (api.playing) return;
        geo = null;
        canvas.hidden = false;
        drawFinal();
      },

      // replay of the finished cycle: all data is there, the steps follow each other (withStage: with the scan scene first)
      playComplete({ withStage = true, onRoi, onDone } = {}) {
        if (!d) return;
        S = newSession('complete', { onRoi, onDone });
        S.alg = d.alg;
        S.raw = d.raw;
        S.alignment = d.pose ? { ok: true } : { ok: false };
        S.pose = d.pose;
        S.hasPose = !!d.pose;
        S.W = d.W;
        S.H = d.H;
        S.rois = d.rois.map((r) => ({ ...r, doneAt: null }));
        S.cycleDone = true;
        S.cycleDoneAt = performance.now();
        S.stagger = true;
        S.replay = withStage;
        canvas.hidden = false;
        stage.classList.remove('handoff');
        if (withStage) restartStageAnimation();
        else S.t -= DUR.stage;
        layout(S.W, S.H);
        raf = requestAnimationFrame(frame);
      },

      // ---- live: follows the running cycle -----------------------------------------
      // rois: [{ kind, x, y, w, h }] from the configuration (digits first, then analog)
      beginLive({ rois, onRoi, onDone }) {
        S = newSession('live', { onRoi, onDone });
        S.rois = rois.map((r) => ({ ...r, label: '', status: 'ok', pct: '', doneAt: null }));
        S.counts = { digit: 0, analog: 0 };
        S.firstSeq = null;
        canvas.hidden = true;
        stage.classList.remove('handoff');
        raf = requestAnimationFrame(frame);
      },

      // answer of GET /api/live
      updateLive(live) {
        if (!S || S.mode !== 'live' || !live) return;
        const now = performance.now();
        if (live.raw && !S.rawLoading) {
          S.rawLoading = true;
          loadImg(Api.process.imageUrl(live.alignment?.rawImage || '/img_tmp/raw.jpg')).then((img) => { if (S && S.mode === 'live') S.raw = img; });
        }
        if (live.alignment && !S.alignLoading) {
          S.alignLoading = true;
          S.alignment = live.alignment;
          loadImg(Api.process.imageUrl('alg.jpg')).then((img) => {
            if (S && S.mode === 'live') {
              S.alg = img;
              if (!S.raw && !S.rawLoading) S.pose = null;
            }
          });
        }
        // results of the ROIs (digits and analog) in the order of the configuration
        const byKind = { digit: [], analog: [] };
        const seq = S.firstSeq || (live.rois[0] && live.rois[0].seq) || null;
        S.firstSeq = seq;
        for (const r of live.rois) if (r.seq === seq && byKind[r.kind]) byKind[r.kind].push(r);
        let idx = 0;
        let batch = 0; // results of one answer: one after another
        for (const kind of ['digit', 'analog']) {
          const slots = S.rois.filter((r) => r.kind === kind);
          slots.forEach((slot, i) => {
            const res = byKind[kind][i];
            if (res && slot.doneAt === null) {
              Object.assign(slot, evalRoi(kind, res.value, res.confidence, res.rejected));
              slot.doneAt = now + batch * 200;
              slot.name = res.name;
              S.hooks.onRoi?.(S.rois.indexOf(slot), slot, batch * 200);
              batch++;
            }
          });
          idx += slots.length;
        }
        void idx;
        if (!live.running && live.cycle) api.endLive();
      },

      endLive() {
        if (S && S.mode === 'live' && !S.cycleDone) {
          S.cycleDone = true;
          S.cycleDoneAt = performance.now();
        }
      },

      // live not available (older firmware) or cycle without usable data: drop the session, the scene stays with the caller
      abortLive() {
        if (S && S.mode === 'live') {
          cancelAnimationFrame(raf);
          S = null;
          api.playing = false;
          api.liveActive = false;
          canvas.hidden = true;
          stage.classList.remove('handoff');
        }
      },

      // new cycle (or leaving the page): stop everything
      cancel() {
        cancelAnimationFrame(raf);
        S = null;
        api.playing = false;
        api.liveActive = false;
        canvas.hidden = true;
        stage.classList.remove('handoff');
      },

      relayout() {
        if (!d || S) return;
        if (!canvas.hidden) drawFinal();
      },

      resumeStage() {
        restartStageAnimation();
      },
    });
    Object.defineProperty(api, 'algUrl', { get: () => (d ? d.alg.src : '') });
    return api;
  }

  // ------------------------------------------------------------------------
  // Readings plot: values of the data log (SD card, /log/data/data_YYYY-MM-DD.csv), minimal line chart.
  // The card stays hidden as long as there is no data logging or fewer than two readings in the range.
  // CSV columns: timestamp, sequence name, raw value, value, fallback value, ...
  // ------------------------------------------------------------------------
  const PLOT_RANGES = [['6h', 6], ['12h', 12], ['24h', 24], ['1w', 168], ['1m', 744]];
  const PLOT_MAX_POINTS = 240;
  const plotFileCache = new Map(); // 'name|size' -> parsed rows [{t, name, v}]

  const plotIssue = (code) => (code === '000' || code === '' ? 0 : ['W01', 'E91', 'E92', 'E93'].includes(code) ? 1 : 2);

  const parseDataTime = (text) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(text);
    // wall clock of the device as UTC value: only differences and the labels are used
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
  };

  const parseDataCsv = (text) => {
    const rows = [];
    for (const line of text.split('\n')) {
      const f = line.split(',');
      if (f.length < 4) continue;
      const t = parseDataTime(f[0]);
      const v = parseFloat(f[3]);
      // f[7]: status code of the reading ('000' valid, W01 invalid data, E91-E93 rate problems: the fallback value was used)
      if (Number.isFinite(t) && Number.isFinite(v)) rows.push({ t, name: f[1], v, s: (f[7] || '000').trim().substring(0, 3) });
    }
    return rows;
  };

  async function loadPlotRows(hours, signal) {
    let files;
    try {
      files = await Api.files.list('/log/data/', { all: true });
    } catch (e) {
      return null; // no data logging
    }
    files = files.filter((f) => !f.isDir && /^data_\d{4}-\d{2}-\d{2}\.csv$/.test(f.name)).sort((a, b) => (a.name < b.name ? -1 : 1));
    if (!files.length) return null;

    const last = files[files.length - 1].name.substring(5, 15);
    const endDay = Date.UTC(+last.substring(0, 4), +last.substring(5, 7) - 1, +last.substring(8, 10));
    const firstDay = endDay - Math.ceil(hours / 24) * 86400000;
    const rows = [];
    for (const f of files) {
      const day = Date.UTC(+f.name.substring(5, 9), +f.name.substring(10, 12) - 1, +f.name.substring(13, 15));
      if (day < firstDay) continue;
      const key = `${f.name}|${f.size}`;
      if (!plotFileCache.has(key)) {
        const res = await apiCall(`/fileserver/log/data/${f.name}`, { signal, timeout: 30000 }, { parseType: 'text' });
        if (signal?.aborted) return undefined;
        if (!res.ok || typeof res.data !== 'string') continue;
        for (const k of plotFileCache.keys()) if (k.startsWith(f.name + '|')) plotFileCache.delete(k); // older state of the same file
        plotFileCache.set(key, parseDataCsv(res.data));
      }
      rows.push(...plotFileCache.get(key));
    }
    return rows;
  }

  function createReadingsPlot(card, rangeBox, body, signal) {
    let hours = 24;
    let busy = false;
    let again = false;
    try {
      const saved = Number(localStorage.getItem('plotHours'));
      if (PLOT_RANGES.some((r) => r[1] === saved)) hours = saved;
    } catch (e) { }

    const buttons = PLOT_RANGES.map(([label, h]) => {
      const b = el('button', 'plot-range-btn', label);
      b.type = 'button';
      b.addEventListener('click', () => {
        hours = h;
        try { localStorage.setItem('plotHours', String(h)); } catch (e) { }
        buttons.forEach((x, i) => x.classList.toggle('active', PLOT_RANGES[i][1] === hours));
        load();
      });
      rangeBox.append(b);
      return b;
    });
    buttons.forEach((x, i) => x.classList.toggle('active', PLOT_RANGES[i][1] === hours));

    const fmtValue = (v) => {
      const a = Math.abs(v);
      return String(parseFloat(v.toFixed(a >= 1000 ? 1 : a >= 10 ? 2 : 3)));
    };
    const pad = (n) => String(n).padStart(2, '0');
    const fmtTime = (t, withDay) => {
      const d = new Date(t);
      const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
      return withDay ? `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}. ${time}` : time;
    };

    function draw(points, stats) {
      const W = 600;
      const H = 140;
      const pl = 8;
      const pr = 8;
      const pt = 10;
      const pb = 18;
      const t0 = points[0].t;
      const t1 = points[points.length - 1].t;
      let lo = Math.min(...points.map((p) => p.v));
      let hi = Math.max(...points.map((p) => p.v));
      if (hi - lo < 1e-9) {
        hi += 0.5;
        lo -= 0.5;
      }
      const x = (t) => pl + ((t - t0) / Math.max(1, t1 - t0)) * (W - pl - pr);
      const y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
      const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join('');
      const area = `${line}L${x(t1).toFixed(1)} ${H - pb}L${x(t0).toFixed(1)} ${H - pb}Z`;

      // Problems: shaded background (yellow: invalid data or rate problem, red: error) and a dashed line where the
      // device used the fallback value instead of the reading
      let solid = '';
      let dashed = '';
      let bands = '';
      let issues = 0;
      let prevBad = false;
      for (let i = 1; i < points.length; i++) {
        const bad = !!plotIssue(points[i].s);
        const from = `${x(points[i - 1].t).toFixed(1)} ${y(points[i - 1].v).toFixed(1)}`;
        const to = `${x(points[i].t).toFixed(1)} ${y(points[i].v).toFixed(1)}`;
        // consecutive segments of the same kind form one path (a continuous dash pattern)
        if (bad) dashed += `${prevBad ? '' : `M${from}`}L${to}`;
        else solid += `${i > 1 && !prevBad ? '' : `M${from}`}L${to}`;
        prevBad = bad;
      }
      for (let i = 0; i < points.length; ) {
        const level = plotIssue(points[i].s);
        if (!level) {
          i++;
          continue;
        }
        let j = i;
        let worst = level;
        while (j + 1 < points.length && plotIssue(points[j + 1].s)) {
          j++;
          worst = Math.max(worst, plotIssue(points[j].s));
        }
        // from the middle between the previous reading and the first problem to the middle after the last one
        const xa = i > 0 ? (x(points[i - 1].t) + x(points[i].t)) / 2 : x(points[i].t);
        const xb = j + 1 < points.length ? (x(points[j].t) + x(points[j + 1].t)) / 2 : x(points[j].t);
        const w = Math.max(xb - xa, 2);
        bands += `<rect class="plot-band ${worst === 2 ? 'is-error' : 'is-warn'}" x="${xa.toFixed(1)}" y="${pt}" width="${w.toFixed(1)}" height="${H - pt - pb}"><title>${worst === 2 ? 'Error' : 'Problem'} ${fmtTime(points[i].t, true)}</title></rect>`;
        issues++;
        i = j + 1;
      }
      const withDay = t1 - t0 > 36 * 3600000;

      body.textContent = '';
      const wrap = el('div', 'plot-wrap');
      wrap.innerHTML =
        `<svg class="plot-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Readings over time">` +
        `${bands}<path class="plot-area" d="${area}"/><path class="plot-line" d="${solid || line}"/>` +
        (dashed ? `<path class="plot-line is-fallback" d="${dashed}"/>` : '') +
        '<line class="plot-cursor" x1="0" x2="0" y1="0" y2="0" hidden/><circle class="plot-dot" r="3.5" hidden/></svg>';
      const info = el('div', 'plot-info');
      const left = el('span', '', fmtTime(t0, withDay));
      const mid = el('span', 'plot-readout', `${fmtValue(lo)} \u2013 ${fmtValue(hi)}`);
      const right = el('span', '', fmtTime(t1, withDay));
      info.append(left, mid, right);
      body.append(wrap, info);
      if (issues) {
        const legend = el('div', 'plot-legend');
        // share of the readings in the selected range
        const pct = (n) => (n === 0 ? '0 %' : n / stats.total < 0.001 ? '<0.1 %' : `${((n / stats.total) * 100).toFixed(1)} %`);
        legend.innerHTML =
          `<span><i class="lg-warn"></i>Problem reading <b>${pct(stats.warn)}</b></span>` +
          `<span><i class="lg-error"></i>Error <b>${pct(stats.error)}</b></span>` +
          '<span><i class="lg-dash"></i>Fallback value used</span>';
        legend.title = `${stats.total} readings in the selected range`;
        body.append(legend);
      }

      const svg = wrap.querySelector('svg');
      const cursor = svg.querySelector('.plot-cursor');
      const dot = svg.querySelector('.plot-dot');
      const idle = mid.textContent;
      const leave = () => {
        cursor.setAttribute('hidden', '');
        dot.setAttribute('hidden', '');
        mid.textContent = idle;
      };
      wrap.addEventListener('pointermove', (e) => {
        const r = svg.getBoundingClientRect();
        const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
        let best = points[0];
        for (const p of points) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
        const bx = x(best.t);
        const by = y(best.v);
        cursor.setAttribute('x1', bx);
        cursor.setAttribute('x2', bx);
        cursor.setAttribute('y1', pt);
        cursor.setAttribute('y2', H - pb);
        dot.setAttribute('cx', bx);
        dot.setAttribute('cy', by);
        cursor.removeAttribute('hidden');
        dot.removeAttribute('hidden');
        mid.textContent = `${fmtValue(best.v)} \u00b7 ${fmtTime(best.t, true)}${plotIssue(best.s) ? ` \u00b7 ${best.s}` : ''}`;
      });
      wrap.addEventListener('pointerleave', leave);
    }

    async function load() {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        const rows = await loadPlotRows(hours, signal);
        if (signal?.aborted || rows === undefined) return;
        if (!rows || rows.length < 2) {
          card.hidden = true;
          return;
        }
        // one sequence only: the first one of the log
        const name = rows[rows.length - 1].name;
        const seq = rows.filter((r) => r.name === name).sort((a, b) => a.t - b.t);
        const end = seq[seq.length - 1].t;
        let pts = seq.filter((r) => r.t >= end - hours * 3600000);
        if (pts.length < 2) {
          card.hidden = true;
          return;
        }
        const stats = { total: pts.length, warn: 0, error: 0 };
        for (const r of pts) {
          const level = plotIssue(r.s);
          if (level === 1) stats.warn++;
          else if (level === 2) stats.error++;
        }
        if (pts.length > PLOT_MAX_POINTS) {
          // one point per bucket, a problem inside the bucket is kept (worst status wins)
          const step = pts.length / PLOT_MAX_POINTS;
          const reduced = [];
          for (let i = 0; i < PLOT_MAX_POINTS; i++) {
            const bucket = pts.slice(Math.floor(i * step), Math.floor((i + 1) * step));
            if (!bucket.length) continue;
            const worst = bucket.reduce((w, r) => (plotIssue(r.s) > plotIssue(w.s) ? r : w), bucket[0]);
            reduced.push({ ...bucket[bucket.length - 1], s: worst.s });
          }
          pts = reduced;
        }
        card.hidden = false;
        draw(pts, stats);
      } finally {
        busy = false;
        if (again) {
          again = false;
          load();
        }
      }
    }

    return { load };
  }

  App.register('dashboard', {
    title: 'Dashboard',

    mount(root) {
      root.classList.add('dash');
      root.innerHTML = DASH_HTML;
      const ref = {};
      root.querySelectorAll('[data-ref]').forEach((n) => { ref[n.dataset.ref] = n; });

      const st = {
        dead: false,
        timer: null,
        running: false,
        lastImageKey: null,
        editingSeq: null, // while set, the automatic refresh does not re-render the cards
        abort: new AbortController(),
      };
      dashActive = st;

      // ---- rendering -----------------------------------------------------
      const statusContent = (val) => {
        const text = String(val ?? '');
        const entry = STATUS_TEXT[text.substring(0, 3)];
        if (!entry) return text;
        const frag = document.createDocumentFragment();
        frag.append(entry[0]);
        if (entry[1]) frag.append(el('br'), el('small', '', entry[1]));
        return frag;
      };

      const chip = (label, value, title) => {
        const c = el('span', 'chip');
        c.append(el('b', '', label), document.createTextNode(value));
        if (title) c.title = title;
        return c;
      };

      const closeFallbackEditor = (card) => {
        card.querySelector('.dash-fallback-edit')?.remove();
        st.editingSeq = null;
      };

      const openFallbackEditor = (card, seq, prefill) => {
        if (card.querySelector('.dash-fallback-edit')) {
          closeFallbackEditor(card);
          return;
        }
        root.querySelectorAll('.dash-fallback-edit').forEach((e) => e.remove()); // only one editor at a time
        st.editingSeq = seq;

        const box = el('div', 'dash-fallback-edit');
        const id = `dash-fb-input-${++dashSeq}`;
        const label = el('label', '', 'New fallback value');
        label.htmlFor = id;

        const row = el('div', 'dash-fallback-row');
        const input = el('input');
        input.type = 'number';
        input.step = 'any';
        input.id = id;
        input.value = prefill;
        input.required = true;

        const apply = el('button', 'button btn-action', 'Apply');
        apply.type = 'button';
        const cancel = el('button', 'button', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', () => closeFallbackEditor(card));

        const submit = async () => {
          const value = parseFloat(String(input.value).replace(',', '.'));
          if (Number.isNaN(value)) return firework.launch('Invalid number entered', 'warning', 2000);

          apply.disabled = true;
          const ok = await Api.process.setFallbackValue(seq, value);
          apply.disabled = false;
          if (!ok || st.dead) return;

          closeFallbackEditor(card);
          refresh();
        };
        apply.addEventListener('click', submit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') closeFallbackEditor(card);
        });

        const hint = el('div', 'dash-fallback-hint', 'Pre-filled with the current raw value. The fallback value is the last valid reading the device falls back to.');
        row.append(input, apply, cancel);
        box.append(label, row, hint);
        card.append(box);
        input.focus();
        input.select();
      };

      const renderSequenceCards = (data) => {
        const container = ref.sequences;
        container.textContent = '';

        for (const seq of Object.keys(data.actual_value ?? {})) {
          const fallback = show(data.fallback_value?.[seq]);
          const fbTime = String(data.timestamp_fallbackvalue?.[seq] ?? '');
          const statusCode = String(data.value_status?.[seq] ?? '').substring(0, 3);
          const isOk = ['', '000', 'E91'].includes(statusCode);

          const card = el('div', `card dash-hero ${isOk ? 'status-valid' : 'status-err'}`);

          // status as badge next to the sequence name (the second line of some states becomes a note below the counter)
          const statusText = String(data.value_status?.[seq] ?? '');
          const statusEntry = STATUS_TEXT[statusCode];
          const badgeClass = statusCode === '000' || statusText === '' ? 'badge-success' : ['W01', 'E91', 'E92', 'E93'].includes(statusCode) ? 'badge-warning' : 'badge-error';
          const badge = el('span', `badge ${badgeClass}`, statusEntry ? statusEntry[0] : statusText);
          badge.title = statusText;
          const head = el('div', 'dash-hero-head');
          head.append(el('div', 'dash-hero-label', `Sequence \u00b7 ${seq}`), badge);

          const chips = el('div', 'chips');
          chips.append(chip('Raw', show(data.raw_value?.[seq])));
          const fbTitle = fallback !== '--' && fallback !== 'Disabled' && fbTime.length >= 19 ? `Set ${fbTime.substring(0, 10)} ${fbTime.substring(11, 19)}` : '';
          chips.append(chip('Fallback', fallback, fbTitle));

          const actions = el('div', 'dash-hero-actions');
          const edit = el('button', 'dash-link-btn', 'Set fallback value');
          edit.type = 'button';
          const rawNum = parseFloat(String(data.raw_value?.[seq] ?? '').replace(',', '.'));
          const actNum = parseFloat(String(data.actual_value?.[seq] ?? '').replace(',', '.'));
          const prefill = !Number.isNaN(rawNum) ? rawNum : !Number.isNaN(actNum) ? actNum : '';
          edit.addEventListener('click', () => openFallbackEditor(card, seq, prefill));
          actions.append(chips, edit);

          const shown = show(data.actual_value[seq]);
          st.meterPrev = st.meterPrev || {};
          // first display: the wheels roll in from zero
          card.append(head, meterEl(shown, st.meterPrev[seq] ?? String(shown).replace(/[1-9]/g, '0')));
          st.meterPrev[seq] = shown;
          if (statusEntry?.[1]) card.append(el('div', 'dash-hero-note', statusEntry[1]));
          card.append(actions);
          container.appendChild(card);
        }
      };

      const renderRssi = (value) => {
        const bars = ref.rssiSvg.querySelectorAll('.bar');
        const setBars = (count, dim) => bars.forEach((bar, i) => {
          const active = i < count;
          bar.style.opacity = active ? '1' : dim;
          bar.style.fill = active ? 'var(--primary)' : 'currentColor';
        });

        if (value === null || value === undefined || isNaN(value)) {
          ref.rssi.textContent = 'Offline';
          setBars(0, '0.1');
        } else if (value <= -255) {
          ref.rssi.textContent = 'Disconnected';
          setBars(0, '0.1');
        } else {
          const label = value >= -55 ? 'Excellent' : value >= -67 ? 'Good' : value >= -78 ? 'Fair' : value >= -85 ? 'Weak' : 'Unreliable';
          ref.rssi.textContent = `${label} (${value}dBm)`;
          setBars(RSSI_THRESHOLDS.filter((t) => value >= t).length, '0.2');
        }
      };

      const renderProcessError = (value, processState) => {
        const state = String(processState ?? '').toLowerCase();
        const isErrorState = ERROR_STATES.some((s) => state.includes(s));
        ref.error.textContent = isErrorState && value < 0 ? 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â  Process error detected. Check logs' : '';
      };

      // ---- loading -------------------------------------------------------
      const loadActivity = async () => {
        const entries = await Api.process.log(st.abort.signal);
        if (st.dead || entries === undefined) return; // aborted
        const box = ref.log;
        if (entries === null) {
          box.textContent = '';
          box.append(el('span', 'dash-log-empty', 'Log not available'));
          return;
        }

        box.textContent = '';
        if (!entries.length) {
          box.append(el('span', 'dash-log-empty', 'No messages yet'));
          return;
        }
        for (const e of entries) {
          const row = el('div', `dash-log-line lvl-${e.lvl}`);
          row.append(el('span', 'dash-log-ts', e.ts), el('span', 'dash-log-lvl', e.lvl), el('span', 'dash-log-msg', `[${e.mod}] ${e.msg}`));
          box.append(row);
        }
      };

      // While the camera takes the picture the device has no image: show the animated scan scene instead of the static state image
      // the scene stays while a cycle is running; the title names the step
      const stageText = (step) => {
        const t = String(step ?? '');
        if (/take image/i.test(t)) return ['Taking image ...', 'The camera captures the picture'];
        if (/align/i.test(t)) return ['Aligning image ...', 'The picture is moved onto the reference'];
        if (/digit|analog|recogni/i.test(t)) return ['Reading digits ...', 'The AI reads the regions of interest'];
        if (/publish|post|additional/i.test(t)) return ['Publishing ...', 'The result is processed and sent'];
        return ['Processing ...', 'The picture is evaluated'];
      };
      const renderStageScene = (step = 'Take Image') => {
        const [title, sub] = stageText(step);
        ref.stage.innerHTML =
          `<div class="dash-stage-icon"><div class="dash-stage-rings"><span></span><span></span><span></span></div>${scanIconHtml(150)}</div>` +
          `<div class="dash-stage-title">${title}</div>` +
          `<div class="dash-stage-sub">${sub}</div>`;
        ref.stage.classList.remove('handoff');
      };
      const updateStageTitle = (step) => {
        const [title, sub] = stageText(step);
        const t = ref.stage.querySelector('.dash-stage-title');
        const u = ref.stage.querySelector('.dash-stage-sub');
        if (t && t.textContent !== title) t.textContent = title;
        if (u && u.textContent !== sub) u.textContent = sub;
      };
      const hideStage = () => {
        ref.stage.hidden = true;
        ref.stage.textContent = '';
        ref.stage.classList.remove('handoff');
        st.stageHold = false;
      };

      // ---- recognition card: blurred while a cycle runs (new results are on the way) -------------------
      const recCard = root.querySelector('.dash-rec');
      const setRecUpdating = (on) => recCard.classList.toggle('is-updating', on);
      // complete data (end of cycle, replay): the tiles appear one after another
      const setTilesPending = (on) => root.querySelectorAll('.rec-roi-tile').forEach((t) => t.classList.toggle('is-pending', on));
      const revealTile = (i, roi, delay = 0) => {
        const tile = root.querySelectorAll('.rec-roi-tile')[i];
        if (tile) setTimeout(() => tile.classList.remove('is-pending'), delay);
      };
      // live: placeholders for all regions, every tile is filled when the device has its result
      const buildLiveTiles = (list) => {
        ref.recBody.textContent = '';
        for (const kind of ['digit', 'analog']) {
          const items = list.filter((r) => r.kind === kind);
          if (!items.length) continue;
          const wrap = el('div', 'rec-roi-block');
          wrap.append(el('div', 'rec-roi-title', kind === 'digit' ? 'Digit ROIs' : 'Analog ROIs'));
          const grid = el('div', `rec-roi-grid is-${kind}`);
          for (let i = 0; i < items.length; i++) {
            const tile = el('div', 'rec-roi-tile is-waiting');
            tile.append(el('div', 'rec-roi-value', '\u2026'));
            grid.append(tile);
          }
          wrap.append(grid);
          ref.recBody.append(wrap);
        }
        st.liveTileEls = [...ref.recBody.querySelectorAll('.rec-roi-tile')];
        st.liveTiles = true;
        setRecUpdating(false);
      };
      const fillLiveTile = (i, roi) => {
        const tile = st.liveTileEls?.[i];
        if (!tile) return;
        tile.classList.remove('is-waiting');
        tile.dataset.status = roi.status;
        tile.textContent = '';
        tile.append(el('div', 'rec-roi-value', roi.label));
        if (roi.name) {
          const img = el('img', 'rec-roi-img');
          img.src = Api.process.imageUrl(`${roi.name}_org.jpg`);
          img.alt = `ROI ${roi.label}`;
          tile.append(img);
        }
        tile.classList.add('is-pop');
      };

      // ---- live view: follows the device while the cycle runs --------------------------------------------
      const cfgRois = () => {
        const out = [];
        try {
          const c = getConfigFromStorage(0);
          for (const kind of ['digit', 'analog']) {
            if (!c?.[kind] || c[kind].enabled === false) continue;
            for (const r of c[kind].sequence?.[0]?.roi ?? []) {
              if (typeof r.x === 'number' && typeof r.dx === 'number') out.push({ kind, x: r.x, y: r.y, w: r.dx, h: r.dy });
            }
          }
        } catch (e) { }
        return out;
      };
      const stopLive = () => {
        clearInterval(st.liveTimer);
        st.liveTimer = null;
        st.liveBusy = false;
        st.liveOn = false;
      };
      const livePoll = async () => {
        if (st.liveBusy || !st.liveOn || st.dead) return;
        st.liveBusy = true;
        const live = await Api.process.live(st.abort.signal);
        st.liveBusy = false;
        if (!st.liveOn || st.dead) return;
        if (live === 'unsupported') { // older firmware: the animation follows after the cycle
          st.liveOk = false;
          st.liveSession = false;
          st.reveal.abortLive();
          stopLive();
          return;
        }
        if (live === null) return; // busy: try again with the next tick
        st.liveOk = true;
        // data of the previous cycle (the new one has not started on the device yet) is ignored
        if (st.idleCycle !== undefined && live.cycle <= st.idleCycle) return;
        st.reveal.updateLive(live);
      };
      const startLive = () => {
        const rois = cfgRois();
        if (!rois.length) {
          st.liveSession = false;
          return;
        }
        st.liveSession = true;
        st.liveOk = null;
        st.liveTiles = false;
        st.liveOn = true;
        st.reveal.beginLive({
          rois,
          onRoi: (i, roi, delay = 0) => {
            if (!st.liveTiles) buildLiveTiles(rois);
            setTimeout(() => { if (!st.dead) fillLiveTile(i, roi); }, delay);
          },
          onDone: () => {
            stopLive();
            st.liveSession = false;
            st.liveDone = true; // the animation is over, the status may report the end of the cycle later: no second animation
            st.revealOk = true;
            st.stageHold = false;
            ref.replay.hidden = false;
            ref.img.hidden = true;
            setRecUpdating(false);
          },
        });
        ref.bgCanvas.hidden = false;
        ref.imgBg.hidden = true;
        clearInterval(st.liveTimer);
        st.liveTimer = setInterval(livePoll, 900);
        livePoll();
      };

      const setStage = (on, step) => {
        if (st.capturing === on) {
          if (on) updateStageTitle(step);
          return;
        }
        const wasCapturing = st.capturing === true; // undefined: first status after opening the page
        st.capturing = on;
        ref.img.hidden = on || st.stageHold || !!st.revealOk;
        if (on) {
          st.reveal.cancel();
          stopLive();
          setTilesPending(false);
          ref.canvas.hidden = true;
          ref.replay.hidden = true;
          st.stageHold = false;
          ref.stage.hidden = false;
          renderStageScene(step);
          setRecUpdating(true);
          st.liveDone = false;
          startLive();
        } else if (wasCapturing) {
          if (st.liveSession) {
            st.reveal.endLive(); // the animation runs to its end, the device data is already there
          } else if (st.liveDone) {
            st.liveDone = false; // the live animation already ended: only the data is refreshed (no replay)
            hideStage();
            setRecUpdating(false);
          } else if (st.revealOk !== false) {
            // no live data: keep the scene until the new picture is ready, the animation then follows
            st.stageHold = true;
            clearTimeout(st.holdTimer);
            st.holdTimer = setTimeout(() => { if (st.stageHold) { hideStage(); ref.img.hidden = !!st.revealOk; setRecUpdating(false); if (st.revealOk) st.reveal.showFinal(); } }, 20000);
          } else {
            hideStage();
            setRecUpdating(false);
          }
        }
      };

      // picture animation after the cycle (no live data) and at rest: prepared with the data of the last cycle
      const applyReveal = async (rec) => {
        if (st.reveal.playing) return;
        const ok = rec?.ready ? await st.reveal.prepare(rec, getConfigFromStorage(0)) : false;
        if (st.dead || st.reveal.playing) return;
        st.revealOk = ok;
        if (!ok) {
          st.reveal.cancel();
          ref.canvas.hidden = true;
          ref.bgCanvas.hidden = true;
          ref.imgBg.hidden = false;
          ref.replay.hidden = true;
          if (st.stageHold) hideStage();
          ref.img.hidden = st.capturing;
          if (!st.capturing) loadRoiImage();
          return;
        }
        ref.replay.hidden = false;
        ref.img.hidden = true;
        ref.imgBg.hidden = true; // the blurred fill is drawn together with the picture
        ref.bgCanvas.hidden = false;
        if (st.stageHold) {
          clearTimeout(st.holdTimer);
          st.stageHold = false;
          setTilesPending(true);
          setRecUpdating(false);
          st.reveal.playComplete({ withStage: false, onRoi: revealTile, onDone: () => setTilesPending(false) });
        } else {
          setTilesPending(false);
          hideStage();
          st.reveal.showFinal();
        }
      };

      ref.replay.addEventListener('click', () => {
        if (!st.revealOk || st.reveal.playing || st.capturing) return;
        ref.stage.hidden = false;
        renderStageScene();
        ref.canvas.hidden = false;
        setTilesPending(true);
        st.reveal.playComplete({ withStage: true, onRoi: revealTile, onDone: () => setTilesPending(false) });
      });

      // the sidebar polls the status every 2 s: switch the scene right away and load the image as soon as the capture is over
      const onCycleStatus = (e) => {
        if (st.dead) return;
        const capturing = !!e.detail?.running; // the scene is shown during the whole cycle, the animation plays when it is over
        const wasCapturing = st.capturing;
        if (!capturing) st.idleCycle = e.detail?.cycle; // number of the last finished cycle
        const last = formatLastSuccess(e.detail);
        ref.lastRun.textContent = last.text;
        ref.lastRun.title = last.title;
        setStage(capturing, e.detail?.state);
        if (wasCapturing && !capturing) refresh(true);
      };
      window.addEventListener('cycle-status', onCycleStatus);
      st.offStatus = () => window.removeEventListener('cycle-status', onCycleStatus);

      // countdown pill at the process state: same text as the sidebar, counts down every second
      const renderStateTimer = () => {
        const s = CycleMonitor.last();
        const text = CycleMonitor.timerText();
        ref.stateTimer.hidden = !text;
        if (!text) return;
        ref.stateTimer.textContent = text;
        ref.stateTimer.dataset.kind = s?.running ? 'running' : s?.paused && s?.autoStart ? 'paused' : 'idle';
      };
      renderStateTimer();
      st.timerTick = setInterval(renderStateTimer, 1000);
      window.addEventListener('cycle-status', renderStateTimer);
      st.offTimer = () => { clearInterval(st.timerTick); window.removeEventListener('cycle-status', renderStateTimer); };

      // Back in the tab after a while: nothing was polled meanwhile, so the whole view is out of date (numbers, picture, plot).
      // The view is marked as "updating" (dimmed, bar, badge), a running animation is dropped and everything is loaded again.
      const STALE_AFTER_MS = 12000; // the automatic refresh runs every 1.5 to 5 s: older data means the page was not running
      const resync = async () => {
        if (st.dead || st.syncing) return;
        const started = performance.now();
        st.syncing = true;
        root.classList.add('is-syncing');
        clearTimeout(st.holdTimer);
        st.reveal.cancel();
        stopLive();
        st.liveSession = false;
        st.liveTiles = false;
        st.capturing = undefined; // the next status tells whether a cycle is running now
        st.stageHold = false;
        hideStage();
        ref.canvas.hidden = true;
        ref.replay.hidden = true;
        ref.img.hidden = false;
        setTilesPending(false);
        setRecUpdating(true);
        st.lastImageKey = null;
        const safety = setTimeout(() => { st.syncing = false; root.classList.remove('is-syncing'); }, 12000);
        try {
          for (let i = 0; i < 5 && st.running && !st.dead; i++) await new Promise((r) => setTimeout(r, 400)); // an automatic refresh is in flight
          await refresh(false);
          const shown = performance.now() - started;
          if (shown < 1200) await new Promise((r) => setTimeout(r, 1200 - shown)); // long enough to be noticed
        } finally {
          clearTimeout(safety);
          st.syncing = false;
          if (!st.dead) {
            if (!st.capturing) setRecUpdating(false);
            root.classList.remove('is-syncing');
          }
        }
      };
      // back in the tab (also when the window was only covered or another window had the focus): check the age of the data
      // Two signals: the time away (the tab was hidden or lost the focus) and the age of the data (a hidden tab only runs its timers
      // about once a minute, so the data can be fairly fresh and still be far behind what the device did meanwhile)
      const AWAY_AFTER_MS = 10000;
      let leftAt = 0;
      const onLeave = () => { if (!leftAt) leftAt = performance.now(); };
      const onBack = () => {
        if (document.hidden) return;
        const now = performance.now();
        const away = leftAt ? now - leftAt : 0;
        leftAt = 0;
        const age = st.lastDataAt ? now - st.lastDataAt : 0;
        if (away > AWAY_AFTER_MS || age > STALE_AFTER_MS) resync();
      };
      const onVisibility = () => (document.hidden ? onLeave() : onBack());
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('blur', onLeave);
      window.addEventListener('focus', onBack);
      window.addEventListener('pageshow', onBack);
      st.offVis = () => {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('blur', onLeave);
        window.removeEventListener('focus', onBack);
        window.removeEventListener('pageshow', onBack);
      };


      // MQTT connection: Connected / Connected (Encrypted) / Disconnected / Disabled (badge hidden)
      const loadMqtt = async () => {
        let text = '';
        try {
          text = await Api.system.infoQuiet('mqtt_status');
        } catch (e) { }
        if (st.dead) return;
        const box = ref.mqttBox;
        box.hidden = !/^(Connected|Disconnected)/.test(text);
        ref.mqtt.textContent = text;
        ref.mqtt.className = `badge ${text.startsWith('Connected') ? 'badge-success' : 'badge-error'}`;
        updateServices();
      };

      // MCP server of the device (optional): shown when the firmware has it. On / Off, a warning color while system actions are allowed
      const loadMcp = async () => {
        const m = await Api.mcp.get();
        if (st.dead) return;
        ref.mcpBox.hidden = !m;
        if (m) {
          ref.mcp.textContent = m.enabled ? (m.allowSystem ? 'On + system' : 'On') : 'Off';
          ref.mcp.className = `badge ${m.enabled ? (m.allowSystem ? 'badge-warning' : 'badge-success') : ''}`;
          ref.mcpBox.title = m.enabled ? (m.allowSystem ? 'Enabled, the assistant may also delete files, reboot and update' : 'Enabled') : 'Switched off';
        }
        updateServices();
      };
      const updateServices = () => { ref.noServices.hidden = !(ref.mqttBox.hidden && ref.mcpBox.hidden); };

      const loadProcessData = async () => {
        const d = await Api.process.get(st.abort.signal);
        if (!d || st.dead) return null;
        loadMqtt();
        loadMcp();

        try {
          renderSequenceCards(d);
          ref.state.textContent = d.process_state;
          renderProcessError(d.process_error, d.process_state);
          ref.uptime.textContent = formatUptime(d.device_uptime);
          ref.cyclesPill.textContent = `${d.cycle_counter} ${Number(d.cycle_counter) === 1 ? 'cycle' : 'cycles'}`;
          ref.cyclesPill.hidden = false;
          ref.rssiBox.style.display = d.wlan_rssi === -255 ? 'none' : ''; // hide the row when the device reports no WLAN
          renderRssi(d.wlan_rssi);
        } catch (e) {
          console.error('Rendering process data failed | ', e);
        }
        return `${d.cycle_counter}|${d.process_state}`;
      };

      // Soft edges of the foreground image (like the blurred-image-card): the mask fades the outer 10 percent of the visible image
      const applyFadeMask = () => {
        const fg = ref.img;
        const card = ref.imageCard;
        if (!fg.naturalWidth || fg.classList.contains('is-loading')) {
          fg.style.maskImage = fg.style.webkitMaskImage = '';
          return;
        }
        const cw = card.clientWidth;
        const ch = card.clientHeight;
        if (!cw || !ch) return;
        const fade = 10;
        const imgRatio = fg.naturalWidth / fg.naturalHeight;
        const cardRatio = cw / ch;
        let left, top, w, h; // position of the contained image in percent of the card
        if (imgRatio > cardRatio) {
          w = 100;
          h = (cardRatio / imgRatio) * 100;
          left = 0;
          top = (100 - h) / 2;
        } else {
          h = 100;
          w = (imgRatio / cardRatio) * 100;
          top = 0;
          left = (100 - w) / 2;
        }
        const fw = (fade * w) / 100;
        const fh = (fade * h) / 100;
        const blur = Math.max(fw, fh) / 2;
        const svg =
          "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><defs><filter id='f' x='-50%' y='-50%' width='200%' height='200%'>" +
          `<feGaussianBlur stdDeviation='${blur}'/></filter></defs><rect x='${left + fw}' y='${top + fh}' width='${w - fw * 2}' height='${h - fh * 2}' fill='white' filter='url(#f)'/></svg>`;
        const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
        fg.style.maskImage = fg.style.webkitMaskImage = url;
      };
      st.reveal = createImageReveal({ card: ref.imageCard, canvas: ref.canvas, bgCanvas: ref.bgCanvas, stage: ref.stage });
      const resizeObserver = new ResizeObserver(() => {
        applyFadeMask();
        st.reveal.relayout();
      });
      resizeObserver.observe(ref.imageCard);
      st.offResize = () => resizeObserver.disconnect();

      const loadRoiImage = () => {
        const img = ref.img;
        return new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), 15000); // safety timeout
          const done = (ok) => {
            clearTimeout(timer);
            img.classList.remove('is-loading');
            resolve(ok);
          };
          const url = Api.process.imageUrl('alg_roi.jpg');
          img.onload = () => {
            ref.imgBg.src = url; // blurred copy fills the card
            ref.imgBg.hidden = false;
            done(true);
            applyFadeMask();
          };
          img.onabort = () => done(false);
          img.onerror = () => {
            img.onerror = null;
            ref.imgBg.hidden = true;
            img.src = typeof noImageAvailable !== 'undefined' ? noImageAvailable : '';
            done(false);
            applyFadeMask();
          };
          img.src = url;
        });
      };

      const renderRecognition = (data) => {
        const body = ref.recBody;
        body.textContent = '';
        if (!data) {
          body.append(el('span', 'dash-log-empty', 'Recognition details not available'));
          return;
        }
        if (!data.ready) {
          body.append(el('span', 'dash-log-empty', `Waiting for the first completed cycle (${data.state || 'not initialized'})`));
          return;
        }
        for (const seq of data.sequences) {
          if (data.sequences.length > 1) body.append(el('div', 'rec-roi-title', `Sequence \u00b7 ${seq.name}`));
          body.append(recRoiSection('Digit ROIs', seq.digit, 'digit'), recRoiSection('Analog ROIs', seq.analog, 'analog'));
        }
      };

      const loadRecognition = async () => {
        const data = await Api.process.recognition(st.abort.signal);
        if (st.dead) return null;
        // while the cycle runs the live view builds the tiles itself
        if (!(st.liveTiles && (st.reveal.liveActive || st.capturing))) renderRecognition(data);
        if (!st.capturing && !st.reveal.liveActive) setRecUpdating(false);
        return data;
      };

      const refresh = async (auto = false) => {
        if (st.running || st.dead) return;
        if (auto && st.editingSeq !== null) return; // keep an open editor untouched
        st.running = true;

        try {
          const key = await loadProcessData();
          if (key === null) return; // device not answering: skip the image
          st.lastDataAt = performance.now();
          loadActivity();

          // Manual refresh always reloads the image; auto refresh only when cycle or step changed
          if (!st.capturing && (!auto || key !== st.lastImageKey)) {
            const rec = await loadRecognition();
            st.lastImageKey = key;
            st.plot?.load();
            await applyReveal(rec);
          }
        } catch (error) {
          console.error('Refresh failed:', error);
        } finally {
          st.running = false;
        }
      };

      const scheduleAuto = () => {
        clearTimeout(st.timer);
        if (st.dead) return;
        st.timer = setTimeout(() => {
          refresh(true).then(scheduleAuto);
        }, st.capturing ? 1500 : AUTO_REFRESH_MS);
      };

      // ---- init ----------------------------------------------------------
      // joins a cycle that is already running (everything the status handler needs exists now)
      const lastStatus = typeof CycleMonitor !== 'undefined' ? CycleMonitor.last() : null;
      if (lastStatus) onCycleStatus({ detail: lastStatus });

      (async () => {
        root.classList.add('is-syncing'); // first load: same "updating" look as after a stale tab
        const loaded = () => { if (!st.dead && !st.syncing) root.classList.remove('is-syncing'); };
        setTimeout(loaded, 15000); // safety: never stays dimmed when the device does not answer
        if (typeof loaderSpinner !== 'undefined') ref.img.src = loaderSpinner;
        st.lastImageKey = await loadProcessData();
        if (st.dead) return;
        st.lastDataAt = performance.now();
        if (!st.capturing) {
          await applyReveal(await loadRecognition()); // the device picture (alg_roi.jpg) is only loaded if the animation view is not possible
        } else {
          await loadRecognition();
        }
        loaded();
        loadActivity();
        st.plot = createReadingsPlot(ref.plotCard, ref.plotRange, ref.plotBody, st.abort.signal);
        st.plot.load();
        scheduleAuto();
      })();
    },

    unmount() {
      const st = dashActive;
      if (!st) return;
      st.dead = true;
      clearTimeout(st.timer);
      st.offStatus?.();
      st.offVis?.();
      st.offTimer?.();
      st.offResize?.();
      st.reveal?.cancel();
      clearTimeout(st.holdTimer);
      st.abort.abort();
      dashActive = null;
    },
  });
})();

/* ========================================================================== */
/* View: setup                                                                */
/* ========================================================================== */

/* ========================================================================== */
/* Setup: reference image + alignment markers + digit / analog ROIs (view `setup`) and the     */
/* initial setup wizard (view `wizard`). The editor is a reusable component:                   */
/*   App.setup.mountEditor(root, tab, opts) -> { unmount, isDirty, save, setTab, getTab }      */
/* ========================================================================== */
(function () {
  'use strict';

  const REF_IMAGE_WIDTH = 640; // ROI position validation assumes the 640x480 reference image
  const REF_IMAGE_HEIGHT = 480;
  const IMG_1PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
  const EDITOR_TABS = ['image', 'markers', 'digit', 'analog'];
  const TAB_TITLE = {
    image: 'Reference image',
    markers: 'Reference image ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· alignment markers',
    digit: 'Reference image ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· digit ROIs',
    analog: 'Reference image ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· analog ROIs',
  };
  const TAB_LABEL = { image: 'Image', markers: 'Markers', digit: 'Digits', analog: 'Analog' };
  // route part <-> internal tab id
  const ROUTE_TO_TAB = { image: 'image', markers: 'markers', digit: 'digit', digits: 'digit', analog: 'analog' };
  const TAB_TO_ROUTE = { image: 'image', markers: 'markers', digit: 'digits', analog: 'analog' };
  const WIZARD_STEP_KEY = 'setupStep'; // sessionStorage, same key as the former setup.html
  const WIZARD_LAST_STEP = 5;
  const WIZARD_ABORT_STEP = 99;

  let uidCounter = 0;

  /* ======================================================================== */
  /* Api.setup: everything the setup views need from the device                */
  /* ======================================================================== */
  /*
   * Legacy firmware endpoints used here (phase 2 replaces them by /api/*):
   *   GET  /config                                   whole configuration (JSON), cached by loadConfig() in sessionStorage
   *   POST /config?reload=true                       save a (partial) configuration and apply it
   *   GET  /camera?task=capture&<camera params>      single shot with temporary parameters (JPEG blob)
   *   POST /upload/config/reference.jpg?overwrite=true   store the reference image (JPEG blob)
   *   POST /api/flow/cutref {in,out,x,y,dx,dy}  cut an alignment marker from the reference image into /img_tmp
   *   POST /api/flow/copy {in,out}              copy a file on the SD card (marker /img_tmp -> /config)
   *   GET  /fileserver/config/reference.jpg, /fileserver/config/markerN.jpg, /fileserver/img_tmp/markerN.jpg   images
   *   GET  /log                                      current log (plain text), wizard log dialog
   */
  const setupApi = {
    /** Configuration object currently cached by the core (sessionStorage) or null. */
    getConfig() {
      let raw = null;
      try {
        raw = sessionStorage.getItem('jsonConfigData');
      } catch (e) {
        /* storage blocked */
      }
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    },

    /** Loads the configuration from the device (toasts and throws on failure). @returns {Promise<object>} */
    async loadConfig() {
      await loadConfig();
      const cfg = setupApi.getConfig();
      if (!cfg) throw new Error('Configuration not available');
      return cfg;
    },

    /** Cached configuration, loads it from the device when nothing is cached. */
    async ensureConfig() {
      return setupApi.getConfig() || setupApi.loadConfig();
    },

    /** Saves a partial configuration (delta). Toasts and throws on failure. */
    async saveConfig(delta, reload = true) {
      await saveConfig(JSON.stringify(delta), reload);
    },

    /**
     * Captures an image with a temporary camera parameter set.
     * @param {Object<string,string>} params flashtime, flashintensity, brightness, ... (see /camera usage)
     * @returns {Promise<{ok:boolean, blob:Blob|null}>}
     */
    async capture(params) {
      const flashTime = parseInt(params.flashtime, 10) || 1000;
      const timeout = Math.max(flashTime + 10000, 15000);
      const query = new URLSearchParams({ task: 'capture', ...params });
      const res = await apiCallNotify(`/camera?${query}`, { timeout }, {
        action: 'Setting image parameter',
        loadingMsg: 'Capturing image...',
        loadingIcon: 'scan',
        parseType: 'blob',
      });
      return { ok: res.ok, blob: res.ok ? res.data : null };
    },

    /** Capture with the device's current camera configuration (wizard preview). Blob or null (toast on failure). */
    async capturePreview(flashTimeMs) {
      const timeout = Math.max((flashTimeMs || 0) + 10000, 15000);
      const res = await apiCallNotify('/camera?task=capture', { timeout }, {
        action: 'Capturing image',
        parseType: 'blob',
        httpObj: {
          403: () => ({
            msg: 'Camera not detected / supported or not initialized. Check camera module installation',
            type: 'danger',
            time: 30000,
          }),
        },
      });
      return res.error || !res.ok ? null : res.data;
    },

    /** Stores the reference image. @returns {Promise<boolean>} */
    async uploadReferenceImage(blob) {
      const res = await Api.post(withDomain(getDomainname(), '/upload/config/reference.jpg?overwrite=true'), blob, { action: 'Image save request' });
      return res.ok;
    },

    /** URL of the stored reference image (cache busted). */
    referenceImageUrl() {
      return `${getDomainname()}/fileserver/config/reference.jpg?${Math.floor(Math.random() * 1000000 + 1)}`;
    },

    /** URL of marker image number `n` (1 based); `pending` = freshly cut but not yet saved (/img_tmp). */
    markerImageUrl(n, pending) {
      return `${getDomainname()}/fileserver${pending ? '/img_tmp' : '/config'}/marker${n}.jpg?${Math.floor(Math.random() * 1000000 + 1)}`;
    },

    /** Cuts the marker area out of the stored reference image into /img_tmp. @returns {Promise<boolean>} */
    async cutMarker(n, roi) {
      const body = { in: '/config/reference.jpg', out: `/img_tmp/marker${n}.jpg`, x: roi.x, y: roi.y, dx: roi.dx, dy: roi.dy };
      const res = await Api.post('/api/flow/cutref', body, {
        action: 'Marker update',
        loadingMsg: 'Request marker update...',
        resultMsg: 'Marker successfully updated',
        httpObj: {
          405: (r) => ({
            msg: `Marker update available in IDLE state only. Please retry shortly. [${String(jsonField(r.data, 'message') ?? '').split(' | ')[1]?.trim() || 'Unknown State'}]`,
            type: 'warning',
            time: 2000,
          }),
        },
      });
      return res.ok;
    },

    /** Makes the cut marker permanent (/img_tmp -> /config). Throws on failure. */
    async commitMarker(n) {
      await apiCopy(`/img_tmp/marker${n}.jpg`, `/config/marker${n}.jpg`);
    },

    /** Current log file as text ('' when not available). */
    async getLog() {
      const res = await apiCall('/log', { timeout: 20000 });
      return res.ok && typeof res.data === 'string' ? res.data : '';
    },
  };
  Api.setup = setupApi;

  /* ======================================================================== */
  /* Small shared helpers (module private)                                    */
  /* ======================================================================== */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const show = (el, condition) => el && el.classList.toggle('hidden', !condition);

  /** Reads a dotted path like 'gpio.gpiopin.0.pinmode' (undefined when missing). */
  function getPath(obj, path) {
    return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
  }

  /** Sets a form control from a config value (selects match case-insensitively on the option value). */
  function setControlValue(el, value) {
    if (!el || value === undefined || value === null) return;
    if (el.tagName === 'SELECT') {
      const wanted = String(value).toLowerCase();
      const idx = Array.from(el.options).findIndex((o) => o.value.toLowerCase() === wanted);
      if (idx >= 0) el.selectedIndex = idx;
    } else {
      el.value = value;
    }
  }

  /**
   * Merges `name = value` into a delta object and returns the new delta (same behaviour as gatherChangedParameter(form)):
   * booleans as 'true'/'false' strings are converted, `integer` parses ints. Do NOT use it for ROI / marker arrays:
   * deepMergeObjects turns arrays into objects, those are copied as a whole instead.
   */
  function mergeParam(delta, name, value, integer) {
    return deepMergeObjects(delta, deepSet({}, name, value, integer));
  }

  /** Native range-limit helper: `<input onchange="!validity.rangeUnderflow || (value = n)">`. */
  function clampMin(input, min) {
    if (input.validity.rangeUnderflow) input.value = min;
  }

  /** Last real camera picture of the wizard (raw, before the calculated preview) so the camera step can come back to it. */
  let wizardLastTake = null;
  const KEY_CAM = 'takeimage.camera.';
  /** Camera / flashlight parameter table of the image tab: two parameter columns per row (same layout as before). */
  const CAM_ROWS = [
    [
      { name: KEY_CAM + 'zoomfactor', label: 'Zoom Factor', type: 'range', min: 1000, max: 4000, value: 1000, int: true, init: true, fmt: 'zoom' },
      { name: KEY_CAM + 'zoomoffsetx', label: 'Zoom Offset X', type: 'range', min: -960, max: 960, value: 0, int: true, init: true, gate: 'zoom' },
    ],
    [
      { name: KEY_CAM + 'zoomoffsety', label: 'Zoom Offset Y', type: 'range', min: -720, max: 720, value: 0, int: true, init: true, gate: 'zoom' },
      { name: 'imagealignment.imagerotation', label: 'Image Rotation', type: 'range', min: -180, max: 180, step: 0.1, value: 0, fmt: 'deg' },
    ],
    [
      { name: 'takeimage.flashlight.flashtime', label: 'Flash Time', type: 'range', min: 100, max: 10000, step: 100, value: 100, int: true, fmt: 'ms' },
      { name: 'takeimage.flashlight.flashintensity', label: 'Flash Intensity', type: 'range', min: 0, max: 100, value: 30, int: true, fmt: 'pct' },
    ],
    [
      { name: KEY_CAM + 'brightness', label: 'Brightness', type: 'range', min: -2, max: 2, value: 0, int: true, init: true },
      { name: KEY_CAM + 'contrast', label: 'Contrast', type: 'range', min: -2, max: 2, value: 0, int: true, init: true },
    ],
    [
      { name: KEY_CAM + 'saturation', label: 'Saturation', type: 'range', min: -2, max: 2, value: 0, int: true, init: true },
      { name: KEY_CAM + 'sharpness', label: 'Sharpness', type: 'range', min: -3, max: 3, value: 0, int: true, init: true },
    ],
    [
      {
            name: KEY_CAM + 'mirrorimage',
            label: 'Mirror Image',
            type: 'select',
            options: [['false', 'Disabled'], ['true', 'Enabled']],
          },
      {
            name: KEY_CAM + 'flipimage',
            label: 'Flip Image',
            type: 'select',
            options: [['false', 'Disabled'], ['true', 'Enabled']],
          },
    ],
    [
      {
            name: KEY_CAM + 'gaincontrolmode',
            label: 'Gain Control',
            type: 'select',
            int: true,
            init: true,
            value: '1',
            options: [['0', 'Manual'], ['1', 'Auto']],
          },
      {
            name: KEY_CAM + 'exposurecontrolmode',
            label: 'Exposure Control',
            type: 'select',
            int: true,
            init: true,
            value: '1',
            options: [['0', 'Manual'], ['1', 'Auto'], ['2', 'Auto (AEC2)']],
          },
    ],
    [
      { name: KEY_CAM + 'manualgainvalue', label: 'Manual Gain Value', type: 'range', min: 0, max: 30, value: 0, int: true, init: true, gate: 'gainManual' },
      { name: KEY_CAM + 'autoexposurelevel', label: 'Auto Exposure Level', type: 'range', min: -2, max: 2, value: 0, int: true, init: true, gate: 'expAuto' },
    ],
    [
      {
            name: KEY_CAM + 'specialeffect',
            label: 'Special Effect',
            type: 'select',
            int: true,
            options: [['0', 'None'], ['1', 'Negative'], ['2', 'Grayscale'], ['7', 'Gray+Negative']],
          },
      { name: KEY_CAM + 'manualexposurevalue', label: 'Manual Exposure Value', type: 'range', min: 0, max: 1920, value: 0, int: true, init: true, gate: 'expManual' },
    ],
  ];
  /** Always visible; everything else sits behind the "Advanced" switch. */
  const CAM_BASIC = ['imagealignment.imagerotation', 'takeimage.flashlight.flashtime', 'takeimage.flashlight.flashintensity', KEY_CAM + 'mirrorimage', KEY_CAM + 'flipimage'];
  const CAM_ORDER = [
    ...CAM_BASIC,
    KEY_CAM + 'zoomfactor', KEY_CAM + 'zoomoffsetx', KEY_CAM + 'zoomoffsety',
    KEY_CAM + 'brightness', KEY_CAM + 'contrast', KEY_CAM + 'saturation', KEY_CAM + 'sharpness',
    KEY_CAM + 'gaincontrolmode', KEY_CAM + 'manualgainvalue', KEY_CAM + 'exposurecontrolmode', KEY_CAM + 'autoexposurelevel', KEY_CAM + 'manualexposurevalue',
    KEY_CAM + 'specialeffect',
  ];
  /** Look of the custom controls: step of the -/+ buttons and how a select is shown (switch or segmented buttons). */
  const CAM_UI = {
    [KEY_CAM + 'zoomfactor']: { step: 100 },
    [KEY_CAM + 'zoomoffsetx']: { step: 10 },
    [KEY_CAM + 'zoomoffsety']: { step: 10 },
    [KEY_CAM + 'manualexposurevalue']: { step: 10 },
    'takeimage.flashlight.flashtime': { step: 100 },
    'takeimage.flashlight.flashintensity': { step: 5 },
    'imagealignment.imagerotation': { step: 0.1 },
    [KEY_CAM + 'mirrorimage']: { kind: 'switch' },
    [KEY_CAM + 'flipimage']: { kind: 'switch' },
  };
  const CAM_FIELDS = CAM_ROWS.flat();
  /** Settings shown calculated on the taken picture (rotation, mirror, flip, brightness, contrast, saturation, sharpness, special effect); all others show only on a new camera picture. */
  const CAM_PREVIEW = new Set(['imagealignment.imagerotation', KEY_CAM + 'mirrorimage', KEY_CAM + 'flipimage', KEY_CAM + 'brightness', KEY_CAM + 'contrast', KEY_CAM + 'saturation', KEY_CAM + 'sharpness', KEY_CAM + 'specialeffect']);
  /** Text of the value shown next to a slider. */
  function camFormat(f, v) {
    switch (f.fmt) {
      case 'zoom':
        return `x`;
      case 'deg':
        return `ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°`;
      case 'ms':
        return ` ms`;
      case 'pct':
        return ` %`;
      default:
        return String(v);
    }
  }
  /** Parameters sent to /camera?task=capture: query key -> [config name, default] (same defaults as before) */
  const CAPTURE_PARAMS = [
    ['flashtime', 'takeimage.flashlight.flashtime', '100'],
    ['flashintensity', 'takeimage.flashlight.flashintensity', '30'],
    ['brightness', KEY_CAM + 'brightness', '0'],
    ['contrast', KEY_CAM + 'contrast', '0'],
    ['saturation', KEY_CAM + 'saturation', '0'],
    ['sharpness', KEY_CAM + 'sharpness', '0'],
    ['exposurecontrolmode', KEY_CAM + 'exposurecontrolmode', '1'],
    ['autoexposurelevel', KEY_CAM + 'autoexposurelevel', '0'],
    ['manualexposurevalue', KEY_CAM + 'manualexposurevalue', '300'],
    ['gaincontrolmode', KEY_CAM + 'gaincontrolmode', '1'],
    ['manualgainvalue', KEY_CAM + 'manualgainvalue', '0'],
    ['specialeffect', KEY_CAM + 'specialeffect', '0'],
    ['mirror', KEY_CAM + 'mirrorimage', 'false'],
    ['flip', KEY_CAM + 'flipimage', 'false'],
    ['zoomfactor', KEY_CAM + 'zoomfactor', '1000'],
    ['zoomx', KEY_CAM + 'zoomoffsetx', '0'],
    ['zoomy', KEY_CAM + 'zoomoffsety', '0'],
  ];

  /** Markup of the camera / flashlight controls (tooltips are looked up by tooltips.js via data-help = config name). The native inputs stay inside as the source of truth. */
  function camPanelMarkup() {
    const spec = Object.fromEntries(CAM_FIELDS.map((f) => [f.name, f]));
    const ctl = (name) => {
      const f = spec[name];
      const ui = CAM_UI[name] || {};
      const help = name.replace(/\./g, '_');
      const gate = f.gate ? ` setup-gate-${f.gate}` : '';
      const adv = CAM_BASIC.includes(name) ? '' : ' setup-cam-adv';
      const cls = `cam-ctl setup-cam-cell${adv}${gate}`;
      const label = App.esc(f.label);
      const tag = CAM_PREVIEW.has(name) ? '<span class="cam-tag cam-tag-live" title="Shown right away on the picture">Preview</span>' : '<span class="cam-tag" title="Needs a new camera picture">Camera</span>';
      const head = (extra) => `<div class="cam-head"><div class="tooltip-trigger" data-help="${help}"></div><span class="cam-label">${label}</span>${tag}${extra}</div>`;
      const btn = (dir, sign) => `<button type="button" class="cam-step" data-dir="${dir}" aria-label="${dir < 0 ? 'Decrease' : 'Increase'} ${label}">${sign}</button>`;
      if (f.type === 'range') {
        return `<div class="${cls} cam-range" data-cam="${name}">${head(`<output data-out="${name}">${camFormat(f, f.value)}</output>`)}
          <div class="cam-slide">${btn(-1, '\u2212')}<input type="range" min="${f.min}" max="${f.max}"${f.step !== undefined ? ` step="${f.step}"` : ''} value="${f.value}" data-param="${name}" aria-label="${label}" />${btn(1, '+')}</div></div>`;
      }
      if (f.type === 'select') {
        const opts = f.options.map(([v, t]) => `<option value="${v}"${f.value === v ? ' selected' : ''}>${App.esc(t)}</option>`).join('');
        const select = `<select data-param="${name}" hidden>${opts}</select>`;
        if (ui.kind === 'switch') {
          return `<div class="${cls} cam-toggle" data-cam="${name}">${head(`<label class="cam-sw"><input type="checkbox" class="cam-check" aria-label="${label}" /></label>`)}${select}</div>`;
        }
        return `<div class="${cls} cam-seg" data-cam="${name}">${head('')}<div class="m-seg cam-segbtns"></div>${select}</div>`;
      }
      const step = f.step !== undefined ? ` step="${f.step}"` : '';
      const max = f.max !== undefined ? ` max="${f.max}"` : '';
      return `<div class="${cls} cam-num" data-cam="${name}">${head('')}
        <div class="cam-numrow">${btn(-1, '\u2212')}<input required type="number" min="${f.min}"${max}${step} value="${f.value}" data-param="${name}" aria-label="${label}" /><span class="cam-unit">${f.unit}</span>${btn(1, '+')}</div></div>`;
    };
    const basicInputs = CAM_BASIC.filter((n) => CAM_UI[n]?.kind !== 'switch').map(ctl).join('');
    const toggles = CAM_BASIC.filter((n) => CAM_UI[n]?.kind === 'switch').map(ctl).join('');
    const advanced = CAM_ORDER.filter((n) => !CAM_BASIC.includes(n)).map(ctl).join('');
    return `${basicInputs}<div class="cam-toggles">${toggles}</div>${advanced}`;
  }

  /* ======================================================================== */
  /* Editor component                                                         */
  /* ======================================================================== */

  /** Pointer position in canvas pixels (also correct while the canvas is scaled down by CSS). */
  function pointerPos(e, elem) {
    const r = elem.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) * elem.width) / r.width),
      y: Math.round(((e.clientY - r.top) * elem.height) / r.height),
    };
  }

  /** Validates a number sequence name. @returns {string} error text or '' */
  function validateSequenceName(name) {
    if (name.length === 0) return 'Number sequence name must not be empty';
    if (name.indexOf('.') >= 0 || name.indexOf(',') >= 0 || name.indexOf(' ') >= 0 || name.indexOf('"') >= 0) {
      return 'Number sequence name must not contain , . " or a space';
    }
    return '';
  }

  const EDITOR_HELP = `
    <div class="help-item">
      <h4>Image</h4>
      <p>Press <b>Update image</b> to take a new picture; then the camera values can be changed. Press it again after every change. Save the new image with the bar at the bottom or discard it to return to the stored one. Make sure it is level (use <i>Image Rotation</i>). Markers and ROIs are placed on this image.</p>
    </div>
    <div class="help-item">
      <h4>Markers</h4>
      <p>Two markers let the device correct small shifts and rotations. Pick a marker, drag its area on the image or enter coordinates, then click <b>Update Marker</b>. Keep markers small, sharp and high-contrast.</p>
    </div>
    <div class="help-item">
      <h4>Digits and analog</h4>
      <p>Group ROIs (<b>R</b>egions <b>O</b>f <b>I</b>nterest) into number sequences. Drag them or enter coordinates; their order defines the decimal place, <b>Move higher / lower</b> changes it. See the <a href="https://jomjol.github.io/AI-on-the-edge-device-docs/ROI-Configuration/" target="_blank" rel="noopener noreferrer">ROI documentation</a>.</p>
    </div>
    <div class="help-item">
      <h4>Saving</h4>
      <p>Markers, digits and analog share one save bar at the bottom. A new image is saved separately on the Image tab.</p>
    </div>`;

  /**
   * Mounts the setup editor (reference image / markers / digit ROIs / analog ROIs) into `root`.
   * All state lives in this closure, any number of mounts is possible (one at a time in practice).
   * @param {HTMLElement} root
   * @param {'image'|'markers'|'digit'|'digits'|'analog'|undefined} tab  initial tab (default: image)
   * @param {{tabs?:boolean, header?:boolean, helpOpen?:boolean, saveBar?:'global'|'inline'|'none',
   *          onNavigate?:(tab:string)=>void, onTabChange?:(tab:string)=>void, onDirtyChange?:(dirty:boolean)=>void}} [opts]
   *   tabs      show the tab bar (default true)
   *   header    show title + subtitle (default true)
   *   introHint  (default true) while no reference image exists show a hint instead of the picture, the button reads Take camera image
   *   onImageState({exists, pending, stale})  the picture state changed (stale: settings differ from the picture)
   *   sequenceBar  show the number sequence selector with the digit / analog switches (default true)
   *   seqCombo  show the number sequence combo inside that bar (default true)
   *   tabList  tabs to show (default all)
   *   autoDigit  switch the digits on when neither digits nor analog is on
   *   centerMarkers  markers that were never placed start in the middle of the picture
   *   onAlignState({ready, procs})  both markers placed (cut once) and at least one of digit / analog selected
   *   helpOpen  "How it works" expanded
   *   saveBar   'global' = core SaveBar (default), 'inline' = bar inside the editor (wizard), 'none'
   *   onNavigate(tab)  tab bar click: the host routes (and calls setTab); without it the editor switches itself
   *   onTabChange(tab) tab changed without a click (digit/analog switch by the processing check boxes): host syncs its URL
   * @returns {{unmount():void, isDirty():boolean, save():Promise<void>, setTab(tab:string):Promise<boolean>, getTab():string|null, ready:Promise<void>}}
   */
  function mountEditor(root, tab, opts = {}) {
    const uid = ++uidCounter;
    const o = { tabs: true, header: true, helpOpen: false, saveBar: 'global', sequenceBar: true, seqCombo: true, procSwitches: true, centerMarkers: false, tabList: null, autoDigit: false, introHint: true, ...opts };
    const toInt = (v) => parseInt(v, 10);

    /* -------------------------------------------------------------- state */
    let destroyed = false;
    let cfg = {}; // last configuration loaded from the device
    let delta = {}; // modified parameters (digit / analog / numbersequences / imagealignment.marker + image parameters)
    let mode = null; // image | markers | digit | analog
    let currentTab = null;
    let roiType = 'digit'; // ROI set that is edited (digit | analog), follows the tab
    let roiSelected = 0;
    let lockAspectRatio = true;
    let lockAspectRatioAnalog = true;
    let lockSizeDigit = false;
    let lockSizeAnalog = false;
    let lockSpaceEquidistant = true;
    let space = 3;
    let rect = {};
    let drag = false;
    let mDragState = null; // drag of a region with a finger (compact layout)
    let markerSelected = 0;
    let markerRoi; // === delta.imagealignment.marker (an array: copied as a whole, never merged)
    let isActReference = false;
    let specialeffect = '0';
    let currentBlobUrl = null;
    let refMissing = false; // introHint: the device has no reference image yet
    let capParams = null; // camera values of the picture that was really taken
    let imagePending = false; // a new camera image exists that is not saved yet
    let camUnlocked = false;
    let editorSnapshot = '';
    let initializing = false;
    let imageOk = false;
    let loadToken = 0;
    let saving = false;
    let lastDirty = false;
    const imageObj = new Image();

    /* ------------------------------------------------------------- markup */
    const tabButtons = EDITOR_TABS.filter((t) => !o.tabList || o.tabList.includes(t)).map(
      (t) =>
        `<button type="button" class="setup-tab" role="tab" data-click="tab" data-tab="${t}">${TAB_LABEL[t]}` +
        (t === 'markers' || t === 'digit' || t === 'analog' ? ` <span class="setup-tab-count" data-count="${t}"></span>` : '') +
        '</button>',
    ).join('');

    const histName = `setup-hist-${uid}`;
    root.classList.add('setup');
    root.innerHTML = `
      <div class="container-header setup-header">
        ${o.header ? '<div class="container-title">Configuration</div><div class="page-sub">Reference image, alignment markers and the digit and analog regions of your meter.</div>' : ''}
        <details class="setup-desc" data-ref="desc"${o.helpOpen ? ' open' : ''}>
          <summary>How it works</summary>
          <div class="help-panel">${EDITOR_HELP}</div>
        </details>
        <div class="card setup-seqcard"${o.sequenceBar ? '' : ' hidden'}>
        <div class="m-only setup-seqglobal" data-ref="mSeqBar">
          <div class="m-seqrow">
            <div class="m-combo" data-ref="mSeqCombo"${o.seqCombo ? '' : ' hidden'}></div>
            <div class="m-procs"${o.procSwitches ? '' : ' hidden'}>
              <label class="m-proc" title="Process digit ROIs"><span>Digits</span><input type="checkbox" data-change="digitProcessing" data-ref="digitProcessing" aria-label="Process digit ROIs" /><span hidden data-ref="digitProcessingText"></span></label>
              <label class="m-proc" title="Process analog ROIs"><span>Analog</span><input type="checkbox" data-change="analogProcessing" data-ref="analogProcessing" aria-label="Process analog ROIs" /><span hidden data-ref="analogProcessingText"></span></label>
            </div>
          </div>
        </div>
        </div>
        ${o.tabs ? `<div class="setup-tabs" role="tablist">${tabButtons}</div>` : ''}
      </div>

      <div class="container-content">
        <div class="editor-layout" data-ref="layout">
          <div class="setup-main">
            <div class="card setup-imgcard">
              <div class="card-header">
                <span data-ref="canvasTitle">Reference image</span>
                <div class="setup-canvas-options" data-ref="optsRoi" hidden>
                  <label class="check setup-vis-digitanalog setup-switch">
                    <input type="checkbox" data-change="redraw" data-ref="showDigitAnalog" checked />Show digit + analog ROIs
                  </label>
                </div>
                <div class="setup-header-actions" data-ref="optsImage" hidden>
                  <button type="button" class="button setup-takebtn" data-click="take" data-ref="take">Update image</button>
                </div>
              </div>
              <div class="m-only setup-seqbar" data-ref="mMarkerBar" hidden>
                <div class="m-combo" data-ref="mMarkerCombo"></div>
              </div>
              <div class="m-only setup-seqbar setup-roibar" data-ref="mRoiBar" hidden>
                <div class="m-combo" data-ref="mRoiCombo"></div>
              </div>
              <div class="canvas-wrap">
                <img data-ref="loading" alt="Loading..." />
                <canvas data-ref="canvas" style="display: none"></canvas>
                <div class="setup-bubble" data-ref="bubble" role="status" hidden>
                  <span>The settings changed. Update the image to check the result with the camera.</span>
                  <button type="button" class="button btn-action" data-click="take">Update image</button>
                </div>
                <div class="setup-intro" data-ref="intro" hidden>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
                  <b>Let's set up the camera image</b>
                  <span>There is no picture on the device yet. Point the camera at your meter and press <i>Take camera image</i>. Save the picture, then continue with the next step.</span>
                </div>
              </div>
              <div class="setup-imgtools" data-ref="zoomBox" hidden>
                <label class="check setup-zoom">
                  <input type="checkbox" data-change="zoomRoi" data-ref="zoomRoi" />Zoom in
                </label>
              </div>
            </div>

            <div class="card setup-marker-rec" data-ref="panelRec" hidden>
              <div class="card-header">
                <span data-ref="recTitle">Last cycle</span>
                <button type="button" class="button" data-click="recRefresh">Refresh</button>
              </div>
              <div class="side-body">
                <div class="rec" data-ref="recBody"><span class="dash-log-empty">Loading ...</span></div>
              </div>
            </div>

          </div>

          <div class="editor-side" data-ref="side">
            <div data-ref="panelImage" hidden>
              <div class="card">
                <div class="card-header setup-cam-head">
                  <label class="check setup-switch setup-cam-switch">
                    <input type="checkbox" data-change="camAdvanced" data-ref="camAdv" />Advanced
                  </label>
                </div>
                <ul class="cam-note">
                  <li><span class="cam-tag cam-tag-live">Preview</span> shows at once on the picture (calculated).</li>
                  <li><span class="cam-tag">Camera</span> needs a new picture. A hint appears after every change.</li>
                </ul>
                <div class="cam-wrap">
                  <div class="cam-grid" data-ref="camGrid">${camPanelMarkup()}</div>
                  <div class="cam-lock" data-ref="camLock"><span>Update the image first, then you can change the settings.</span></div>
                </div>
              </div>
            </div>
            <div data-ref="panelMarkers" hidden>
              <div class="m-only setup-pair" data-ref="mPairMarker"></div>
              <div class="card setup-markercard m-hide">
                <div class="card-header"><span>Marker</span></div>
                <div class="side-body">
                  <label class="field m-hide">
                    <span class="field-label">Selected marker</span>
                    <select data-change="markerSelect" data-ref="markerSelect"></select>
                  </label>
                  <div class="field-grid m-hide">
                    <label class="field"><span class="field-label">X</span><input type="number" min="1" data-change="markerValue" data-ref="mx" /></label>
                    <label class="field"><span class="field-label">Y</span><input type="number" min="1" data-change="markerValue" data-ref="my" /></label>
                    <label class="field"><span class="field-label">Width</span><input type="number" min="1" data-change="markerValue" data-ref="mdx" /></label>
                    <label class="field"><span class="field-label">Height</span><input type="number" min="1" data-change="markerValue" data-ref="mdy" /></label>
                  </div>
                  <div class="field-grid">
                    <div class="field">
                      <span class="field-label">Marker image</span>
                      <img class="setup-marker-image" data-ref="markerImage" alt="" />
                    </div>
                    <div class="field">
                      <span class="field-label">Histogram</span>
                      <canvas class="setup-histogram" height="60" width="190" data-ref="hist"></canvas>
                    </div>
                  </div>
                  <div class="setup-hist-types">
                    <label class="check"><input name="${histName}" data-change="histogram" data-ref="histValue" type="radio" checked />Value</label>
                    <label class="check"><input name="${histName}" data-change="histogram" data-ref="histRed" type="radio" />Red</label>
                    <label class="check"><input name="${histName}" data-change="histogram" data-ref="histRGB" type="radio" />RGB</label>
                  </div>
                  <div class="btn-row">
                    <button type="button" class="button" data-click="updateMarker" data-ref="updateMarker" disabled>Update Marker</button>
                  </div>
                </div>
              </div>

            </div>

            <div class="setup-contents" data-ref="panelRoi" hidden>
              <div class="m-only m-offnote" data-ref="mOffNote" hidden></div>
              <div class="m-only setup-pair" data-ref="mPairRoi"></div>
              <div class="card m-hide">
                <div class="card-header"><span>Number sequence</span></div>
                <div class="side-body">
                  <label class="field">
                    <span class="field-label">Sequence</span>
                    <select data-change="sequence" data-ref="seqSelect"></select>
                  </label>
                  <div class="btn-row">
                    <button type="button" class="button" data-click="newSequence">New</button>
                    <button type="button" class="button" data-click="renameSequence">Rename</button>
                    <button type="button" class="button btn-danger" data-click="deleteSequence" data-ref="deleteSeq">Delete</button>
                  </div>
                </div>
              </div>

              <div class="card setup-roicard">
                <div class="card-header"><span>Region of interest</span></div>
                <div class="side-body">
                  <div class="setup-roi-inputs" data-ref="roiInputs" hidden>
                    <div class="field-grid m-hide">
                      <label class="field">
                        <span class="field-label">ROI</span>
                        <select data-change="roi" data-ref="roiSelect"></select>
                      </label>
                    </div>
                    <div class="btn-row grid2 m-hide">
                      <button type="button" class="button" data-click="newROI" data-ref="newROI">New</button>
                      <button type="button" class="button btn-danger" data-click="deleteROI" data-ref="deleteROI">Delete</button>
                      <button type="button" class="button" data-click="moveHigher" data-ref="moveHigher">Move higher</button>
                      <button type="button" class="button" data-click="moveLower" data-ref="moveLower">Move lower</button>
                    </div>
                    <div class="setup-multiplier m-hide">
                      <div>Multiplier by order: <output data-ref="multiplier"></output></div>
                      <div>With decimal scaling (<output data-ref="decimalShift"></output>): <output data-ref="multiplierDecshift"></output></div>
                    </div>
                    <div class="field-grid m-hide">
                      <label class="field"><span class="field-label">X</span><input type="number" min="1" data-change="roiValue" data-ref="refx" /></label>
                      <label class="field"><span class="field-label">Y</span><input type="number" min="1" data-change="roiValue" data-ref="refy" /></label>
                      <label class="field"><span class="field-label">Width</span><input type="number" min="1" data-change="roiValueDx" data-ref="refdx" /></label>
                      <label class="field"><span class="field-label">Height</span><input type="number" min="1" data-change="roiValue" data-ref="refdy" /></label>
                    </div>
                    <div class="setup-lock-list">
                      <label class="check setup-digit-only">
                        <input type="checkbox" data-change="lockAspect" data-ref="lockAspectDigit" checked />Lock aspect ratio
                      </label>
                      <label class="check setup-analog-only">
                        <input type="checkbox" data-change="lockAspect" data-ref="lockAspectAnalog" checked />Lock aspect ratio
                      </label>
                      <label class="check setup-digit-only">
                        <input type="checkbox" data-change="lockSizes" data-ref="lockSizesDigit" checked />Synchronize Y, width and height
                      </label>
                      <label class="check setup-analog-only">
                        <input type="checkbox" data-change="lockSizes" data-ref="lockSizesAnalog" checked />Synchronize width and height
                      </label>
                      <label class="check setup-digit-only">
                        <input type="checkbox" data-change="lockSpace" data-ref="lockSpace" checked />
                        <span>Keep spacing of
                          <input class="setup-space-input" type="number" min="0" data-change="roiSpace" data-ref="space" />
                          between all ROIs</span>
                      </label>
                      <label class="check setup-analog-only">
                        <input type="checkbox" data-change="ccw" data-ref="ccw" />Counter clockwise rotation (CCW)
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="setup-inlinebar" data-ref="inlineBar" hidden>
        <span class="setup-inlinebar-text" data-ref="inlineText">Unsaved changes</span>
        <span class="setup-inlinebar-actions">
          <button type="button" class="button ghost" data-click="discard" data-ref="inlineDiscard">Discard</button>
          <button type="button" class="button btn-action" data-click="saveNow" data-ref="inlineSave">Save</button>
        </span>
      </div>`;

    const R = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      R[el.dataset.ref] = el;
    });
    const all = (selector) => Array.from(root.querySelectorAll(selector));
    const g = R.canvas.getContext('2d');
    R.loading.src = loaderSpinner;
    const camInput = {};
    const camUI = {}; // name -> function that mirrors the native input into its custom control
    all('[data-param]').forEach((el) => {
      camInput[el.dataset.param] = el;
    });
    const camSpec = {};
    CAM_FIELDS.forEach((f) => {
      camSpec[f.name] = f;
    });

    /* ------------------------------------------- data access (per mount) */
    const seqIdx = () => R.seqSelect.selectedIndex;
    const seqName = () => R.seqSelect.options[R.seqSelect.selectedIndex].text;
    const roisOf = (type = roiType) => delta[type].sequence[seqIdx()].roi;
    const roiCount = () => roisOf().length;
    const isRoiMode = () => mode === 'digit' || mode === 'analog';

    /* ================================================================== */
    /* Number sequences + ROIs (digit / analog)                           */
    /* ================================================================== */
    function setInputVisibility() {
      const enabled = !!(delta.digit.enabled || delta.analog.enabled);
      R.roiInputs.hidden = !enabled;
    }

    function digitProcessingChanged(init = false) {
      if (init) {
        R.digitProcessing.checked = !!cfg.digit.enabled;
      } else {
        delta.digit.enabled = R.digitProcessing.checked;
      }
      R.digitProcessingText.textContent = R.digitProcessing.checked ? 'On' : 'Off';
      setInputVisibility();
      if (delta.digit.enabled) {
        all('.setup-vis-digitanalog').forEach((el) => show(el, delta.analog.enabled));
        roiType = 'digit';
      } else {
        all('.setup-vis-digitanalog').forEach((el) => show(el, false));
        roiType = 'analog';
      }
      // the switches sit above all tabs: switching one never changes the tab the user is on
      if (!init && isRoiMode()) roiType = mode;
      refreshROI();
      parseROIArrangement();
      onTypeChanged();
    }

    function analogProcessingChanged(init = false) {
      if (init) {
        R.analogProcessing.checked = !!cfg.analog.enabled;
      } else {
        delta.analog.enabled = R.analogProcessing.checked;
      }
      R.analogProcessingText.textContent = R.analogProcessing.checked ? 'On' : 'Off';
      setInputVisibility();
      if (delta.analog.enabled) {
        all('.setup-vis-digitanalog').forEach((el) => show(el, delta.digit.enabled));
        roiType = 'analog';
      } else {
        all('.setup-vis-digitanalog').forEach((el) => show(el, false));
        roiType = 'digit';
      }
      if (!init && isRoiMode()) roiType = mode;
      refreshROI();
      parseROIArrangement();
      onTypeChanged();
    }

    // The digit / analog switch of the original ROI editor follows the tabs
    function onTypeChanged() {
      roiSelected = 0;
      all('.setup-digit-only').forEach((el) => show(el, roiType === 'digit'));
      all('.setup-analog-only').forEach((el) => show(el, roiType === 'analog'));
      refreshROI();
      parseROIArrangement();
      if (!initializing && isRoiMode() && roiType !== mode) {
        mode = roiType;
        currentTab = mode;
        updateTabsUI();
        o.onTabChange?.(mode);
      }
    }

    function onSequenceChanged() {
      roiSelected = 0;
      onTypeChanged();
    }

    function fillSequenceSelectionOptions(selectedSequence) {
      const sel = R.seqSelect;
      sel.options.length = 0;
      const sequences = delta.numbersequences.sequence;
      if (sequences.length === 0) {
        sel.add(new Option('N/A', -1));
      } else {
        for (let i = 0; i < sequences.length; ++i) {
          sel.add(new Option(sequences[i].sequencename, i));
          if (selectedSequence !== undefined && sequences[i].sequencename === selectedSequence) sel.selectedIndex = i;
        }
      }
      R.deleteSeq.disabled = sel.options.length <= 1;
      mFillSeq();
    }

    function createNumberSequence(sequenceName) {
      const err = validateSequenceName(sequenceName);
      if (err) return err;
      if (delta.numbersequences.sequence.some((s) => s.sequencename === sequenceName)) return 'Number sequence name is already existing';

      delta.numbersequences.sequence.push({ sequenceid: -1, sequencename: sequenceName });
      delta.digit.sequence.push({ sequenceid: -1, sequencename: sequenceName, roi: [] });
      delta.analog.sequence.push({ sequenceid: -1, sequencename: sequenceName, roi: [] });
      return '';
    }

    function renameNumberSequence(idx, sequenceNameNew) {
      const err = validateSequenceName(sequenceNameNew);
      if (err) return err;
      if (delta.numbersequences.sequence.some((s) => s.sequencename === sequenceNameNew)) return 'Number sequence name is already existing';
      if (idx === -1) return 'Invalid number sequence index';

      delta.numbersequences.sequence[idx].sequencename = sequenceNameNew;
      delta.digit.sequence[idx].sequencename = sequenceNameNew;
      delta.analog.sequence[idx].sequencename = sequenceNameNew;
      return '';
    }

    function deleteNumberSequence(idx) {
      if (delta.numbersequences.sequence.length === 1) return 'One number sequence is mandatory. Therefore this cannot be deleted';
      delta.numbersequences.sequence.splice(idx, 1);
      delta.digit.sequence.splice(idx, 1);
      delta.analog.sequence.splice(idx, 1);
      return '';
    }

    async function onClickNewSequence() {
      const promptResult = await promptDialog({
        title: 'New number sequence',
        text: 'Choose a name without spaces, commas, dots or quotes.',
        value: 'name',
        okLabel: 'Create',
      });
      if (promptResult === null || destroyed) return; // aborted

      const sequenceName = promptResult.toLowerCase();
      const err = createNumberSequence(sequenceName);
      if (err) firework.launch(err, 'danger', 30000);
      else fillSequenceSelectionOptions(sequenceName);
      onTypeChanged();
    }

    async function onClickRenameSequence() {
      const promptResult = await promptDialog({
        title: 'Rename number sequence',
        text: 'Choose a name without spaces, commas, dots or quotes.',
        value: seqName(),
        okLabel: 'Rename',
      });
      if (promptResult === null || destroyed) return; // aborted

      const sequenceNameNew = promptResult.toLowerCase();
      const err = renameNumberSequence(seqIdx(), sequenceNameNew);
      if (err) firework.launch(err, 'danger', 5000);
      else fillSequenceSelectionOptions(sequenceNameNew);
    }

    async function onClickDeleteSequence() {
      const confirmed = await confirmDialog({
        title: 'Delete number sequence?',
        text: 'The entire sequence including all of its digit and analog ROIs will be removed.',
        okLabel: 'Delete sequence',
        danger: true,
      });
      if (destroyed) return;
      if (confirmed) {
        const err = deleteNumberSequence(seqIdx());
        if (err) firework.launch(err, 'danger', 5000);
        fillSequenceSelectionOptions();
      }
      onTypeChanged();
    }

    function onROIChanged() {
      roiSelected = toInt(R.roiSelect.value);
      refreshROI();
      parseROIArrangement();
    }

    function createROI(type, sequenceName, x, y, dx, dy) {
      const sequence = delta[type].sequence.find((s) => s.sequencename === sequenceName);
      if (!sequence) return 'Number sequence not existing. ROI cannot be created';
      const base = { x: toInt(x), y: toInt(y), dx: toInt(dx), dy: toInt(dy) };
      sequence.roi.push(type === 'analog' ? { ...base, ccw: false, ar: dx / dy } : { ...base, ar: dx / dy });
      return '';
    }

    function onClickNewROI() {
      const sequenceName = seqName();
      const rois = roisOf();
      const type = roiType;
      let err;
      if (rois.length > 0) {
        if (rois.length > 1) space = toInt(rois[1].x) - toInt(rois[0].x) - toInt(rois[0].dx);
        const last = rois[rois.length - 1];
        // digits get the spacing of the existing ones, analog ROIs are placed directly next to each other
        const roiX = toInt(last.x) + toInt(last.dx) + (type === 'digit' ? toInt(space) : 0);
        err = createROI(type, sequenceName, roiX, toInt(last.y), toInt(last.dx), toInt(last.dy));
      } else {
        err = type === 'digit' ? createROI('digit', sequenceName, 15, 30, 55, 75) : createROI('analog', sequenceName, 15, 140, 100, 100);
      }
      if (err) {
        firework.launch(err, 'danger', 30000);
      } else {
        refreshROI((type === 'digit' ? 'dig' : 'ana') + roisOf(type).length.toString());
        refreshDraw();
      }
    }

    async function onClickDeleteROI() {
      const confirmed = await confirmDialog({ title: 'Delete this ROI?', text: 'The selected region is removed from the sequence.', okLabel: 'Delete', danger: true });
      if (!confirmed || destroyed) return;
      const rois = roisOf();
      rois.splice(roiSelected, 1);
      if (roiSelected > rois.length - 1) roiSelected = rois.length - 1;
      refreshROI();
    }

    function swapROI(offset) {
      const rois = roisOf();
      const tmp = rois[roiSelected];
      rois[roiSelected] = rois[roiSelected + offset];
      rois[roiSelected + offset] = tmp;
      roiSelected += offset;
      refreshROI();
      onValueManualChanged();
    }

    function onClickLockAspectRatio() {
      if (roiType === 'digit') lockAspectRatio = R.lockAspectDigit.checked;
      else lockAspectRatioAnalog = R.lockAspectAnalog.checked;
    }

    function onClickLockSizes() {
      if (roiType === 'digit') {
        lockSizeDigit = R.lockSizesDigit.checked;
        onValueManualChangedSpace();
        refreshDraw();
      } else {
        lockSizeAnalog = R.lockSizesAnalog.checked;
        refreshROI();
      }
    }

    function onClickLockSpaceEquidistant() {
      lockSpaceEquidistant = R.lockSpace.checked;
      R.space.disabled = !lockSpaceEquidistant;
      refreshROI();
    }

    function onClickCCW() {
      roisOf('analog')[roiSelected].ccw = R.ccw.checked;
      refreshROI();
    }

    function makeXSpaceEquidistant() {
      const rois = roisOf('digit');
      if (rois.length <= 1) return; // only one or no number
      const sp = toInt(space);
      if (roiSelected === 0) {
        for (let i = 1; i < rois.length; i++) rois[i].x = toInt(rois[i - 1].x) + toInt(rois[i - 1].dx) + sp;
      } else {
        for (let i = roiSelected - 1; i >= 0; i--) rois[i].x = toInt(rois[i + 1].x) - toInt(rois[i].dx) - sp; // left side
        for (let i = roiSelected + 1; i < rois.length; i++) rois[i].x = toInt(rois[i - 1].x) + toInt(rois[i - 1].dx) + sp; // right side
      }
    }

    /** Manual edit of x / y / height (and width when the aspect ratio is not locked in the other direction). */
    function applyManualRoi(widthFollowsHeight) {
      if (roiCount() === 0) return;
      if (!drag) {
        rect.w = R.refdx.value;
        rect.h = R.refdy.value;
        const locked = roiType === 'digit' ? lockAspectRatio : lockAspectRatioAnalog;
        if (locked) {
          const ar = roisOf()[roiSelected].ar;
          if (widthFollowsHeight) {
            rect.w = Math.round(rect.h * ar);
            R.refdx.value = rect.w;
          } else {
            rect.h = Math.round(rect.w / ar);
            R.refdy.value = rect.h;
          }
        }
        rect.startX = R.refx.value;
        rect.startY = R.refy.value;
        if (roiType === 'digit' && lockSpaceEquidistant) makeXSpaceEquidistant();
        refreshDraw();
      }
      refreshROI();
    }

    const onValueManualChanged = () => applyManualRoi(true);
    const onValueManualChangedDx = () => applyManualRoi(false);

    function onValueManualChangedSpace() {
      if (!drag) {
        space = R.space.value;
        onValueManualChanged();
        refreshDraw();
      }
    }

    function refreshROI(roiName) {
      const type = roiType;
      const rois = roisOf();
      const dependent = [
        R.refx, R.refdx, R.refy, R.refdy, R.lockAspectDigit, R.lockAspectAnalog, R.lockSizesDigit, R.lockSizesAnalog,
        R.lockSpace, R.space, R.ccw, R.zoomRoi,
      ];
      const sel = R.roiSelect;
      while (sel.length) sel.remove(0);

      if (rois.length === 0) {
        R.roiSelect.disabled = true;
        show(R.multiplier, false);
        show(R.multiplierDecshift, false);
        R.newROI.disabled = false;
        R.deleteROI.disabled = true;
        dependent.forEach((el) => (el.disabled = true));
        R.moveLower.disabled = true;
        R.moveHigher.disabled = true;
        const option = document.createElement('option');
        option.text = 'None';
        option.value = -1;
        sel.add(option);
        roiSelected = sel.selectedIndex = 0;
        refreshDraw();
        return;
      }

      R.roiSelect.disabled = false;
      show(R.multiplier, true);
      show(R.multiplierDecshift, true);
      R.newROI.disabled = false;
      R.deleteROI.disabled = false;
      dependent.forEach((el) => (el.disabled = false));
      if (roiSelected > rois.length) roiSelected = rois.length - 1;
      for (let i = 0; i < rois.length; ++i) {
        const option = document.createElement('option');
        option.text = (type === 'digit' ? 'dig' : 'ana') + (i + 1).toString();
        option.value = i;
        sel.add(option);
        if (roiName !== undefined && option.text === roiName) roiSelected = i;
        rois[i].ar = rois[i].dx / rois[i].dy;
        roiPositionValidation(rois[i]);
      }
      sel.selectedIndex = roiSelected;

      R.moveHigher.disabled = roiSelected === 0;
      R.moveLower.disabled = roiSelected === rois.length - 1;
      showMultiplier();
      R.lockAspectDigit.checked = lockAspectRatio;
      R.lockAspectAnalog.checked = lockAspectRatioAnalog;
      R.lockSizesDigit.checked = lockSizeDigit;
      R.lockSizesAnalog.checked = lockSizeAnalog;
      R.lockSpace.checked = lockSpaceEquidistant;
      R.space.disabled = !lockSpaceEquidistant;
      R.space.value = space;
      const roi = rois[roiSelected];
      rect.startX = R.refx.value = roi.x;
      rect.startY = R.refy.value = roi.y;
      rect.w = R.refdx.value = roi.dx;
      rect.h = R.refdy.value = roi.dy;
      if (type === 'analog') R.ccw.checked = roi.ccw;
      refreshDraw();
    }

    function parseROIArrangement() {
      const rois = roisOf();
      if (rois.length <= 1) return; // only one ROI, no check needed
      if (roiType === 'digit') {
        // Check if the ROIs are equidistant. Only if not, untick the checkbox
        const gap = (i) => toInt(rois[i + 1].x) - (toInt(rois[i].x) + toInt(rois[i].dx));
        const firstGap = gap(0);
        for (let i = 1; i < rois.length - 1; ++i) {
          if (firstGap !== gap(i)) {
            lockSpaceEquidistant = false;
            R.lockSpace.checked = lockSpaceEquidistant;
            R.space.disabled = !lockSpaceEquidistant;
            break;
          }
        }
        // Check if the ROIs have same y, dy and dx. If so, tick the sync checkbox
        const identical = rois.every(
          (roi) => toInt(roi.y) === toInt(rois[0].y) && toInt(roi.dx) === toInt(rois[0].dx) && toInt(roi.dy) === toInt(rois[0].dy),
        );
        if (identical) {
          lockSizeDigit = true;
          R.lockSizesDigit.checked = lockSizeDigit;
        }
        // Preset space value
        space = toInt(rois[1].x) - toInt(rois[0].x) - toInt(rois[0].dx);
        R.space.value = space;
      } else {
        // Check if the ROIs have same dy and dx. If so, tick the sync checkbox
        const identical = rois.every((roi) => toInt(roi.dx) === toInt(rois[0].dx) && toInt(roi.dy) === toInt(rois[0].dy));
        if (identical) {
          lockSizeAnalog = true;
          R.lockSizesAnalog.checked = lockSizeAnalog;
        }
      }
    }

    function roiPositionValidation(roi) {
      const warn = (axis) =>
        firework.launch(`ROI partially or completely out of image area (${axis}) -> Position automatically adapted. Please verify position`, 'warning', 5000);
      if (toInt(roi.x) + toInt(roi.dx) >= REF_IMAGE_WIDTH) {
        roi.x = REF_IMAGE_WIDTH - toInt(roi.dx) - 1;
        warn('x');
      } else if (toInt(roi.x) < 1) {
        roi.x = 1;
        warn('x');
      }
      if (toInt(roi.y) + toInt(roi.dy) >= REF_IMAGE_HEIGHT) {
        roi.y = REF_IMAGE_HEIGHT - toInt(roi.dy) - 1;
        warn('y');
      } else if (toInt(roi.y) < 1) {
        roi.y = 1;
        warn('y');
      }
    }

    function showMultiplier() {
      let multiplier;
      let multiplierDecshift;
      let fixedDecimals;
      let fixedDecimalsDecshift;
      let decimalShift = (R.decimalShift.value = 0);
      const sequenceName = seqName();
      // Compare with the unmodified config (a new sequence initially uses decimalShift = 0)
      for (let i = 0; i < cfg.numbersequences.sequence.length; i++) {
        if (cfg.numbersequences.sequence[i].sequencename === sequenceName) {
          decimalShift = R.decimalShift.value = cfg.postprocessing.sequence[i].decimalshift ?? 0;
        }
      }
      const orderMultiplier = () => {
        multiplier = roiCount() - 1 - roiSelected;
        multiplierDecshift = fixedDecimalsDecshift = multiplier + Number(decimalShift);
        if (multiplierDecshift > 0) fixedDecimalsDecshift = 0;
        if (fixedDecimalsDecshift < 0) fixedDecimalsDecshift = -1 * fixedDecimalsDecshift;
        R.multiplier.value = 'x' + Number(10 ** multiplier).toFixed(0);
        R.multiplierDecshift.value = 'x' + Number(10 ** multiplierDecshift).toFixed(fixedDecimalsDecshift);
      };
      if (roiType === 'digit') {
        orderMultiplier();
      } else if (delta.digit.enabled && delta.analog.enabled) {
        // Digit + Analog
        multiplier = fixedDecimals = roiSelected + 1;
        multiplierDecshift = fixedDecimalsDecshift = multiplier - Number(decimalShift);
        if (multiplier < 0) fixedDecimals = 0;
        if (multiplierDecshift < 0) fixedDecimalsDecshift = 0;
        R.multiplier.value = 'x' + Number(10 ** (-1 * multiplier)).toFixed(fixedDecimals);
        R.multiplierDecshift.value = 'x' + Number(10 ** (-1 * multiplierDecshift)).toFixed(fixedDecimalsDecshift);
      } else if (!delta.digit.enabled && delta.analog.enabled) {
        // Only Analog
        orderMultiplier();
      }
    }

    /* ================================================================== */
    /* Canvas: image loading + ROI overlay                                */
    /* ================================================================== */
    /** Loads `url` into the shared image object, falls back to the placeholder on error / timeout. */
    function loadImageSource(url, onLoaded) {
      const token = ++loadToken;
      let fellBack = false;
      let timer = null;
      R.canvas.style.display = 'none';
      R.loading.style.display = 'block';
      imageOk = false;

      const fallback = () => {
        clearTimeout(timer);
        if (token !== loadToken || destroyed || fellBack) return;
        fellBack = true;
        imageObj.onerror = null;
        imageObj.src = noImageAvailable;
      };
      imageObj.onload = () => {
        clearTimeout(timer);
        if (token !== loadToken || destroyed) return;
        imageOk = !fellBack;
        R.canvas.width = imageObj.width;
        R.canvas.height = imageObj.height;
        onLoaded();
        R.loading.style.display = 'none';
        R.canvas.style.display = 'block';
      };
      imageObj.onerror = fallback;
      imageObj.src = url;
      timer = setTimeout(fallback, 15000);
    }

    function loadReferenceCanvas(url) {
      loadImageSource(url, () => refreshDraw());
    }

    function drawCrosshair(pos) {
      g.lineWidth = 1;
      g.strokeStyle = 'rgb(160, 160, 160)';
      g.beginPath();
      g.moveTo(0, pos.y);
      g.lineTo(R.canvas.width, pos.y);
      g.moveTo(pos.x, 0);
      g.lineTo(pos.x, R.canvas.height);
      g.stroke();
    }

    let canvasZoom = 1; // scale of the zoomed canvas (1 = whole image)

    /** One region in the look of the dashboard: soft fill, clean frame, rounded name badge above it (lines and text keep their size while zoomed). */
    function drawRoiMark(kind, x0, y0, w0, h0, label, selected, accent) {
      const z = canvasZoom;
      const x = w0 < 0 ? x0 + w0 : x0; // a region that is dragged leftwards or upwards has a negative size for a moment
      const y = h0 < 0 ? y0 + h0 : y0;
      const w = Math.abs(w0);
      const h = Math.abs(h0);
      const col = selected ? accent : '#f8fafc';
      const analog = kind === 'analog';
      const path = () => {
        g.beginPath();
        if (analog) g.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 0.01), Math.max(h / 2, 0.01), 0, 0, 2 * Math.PI);
        else g.rect(x, y, w, h);
      };
      // focus: the selected region is solid with a light halo, the others step back through transparency
      g.save();
      g.globalAlpha = selected ? 0.24 : 0.06;
      g.fillStyle = col;
      path();
      g.fill();
      g.restore();
      if (selected) {
        g.lineWidth = 5.5 / z;
        g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        path();
        g.stroke();
      }
      g.save();
      g.globalAlpha = selected ? 1 : 0.55;
      g.lineWidth = (selected ? 2.5 : 1.5) / z;
      g.strokeStyle = col;
      path();
      g.stroke();
      g.restore();
      // guide lines as before: digits get the middle line and the inner frame, analog regions the dashed crosshair
      g.save();
      g.globalAlpha = selected ? 1 : 0.4;
      g.lineWidth = 1 / z;
      g.setLineDash([2 / z, 2 / z]);
      g.beginPath();
      g.moveTo(x, y + h / 2);
      g.lineTo(x + w, y + h / 2);
      if (analog) {
        g.moveTo(x + w / 2, y);
        g.lineTo(x + w / 2, y + h);
      }
      g.stroke();
      if (!analog) g.strokeRect(x + w * 0.2, y + h * 0.2, w * 0.6, h * 0.6);
      g.restore();
      drawBadge(label, x, y, w, h, selected ? accent : 'rgba(15, 23, 42, 0.5)');
    }

    /** Rounded name badge above a frame (below it when there is no room), as on the dashboard. */
    function drawBadge(label, x, y, w, h, color) {
      const z = canvasZoom;
      g.font = `700 ${12 / z}px system-ui, sans-serif`;
      const tw = g.measureText(label).width + 10 / z;
      const bh = 17 / z;
      let by = y - 5 / z - bh;
      if (by < 0) by = y + h + 5 / z;
      g.fillStyle = color;
      g.beginPath();
      if (g.roundRect) g.roundRect(x + w / 2 - tw / 2, by, tw, bh, 5 / z);
      else g.rect(x + w / 2 - tw / 2, by, tw, bh);
      g.fill();
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, x + w / 2, by + bh / 2 + 0.5 / z);
      g.textBaseline = 'alphabetic';
    }

    /** Draws the reference image and the digit / analog ROI overlay (also writes the dragged rectangle back into the data). */
    function seqRefreshDraw() {
      g.clearRect(0, 0, R.canvas.width, R.canvas.height);
      g.drawImage(imageObj, 0, 0);
      const idx = seqIdx();
      const showBoth = R.showDigitAnalog.checked;
      const primary = getComputedStyle(root).getPropertyValue('--primary').trim() || '#2563eb';
      const colors = { digit: primary, analog: '#f59e0b' };

      const drawKind = (kind, rois, tagOf) => {
        const active = roiType === kind;
        // the others first, the selected one on top
        for (let i = 0; i < rois.length; i++) {
          if (active && i === roiSelected) continue;
          drawRoiMark(kind, toInt(rois[i].x), toInt(rois[i].y), toInt(rois[i].dx), toInt(rois[i].dy), tagOf(i), false, colors[kind]);
        }
        if (active && rois[roiSelected]) {
          drawRoiMark(kind, toInt(rect.startX), toInt(rect.startY), toInt(rect.w), toInt(rect.h), tagOf(roiSelected), true, colors[kind]);
          rois[roiSelected].x = toInt(rect.startX);
          rois[roiSelected].y = toInt(rect.startY);
          rois[roiSelected].dx = toInt(rect.w);
          rois[roiSelected].dy = toInt(rect.h);
        }
      };

      // digit ROI overlay
      if (R.digitProcessing.checked && (roiType === 'digit' || showBoth)) {
        const rois = delta.digit.sequence[idx].roi;
        if (roiType === 'digit' && lockSizeDigit) {
          // Synchronize y, dx and dy
          for (let i = 0; i < rois.length; i++) {
            if (i !== roiSelected) {
              rois[i].y = toInt(rect.startY);
              rois[i].dy = toInt(rect.h);
              rois[i].dx = toInt(rect.w);
            }
          }
        }
        drawKind('digit', rois, (i) => `dig${i + 1}`);
      }

      // analog ROI overlay
      if (R.analogProcessing.checked && (roiType === 'analog' || showBoth)) {
        const rois = delta.analog.sequence[idx].roi;
        if (roiType === 'analog' && lockSizeAnalog) {
          // Synchronize dx and dy
          for (let i = 0; i < rois.length; i++) {
            if (i !== roiSelected) {
              rois[i].dy = toInt(rect.h);
              rois[i].dx = toInt(rect.w);
            }
          }
        }
        drawKind('analog', rois, (i) => `ana${i + 1}${rois[i].ccw === false ? '' : ' (CCW)'}`);
      }
    }

    /* ---- pointer handling (mouse, pen and touch; positions are scaled to canvas pixels) ---- */
    function seqPointerDown(e) {
      rect.startX = pointerPos(e, R.canvas).x;
      rect.startY = pointerPos(e, R.canvas).y;
      rect.centerX = rect.startX;
      rect.centerY = rect.startY;
      R.refx.value = rect.startX;
      R.refy.value = rect.startY;
      drag = true;
    }

    function seqPointerUp() {
      drag = false;
      if (rect.w < 0) {
        rect.w = -rect.w;
        rect.startX -= rect.w;
      }
      if (rect.h < 0) {
        rect.h = -rect.h;
        rect.startY -= rect.h;
      }
      R.refdx.value = rect.w;
      R.refdy.value = rect.h;
      R.refx.value = rect.startX;
      R.refy.value = rect.startY;
      refreshROI();
    }

    function seqPointerMove(e) {
      const pos = pointerPos(e, R.canvas);
      if (drag) {
        if (roiCount() === 0) return;
        if (roiType === 'digit') {
          if (lockAspectRatio) {
            rect.h = pos.y - rect.startY;
            rect.w = Math.round(rect.h * roisOf('digit')[roiSelected].ar);
          } else {
            rect.w = pos.x - rect.startX;
            rect.h = pos.y - rect.startY;
          }
          R.refdx.value = rect.w;
          R.refdy.value = rect.h;
          refreshDraw();
        } else {
          // analog ROIs grow from their center
          if (lockAspectRatioAnalog) {
            rect.h = Math.abs(pos.y - rect.centerY) * 2;
            rect.w = Math.round(rect.h * roisOf('analog')[roiSelected].ar);
          } else {
            rect.w = Math.abs(pos.x - rect.centerX) * 2;
            rect.h = Math.abs(pos.y - rect.centerY) * 2;
          }
          rect.startX = rect.centerX - rect.w / 2;
          rect.startY = rect.centerY - rect.h / 2;
          R.refx.value = Math.round(rect.startX);
          R.refy.value = Math.round(rect.startY);
          refreshDraw();
        }
      } else {
        redraw();
        drawCrosshair(pos);
      }
    }

    function seqInit() {
      delta.numbersequences = structuredClone(cfg.numbersequences);
      delta.digit = structuredClone(cfg.digit);
      delta.analog = structuredClone(cfg.analog);
      fillSequenceSelectionOptions();
      analogProcessingChanged(true);
      digitProcessingChanged(true);
      onTypeChanged();
    }

    /* ================================================================== */
    /* Alignment markers                                                  */
    /* ================================================================== */
    function markerInit() {
      const storedMarker = cfg.imagealignment.marker;
      delta.imagealignment = { marker: structuredClone(Array.isArray(storedMarker) ? storedMarker : Object.values(storedMarker || {})) };
      markerRoi = delta.imagealignment.marker; // shorter name; an array, saved as a whole
      markerRoi.forEach((m, i) => {
        m.placed = Number(m.x) > 1 || Number(m.y) > 1; // 1/1 is the factory value: never placed
        if (o.centerMarkers && !m.placed) {
          const w = imageObj.naturalWidth || 640;
          const h = imageObj.naturalHeight || 480;
          const dx = toInt(m.dx) || 40;
          const dy = toInt(m.dy) || 40;
          m.x = Math.round(w * (i === 0 ? 0.35 : 0.65) - dx / 2);
          m.y = Math.round(h / 2 - dy / 2);
          cutCentered(i, m);
        }
      });      if (markerSelected >= markerRoi.length) markerSelected = 0;
      // the size of a marker is the size of its image: read it for both markers (the preview and the steppers need it)
      markerRoi.forEach((m, i) => {
        const im = new Image();
        im.onload = () => {
          if (destroyed || markerRoi[i] !== m || m.dx0 !== undefined) return;
          m.dx = m.dx0 = im.naturalWidth;
          m.dy = m.dy0 = im.naturalHeight;
          mSync(true);
        };
        im.src = Api.setup.markerImageUrl(i + 1, false);
      });
      R.markerSelect.options.length = 0;
      for (let i = 0; i < Math.max(markerRoi.length, 1); i++) R.markerSelect.add(new Option(`Marker ${i + 1}`, i));
      R.markerSelect.selectedIndex = markerSelected;
      if (mode === 'markers') refreshMarker();
    }

    const markerReady = () => Array.isArray(markerRoi) && !!markerRoi[markerSelected];

    function markerSelectionChanged() {
      markerSelected = toInt(R.markerSelect.value);
      if (!markerReady()) return;
      refreshMarker();
    }

    function markerValueChanged() {
      if (!markerReady()) return;
      const roi = markerRoi[markerSelected];
      if (!drag) {
        rect.startX = roi.x = toInt(R.mx.value);
        rect.startY = roi.y = toInt(R.my.value);
        rect.w = roi.dx = toInt(R.mdx.value);
        rect.h = roi.dy = toInt(R.mdy.value);
      }
      roiPositionValidation(roi);
      rect.startX = R.mx.value = roi.x;
      rect.startY = R.my.value = roi.y;
      refreshDraw();
    }

    async function requestMarkerCut() {
      if (!markerReady()) {
        firework.launch('Marker data not initialized yet. Please wait a moment and retry.', 'warning', 4000);
        return;
      }
      const roi = markerRoi[markerSelected];
      roi.x = toInt(R.mx.value);
      roi.y = toInt(R.my.value);
      roi.dx = toInt(R.mdx.value);
      roi.dy = toInt(R.mdy.value);

      const ok = await Api.setup.cutMarker(markerSelected + 1, roi);
      if (!ok || destroyed) return;
      roi.modified = true;
      refreshMarker();
      reportAlign();
    }

    // a centered start marker gets its picture right away, so Next only waits for the processing choice
    async function cutCentered(i, m) {
      const ok = await Api.setup.cutMarker(i + 1, m);
      if (!ok || destroyed || markerRoi[i] !== m) return;
      m.modified = true;
      if (mode === 'markers' && markerSelected === i) refreshMarker();
      reportAlign();
    }

    function reportAlign() {
      if (destroyed || !o.onAlignState || !Array.isArray(markerRoi) || !delta.digit) return;
      o.onAlignState({
        ready: markerRoi.length >= 2 && markerRoi.every((m) => m.modified || m.placed),
        procs: !!(delta.digit.enabled || delta.analog.enabled),
      });
    }

    function refreshMarker() {
      const roi = markerRoi[markerSelected];
      const img = R.markerImage;
      // a freshly cut marker lives in /img_tmp until it is saved
      if (getTestEnvironmentActive()) img.crossOrigin = 'use-credentials'; // otherwise the histogram canvas gets tainted
      img.onload = function () {
        if (mode !== 'markers' || destroyed) return;
        // dx, dy derive from the marker image size
        // (a size that was set with the steppers stays: only the first load of the saved image defines it)
        if (roi.dx0 === undefined) {
          roi.dx = roi.dx0 = this.naturalWidth;
          roi.dy = roi.dy0 = this.naturalHeight;
        }
        rect.w = R.mdx.value = roi.dx;
        rect.h = R.mdy.value = roi.dy;
        roiPositionValidation(roi);
        rect.startX = R.mx.value = roi.x;
        rect.startY = R.my.value = roi.y;
        refreshDraw();
        histogramUpdate();
      };
      img.onerror = function () {
        this.onerror = null;
        this.src = IMG_1PX; // 1px image if loading failed
        refreshDraw();
      };
      img.src = Api.setup.markerImageUrl(markerSelected + 1, !!roi.modified);
      // x, y from the config
      rect.startX = R.mx.value = roi.x;
      rect.startY = R.my.value = roi.y;
    }

    function markerRefreshDraw() {
      g.clearRect(0, 0, R.canvas.width, R.canvas.height);
      g.drawImage(imageObj, 0, 0);
      // during init markerRoi is not defined yet, or no marker is defined
      if (!Array.isArray(markerRoi) || markerRoi.length === 0) return;
      // same colors and focus as the digit regions: the selected marker in the accent color with a halo, the other one white and transparent
      const accent = getComputedStyle(root).getPropertyValue('--primary').trim() || '#2563eb';
      const frame = (x0, y0, w0, h0, selected) => {
        const x = w0 < 0 ? x0 + w0 : x0;
        const y = h0 < 0 ? y0 + h0 : y0;
        const w = Math.abs(w0);
        const h = Math.abs(h0);
        g.save();
        g.globalAlpha = selected ? 0.24 : 0.06;
        g.fillStyle = selected ? accent : '#f8fafc';
        g.fillRect(x, y, w, h);
        g.restore();
        if (selected) {
          g.lineWidth = 5.5;
          g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          g.strokeRect(x, y, w, h);
        }
        g.lineWidth = selected ? 2.5 : 1.5;
        g.globalAlpha = selected ? 1 : 0.55;
        g.strokeStyle = selected ? accent : '#f8fafc';
        g.strokeRect(x, y, w, h);
        g.globalAlpha = 1;
        return [x, y, w, h];
      };
      markerRoi.forEach((m, i) => {
        if (i === markerSelected) return;
        const [x, y, w, h] = frame(toInt(m.x), toInt(m.y), toInt(m.dx), toInt(m.dy), false);
        drawBadge(`Marker ${i + 1}`, x, y, w, h, 'rgba(15, 23, 42, 0.5)');
      });
      const [x, y, w, h] = frame(toInt(rect.startX), toInt(rect.startY), toInt(rect.w), toInt(rect.h), true);
      drawBadge(`Marker ${markerSelected + 1}`, x, y, w, h, accent);
    }

    function markerPointerDown(e) {
      rect.startX = pointerPos(e, R.canvas).x;
      rect.startY = pointerPos(e, R.canvas).y;
      R.mx.value = rect.startX;
      R.my.value = rect.startY;
      drag = true;
    }

    function markerPointerUp() {
      drag = false;
      if (rect.w < 0) {
        rect.w = -rect.w;
        rect.startX -= rect.w;
      }
      if (rect.h < 0) {
        rect.h = -rect.h;
        rect.startY -= rect.h;
      }
      R.mdx.value = rect.w;
      R.mdy.value = rect.h;
      R.mx.value = rect.startX;
      R.my.value = rect.startY;
      markerValueChanged();
    }

    function markerPointerMove(e) {
      const pos = pointerPos(e, R.canvas);
      if (drag) {
        rect.w = pos.x - rect.startX;
        rect.h = pos.y - rect.startY;
        R.mdx.value = rect.w;
        R.mdy.value = rect.h;
        refreshDraw();
      } else {
        redraw();
        drawCrosshair(pos);
      }
    }

    /* ---- histogram of the marker image ---- */
    function processImageHistogram(inImg) {
      const src = new Uint32Array(inImg.data.buffer);
      const isValueHistogram = R.histValue.checked;
      const isRedChannel = R.histRed.checked;

      const histBrightness = new Array(256).fill(0);
      const histR = new Array(256).fill(0);
      const histG = new Array(256).fill(0);
      const histB = new Array(256).fill(0);
      for (let i = 0; i < src.length; i++) {
        const r = src[i] & 0xff;
        const gr = (src[i] >> 8) & 0xff;
        const b = (src[i] >> 16) & 0xff;
        histBrightness[r]++;
        histBrightness[gr]++;
        histBrightness[b]++;
        histR[r]++;
        histG[gr]++;
        histB[b]++;
      }

      let maxBrightness = 0;
      if (isValueHistogram) {
        for (let i = 1; i < 256; i++) if (maxBrightness < histBrightness[i]) maxBrightness = histBrightness[i];
      } else {
        for (let i = 0; i < 256; i++) {
          if (maxBrightness < histR[i]) maxBrightness = histR[i];
          else if (maxBrightness < histG[i]) maxBrightness = histG[i];
          else if (maxBrightness < histB[i]) maxBrightness = histB[i];
        }
      }

      const hc = R.hist;
      const h = hc.getContext('2d');
      const style = getComputedStyle(document.documentElement);
      const bgColor = style.getPropertyValue('--bg').trim();
      const valueColor = style.getPropertyValue('--text-main').trim();

      const guideHeight = 4;
      const startY = hc.height - guideHeight;
      const dx = hc.width / 256;
      const dy = startY / maxBrightness;
      h.lineWidth = dx;
      h.fillStyle = bgColor;
      h.fillRect(0, 0, hc.width, hc.height);

      const bar = (x, count, color) => {
        h.strokeStyle = color;
        h.beginPath();
        h.moveTo(x, startY);
        h.lineTo(x, startY - count * dy);
        h.closePath();
        h.stroke();
      };
      for (let i = 0; i < 256; i++) {
        const x = i * dx;
        if (isValueHistogram) {
          bar(x, histBrightness[i], valueColor);
        } else {
          bar(x, histR[i], 'rgba(220,0,0,0.5)');
          if (!isRedChannel) {
            bar(x, histG[i], 'rgba(0,210,0,0.5)');
            bar(x, histB[i], 'rgba(0,0,255,0.5)');
          }
        }
        // guide
        h.strokeStyle = 'rgb(' + i + ', ' + i + ', ' + i + ')';
        h.beginPath();
        h.moveTo(x, startY);
        h.lineTo(x, hc.height);
        h.closePath();
        h.stroke();
      }
    }

    function histogramUpdate() {
      const img = R.markerImage;
      if (!img || !img.naturalWidth || !img.naturalHeight) return;
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const cx = c.getContext('2d');
        cx.drawImage(img, 0, 0);
        processImageHistogram(cx.getImageData(0, 0, c.width, c.height));
      } catch (e) {
        console.warn('Histogram not available:', e);
      }
    }

    /* ================================================================== */
    /* Reference image (camera capture)                                   */
    /* ================================================================== */
    const camValue = (name) => parseFloat(camInput[name].value);

    function updateParamOutput(el) {
      const out = root.querySelector(`[data-out="${el.dataset.param}"]`);
      if (!out) return;
      out.value = camFormat(camSpec[el.dataset.param], el.value);
      camUI[el.dataset.param]?.();
    }

    /** Enables / disables the dependent parameters (zoom offsets, manual gain, auto / manual exposure). */
    function applyCamGates() {
      const gates = {
        zoom: camValue(KEY_CAM + 'zoomfactor') > 1000,
        gainManual: camValue(KEY_CAM + 'gaincontrolmode') === 0,
        expAuto: camValue(KEY_CAM + 'exposurecontrolmode') > 0,
        expManual: camValue(KEY_CAM + 'exposurecontrolmode') === 0,
      };
      CAM_FIELDS.forEach((f) => {
        if (f.gate) camInput[f.name].disabled = !(camUnlocked && gates[f.gate]);
      });
      all('.setup-cam-cell').forEach((cell) => {
        const input = cell.querySelector('[data-param]');
        cell.classList.toggle('is-off', !!input && input.disabled);
      });
      Object.values(camUI).forEach((sync) => sync());
    }

    /** Locks (saved reference shown) or releases (new image) all camera parameters. */
    function camEnable(flag) {
      camUnlocked = flag;
      if (R.camLock) R.camLock.hidden = flag; // blurred with a hint until a new picture exists
      CAM_FIELDS.forEach((f) => {
        camInput[f.name].disabled = !flag;
      });
      applyCamGates();
    }

    /** Parameter limits depend on the camera model (sensor size) and the zoom factor. */
    function setVariableInputLimits(gather) {
      let sensorFrameSizeWidth = 1600;
      let sensorFrameSizeHeight = 1200;
      let autoExposureLimit = 2;
      const cameraModel = cfg.takeimage?.camera?.cameramodel;
      if (cameraModel === 1) {
        // OV2640
        sensorFrameSizeWidth = 1600;
        sensorFrameSizeHeight = 1200;
        autoExposureLimit = 2;
      } else if (cameraModel === 2) {
        // OV3660
        sensorFrameSizeWidth = 2048;
        sensorFrameSizeHeight = 1536;
        autoExposureLimit = 5;
      } else if (cameraModel === 3) {
        // OV5640
        sensorFrameSizeWidth = 2560;
        sensorFrameSizeHeight = 1920;
        autoExposureLimit = 5;
      } else {
        firework.launch('Camera model unknown. Zoom factor range / limits may be wrong', 'warning', 5000);
      }

      const zoomEl = camInput[KEY_CAM + 'zoomfactor'];
      const offsetX = camInput[KEY_CAM + 'zoomoffsetx'];
      const offsetY = camInput[KEY_CAM + 'zoomoffsety'];
      const aeLevel = camInput[KEY_CAM + 'autoexposurelevel'];
      const manualEx = camInput[KEY_CAM + 'manualexposurevalue'];

      zoomEl.setAttribute('max', (sensorFrameSizeWidth * 1000) / 640);

      let imageWidthZoomed = Math.floor((sensorFrameSizeWidth * 1000) / parseFloat(zoomEl.value));
      imageWidthZoomed += imageWidthZoomed % 4;
      const maxX = (sensorFrameSizeWidth - imageWidthZoomed) / 2;
      offsetX.setAttribute('max', maxX);
      offsetX.setAttribute('min', -1 * maxX);

      let imageHeightZoomed = Math.floor((sensorFrameSizeHeight * 1000) / parseFloat(zoomEl.value));
      imageHeightZoomed += imageHeightZoomed % 4;
      const maxY = (sensorFrameSizeHeight - imageHeightZoomed) / 2;
      offsetY.setAttribute('max', maxY);
      offsetY.setAttribute('min', -1 * maxY);

      aeLevel.setAttribute('max', autoExposureLimit);
      aeLevel.setAttribute('min', -1 * autoExposureLimit);
      manualEx.setAttribute('max', sensorFrameSizeHeight);

      // the limits may have moved the values: refresh the outputs, record them as changes while the user edits
      [offsetX, offsetY, aeLevel, manualEx].forEach((el) => {
        updateParamOutput(el);
        if (gather) delta = mergeParam(delta, el.dataset.param, el.value, true);
      });
    }

    /** A camera / flashlight parameter was changed by the user. */
    function onParamChange(el) {
      const f = camSpec[el.dataset.param];
      switch (f.name) {
        case KEY_CAM + 'zoomfactor':
          setVariableInputLimits(true);
          break;
        case 'takeimage.flashlight.flashtime':
          if (el.validity.rangeUnderflow) el.value = 100;
          else if (el.validity.stepMismatch) el.value = parseInt(el.value, 10);
          break;
        case 'takeimage.flashlight.flashintensity':
          if (el.validity.rangeUnderflow) el.value = 0;
          else if (el.validity.rangeOverflow) el.value = 100;
          break;
        case 'imagealignment.imagerotation':
          if (el.validity.rangeUnderflow) el.value = -180.0;
          else if (el.validity.rangeOverflow) el.value = 180.0;
          drawRotated();
          break;
        default:
      }
      applyCamGates();
      updateParamOutput(el);
      delta = mergeParam(delta, f.name, el.value, !!f.int);
      if (!isActReference && imageOk && CAM_PREVIEW.has(f.name)) drawRotated();
      updateTakeState();
    }

    /** The picture is outdated as soon as a camera value differs from the one the picture was taken with. */
    function imageStale() {
      if (!capParams) return false;
      if (String(camInput['imagealignment.imagerotation'].value) !== String(capParams.rotation)) return true;
      return CAPTURE_PARAMS.some(([key, name, def]) => {
        const v = camInput[name].value;
        return String(v === '' ? def : v) !== String(capParams[key]);
      });
    }

    function updateTakeState() {
      if (destroyed) return;
      const stale = imageStale();
      R.bubble.hidden = !stale;
      // Update image is only needed while there is no current picture
      const needed = o.introHint ? refMissing || stale || !camUnlocked : !imagePending || stale;
      R.take.classList.toggle('btn-action', needed);
      R.take.classList.toggle('ghost', !needed);
      R.take.disabled = taking || !needed;
      o.onImageState?.({ exists: !refMissing, pending: imagePending, stale });
    }

    /** The Advanced rows are closed whenever the page is opened (not remembered). */
    function setCamAdvanced(on) {
      R.camAdv.checked = on;
      root.dataset.camAdv = on ? '1' : '0';
    }
    function parseCamParams() {
      CAM_FIELDS.forEach((f) => setControlValue(camInput[f.name], getPath(cfg, f.name)));
      CAM_FIELDS.filter((f) => f.type === 'range').forEach((f) => updateParamOutput(camInput[f.name]));
      setVariableInputLimits(false);
      applyCamGates();
    }

    let taking = false; // a picture is being taken
    async function doTake() {
      const params = {};
      CAPTURE_PARAMS.forEach(([key, name, def]) => {
        const v = camInput[name].value;
        params[key] = v === '' ? def : v;
      });
      specialeffect = params.specialeffect;

      if (taking) return;
      taking = true;
      R.take.disabled = true;
      const sentParams = { ...params, rotation: camInput['imagealignment.imagerotation'].value };
      let result;
      try {
        result = await Api.setup.capture(params);
      } finally {
        taking = false;
        if (!destroyed) updateTakeState();
      }
      const { ok, blob } = result;
      if (destroyed) return;
      if (!ok) {
        showReference();
        return;
      }
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = URL.createObjectURL(blob);
      refLoadCanvas(currentBlobUrl, true);
      isActReference = false;
      capParams = sentParams;
      if (o.introHint) wizardLastTake = { blob, params: sentParams };
      imagePending = true;
      refMissing = false;
      updateIntro();
      updateTakeState();
      R.canvas.style.display = 'block';
      camEnable(true); // now the settings can be changed; "Update image" again takes the next picture
      refreshSaveBar();
    }

    /** CSS filter for the calculated difference between the real picture and the current inputs (estimated strengths, the hint asks for a real picture). */
    function previewFilter() {
      const val = (name) => camInput[name].value;
      const cap = capParams || { specialeffect: specialeffect };
      const diff = (key, name) => (capParams ? Number(val(name)) - Number(cap[key] ?? 0) : 0);
      const hw = { '0': [0, 0], '1': [0, 1], '2': [1, 0], '7': [1, 0] }[String(cap.specialeffect ?? 0)] || [0, 0];
      const want = { '0': [0, 0], '1': [0, 1], '2': [1, 0], '7': [1, 1] }[String(capParams ? val(KEY_CAM + 'specialeffect') : specialeffect)] || [0, 0];
      const parts = [];
      const b = diff('brightness', KEY_CAM + 'brightness');
      const c = diff('contrast', KEY_CAM + 'contrast');
      const s = diff('saturation', KEY_CAM + 'saturation');
      const sh = diff('sharpness', KEY_CAM + 'sharpness');
      if (b) parts.push(`brightness(${Math.max(0.2, 1 + 0.25 * b)})`);
      if (c) parts.push(`contrast(${Math.max(0.2, 1 + 0.25 * c)})`);
      if (s) parts.push(`saturate(${Math.max(0, 1 + 0.5 * s)})`);
      if (sh < 0) parts.push(`blur(${(-sh * 0.5).toFixed(1)}px)`);
      if (want[0] && !hw[0]) parts.push('grayscale(1)');
      if (want[1] !== hw[1]) parts.push('invert(1)');
      return parts.join(' ') || 'none';
    }

    /** Sharpening that was added after the real picture was taken (3x3 kernel on the canvas). */
    function previewSharpen() {
      if (!capParams) return;
      const sh = Number(camInput[KEY_CAM + 'sharpness'].value) - Number(capParams.sharpness ?? 0);
      if (sh <= 0) return;
      const k = 0.4 * sh;
      const w = R.canvas.width;
      const h = R.canvas.height;
      const src = g.getImageData(0, 0, w, h);
      const out = g.createImageData(w, h);
      const a = src.data;
      const d = out.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          for (let ch = 0; ch < 3; ch++) {
            const c0 = a[i + ch];
            const n = a[(Math.max(0, y - 1) * w + x) * 4 + ch];
            const s2 = a[(Math.min(h - 1, y + 1) * w + x) * 4 + ch];
            const wv = a[(y * w + Math.max(0, x - 1)) * 4 + ch];
            const e = a[(y * w + Math.min(w - 1, x + 1)) * 4 + ch];
            d[i + ch] = Math.max(0, Math.min(255, c0 * (1 + 4 * k) - k * (n + s2 + wv + e)));
          }
          d[i + 3] = 255;
        }
      }
      g.putImageData(out, 0, 0);
    }

    function drawRotated(grid = true) {
      g.fillStyle = 'rgb(250, 250, 250)';
      g.fillRect(0, 0, R.canvas.width, R.canvas.height);
      g.save();
      const degrees = parseFloat(camInput['imagealignment.imagerotation'].value);
      if (isActReference) {
        g.drawImage(imageObj, 0, 0);
      } else {
        g.translate(R.canvas.width / 2, R.canvas.height / 2);
        g.rotate((degrees * Math.PI) / 180);
        // mirror / flip differing from the real picture are shown calculated; the hint asks for a new picture
        const cap = capParams || {};
        const flipped = (name, key) => (camInput[name].value === 'true') !== ((cap[key] ?? 'false') === 'true');
        g.scale(flipped(KEY_CAM + 'mirrorimage', 'mirror') ? -1 : 1, flipped(KEY_CAM + 'flipimage', 'flip') ? -1 : 1);
        // Special effect 7 (grayscale + negative): both together do not work on the camera.
        // Workaround: grayscale on the camera + negative on the MCU (processing) / in the browser (preview)
        g.filter = previewFilter();
        g.drawImage(imageObj, -imageObj.width / 2, -imageObj.height / 2);
      }
      g.restore();
      if (!isActReference) previewSharpen();
      if (grid) drawGrid();
    }

    function drawGrid() {
      const w = R.canvas.width;
      const h = R.canvas.height;
      g.save();
      g.lineWidth = 0.25;
      g.strokeStyle = 'rgb(160, 160, 160)';
      for (let i = h / 2; i < h; i += 100) {
        g.moveTo(0, i);
        g.lineTo(w, i);
        g.stroke();
        g.moveTo(0, h - i);
        g.lineTo(w, h - i);
        g.stroke();
      }
      for (let i = w / 2; i < w; i += 100) {
        g.moveTo(i, 0);
        g.lineTo(i, h);
        g.stroke();
        g.moveTo(w - i, 0);
        g.lineTo(w - i, h);
        g.stroke();
      }
      g.restore();
    }

    function refLoadCanvas(url, grid) {
      loadImageSource(url, () => {
        drawRotated(!!grid);
      });
    }

    async function saveReference() {
      if (saving) return;
      setBusy(true);
      try {
        drawRotated(false);
        const blob = await new Promise((resolve) => R.canvas.toBlob(resolve, 'image/jpeg', 0.95));
        if (!blob || !(await Api.setup.uploadReferenceImage(blob))) throw new Error('Reference image upload failed');
        await Api.setup.saveConfig(delta, true);
        if (destroyed) return;
        showReference(); // saved: show the stored reference again (nothing pending anymore)
      } catch (error) {
        console.error('Save reference failed:', error);
      } finally {
        if (!destroyed) {
          setBusy(false);
          refreshSaveBar();
        }
      }
    }

    function updateIntro() {
      if (!o.introHint) return;
      const first = refMissing && !imagePending;
      R.intro.hidden = !first;
      R.canvas.style.visibility = first ? 'hidden' : '';
      R.take.textContent = first ? 'Take camera image' : 'Update image';
      if (R.camLock) R.camLock.firstChild.textContent = first ? 'Take the camera image first, then you can change the settings.' : 'Update the image first, then you can change the settings.';
    }

    function showReference() {
      capParams = null;
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
      }
      isActReference = true;
      loadImageSource(Api.setup.referenceImageUrl(), () => {
        refMissing = !imageOk;
        if (o.introHint && refMissing) {
          // the empty frame already has the size of a camera picture, so the card does not jump when the first one arrives
          R.canvas.width = 640;
          R.canvas.height = 480;
        } else {
          drawRotated(false);
          if (o.introHint) {
            // wizard: the stored picture is the current one, its settings are the reference for the hint
            capParams = { rotation: camInput['imagealignment.imagerotation'].value };
            CAPTURE_PARAMS.forEach(([key, name, def]) => {
              const v = camInput[name].value;
              capParams[key] = v === '' ? def : v;
            });
            const last = wizardLastTake;
            const same = last && Object.keys(last.params).every((k) => String(last.params[k]) === String(capParams[k]));
            if (same) {
              // the raw picture of the last real shot is still here: the calculated preview works on it again
              currentBlobUrl = URL.createObjectURL(last.blob);
              isActReference = false;
              capParams = { ...last.params };
              refLoadCanvas(currentBlobUrl, true);
              camEnable(true);
            }
            // otherwise only the stored picture exists: the controls stay locked until a new picture is taken
          }
        }
        updateIntro();
        updateTakeState();
      });
      imagePending = false;
      // a discarded picture takes its camera settings with it: the inputs show the stored values again
      delete delta.takeimage;
      if (delta.imagealignment) delete delta.imagealignment.imagerotation;

      cfg = Api.setup.getConfig() || cfg; // stored values back into the parameter inputs
      parseCamParams();
      camEnable(false); // locked (and blurred) until "Update image" has taken a new picture
      refreshSaveBar();
    }

    /* ================================================================== */
    /* Dispatch by tab, tabs, dirty detection, save bar                   */
    /* ================================================================== */
    function redraw() {
      if (mode === 'markers') markerRefreshDraw();
      else if (isRoiMode()) seqRefreshDraw();
      else drawRotated(!isActReference);
    }

    function refreshDraw() {
      applyZoom();
      redraw();
      updateCounts();
      mSync();
      if (!drag) refreshSaveBar();
    }

    /** "Zoom in": the view follows the selected region (not while it is dragged, so the picture does not run away). */
    function applyZoom() {
      const cv = R.canvas;
      const wrap = cv.parentElement;
      const sel = isRoiMode() && R.zoomRoi.checked && roiCount() > 0 ? roisOf()[roiSelected] : null;
      if (!sel || !cv.offsetWidth || !cv.width) {
        canvasZoom = 1;
        wrap.classList.remove('zoomed');
        cv.style.transform = '';
        wrap.style.clipPath = '';
        return;
      }
      if (drag || mDragState) return;
      const W = cv.width;
      const H = cv.height;
      const k = cv.offsetWidth / W; // canvas pixel -> screen pixel
      const vw = clampN(Math.max(toInt(sel.dx) * 9, 260), 260, W); // about 2.5x for a digit
      const vh = (vw * H) / W;
      const vx = clampN(toInt(sel.x) + toInt(sel.dx) / 2 - vw / 2, 0, W - vw);
      const vy = clampN(toInt(sel.y) + toInt(sel.dy) / 2 - vh / 2, 0, H - vh);
      canvasZoom = W / vw;
      wrap.classList.add('zoomed');
      // the zoomed picture is clipped to the place of the canvas (not to the padding of the frame)
      const l = cv.offsetLeft;
      const t = cv.offsetTop;
      wrap.style.clipPath = `inset(${t}px ${wrap.clientWidth - l - cv.offsetWidth}px ${wrap.clientHeight - t - cv.offsetHeight}px ${l}px round 0.6rem)`;
      cv.style.transform = `translate(${-vx * k * canvasZoom}px, ${-vy * k * canvasZoom}px) scale(${canvasZoom})`;
    }

    function updateCounts() {
      try {
        const markerCount = root.querySelector('[data-count="markers"]');
        if (markerCount && delta.imagealignment?.marker) markerCount.textContent = delta.imagealignment.marker.length;
        if (!delta.digit || seqIdx() < 0) return;
        const idx = seqIdx();
        [['digit', delta.digit], ['analog', delta.analog]].forEach(([type, set]) => {
          const el = root.querySelector(`[data-count="${type}"]`);
          if (!el) return;
          const n = set.sequence[idx]?.roi.length ?? 0;
          el.textContent = set.enabled ? n : 'off';
          el.classList.toggle('off', !set.enabled);
        });
      } catch (e) {
        /* data not ready yet */
      }
    }

    let lastRecTab = '';
    // Markers tab: recognition of the last cycle next to the marker, to judge the alignment by its result
    const recTileValue = (kind, r) => {
      if (r.na) return ['N', 'err'];
      const n = parseFloat(r.value);
      const label = Number.isNaN(n) ? String(r.value) : kind === 'digit' ? String(Math.round(n) % 10) : n.toFixed(1);
      const c = r.confidence;
      return [label, c === null || c === undefined ? 'ok' : c >= 90 ? 'ok' : c >= 60 ? 'warn' : 'err'];
    };
    // the recognition card shows only the regions of the open tab: digits or analog
    let recData; // last answer of the device (undefined: not loaded, null: not available)
    function renderMarkerRecognition() {
      if (destroyed || !R.recBody) return;
      const kind = mode === 'analog' ? 'analog' : 'digit';
      R.recTitle.textContent = `Last cycle ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${kind === 'analog' ? 'analog' : 'digits'}`;
      const body = R.recBody;
      body.textContent = '';
      const note = (text) => {
        const msg = document.createElement('span');
        msg.className = 'dash-log-empty';
        msg.textContent = text;
        body.append(msg);
      };
      if (!recData || !recData.ready) {
        note(recData === undefined ? 'Loading ...' : recData ? 'No result yet' : 'Not available');
        return;
      }
      const block = recData.sequences[0]?.[kind];
      if (!block || !block.enabled || !block.rois.length) {
        note('Switched off');
        return;
      }
      const grid = document.createElement('div');
      grid.className = `rec-roi-grid is-${kind}`;
      for (const r of block.rois) {
        const [label, status] = recTileValue(kind, r);
        const tile = document.createElement('div');
        tile.className = 'rec-roi-tile';
        tile.dataset.status = status;
        const v = document.createElement('div');
        v.className = 'rec-roi-value';
        v.textContent = label;
        tile.append(v);
        if (!r.na && r.image) {
          const img = document.createElement('img');
          img.className = 'rec-roi-img';
          img.src = Api.process.imageUrl(r.image);
          img.alt = `ROI ${label}`;
          tile.append(img);
        }
        grid.append(tile);
      }
      body.append(grid);
    }
    async function loadMarkerRecognition() {
      if (destroyed || !R.recBody) return;
      const data = await Api.process.recognition();
      if (destroyed) return;
      recData = data;
      renderMarkerRecognition();
    }
    // a finished cycle has new results
    let recWasRunning = false;
    const onCycleForRec = (e) => {
      const running = !!e.detail?.running;
      if (recWasRunning && !running && isRoiMode()) loadMarkerRecognition();
      recWasRunning = running;
    };
    window.addEventListener('cycle-status', onCycleForRec);

    function updateTabsUI() {
      all('.setup-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === mode));
      const isRoi = isRoiMode();
      R.panelImage.hidden = mode !== 'image';
      R.panelMarkers.hidden = mode !== 'markers';
      R.panelRec.hidden = !isRoi; // recognition of the last cycle: only with the digit and analog regions
      if (isRoi && !['digit', 'analog'].includes(lastRecTab)) loadMarkerRecognition();
      else if (isRoi && lastRecTab !== mode) renderMarkerRecognition(); // digits <-> analog: same data, other regions
      lastRecTab = mode;
      R.panelRoi.hidden = !isRoi;
      R.optsImage.hidden = mode !== 'image';
      R.optsRoi.hidden = !isRoi;
      R.zoomBox.hidden = !isRoi;
      R.canvasTitle.textContent = TAB_TITLE[mode];
      R.canvas.classList.toggle('setup-canvas-draw', mode !== 'image'); // touch drawing must not scroll the page
      R.mMarkerBar.hidden = mode !== 'markers';
      R.mRoiBar.hidden = !isRoi;
      root.dataset.mode = mode;
      mSync(true);
      updateCounts();
    }

    /**
     * Real change detection: compare the editable data with the state right after loading.
     * Derived values (aspect ratio `ar`, marker size dx/dy) are left out so that just looking at a tab never counts as a change.
     */
    function editorState() {
      const markers = (delta.imagealignment?.marker || []).map((m) => ({
        x: m.x,
        y: m.y,
        updated: !!m.modified,
        size: m.dx0 !== undefined && (m.dx !== m.dx0 || m.dy !== m.dy0), // a changed size needs a new marker image as well
      }));
      return JSON.stringify(
        { markers, sequences: delta.numbersequences, digit: delta.digit, analog: delta.analog },
        (k, v) => (k === 'ar' ? undefined : v),
      );
    }

    function isDirty() {
      if (destroyed || !currentTab) return false;
      if (mode === 'image') return imagePending;
      return editorState() !== editorSnapshot;
    }

    function discardEditorChanges() {
      loadEditorData();
      if (mode === 'markers') {
        if (markerReady()) refreshMarker();
        refreshDraw();
      } else {
        roiType = mode;
        onTypeChanged();
      }
      refreshSaveBar();
    }

    function discardCurrent() {
      if (mode === 'image') showReference();
      else discardEditorChanges();
    }

    function setBusy(flag) {
      saving = flag;
      if (o.saveBar === 'global') SaveBar.busy(flag);
      R.inlineSave.disabled = flag;
      R.inlineDiscard.disabled = flag;
    }

    function refreshSaveBar() {
      if (destroyed || !currentTab || initializing) return;
      reportAlign();
      const image = mode === 'image';
      const dirty = isDirty();
      const text = image ? 'New image not saved' : 'Unsaved changes';
      if (o.saveBar === 'global') {
        SaveBar.set({ dirty, text, saveLabel: 'Save', onSave: () => save(), onDiscard: () => discardCurrent() });
      } else if (o.saveBar === 'inline') {
        R.inlineBar.hidden = !dirty;
        R.inlineText.textContent = text;
      }
      if (dirty !== lastDirty) {
        lastDirty = dirty;
        o.onDirtyChange?.(dirty);
      }
    }

    async function setTab(newTab, initial = false) {
      if (destroyed) return false;
      if (!EDITOR_TABS.includes(newTab)) return false;
      if (!initial && newTab === currentTab) return true;

      if (!initial) {
        if (currentTab === 'image' && imagePending) {
          const ok = await confirmDialog({ title: 'Discard the new image?', text: 'The new image has not been saved yet.', okLabel: 'Discard', danger: true });
          if (!ok) return false;
        } else if (newTab === 'image' && isDirty()) {
          const ok = await confirmDialog({
            title: 'Discard unsaved changes?',
            text: 'Markers and ROIs you changed are not saved yet. Open the image tab anyway?',
            okLabel: 'Discard changes',
            danger: true,
          });
          if (!ok) return false;
        }
        if (destroyed) return false;
      }

      const leavingImage = currentTab === 'image' && newTab !== 'image';
      currentTab = newTab;
      mode = newTab;
      updateTabsUI();

      if (newTab === 'image') {
        showReference();
        if (initial) {
          // the number sequence and the switches above the tabs need the data right away, also on the image tab
          try {
            loadEditorData();
          } catch (e) {
            console.error(e);
          }
        }
        return true;
      }

      if (leavingImage || initial) {
        if (leavingImage) {
          try {
            cfg = await Api.setup.loadConfig();
          } catch (e) {
            console.error(e);
          }
          if (destroyed) return false;
        }
        loadEditorData();
        loadReferenceCanvas(Api.setup.referenceImageUrl());
      }

      if (newTab === 'markers') {
        if (markerReady()) refreshMarker();
        refreshDraw();
      } else {
        roiType = newTab;
        onTypeChanged();
      }
      refreshSaveBar();
      return true;
    }

    /* ================================================================== */
    /* Data, saving, init                                                 */
    /* ================================================================== */
    function loadEditorData() {
      cfg = Api.setup.getConfig() || cfg;
      delta = {}; // reset the modified parameter container
      initializing = true;
      try {
        markerInit();
        seqInit();
      } finally {
        initializing = false;
      }
      editorSnapshot = editorState();
      if (o.autoDigit && !delta.digit.enabled && !delta.analog.enabled) {
        R.digitProcessing.checked = true; // first visit: start with the digits
        digitProcessingChanged();
      }
      reportAlign();
      R.updateMarker.disabled = false;
      updateCounts();
    }

    async function saveAll() {
      if (saving) return;
      setBusy(true);
      try {
        if (Array.isArray(markerRoi)) {
          // a marker that was moved or resized gets its new image cut from the reference image, then all new images are stored
          for (let i = 0; i < markerRoi.length; i++) {
            const m = markerRoi[i];
            const o = cfg.imagealignment?.marker?.[i];
            const moved = o && (toInt(m.x) !== toInt(o.x) || toInt(m.y) !== toInt(o.y));
            const resized = m.dx0 !== undefined && (m.dx !== m.dx0 || m.dy !== m.dy0);
            if (!m.modified && (moved || resized)) {
              const cut = await Api.setup.cutMarker(i + 1, m);
              if (!cut) throw new Error(`Marker ${i + 1} could not be cut`);
              m.modified = true;
            }
          }
          for (let i = 0; i < markerRoi.length; i++) {
            if (markerRoi[i].modified) await Api.setup.commitMarker(i + 1);
          }
        }
        await Api.setup.saveConfig(delta, true);
        await sleep(500);
        if (destroyed) return;
        cfg = await Api.setup.loadConfig();
        if (destroyed) return;
        loadEditorData();
        if (mode === 'markers') {
          refreshMarker();
        } else {
          roiType = mode;
          onTypeChanged();
        }
      } catch (error) {
        console.error('Saving setup failed: ', error);
      } finally {
        if (!destroyed) {
          setBusy(false);
          refreshSaveBar();
        }
      }
    }

    async function save() {
      if (mode === 'image') await saveReference();
      else await saveAll();
    }

    /* ================================================================== */
    /* Compact layout (phones): chips, pad, jog and steppers drive the    */
    /* same logic as the fields of the desktop layout                     */
    /* ================================================================== */
    const mq = window.matchMedia('(max-width: 860px)');
    const compact = () => true; // the controls are the same on every screen size (the layout around them differs)
    let mStep = 10;
    const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
    const mEl = (tag, cls, html) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (html !== undefined) el.innerHTML = html;
      return el;
    };
    const M_ICON = {
      up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
      down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
      left: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
      right: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
      jog: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>',
    };

    // the thing that is edited: a region of interest or an alignment marker
    const mTargets = {
      roi: {
        ready: () => !!delta.digit && roiCount() > 0,
        list: () => roisOf().map((r) => ({ x: toInt(r.x), y: toInt(r.y), w: toInt(r.dx), h: toInt(r.dy) })),
        index: () => roiSelected,
        select: (i) => {
          R.roiSelect.value = String(i);
          onROIChanged();
        },
        setPos: (x, y) => {
          R.refx.value = x;
          R.refy.value = y;
          onValueManualChanged();
        },
        setW: (w) => {
          R.refdx.value = w;
          onValueManualChangedDx();
        },
        setH: (h) => {
          R.refdy.value = h;
          onValueManualChanged();
        },
      },
      marker: {
        ready: () => markerReady(),
        list: () => (Array.isArray(markerRoi) ? markerRoi.map((r) => ({ x: toInt(r.x), y: toInt(r.y), w: toInt(r.dx), h: toInt(r.dy) })) : []),
        index: () => markerSelected,
        select: (i) => {
          R.markerSelect.value = String(i);
          markerSelectionChanged();
        },
        setPos: (x, y) => {
          R.mx.value = x;
          R.my.value = y;
          markerValueChanged();
        },
        setW: (w) => {
          R.mdx.value = w;
          markerValueChanged();
        },
        setH: (h) => {
          R.mdy.value = h;
          markerValueChanged();
        },
      },
    };
    const mTarget = () => (mode === 'markers' ? mTargets.marker : isRoiMode() ? mTargets.roi : null);
    const mCurrent = (t) => {
      try {
        return t.ready() ? t.list()[t.index()] || null : null;
      } catch (e) {
        return null;
      }
    };

    // button that repeats while it is held (and gets faster)
    function mHold(el, fn) {
      let timer = null;
      let delay = 380;
      let pressed = false;
      const stop = () => {
        pressed = false;
        clearTimeout(timer);
      };
      const loop = () => {
        if (!pressed) return;
        fn();
        delay = Math.max(60, delay * 0.8);
        timer = setTimeout(loop, delay);
      };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pressed = true;
        delay = 380;
        fn();
        timer = setTimeout(loop, delay);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => el.addEventListener(ev, stop));
    }

    // Position (pad with jog) and Size (steppers) as two cards next to each other
    function mBuildPair(host, which) {
      const t = mTargets[which];
      const pos = mEl('div', 'card m-card');
      pos.append(mEl('div', 'm-title', 'Position'));
      const pad = mEl('div', 'm-dpad');
      const keys = { up: [0, -1], left: [-1, 0], right: [1, 0], down: [0, 1] };
      for (const [name, [dx, dy]] of Object.entries(keys)) {
        const b = mEl('button', `m-key ${name}`, M_ICON[name]);
        b.type = 'button';
        b.setAttribute('aria-label', name);
        mHold(b, () => {
          const c = mCurrent(t);
          if (c) t.setPos(c.x + dx * mStep, c.y + dy * mStep);
        });
        pad.append(b);
      }
      const jog = mEl('div', 'm-key mid', M_ICON.jog);
      jog.setAttribute('role', 'slider');
      jog.setAttribute('aria-label', 'Jog: pull in any direction to move');
      jog.tabIndex = 0;
      pad.append(jog);
      pos.append(pad);

      const by = mEl('div', 'm-moveby');
      by.append(mEl('small', '', 'Move by'));
      const seg = mEl('div', 'm-seg');
      [1, 5, 10].forEach((n) => {
        const b = mEl('button', n === mStep ? 'active' : '', String(n));
        b.type = 'button';
        b.addEventListener('click', () => {
          mStep = n;
          by.querySelectorAll('button').forEach((x) => x.classList.toggle('active', Number(x.textContent) === n));
        });
        seg.append(b);
      });
      by.append(seg);
      pos.append(by);

      // jog: the stick moves the region, the further it is pulled the faster; it springs back on release
      (() => {
        const MAXR = 34;
        const DEAD = 0.1;
        const SPEED = 90;
        let st = null;
        let timer = null;
        const tick = () => {
          if (!st) return;
          const now = performance.now();
          const dt = Math.min(0.05, (now - st.t) / 1000);
          st.t = now;
          const mag = Math.hypot(st.vx, st.vy);
          const f = clampN(mag / MAXR, 0, 1);
          const c = mCurrent(t);
          if (f > DEAD && c) {
            const k = (Math.pow((f - DEAD) / (1 - DEAD), 2) * SPEED * dt) / mag;
            st.ax += st.vx * k;
            st.ay += st.vy * k;
            const mx = Math.trunc(st.ax);
            const my = Math.trunc(st.ay);
            if (mx || my) {
              st.ax -= mx;
              st.ay -= my;
              t.setPos(c.x + mx, c.y + my);
            }
          }
        };
        jog.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          try { jog.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
          jog.classList.add('active');
          st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, vx: 0, vy: 0, ax: 0, ay: 0, t: performance.now() };
          timer = setInterval(tick, 16);
        });
        jog.addEventListener('pointermove', (e) => {
          if (!st || e.pointerId !== st.id) return;
          let dx = e.clientX - st.x0;
          let dy = e.clientY - st.y0;
          const m = Math.hypot(dx, dy);
          if (m > MAXR) {
            dx *= MAXR / m;
            dy *= MAXR / m;
          }
          st.vx = dx;
          st.vy = dy;
          jog.style.transform = `translate(${dx}px, ${dy}px)`;
        });
        const end = (e) => {
          if (!st || e.pointerId !== st.id) return;
          clearInterval(timer);
          st = null;
          jog.classList.remove('active');
          jog.style.transform = '';
        };
        jog.addEventListener('pointerup', end);
        jog.addEventListener('pointercancel', end);
        jog.addEventListener('keydown', (e) => {
          const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
          const c = mCurrent(t);
          if (d && c) {
            e.preventDefault();
            t.setPos(c.x + d[0], c.y + d[1]);
          }
        });
      })();

      const size = mEl('div', 'card m-card');
      size.append(mEl('div', 'm-title', 'Size'));
      const steppers = mEl('div', 'm-steppers');
      const inputs = {};
      const stepper = (key, label, set) => {
        const box = mEl('div', 'm-stepper');
        const minus = mEl('button', '', '&minus;');
        const plus = mEl('button', '', '+');
        minus.type = 'button';
        plus.type = 'button';
        minus.setAttribute('aria-label', `${label} smaller`);
        plus.setAttribute('aria-label', `${label} larger`);
        const mid = mEl('div', 'm-stepval');
        mid.append(mEl('small', '', label));
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.inputMode = 'numeric';
        inp.setAttribute('aria-label', label);
        mid.append(inp);
        box.append(minus, mid, plus);
        mHold(minus, () => { const c = mCurrent(t); if (c) set(Math.max(1, c[key] - 1)); });
        mHold(plus, () => { const c = mCurrent(t); if (c) set(c[key] + 1); });
        inp.addEventListener('change', () => {
          const v = parseInt(inp.value, 10);
          if (Number.isNaN(v) || v < 1) mSync();
          else set(v);
        });
        inputs[key] = inp;
        steppers.append(box);
      };
      stepper('w', 'Width', (v) => t.setW(v));
      stepper('h', 'Height', (v) => t.setH(v));
      size.append(steppers);
      host.append(pos, size);
      return {
        update() {
          const c = mCurrent(t);
          for (const key of ['w', 'h']) {
            if (document.activeElement !== inputs[key]) inputs[key].value = c && Number.isFinite(c[key]) ? c[key] : '';
            inputs[key].disabled = !c;
          }
        },
      };
    }
    const mPairs = {};

    // preview of a marker: the cut-out of the reference image at its current position (follows the pad)
    function mThumb(m) {
      const c = document.createElement('canvas');
      const h = 36;
      if (!m || !(m.w >= 1) || !(m.h >= 1) || !imageObj.naturalWidth) {
        c.width = 40;
        c.height = h;
        return c;
      }
      c.width = clampN(Math.round((h * m.w) / m.h), 22, 90);
      c.height = h;
      c.getContext('2d').drawImage(imageObj, m.x, m.y, m.w, m.h, 0, 0, c.width, c.height);
      return c;
    }

    // combo box (markers, number sequences): items = [{ thumb?: canvas, title, sub }]
    function mComboClose(host) {
      host._open = false;
      const list = host.querySelector('.m-combo-list');
      if (list) list.hidden = true;
      host.querySelector('.m-combo-btn')?.setAttribute('aria-expanded', 'false');
    }
    function mComboRender(host, { caption, items, selected, onPick, add, empty }) {
      if (!host.firstChild) {
        const btn = mEl('button', 'm-combo-btn');
        btn.type = 'button';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');
        const ul = mEl('ul', 'm-combo-list');
        ul.setAttribute('role', 'listbox');
        ul.hidden = true;
        host.append(btn, ul);
        btn.addEventListener('click', () => {
          host._open = ul.hidden;
          ul.hidden = !host._open;
          btn.setAttribute('aria-expanded', String(host._open));
        });
        document.addEventListener('pointerdown', (e) => {
          if (host._open && !host.contains(e.target)) mComboClose(host);
        });
        host.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') mComboClose(host);
        });
      }
      const btn = host.querySelector('.m-combo-btn');
      const ul = host.querySelector('.m-combo-list');
      const entry = (it, withCaption) => {
        const wrap = mEl('span', 'm-combo-entry');
        if (it && it.thumb) {
          // a node can only sit in one place: the button and the list entry each get a copy of the preview
          const copy = document.createElement('canvas');
          copy.width = it.thumb.width;
          copy.height = it.thumb.height;
          copy.getContext('2d').drawImage(it.thumb, 0, 0);
          wrap.append(copy);
        }
        const txt = mEl('span', 'm-combo-text');
        if (withCaption && caption) txt.append(mEl('i', 'm-combo-caption', caption));
        txt.append(mEl('b', '', it ? it.title : ''), mEl('small', '', it ? it.sub || '' : ''));
        wrap.append(txt);
        return wrap;
      };
      btn.textContent = '';
      btn.append(entry(items[selected] || { title: empty || '', sub: '' }, true), mEl('span', 'm-combo-chev', '&#9662;'));
      if (host._adding) return; // a name is being typed: keep the list as it is
      ul.textContent = '';
      const pencil = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
      const trash = '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>';
      items.forEach((it, i) => {
        const li = mEl('li', `m-combo-item${i === selected ? ' selected' : ''}`);
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === selected));
        const main = mEl('div', 'm-combo-main');
        main.append(entry(it, false));
        main.addEventListener('click', () => {
          mComboClose(host);
          onPick(i);
        });
        li.append(main);
        if (it.actions) {
          const acts = mEl('span', 'm-combo-acts');
          const edit = mEl('button', 'm-combo-act', pencil);
          edit.type = 'button';
          edit.title = 'Rename';
          edit.setAttribute('aria-label', `Rename ${it.title}`);
          const del = mEl('button', 'm-combo-act m-danger', trash);
          del.type = 'button';
          del.title = 'Delete';
          del.setAttribute('aria-label', `Delete ${it.title}`);
          del.disabled = !it.actions.canDelete;
          edit.addEventListener('click', (e) => {
            e.stopPropagation();
            host._adding = true; // keep the list while the name is edited
            li.textContent = '';
            li.classList.add('editing');
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.maxLength = 30;
            inp.value = it.title;
            inp.setAttribute('aria-label', 'New name');
            const ok = mEl('button', 'm-combo-addok', 'Save');
            ok.type = 'button';
            const leave = () => {
              host._adding = false;
              it.actions.refresh();
            };
            const submit = () => {
              const name = inp.value.trim();
              if (!name || name === it.title) return leave();
              host._adding = false;
              const err = it.actions.rename(name);
              if (err) {
                host._adding = true;
                inp.classList.add('invalid');
                inp.title = err;
              }
            };
            ok.addEventListener('click', submit);
            inp.addEventListener('keydown', (ev) => {
              ev.stopPropagation();
              if (ev.key === 'Enter') submit();
              if (ev.key === 'Escape') leave();
            });
            inp.addEventListener('input', () => inp.classList.remove('invalid'));
            li.append(inp, ok);
            inp.focus();
            inp.select();
          });
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            mComboClose(host);
            it.actions.remove();
          });
          acts.append(edit, del);
          li.append(acts);
        }
        if (it.buttons) {
          // free buttons of an entry (regions: move up / down, copy, delete); moving keeps the list open
          const acts = mEl('span', 'm-combo-acts');
          it.buttons.forEach((bt) => {
            const b = mEl('button', `m-combo-act${bt.danger ? ' m-danger' : ''}`, bt.icon);
            b.type = 'button';
            b.title = bt.title;
            b.setAttribute('aria-label', `${bt.title}: ${it.title}`);
            b.disabled = !!bt.disabled;
            b.addEventListener('click', (e) => {
              e.stopPropagation();
              if (bt.close) mComboClose(host);
              bt.onClick();
            });
            acts.append(b);
          });
          li.append(acts);
        }
        ul.append(li);
      });
      if (add) {
        // new entry right in the list: a click turns it into an input
        const li = mEl('li', 'm-combo-add');
        const show = () => {
          host._adding = false;
          li.textContent = '';
          const b = mEl('button', 'm-combo-addbtn', '<span>+</span> ' + add.label);
          b.type = 'button';
          b.addEventListener('click', add.immediate ? () => {
            mComboClose(host);
            add.immediate();
          } : edit);
          li.append(b);
        };
        const edit = () => {
          host._adding = true;
          li.textContent = '';
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.maxLength = 30;
          inp.placeholder = add.placeholder || 'Name';
          inp.setAttribute('aria-label', add.label);
          const ok = mEl('button', 'm-combo-addok', 'Add');
          ok.type = 'button';
          const submit = () => {
            const name = inp.value.trim();
            if (!name) return;
            const err = add.onSubmit(name);
            if (err) {
              inp.classList.add('invalid');
              inp.title = err;
              return;
            }
            host._adding = false;
            mComboClose(host);
            mFillSeq(); // rebuild the list with the new entry
          };
          ok.addEventListener('click', submit);
          inp.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') {
              show();
              mComboClose(host);
            }
          });
          inp.addEventListener('input', () => inp.classList.remove('invalid'));
          li.append(inp, ok);
          inp.focus();
        };
        show();
        ul.append(li);
      }
    }
    function mRenderMarkerCombo(t, sel) {
      const items = t.list().map((m, i) => ({ thumb: mThumb(m), title: `Marker ${i + 1}`, sub: m.w >= 1 && m.h >= 1 ? `${m.x}, ${m.y} \u00b7 ${m.w} \u00d7 ${m.h}` : `${m.x}, ${m.y}` }));
      mComboRender(R.mMarkerCombo, { caption: 'Markers', items, selected: sel, onPick: (i) => t.select(i) });
    }

    const MI = {
      up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
      down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
      copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
      trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
    };
    function mRenderRoiCombo(t, sel) {
      const digit = roiType === 'digit';
      let list = [];
      try {
        list = t.ready() ? t.list() : [];
      } catch (e) {
        list = []; // data not loaded yet
      }
      const pick = (i) => {
        if (i !== roiSelected) t.select(i);
      };
      const items = list.map((m, i) => ({
        thumb: mThumb(m),
        title: `${digit ? 'Digit' : 'Analog'} ${i + 1}`,
        sub: m.w >= 1 && m.h >= 1 ? `${m.x}, ${m.y} \u00b7 ${m.w} \u00d7 ${m.h}` : `${m.x}, ${m.y}`,
        buttons: [
          { icon: MI.up, title: 'Move up', disabled: i === 0, onClick: () => mMoveROI(i, i - 1) },
          { icon: MI.down, title: 'Move down', disabled: i === list.length - 1, onClick: () => mMoveROI(i, i + 1) },
          {
            icon: MI.copy,
            title: 'Copy to the right',
            close: true,
            onClick: () => {
              pick(i);
              onClickCopyROI();
            },
          },
          {
            icon: MI.trash,
            title: 'Delete',
            danger: true,
            close: true,
            onClick: () => {
              pick(i);
              onClickDeleteROI();
            },
          },
        ],
      }));
      mComboRender(R.mRoiCombo, {
        caption: digit ? 'Digit region' : 'Analog region',
        items,
        selected: sel,
        onPick: (i) => pick(i),
        add: { label: digit ? 'Add digit' : 'Add analog region', immediate: () => onClickNewROI() },
        empty: { title: 'No regions yet', sub: 'Add the first one' }.title,
      });
    }

    function mMoveROI(from, to) {
      const rois = roisOf();
      const [r] = rois.splice(from, 1);
      rois.splice(to, 0, r);
      roiSelected = to;
      refreshROI();
      onValueManualChanged(); // spacing and synchronized values follow the new order
    }

    // copy the selected region to the right of it
    function onClickCopyROI() {
      const rois = roisOf();
      if (!rois.length) return;
      const r = rois[roiSelected];
      const gap = roiType === 'digit' ? toInt(space) : 0;
      rois.splice(roiSelected + 1, 0, { ...r, x: toInt(r.x) + toInt(r.dx) + gap });
      roiSelected += 1;
      refreshROI();
      onValueManualChanged();
    }

    // number sequences: one combo for the digit and the analog tab; the counts show what a sequence contains
    function mFillSeq() {
      if (!R.mSeqCombo) return;
      const opts = Array.from(R.seqSelect.options);
      const items = opts.map((o, i) => {
        const nd = delta.digit?.sequence?.[i]?.roi?.length ?? 0;
        const na = delta.analog?.sequence?.[i]?.roi?.length ?? 0;
        const dOff = delta.digit && !delta.digit.enabled ? ' (off)' : '';
        const aOff = delta.analog && !delta.analog.enabled ? ' (off)' : '';
        return {
          title: o.text,
          sub: `${nd} digit${nd === 1 ? '' : 's'}${dOff} \u00b7 ${na} analog${aOff}`,
          actions: {
            canDelete: opts.length > 1,
            refresh: () => mFillSeq(),
            rename: (name) => {
              const keep = seqName();
              const nm = name.toLowerCase();
              const err = renameNumberSequence(i, nm);
              if (err) {
                firework.launch(err, 'danger', 5000);
                return err;
              }
              fillSequenceSelectionOptions(i === seqIdx() ? nm : keep);
              return '';
            },
            remove: async () => {
              const confirmed = await confirmDialog({
                title: `Delete number sequence "${o.text}"?`,
                text: 'The entire sequence including all of its digit and analog ROIs will be removed.',
                okLabel: 'Delete sequence',
                danger: true,
              });
              if (destroyed || !confirmed) return;
              const keep = seqName();
              const err = deleteNumberSequence(i);
              if (err) {
                firework.launch(err, 'danger', 5000);
                return;
              }
              fillSequenceSelectionOptions(keep === o.text ? undefined : keep);
              onTypeChanged();
            },
          },
        };
      });
      mComboRender(R.mSeqCombo, {
        caption: 'Number sequence',
        add: {
          label: 'Add sequence',
          placeholder: 'Name of the new sequence',
          onSubmit: (name) => {
            const nm = name.toLowerCase();
            const err = createNumberSequence(nm);
            if (err) {
              firework.launch(err, 'danger', 5000);
              return err;
            }
            fillSequenceSelectionOptions(nm);
            onTypeChanged();
            return '';
          },
        },
        items,
        selected: Math.max(0, R.seqSelect.selectedIndex),
        onPick: (i) => {
          R.seqSelect.selectedIndex = i;
          onSequenceChanged();
        },
      });
    }

    // keeps chips and values in step with the editor state (cheap: called after every redraw)
    function mSync(force) {
      if (!R.mRoiCombo) return;
      mFillSeq(); // the number sequence applies to every tab
      // regions of a switched-off kind stay saved but are ignored: the controls are greyed out and say so
      const off = isRoiMode() && !(mode === 'digit' ? R.digitProcessing.checked : R.analogProcessing.checked);
      root.dataset.procOff = off ? '1' : '';
      R.mOffNote.hidden = !off;
      R.mOffNote.textContent = off ? `${mode === 'digit' ? 'Digit' : 'Analog'} processing is switched off. The regions stay saved but are ignored.` : '';
      const t = mTarget();
      if (!t) return;
      let count = 0;
      try {
        count = t.ready() ? t.list().length : 0;
      } catch (e) {
        count = 0;
      }
      const which = mode === 'markers' ? 'marker' : 'roi';
      const sel = t.index();
      if (which === 'marker') {
        mRenderMarkerCombo(t, sel);
      } else {
        mRenderRoiCombo(t, sel);
      }
      mPairs[which]?.update();
    }

    // on a phone the region is moved by dragging it in the image (the size is changed with the steppers)
    function mPointerDown(e) {
      const t = mTarget();
      if (!t || !t.ready()) return false;
      if (root.dataset.procOff === '1') return true; // switched off: the regions are not shown and cannot be grabbed
      const p = pointerPos(e, R.canvas);
      const list = t.list();
      const cur = t.index();
      const tol = 8;
      const inside = (r) => !!r && p.x >= r.x - tol && p.x <= r.x + r.w + tol && p.y >= r.y - tol && p.y <= r.y + r.h + tol;
      let hit = -1;
      if (inside(list[cur])) {
        hit = cur;
      } else {
        let best = Infinity;
        list.forEach((r, i) => {
          if (inside(r) && r.w * r.h < best) {
            best = r.w * r.h;
            hit = i;
          }
        });
      }
      if (hit < 0) return true; // nothing to grab
      if (hit !== cur) t.select(hit);
      const c = mCurrent(t);
      if (!c) return true;
      mDragState = { id: e.pointerId, x0: p.x, y0: p.y, ox: c.x, oy: c.y };
      return true;
    }
    function mPointerMove(e) {
      if (!mDragState || e.pointerId !== mDragState.id) return;
      const p = pointerPos(e, R.canvas);
      mTarget()?.setPos(mDragState.ox + p.x - mDragState.x0, mDragState.oy + p.y - mDragState.y0);
    }

    function mInit() {
      mPairs.roi = mBuildPair(R.mPairRoi, 'roi');
      mPairs.marker = mBuildPair(R.mPairMarker, 'marker');
      mq.addEventListener?.('change', () => mSync(true));
    }

    mInit();

    /* ---------------------------------------------------------- camera controls (-/+ buttons, slider, switch, segmented buttons) */
    function camSend(el, value) {
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function camNudge(el, delta) {
      let v = Number((parseFloat(el.value) || 0) + delta);
      v = Number(v.toFixed(Math.abs(delta) < 1 ? 1 : 0));
      const min = parseFloat(el.min);
      const max = parseFloat(el.max);
      if (Number.isFinite(min)) v = Math.max(min, v);
      if (Number.isFinite(max)) v = Math.min(max, v);
      if (String(v) !== el.value) camSend(el, v);
    }
    function camBuildUI() {
      root.querySelectorAll('[data-cam]').forEach((box) => {
        const name = box.dataset.cam;
        const el = camInput[name];
        const step = CAM_UI[name]?.step ?? (parseFloat(el.getAttribute('step')) || 1);
        box.querySelectorAll('.cam-step').forEach((b) => {
          const dir = Number(b.dataset.dir);
          mHold(b, () => {
            if (!el.disabled) camNudge(el, dir * step);
          });
          b.addEventListener('click', (e) => {
            if (e.detail === 0 && !el.disabled) camNudge(el, dir * step); // keyboard
          });
        });
        const sw = box.querySelector('.cam-check');
        if (sw) sw.addEventListener('change', () => camSend(el, sw.checked ? 'true' : 'false'));
        const seg = box.querySelector('.cam-segbtns');
        if (seg) {
          [...el.options].forEach((o) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.dataset.v = o.value;
            b.textContent = o.text;
            b.addEventListener('click', () => {
              if (!el.disabled && el.value !== o.value) camSend(el, o.value);
            });
            seg.append(b);
          });
          seg.dataset.cols = String(el.options.length > 3 ? 2 : el.options.length);
        }
        camUI[name] = () => {
          const off = el.disabled;
          box.querySelectorAll('.cam-step').forEach((b) => {
            b.disabled = off;
          });
          if (sw) {
            sw.checked = el.value === 'true';
            sw.disabled = off;
          }
          if (seg) {
            [...seg.children].forEach((b) => {
              b.classList.toggle('active', b.dataset.v === el.value);
              b.disabled = off;
            });
          }
          if (el.type === 'range') {
            const min = parseFloat(el.min);
            const max = parseFloat(el.max);
            const at = (v) => ((v - min) / (max - min || 1)) * 100;
            const pos = at(parseFloat(el.value) || 0);
            const zero = min < 0 && max > 0 ? at(0) : 0; // ranges around zero are filled from the middle
            box.style.setProperty('--from', `${Math.min(zero, pos)}%`);
            box.style.setProperty('--to', `${Math.max(zero, pos)}%`);
          }
        };
        camUI[name]();
      });
    }
    camBuildUI();
    setCamAdvanced(false);

    /* ---------------------------------------------------------- events */
    const CLICKS = {
      tab: (e, t) => {
        if (o.onNavigate) o.onNavigate(t.dataset.tab);
        else setTab(t.dataset.tab);
      },
      take: () => doTake(),
      updateMarker: () => requestMarkerCut(),
      recRefresh: () => loadMarkerRecognition(),
      newSequence: () => onClickNewSequence(),
      renameSequence: () => onClickRenameSequence(),
      deleteSequence: () => onClickDeleteSequence(),
      newROI: () => onClickNewROI(),
      copyROI: () => onClickCopyROI(),
      deleteROI: () => onClickDeleteROI(),
      moveHigher: () => swapROI(-1),
      moveLower: () => swapROI(1),
      saveNow: () => save(),
      discard: () => discardCurrent(),
    };
    const CHANGES = {
      redraw: () => refreshDraw(),
      camAdvanced: () => setCamAdvanced(R.camAdv.checked),
      zoomRoi: () => refreshDraw(),
      markerSelect: () => markerSelectionChanged(),
      markerValue: (t) => {
        clampMin(t, 1);
        markerValueChanged();
      },
      histogram: () => histogramUpdate(),
      digitProcessing: () => digitProcessingChanged(),
      analogProcessing: () => analogProcessingChanged(),
      sequence: () => onSequenceChanged(),
      roi: () => onROIChanged(),
      roiValue: (t) => {
        clampMin(t, 1);
        onValueManualChanged();
      },
      roiValueDx: (t) => {
        clampMin(t, 1);
        onValueManualChangedDx();
      },
      roiSpace: (t) => {
        clampMin(t, 0);
        onValueManualChangedSpace();
      },
      lockAspect: () => onClickLockAspectRatio(),
      lockSizes: () => onClickLockSizes(),
      lockSpace: () => onClickLockSpaceEquidistant(),
      ccw: () => onClickCCW(),
    };

    const onRootClick = (e) => {
      const t = e.target.closest('[data-click]');
      if (t && root.contains(t) && !t.disabled) CLICKS[t.dataset.click]?.(e, t);
    };
    const onRootChange = (e) => {
      const p = e.target.closest('[data-param]');
      if (p) {
        onParamChange(p);
        return;
      }
      const t = e.target.closest('[data-change]');
      if (t && root.contains(t)) CHANGES[t.dataset.change]?.(t);
    };
    const onRootInput = (e) => {
      const p = e.target.closest('[data-param]');
      if (p && p.type === 'range') {
        updateParamOutput(p); // live value while dragging a slider
        if (!isActReference && imageOk && CAM_PREVIEW.has(p.dataset.param)) drawRotated();
        updateTakeState();
        if (p.dataset.param === 'imagealignment.imagerotation' && !isActReference) drawRotated(); // the preview turns along with the slider
      }
    };
    root.addEventListener('click', onRootClick);
    root.addEventListener('change', onRootChange);
    root.addEventListener('input', onRootInput);

    const onPointerDown = (e) => {
      if (!imageOk || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (compact() && (mode === 'markers' || isRoiMode())) {
        // the region is moved by dragging (its size is changed with the steppers)
        if (!mPointerDown(e)) return;
        try {
          R.canvas.setPointerCapture(e.pointerId);
        } catch (err) {
          /* not capturable */
        }
        e.preventDefault();
        return;
      }
      if (mode === 'markers') markerPointerDown(e);
      else if (isRoiMode()) seqPointerDown(e);
      else return;
      try {
        R.canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* not capturable */
      }
      e.preventDefault();
    };
    const onPointerUp = (e) => {
      if (mDragState) {
        mDragState = null;
        applyZoom(); // the view follows the region again after the drag
        return;
      }
      if (!drag) return;
      if (mode === 'markers') markerPointerUp(e);
      else if (isRoiMode()) seqPointerUp(e);
    };
    const onPointerMove = (e) => {
      if (compact() && (mode === 'markers' || isRoiMode())) {
        mPointerMove(e);
        return;
      }
      if (mode === 'markers') {
        if (imageOk) markerPointerMove(e);
      } else if (isRoiMode()) {
        if (imageOk) seqPointerMove(e);
      } else {
        drawRotated(!isActReference);
        drawCrosshair(pointerPos(e, R.canvas));
      }
    };
    R.canvas.addEventListener('pointerdown', onPointerDown);
    R.canvas.addEventListener('pointerup', onPointerUp);
    R.canvas.addEventListener('pointercancel', onPointerUp);
    R.canvas.addEventListener('pointermove', onPointerMove);

    // theme change: the histogram takes its colors from the CSS variables
    const offTheme = App.onThemeChange(() => {
      if (mode === 'markers') histogramUpdate();
    });

    /* -------------------------------------------------------- lifecycle */
    async function init() {
      try {
        cfg = await Api.setup.loadConfig();
        if (destroyed) return;
        const wanted = ROUTE_TO_TAB[tab];
        const start = wanted || 'image'; // first tab
        await setTab(start, true);
      } catch (error) {
        firework.launch('Failed to load config. Retry or check logs', 'danger', 5000);
        console.error('Initialization failed:', error);
      }
    }

    function unmount() {
      if (destroyed) return;
      destroyed = true;
      if (typeof offTheme === 'function') offTheme();
      window.removeEventListener('cycle-status', onCycleForRec);
      root.removeEventListener('click', onRootClick);
      root.removeEventListener('change', onRootChange);
      root.removeEventListener('input', onRootInput);
      imageObj.onload = imageObj.onerror = null;
      R.markerImage.onload = R.markerImage.onerror = null;
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
      if (o.saveBar === 'global') {
        SaveBar.busy(false);
        SaveBar.set({ dirty: false });
      }
      root.classList.remove('setup');
      root.innerHTML = '';
    }

    const ready = init();
    return {
      unmount,
      isDirty,
      save,
      setTab: (t) => setTab(ROUTE_TO_TAB[t] || t),
      getTab: () => currentTab,
      ready,
    };
  }

  /* ======================================================================== */
  /* View: setup (#/config, #/config/<image|markers|digits|analog>)             */
  /* ======================================================================== */
  let setupEditor = null;
  const setupHash = (tab) => '#/config/' + TAB_TO_ROUTE[tab];

  App.register('config', {
    title: 'Configuration',
    mount(root, ctx) {
      setupEditor = mountEditor(root, ctx.parts[0], {
        onNavigate: (tab) => App.navigate(setupHash(tab)),
        // tab flipped by the processing check boxes: keep the URL in sync without routing again
        onTabChange: (tab) => history.replaceState(null, '', setupHash(tab)),
      });
    },
    async route(ctx) {
      if (!setupEditor) return;
      const wanted = ROUTE_TO_TAB[ctx.parts[0]];
      if (!wanted) return;
      const ok = await setupEditor.setTab(wanted);
      // dialog cancelled: put the URL of the tab that stays open back
      if (!ok && setupEditor && setupEditor.getTab()) history.replaceState(null, '', setupHash(setupEditor.getTab()));
    },
    unmount() {
      if (setupEditor) setupEditor.unmount();
      setupEditor = null;
    },
  });

  /* ======================================================================== */
  /* View: wizard (#/wizard), the initial setup wizard                         */
  /* ======================================================================== */
  const WIZARD_STEPS = ['Meter type', 'Camera', 'Alignment', 'Regions', 'Finish'];
  const WIZARD_FLOW = [
    { name: 'Meter type', text: 'Choose the type of your meter. It sets the units and the look of the interface. The flashlight pin can be customized here as well.' },
    { name: 'Camera', text: 'Take a live picture, adjust the lens focus, the flashlight and the image settings until the meter is sharp, upright and free of glare.' },
    { name: 'Alignment', text: 'Place two alignment markers on fixed structures of the meter, so the device finds the dials again in every picture.' },
    { name: 'Regions', text: 'Mark the digits and the analog dials that make up the reading. Switch digits and analog on or off and use the tabs to move between them.' },
    { name: 'Finish', text: 'Optionally protect the web interface with a password, then switch to the operational web interface.' },
  ];
  const WIZARD_EDITOR_TABS = { 2: 'image', 3: 'markers', 4: 'digit' };

  /** A row in the style of the setup page (label with help, control, unit). */
  const cfgRow = (label, help, control, cls = 'cfg-l0', attrs = '') => `
    <div class="cfg-row ${cls}"${attrs}>
      <div class="cfg-label"><span>${label}</span>${help ? `<div class="tooltip-trigger" data-help="${help}"></div>` : ''}</div>
      <div class="cfg-ctl">${control}</div>
    </div>`;

  function wizardMarkup() {
    return `
      <header class="wiz-bar">
        <div class="wiz-brand">
          <img src="favicon.ico" alt="" class="wiz-logo" />
          <div>
            <h1 class="wiz-title">AI-on-the-Edge</h1>
            <div class="wiz-sub">Initial setup</div>
          </div>
        </div>
      </header>

      <ol class="wiz-stepper" data-ref="stepper" aria-label="Setup steps">
        ${WIZARD_STEPS.map((s, i) => `<li data-step="${i + 1}"><span>${App.esc(s)}</span></li>`).join('')}
      </ol>

      <main class="wiz-content">
        <div class="wiz-step hidden" data-panel="0">
          <div class="wiz-welcome">
            <div class="card wiz-welcome-card">
              <div class="card-header"><span>Welcome</span></div>
              <div class="wiz-card-pad">
                <p class="wiz-lead">
                  This wizard configures your device for first use. When you are done, the device restarts into the operational web interface.
                  All wizard settings stay available there.
                </p>
                <ol class="wiz-flow" data-ref="flow" aria-label="Setup steps">
                  ${WIZARD_FLOW.map((f, i) => `<li><button type="button" class="wiz-flow-node${i === 0 ? ' active' : ''}" data-click="flowInfo" data-i="${i}"><span class="wiz-flow-num">${i + 1}</span><span class="wiz-flow-name">${App.esc(f.name)}</span></button></li>`).join('')}
                </ol>
                <div class="wiz-flow-info" data-ref="flowInfo" aria-live="polite"><b>${App.esc(WIZARD_FLOW[0].name)}</b><span>${App.esc(WIZARD_FLOW[0].text)}</span></div>
              </div>
            </div>

            <div class="wiz-start" role="group" aria-label="How do you want to start?">
              <button type="button" class="wiz-choice wiz-choice-big wiz-choice-main" data-click="startScratch">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" /></svg>
                <b>Start from scratch</b>
                <span>Set up flashlight, camera, markers and regions step by step</span>
              </button>
              <button type="button" class="wiz-choice wiz-choice-big" data-click="startRestore" data-ref="choiceRestore" aria-expanded="false">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M4 14v5a1 1 0 001 1h14a1 1 0 001-1v-5" /></svg>
                <b>Restore a backup</b>
                <span>Bring back the configuration of a backup of this application (or of firmware v16)</span>
              </button>
            </div>
          </div>

          <div class="wiz-restore" data-ref="restoreHost" hidden></div>
        </div>

        <div class="wiz-step hidden" data-panel="1">
          <div class="wiz-step-content">
            <strong>Step 1: Meter type</strong>
            <p>Choose the type of your meter. It sets the units and the look of the interface. You can continue after you have made a choice.</p>
          </div>
          <div class="cfg wiz-cfg">
            <div class="card cfg-card" data-card="metertheme">
              <div class="card-header"><span class="cfg-card-title">Meter type</span></div>
              <div class="card-body cfg-body">
                ${cfgRow('Meter Type', 'mqtt_homeassistant_metertype', '<select data-field="mqtt.homeassistant.metertype" data-int="1" data-ref="meterType" data-change="field" hidden></select><span data-ref="meterCombo"></span>')}
              </div>
            </div>
            <div class="card cfg-card">
              <div class="card-header"><span class="cfg-card-title">GPIO mapping</span></div>
              <div class="card-body cfg-body">
                ${cfgRow('Actual GPIO Mapping', '', '<span class="cfg-info" data-ref="mapping"></span>')}
                ${cfgRow('GPIO Customization', 'gpio_customizationenabled', `<select data-field="gpio.customizationenabled" data-ref="gpioCustom" data-change="field">
                  <option value="false" selected>Disabled</option>
                  <option value="true">Enabled</option>
                </select>`)}
                ${cfgRow('Pin Selection', 'gpio_gpiopin_gpionumber', '<select class="cfg-strong" data-field="gpio.gpiopin.#.gpionumber" data-int="1" data-ref="gpioPin" data-change="gpioPin"></select>', 'cfg-l1', ' data-gpio-row="pin"')}
                ${cfgRow('Pin Status', 'gpio_gpiopin_pinenabled', `<select data-field="gpio.gpiopin.#.pinenabled" data-pin="1" data-ref="gpioPinEnabled" data-change="field">
                  <option value="false" selected>Disabled</option>
                  <option value="true">Enabled</option>
                </select>`, 'cfg-l1', ' data-gpio-row="pin"')}
                ${cfgRow('Pin Mode <span class="wiz-restricted hidden" data-ref="restricted"></span>', 'gpio_gpiopin_pinmode', `<select data-field="gpio.gpiopin.#.pinmode" data-pin="1" data-ref="gpioPinMode" data-change="field">
                  <option value="flashlight-default">Flashlight Default</option>
                  <option value="flashlight-pwm">Flashlight PWM</option>
                  <option value="flashlight-smartled">Flashlight Smartled</option>
                  <option value="flashlight-digital">Flashlight Digital</option>
                </select>`, 'cfg-l1', ' data-gpio-row="mode"')}
                ${cfgRow('Pin Logic Level', 'gpio_gpiopin_logicactivelow', `<select data-field="gpio.gpiopin.#.logicactivelow" data-pin="1" data-change="field">
                  <option value="false" selected>Active High</option>
                  <option value="true">Active Low</option>
                </select>`, 'cfg-l1', ' data-gpio-row="logic"')}
                ${cfgRow('LED Type', 'gpio_gpiopin_smartled_type', `<select data-field="gpio.gpiopin.#.smartled.type" data-pin="1" data-int="1" data-change="field">
                  <option value="0" selected>WS2812</option>
                  <option value="1">WS2812B (universal)</option>
                  <option value="2">WS2812B (newer variant)</option>
                  <option value="3">WS2812B (older variant)</option>
                  <option value="4">SK6812</option>
                  <option value="5">WS2813</option>
                </select>`, 'cfg-l1', ' data-gpio-row="smartled"')}
                ${cfgRow('LED Color (RGB)', 'gpio_gpiopin_smartled_color', `
                  <span class="cfg-pre">R</span><input class="cfg-num-sm" required type="number" min="0" max="255" value="255" data-field="gpio.gpiopin.#.smartled.colorredchannel" data-pin="1" data-int="1" data-change="field" />
                  <span class="cfg-pre">G</span><input class="cfg-num-sm" required type="number" min="0" max="255" value="255" data-field="gpio.gpiopin.#.smartled.colorgreenchannel" data-pin="1" data-int="1" data-change="field" />
                  <span class="cfg-pre">B</span><input class="cfg-num-sm" required type="number" min="0" max="255" value="255" data-field="gpio.gpiopin.#.smartled.colorbluechannel" data-pin="1" data-int="1" data-change="field" />`, 'cfg-l1', ' data-gpio-row="smartled"')}
                ${cfgRow('LED Intensity Correction', 'gpio_gpiopin_intensitycorrectionfactor', '<input class="cfg-num" required type="number" min="1" max="100" value="100" data-field="gpio.gpiopin.#.intensitycorrectionfactor" data-pin="1" data-int="1" data-change="field" /><span class="cfg-unit">%</span>', 'cfg-l1', ' data-gpio-row="intensity"')}
              </div>
            </div>
          </div>
        </div>

        <div class="wiz-step hidden" data-panel="2">
          <div class="wiz-step-content">
            <strong>Step 2: Camera and image</strong>
            <p>
              Take a live image with <b>Update image</b> and adjust the lens focus until it is as sharp as possible. Detailed instructions are available in the
              <a href="https://jomjol.github.io/AI-on-the-edge-device-docs/Reference-Image/#focus" target="_blank" rel="noopener noreferrer">focus adjustment guide</a>.<br />
              Verify that the flashlight does not create glare in critical processing areas. If the internal LED is insufficient or glare cannot be avoided,
              refer to <a href="https://jomjol.github.io/AI-on-the-edge-device-docs/External-LED/" target="_blank" rel="noopener noreferrer">Installation of external LEDs</a> or
              to discussion <a href="https://github.com/jomjol/AI-on-the-edge-device/discussions/1949" target="_blank" rel="noopener noreferrer">Ways to avoid reflections</a>.
            </p>
          </div>
          <div class="wiz-editor" data-editor></div>
        </div>
        <div class="wiz-step hidden" data-panel="3">
          <div class="wiz-step-content"><strong>Step 3: Alignment Marker Configuration</strong></div>
          <div class="wiz-editor" data-editor></div>
        </div>
        <div class="wiz-step hidden" data-panel="4">
          <div class="wiz-step-content"><strong>Step 4: Regions of interest</strong></div>
          <div class="wiz-editor" data-editor></div>
        </div>
        <div class="wiz-step hidden" data-panel="5">
          <div class="wiz-step-content"><strong>Step 5: Configure WebUI Security &amp; Complete Initial Setup</strong></div>
          <div class="cfg wiz-cfg">
            <div class="card cfg-card">
              <div class="card-header"><span class="cfg-card-title">WebUI security</span></div>
              <div class="card-body cfg-body">
                ${cfgRow('Authentication', 'webui_httpauth_authmode', `<select data-field="webui.httpauth.authmode" data-int="1" data-ref="authMode" data-change="field">
                  <option value="0" selected>Disabled</option>
                  <option value="1">Enabled</option>
                </select>`)}
                ${cfgRow('Username', 'webui_httpauth_username', '<input type="text" data-field="webui.httpauth.username" data-change="field" autocomplete="username" />', 'cfg-l1', ' data-auth-row')}
                ${cfgRow('Password', 'webui_httpauth_password', `<div class="wiz-pw">
                  <input type="password" data-field="webui.httpauth.password" data-ref="password" data-change="field" autocomplete="on" />
                  <button type="button" class="wiz-pw-toggle" data-click="togglePw" aria-label="Show or hide the password">Show</button>
                </div>`, 'cfg-l1', ' data-auth-row')}
              </div>
            </div>
          </div>

          <div class="info-box">
            <p><b>INITIAL SETUP COMPLETED</b></p>
            <p>Congratulations! You have completed the initial setup and you are now ready to switch to the operational web interface!</p>
            <p>
              Once you push the button below, the initial setup wizard will be completed and the device will automatically switch to operational
              web interface. If configuration is error free, the device will automatically start with first processing. It will take
              some time until you get the first reading.
            </p>
            <p><button type="button" class="button btn-action btn-wide" data-click="complete">Complete Setup Wizard</button></p>
          </div>
        </div>

        <div class="wiz-step hidden" data-panel="99">
          <div class="wiz-step-content wiz-step-abort">
            <strong>Abort Initial Setup</strong>
            <button type="button" class="button" data-click="restart">Restart Wizard</button>
          </div>
          <div class="warning-box">
            <p><b>INITIAL SETUP ABORTED</b></p>
            <p>
              Once you push the button below, the initial setup wizard will be aborted and the device will automatically switch to operational
              web interface. Please be aware: The configuration of the device is not or only partly adapted to your needs!
            </p>
            <p>Configuration can still be adapted / completed using operational web interface.</p>
            <p><button type="button" class="button danger-solid btn-wide" data-click="abort">Abort Setup Wizard</button></p>
          </div>
        </div>
      </main>

      <footer class="wiz-actions">
        <div class="wiz-actions-inner">
          <div class="wiz-actions-left">
            <button type="button" class="button danger-solid" data-click="skip" data-ref="skip">Abort wizard</button>
            <button type="button" class="wiz-link-btn" data-click="log">Log</button>
          </div>
          <div class="wiz-actions-right">
            <button type="button" class="button" data-click="previous" data-ref="previous">Back</button>
            <button type="button" class="button btn-action" data-click="next" data-ref="next">Next</button>
          </div>
        </div>
      </footer>`;
  }

  function mountWizard(root) {
    root.classList.add('wiz');
    root.innerHTML = wizardMarkup();

    const R = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      R[el.dataset.ref] = el;
    });
    const all = (selector) => Array.from(root.querySelectorAll(selector));
    const stepFromStorage = () => {
      try {
        return parseInt(sessionStorage.getItem(WIZARD_STEP_KEY), 10) || 0;
      } catch (e) {
        return 0;
      }
    };

    let destroyed = false;
    let step = stepFromStorage();
    let cfg = {};
    let delta = {}; // modified parameters of the current step (flashlight, security, operation mode)
    let editor = null;
    let busy = false;
    let logDialog = null;
    let meterChosen = stepFromStorage() > 1; // the meter type has to be picked once before the wizard goes on
    let meterCombo = null;

    /* ------------------------------------------------------------ fields */
    const pinIdx = () => R.gpioPin.selectedIndex;
    const fieldName = (el) => el.dataset.field.replace('#', String(pinIdx()));
    const isInt = (el) => el.dataset.int === '1';

    /** Fills all configuration inputs from `source` (config or config + delta). */
    function loadFields(source) {
      all('[data-field]').forEach((el) => {
        if (el === R.gpioPin) return; // options are built from the config
        setControlValue(el, getPath(source, fieldName(el)));
      });
    }

    /** A configuration input was changed: record it in the delta. Pin parameters always carry the pin number. */
    function onFieldChange(el) {
      const name = fieldName(el);
      switch (el.dataset.field) {
        case 'takeimage.flashlight.flashtime':
          if (el.validity.rangeUnderflow) el.value = 100;
          else if (el.validity.stepMismatch) el.value = parseInt(el.value, 10);
          break;
        case 'takeimage.flashlight.flashintensity':
          if (el.validity.rangeUnderflow) el.value = 0;
          else if (el.validity.rangeOverflow) el.value = 100;
          break;
        default:
          if (el.type === 'number' && el.dataset.pin === '1') {
            if (el.validity.rangeUnderflow) el.value = el.min;
            else if (el.validity.rangeOverflow) el.value = el.max;
          }
      }
      if (el.dataset.pin === '1') delta = mergeParam(delta, fieldName(R.gpioPin), R.gpioPin.value, true);
      delta = mergeParam(delta, name, el.value, isInt(el));
      if (el === R.gpioCustom || el.dataset.pin === '1') updateGpioUi();
      if (el === R.authMode) updateAuthUi();
    }

    function updateAuthUi() {
      all('[data-auth-row]').forEach((row) => show(row, R.authMode.value === '1'));
    }

    /* ---------------------------------------------------------- GPIO UI */
    function initGpioSection() {
      const pins = cfg.gpio?.gpiopin || [];
      const sel = R.gpioPin;
      sel.options.length = 0;
      let first = -1;
      pins.forEach((pin, i) => {
        sel.add(new Option('GPIO' + pin.gpionumber, pin.gpionumber));
        if (first < 0 && pin.pinenabled) first = i;
      });
      sel.selectedIndex = pins.length ? Math.max(first, 0) : -1;
      loadPinFields();
      updateGpioPinUsage(parseInt(sel.value, 10));
    }

    /** Loads the parameters of the selected pin from configuration + not yet saved changes. */
    function loadPinFields() {
      // note: deepMergeObjects turns the pin array into an object keyed by the index, which getPath() reads as well
      const merged = deepMergeObjects(cfg, delta);
      all('[data-pin="1"]').forEach((el) => setControlValue(el, getPath(merged, fieldName(el))));
    }

    function updateGpioPinUsage(gpioNumberSelected) {
      const pin = (cfg.gpio?.gpiopin || []).find((p) => p.gpionumber === gpioNumberSelected);
      if (!pin) return;
      const usage = pin.gpiousage || '';
      const defaultOption = R.gpioPinMode.options[0];
      if (usage.substring(0, 10) === 'flashlight') defaultOption.removeAttribute('hidden');
      else defaultOption.setAttribute('hidden', 'true');
      if (usage.substring(0, 10) === 'restricted') {
        R.restricted.textContent = '(ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â  DEFAULT: ' + usage.substring(12).replace(/-/g, ' ').toUpperCase() + ')';
        show(R.restricted, true);
      } else {
        show(R.restricted, false);
      }
    }

    function updateGpioUi() {
      const isCustomized = R.gpioCustom.value === 'true';
      if (isCustomized) {
        R.mapping.textContent = 'Customized';
      } else {
        const pin = (cfg.gpio?.gpiopin || []).find((p) => (p.gpiousage || '').substring(0, 10) === 'flashlight');
        R.mapping.textContent = pin
          ? 'Board Default [GPIO' + pin.gpionumber + ', ' + pin.gpiousage.substring(11).toUpperCase() + ']'
          : 'No Board Default. Use Customization';
      }
      const pinEnabled = R.gpioPinEnabled.value === 'true';
      const mode = R.gpioPinMode.value;
      const rows = {
        pin: isCustomized,
        mode: isCustomized && pinEnabled,
        logic: isCustomized && pinEnabled && mode === 'flashlight-digital',
        smartled: isCustomized && pinEnabled && mode === 'flashlight-smartled',
        intensity: isCustomized && pinEnabled && mode === 'flashlight-smartled',
      };
      all('[data-gpio-row]').forEach((row) => show(row, rows[row.dataset.gpioRow]));
    }

    function onPinSelected() {
      loadPinFields();
      onFieldChange(R.gpioPinEnabled); // same as before: selecting a pin records its number and status
      updateGpioPinUsage(parseInt(R.gpioPin.value, 10));
    }

    /** Re-reads the stored configuration into all inputs, drops pending changes. */
    function syncConfigToUI() {
      cfg = Api.setup.getConfig() || cfg;
      if (step === 1) initGpioSection();
      loadFields(cfg);
      meterCombo?.sync();
      updateGpioUi();
      updateAuthUi();
      delta = {};
    }

    /* ------------------------------------------------------- navigation */
    function setNavDisabled(prev, next, skip) {
      R.previous.disabled = prev;
      R.next.disabled = next;
      R.skip.disabled = skip;
    }

    function updateStepper() {
      all('.wiz-stepper li').forEach((li) => {
        const n = parseInt(li.dataset.step, 10);
        li.classList.toggle('done', step === WIZARD_ABORT_STEP ? false : n < step);
        li.classList.toggle('current', n === step);
      });
    }

    function unmountEditor() {
      if (editor) editor.unmount();
      editor = null;
    }

    function renderStep() {
      unmountEditor();
      all('[data-panel]').forEach((p) => show(p, parseInt(p.dataset.panel, 10) === step));
      root.querySelector('.wiz-actions').hidden = step === 0; // the start screen has its own big choices: no bar
      updateStepper();
      setNavDisabled(step === 0 || step === WIZARD_ABORT_STEP, step === WIZARD_LAST_STEP || step === WIZARD_ABORT_STEP || (step === 1 && !meterChosen) || step === 2 || step === 3 || step === 4, step === WIZARD_LAST_STEP || step === WIZARD_ABORT_STEP);

      if (WIZARD_EDITOR_TABS[step]) {
        const host = root.querySelector(`[data-panel="${step}"] [data-editor]`);
        editor = App.setup.mountEditor(host, WIZARD_EDITOR_TABS[step], {
          header: false,
          tabs: step === 4,
          sequenceBar: step > 3,
          seqCombo: true,
          procSwitches: true,
          tabList: step === 4 ? ['digit', 'analog'] : null,
          autoDigit: step === 4,
          centerMarkers: step === 3,
          onAlignState: ({ ready, procs }) => {
            if (busy) return;
            if (step === 3) R.next.disabled = !ready;
            if (step === 4) R.next.disabled = !procs;
          },
          introHint: step === 2,
          onImageState: ({ exists, pending, stale }) => {
            // Next needs a picture that matches the current settings
            if (step === 2 && !busy) R.next.disabled = stale || (!pending && !exists);
          },
          helpOpen: true,
          saveBar: 'none', // the steps save when you leave them
        });
      }
      root.scrollIntoView?.({ block: 'start' });
    }

    async function navigate(target) {
      if (busy) return;
      if (step >= 2 && step < WIZARD_LAST_STEP && editor && editor.isDirty()) {
        // the new camera picture is stored with Next / Previous, no extra question
        stepFlashCfgBusy(true);
        try {
          await editor.save();
        } finally {
          if (!destroyed) stepFlashCfgBusy(false);
        }
        if (destroyed || editor.isDirty()) return;
      } else if (editor && editor.isDirty()) {
        const discard = await confirmDialog({
          title: 'Discard unsaved changes?',
          text: 'You have changes in this step that are not saved yet. Leave the step anyway?',
          okLabel: 'Discard changes',
          danger: true,
        });
        if (!discard || destroyed) return;
      }
      if (target < 0) target = 0;
      if (target > WIZARD_LAST_STEP && target < WIZARD_ABORT_STEP) target = WIZARD_LAST_STEP;
      if (step === 1 && target > 1 && target < WIZARD_ABORT_STEP && !meterChosen) return; // pick the meter type first
      if (step === 1 && target === 2) {
        // processing starts switched off, the sequences step turns it on
        delta.digit = { ...delta.digit, enabled: false };
        delta.analog = { ...delta.analog, enabled: false };
        // a device that still has the factory flash values starts with a short, gentle flash
        const fl = cfg.takeimage?.flashlight;
        if (fl && [1000, 2000].includes(Number(fl.flashtime)) && Number(fl.flashintensity) === 50) {
          delta.takeimage = { ...delta.takeimage, flashlight: { flashtime: 100, flashintensity: 30 } };
        }
      }
      if (step === 1 && target !== step && Object.keys(delta).length) {
        stepFlashCfgBusy(true);
        const saved = await savePendingChanges();
        if (!destroyed) stepFlashCfgBusy(false);
        if (!saved || destroyed) return;
      }
      step = target;
      try {
        sessionStorage.setItem(WIZARD_STEP_KEY, String(step));
      } catch (e) {
        /* storage blocked */
      }
      syncConfigToUI();
      renderStep();
    }

    function stepFlashCfgBusy(flag) {
      busy = flag;
      R.previous.disabled = flag;
      R.next.disabled = flag || !meterChosen;
      R.skip.disabled = flag;
    }

    /** Saves the changes of the step (meter type, flashlight) and reloads the stored configuration. */
    async function savePendingChanges() {
      try {
        await Api.setup.saveConfig(delta, true);
        syncConfigToUI();
        return true;
      } catch (error) {
        console.error('Failed to save the configuration:', error);
        return false;
      }
    }

    /* ------------------------------------------------------- completion */
    async function finalizeSetup(isAbort) {
      const confirmed = await confirmDialog({
        title: isAbort ? 'Abort the setup?' : 'Complete the setup?',
        text: isAbort
          ? 'Do you want to abort the setup and switch to operational web interface?'
          : 'Do you want to complete the setup mode and switch to operational web interface?',
        okLabel: isAbort ? 'Abort setup' : 'Complete setup',
        danger: isAbort,
      });
      if (!confirmed || destroyed) return;

      delta.operationmode = delta.operationmode || {};
      delta.operationmode.opmode = 1; // switch to automatic mode
      try {
        sessionStorage.removeItem(WIZARD_STEP_KEY);
      } catch (e) {
        /* storage blocked */
      }

      try {
        await Api.setup.saveConfig(delta, true);
        firework.launch(
          isAbort
            ? 'Initial setup aborted. Device configuration incomplete. Loading operational web interface...'
            : 'Initial setup completed. Loading operational web interface...',
          isAbort ? 'warning' : 'success',
          10000,
        );
      } catch (error) {
        const errorMsg = error.message || error;
        firework.launch(
          'Failed saving configuration. (Error: ' + errorMsg + '). Check config and/or logs after operational web interface is loaded (Dashboard > Activity). Loading operational web interface...',
          'danger',
          10000,
        );
        console.error('Saving setup failed:', error);
      }

      // Load the operational web interface in any case. Intentionally not cancelled when the view is left:
      // the device switches its operation mode, the page has to be reloaded.
      App.leaveSetup();
      setTimeout(() => {
        const target = getDomainname();
        if (target !== window.location.origin) {
          window.location.assign(target + '/#/dashboard');
        } else {
          window.location.hash = '#/dashboard';
          window.location.reload();
        }
      }, 7000);
    }

    /* -------------------------------------------------------- log dialog */
    async function openLog() {
      if (logDialog) return;
      const dlg = document.createElement('dialog');
      dlg.className = 'dlg wiz-log-dlg';
      dlg.innerHTML = `<div class="dlg-body"><h2>Log</h2><pre class="wiz-log">Loading...</pre>
        <div class="dlg-actions"><button type="button" class="button" data-a="refresh">Refresh</button><button type="button" class="button btn-action" data-a="close">Close</button></div></div>`;
      const pre = dlg.querySelector('.wiz-log');
      const load = async () => {
        pre.textContent = 'Loading...';
        const text = await Api.setup.getLog();
        if (!dlg.isConnected) return;
        pre.textContent = text ? text.slice(-100000) : 'Log not available';
        pre.scrollTop = pre.scrollHeight;
      };
      dlg.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]');
        if (a && a.dataset.a === 'close') dlg.close();
        else if (a && a.dataset.a === 'refresh') load();
        else if (e.target === dlg) dlg.close();
      });
      dlg.addEventListener('close', () => {
        dlg.remove();
        logDialog = null;
      });
      logDialog = dlg;
      document.body.append(dlg);
      dlg.showModal();
      load();
    }

    /* ------------------------------------------------------------ events */
    let restorePanel = null;
    const CLICKS = {
      log: () => openLog(),
      startScratch: () => navigate(1),
      startRestore: () => {
        const open = R.restoreHost.hidden;
        R.restoreHost.hidden = !open;
        R.choiceRestore.classList.toggle('active', open);
        R.choiceRestore.setAttribute('aria-expanded', String(open));
        if (open) R.restoreHost.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        if (open && !restorePanel) {
          restorePanel = App.mountRestore(R.restoreHost, {
            onImported: () => {
              // a v16 import has switched the device to automatic mode: continue in the operational web interface
              App.leaveSetup();
              window.location.hash = '#/dashboard';
              window.location.reload();
            },
          });
        }
      },
      next: () => navigate(step + 1),
      previous: () => navigate(step - 1),
      skip: () => finalizeSetup(true), // asks for confirmation first
      restart: () => navigate(0),
      complete: () => finalizeSetup(false),
      abort: () => finalizeSetup(true),
      flowInfo: (e, t) => {
        const f = WIZARD_FLOW[parseInt(t.dataset.i, 10)];
        all('.wiz-flow-node').forEach((n) => n.classList.toggle('active', n === t));
        R.flowInfo.replaceChildren(App.el('b', '', f.name), App.el('span', '', f.text));
      },
      togglePw: (e, t) => {
        const hidden = R.password.type === 'password';
        R.password.type = hidden ? 'text' : 'password';
        t.textContent = hidden ? 'Hide' : 'Show';
      },
    };
    const CHANGES = {
      field: (el) => onFieldChange(el),
      gpioPin: () => onPinSelected(),
    };
    const onClick = (e) => {
      const t = e.target.closest('[data-click]');
      if (t && root.contains(t) && !t.disabled) CLICKS[t.dataset.click]?.(e, t);
    };
    const onChange = (e) => {
      const t = e.target.closest('[data-change]');
      // the embedded editor handles its own change events
      if (t && root.contains(t) && !t.closest('[data-editor]')) CHANGES[t.dataset.change]?.(t);
    };
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);

    /* --------------------------------------------------------- lifecycle */
    (function buildMeterTypeCombo() {
      const sel = R.meterType;
      App.meterTypeOptions().forEach(([value, label]) => sel.add(new Option(label, value)));
      const items = Array.from(sel.options).map((o) => ({ value: o.value, label: o.textContent, lead: logoSvg(METER_TYPE_THEME[Number(o.value)] || 'generic', 24) }));
      meterCombo = App.createCombo(items, () => (meterChosen ? sel.value : ''), (value) => {
        meterChosen = true;
        R.next.disabled = false;
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true })); // recorded like every other field, saved with Next
        meterCombo.sync();
        MeterTheme.apply(Number(value)); // icons and colors follow right away
      });
      meterCombo.placeholder = 'Select your meter type';
      meterCombo.markSelected = true;
      meterCombo.sync();
      meterCombo.el.classList.add('is-wide');
      R.meterCombo.replaceWith(meterCombo.el);
    })();
    (async () => {
      try {
        cfg = await Api.setup.loadConfig();
        if (destroyed) return;
        syncConfigToUI();
        renderStep();
      } catch (err) {
        console.error('Failed to initialize setup:', err);
      }
    })();

    return {
      unmount() {
        if (destroyed) return;
        destroyed = true;
        unmountEditor();
        if (logDialog) logDialog.close();
        restorePanel?.destroy();
        root.removeEventListener('click', onClick);
        root.removeEventListener('change', onChange);
        root.classList.remove('wiz');
        root.innerHTML = '';
      },
    };
  }

  let wizardInstance = null;

  App.register('wizard', {
    title: 'Setup wizard',
    mount(root) {
      wizardInstance = mountWizard(root);
    },
    unmount() {
      if (wizardInstance) wizardInstance.unmount();
      wizardInstance = null;
    },
  });

  /* ======================================================================== */
  /* Public component API                                                     */
  /* ======================================================================== */
  App.setup = { mountEditor };
})();

/* ========================================================================== */
/* View: config                                                               */
/* ========================================================================== */

/* ==========================================================================
   setup view (route #/system/setup and #/system/setup/<section>)
   Part of the single page app. The form is built from a data schema (SCHEMA below, generated from the
   former hand written edit_configuration.html by gen_config_schema.py), not from static markup.
   ========================================================================== */
(function () {
  'use strict';

  const ADVANCED_STORAGE_KEY = 'cfgAdvanced';
  const SECTION_STORAGE_KEY = 'cfgSection2';
  const DEFAULT_SECTION = 'general';
  const SETUP_IMAGE_ROUTE = '#/config/image';
  const REBOOT_ROUTE = '#/system/reboot?now=1'; // the reboot page starts the restart right away with ?now=1
  const REBOOT_DELAY_MS = 500;
  const HELP_HIDE_DELAY_MS = 180;
  const NETWORK_OPMODE_ID = 'network_opmode';
  const ETHERNET_OPTIONS = [['4', 'Ethernet'], ['5', 'Ethernet (Fallback WLAN AP)']];
  const PIN_MODE_ID = 'gpio_gpiopin_0_pinmode';
  const PIN_SELECT_ID = 'gpio_gpiopin_0_gpionumber';
  const FLASH_MAPPING_ID = 'takeimage_flashlightgpiomapping';
  const WLAN_SSID_ID = 'network_wlan_ssid';

  /* ======================================================================== */
  /* Api.config: everything the view needs from the device                    */
  /* ======================================================================== */
  // Phase 2 will replace the legacy endpoints below by JSON /api/* endpoints, only this object changes.
  Api.config = {
    // GET /config (legacy: JSON document of the whole configuration) -> configuration object
    async load() {
      await loadConfig();
      return getConfigFromStorage(0);
    },
    // POST /config[?reload=true] with the changed parameters only (delta object). Throws on failure.
    async save(delta, reload) {
      await saveConfig(JSON.stringify(delta), reload);
    },
    // GET /config?task=reload: apply the stored configuration without restart
    reload() {
      return reloadConfig();
    },
    // GET /wlan?task=scan -> [{ ssid, rssi, channel, authmode }]. Throws on failure.
    async wlanScan() {
      const res = await getWlanNetworks();
      return Object.values((res && res.networks) || {});
    },
    // GET /fileserver/config/models/?list_dir=true -> sorted lower case file names ('dig-class100_0182.tflite')
    async models() {
      const res = await getTfliteFileList();
      return [...(res.files || [])].sort().map((v) => v.toLowerCase());
    },
    // GET /fileserver/config/certs/?list_dir=true -> sorted file names
    async certs() {
      const res = await getCertFileList();
      return [...(res.files || [])].sort();
    },
  };

  /* ======================================================================== */
  /* Schema (generated)                                                       */
  /* ======================================================================== */
  // BEGIN GENERATED SCHEMA (gen_config_schema.py from edit_configuration.html, do not edit by hand, edit the generator)
  const SCHEMA = {
    groups: [
      {"label": "Basics", "sections": [{"id": "general", "label": "General", "cards": ["metertheme", "operation", "time", "webui", "log", "system"]}, {"id": "network", "label": "Network", "cards": ["network"]}]},
      {"label": "Recognition", "sections": [{"id": "recognition", "label": "Recognition", "cards": ["alignment", "digit", "analog", "postprocessing"], "note": true}]},
      {"label": "Integrations", "sections": [{"id": "mqtt", "label": "MQTT", "cards": ["mqtt"]}]},
      {"label": "Advanced", "adv": true, "sections": [{"id": "camera", "label": "Camera", "cards": ["capture"]}, {"id": "gpio", "label": "GPIO", "cards": ["gpio"]}]},
    ],
    // visibility rules: class used by rows (row.show) -> condition. Unknown classes mean "visible".
    // condition: {id, op, v} | {all:[...]} | {any:[...]}. op: == === != > >= < <= in prefix (JS semantics, v keeps its literal type)
    rules: {
      "classvisibility_operationmode_opmode_auto": {"id": "operationmode_opmode", "op": "==", "v": 1},
      "classvisibility_operationmode_opmode_demomode": {"id": "operationmode_opmode", "op": ">=", "v": 0},
      "classvisibility_takeimage_exposurecontrolmode_auto": {"id": "takeimage_camera_exposurecontrolmode", "op": ">", "v": 0},
      "classvisibility_takeimage_exposurecontrolmode_manual": {"id": "takeimage_camera_exposurecontrolmode", "op": "==", "v": 0},
      "classvisibility_takeimage_gaincontrolmode_manual": {"id": "takeimage_camera_gaincontrolmode", "op": "==", "v": 0},
      "classvisibility_takeimage_debug_saverawimages": {"id": "takeimage_debug_saverawimages", "op": "==", "v": "true"},
      "classvisibility_imagealignment_algo_3": {"id": "imagealignment_alignmentalgo", "op": "<", "v": 3},
      "classvisibility_imagealignment_algo_4": {"id": "imagealignment_alignmentalgo", "op": "<", "v": 4},
      "classvisibility_digit_enabled": {"id": "digit_enabled", "op": "==", "v": "true"},
      "classvisibility_digit_debug_saveroiimages": {"id": "digit_debug_saveroiimages", "op": "==", "v": "true"},
      "classvisibility_analog_enabled": {"id": "analog_enabled", "op": "==", "v": "true"},
      "classvisibility_analog_debug_saveroiimages": {"id": "analog_debug_saveroiimages", "op": "==", "v": "true"},
      "classvisibility_postprocessing_maxratechecktype": {"id": "postprocessing_sequence_0_maxratechecktype", "op": ">", "v": "0"},
      "classvisibility_postprocessing_usefallbackvalue": {"id": "postprocessing_sequence_0_usefallbackvalue", "op": "==", "v": "true"},
      "classvisibility_mqtt_enabled": {"id": "mqtt_enabled", "op": "==", "v": "true"},
      "classvisibility_mqtt_authmode_2_ca": {"id": "mqtt_tls_servercertverification", "op": "!=", "v": "0"},
      "classvisibility_mqtt_homeassistant_discoveryenabled": {"id": "mqtt_homeassistant_discoveryenabled", "op": "==", "v": "true"},
      "classvisibility_gpio_customizationenabled": {"id": "gpio_customizationenabled", "op": "==", "v": "true"},
      "classvisibility_gpio_gpiopin_pinenabled": {"id": "gpio_gpiopin_0_pinenabled", "op": "==", "v": "true"},
      "classvisibility_log_data_enabled": {"id": "log_data_enabled", "op": "==", "v": "true"},
      "classvisibility_network_wlan_ipv4_networkconfig": {"id": "network_wlan_ipv4_networkconfig", "op": "==", "v": 1},
      "classvisibility_network_wlan_wlanroaming_enabled": {"id": "network_wlan_wlanroaming_enabled", "op": "==", "v": "true"},
      "classvisibility_network_ethernet_ipv4_networkconfig": {"id": "network_ethernet_ipv4_networkconfig", "op": "==", "v": 1},
      "classvisibility_network_time_ntp_timesyncenabled": {"id": "network_time_ntp_timesyncenabled", "op": "==", "v": "true"},
      "classvisibility_webui_authmode": {"id": "webui_httpauth_authmode", "op": "===", "v": "1"},
      "classvisibility_webui_autorefresh_dashboard_enabled": {"id": "webui_autorefresh_dashboard_enabled", "op": "==", "v": "true"},
      "classvisibility_network_opmode_client": {"id": "network_opmode", "op": "in", "v": ["0", "1"]},
      "classvisibility_network_opmode_ap": {"id": "network_opmode", "op": "in", "v": ["2", "3", "5"]},
      "classvisibility_network_opmode_offdelay": {"id": "network_opmode", "op": "in", "v": ["1", "3"]},
      "classvisibility_network_opmode_ethernet": {"id": "network_opmode", "op": "in", "v": ["4", "5"]},
      "classvisibility_mqtt_authmode_1": {"id": "mqtt_authmode", "op": "in", "v": ["1", "2"]},
      "classvisibility_mqtt_authmode_2": {"id": "mqtt_authmode", "op": "==", "v": "2"},
      "classvisibility_network_time_timesetmanual": {"id": "network_time_ntp_timesyncenabled", "op": "===", "v": "false"},
      "gpio_show_pwm_frequency": {"any": [{"id": "gpio_gpiopin_0_pinmode", "op": "in", "v": ["flashlight-pwm", "output-pwm"]}, {"all": [{"id": "gpio_gpiopin_0_pinmode", "op": "===", "v": "flashlight-default"}, {"id": "@anypwm", "op": "==", "v": true}]}]},
      "gpio_show_capture_mode": {"id": "gpio_gpiopin_0_pinmode", "op": "in", "v": ["input", "input-pullup", "input-pulldown"]},
      "gpio_show_debounce_time": {"any": [{"all": [{"id": "gpio_gpiopin_0_pinmode", "op": "in", "v": ["input", "input-pullup", "input-pulldown"]}, {"id": "gpio_gpiopin_0_capturemode", "op": "!=", "v": "cyclic-polling"}]}, {"id": "gpio_gpiopin_0_pinmode", "op": "in", "v": ["trigger-cycle-start", "resume-wlan-connection"]}]},
      "gpio_show_smartled": {"any": [{"id": "gpio_gpiopin_0_pinmode", "op": "===", "v": "flashlight-smartled"}, {"all": [{"id": "@anysmartled", "op": "==", "v": true}, {"id": "gpio_gpiopin_0_pinmode", "op": "===", "v": "flashlight-default"}]}]},
      "gpio_show_intersity_correction": {"all": [{"id": "gpio_gpiopin_0_pinmode", "op": "prefix", "v": "flashlight"}, {"id": "gpio_gpiopin_0_pinmode", "op": "!=", "v": "flashlight-digital"}]},
      "gpio_show_logiclevel": {"id": "gpio_gpiopin_0_pinmode", "op": "in", "v": ["flashlight-digital", "trigger-cycle-start", "resume-wlan-connection"]},
    },
    cards: [
      {
        "id": "operation", "title": "Operation",
        "rows": [
          {"label": "Operation Mode", "lvl": 1, "id": "operationmode_opmode", "name": "operationmode.opmode", "t": "cards", "opts": [["-1", "Setup"], ["0", "Manual"], ["1", "Automatic"]], "def": "-1", "int": true, "desc": {"-1": "Configure the device. No automatic readings.", "0": "Readings only when you trigger them.", "1": "Readings on a fixed schedule."}},
          {"label": "Automatic Process Interval", "lvl": 2, "show": ["classvisibility_operationmode_opmode_auto"], "id": "operationmode_automaticprocessinterval", "name": "operationmode.automaticprocessinterval", "t": "number", "def": "1.00", "min": 0.01, "step": 0.01, "req": true, "unit": "Minutes"},
          {"h": "Demo Mode", "show": ["classvisibility_operationmode_opmode_demomode"]},
          {"label": "Use Demo Images", "lvl": 1, "show": ["classvisibility_operationmode_opmode_demomode"], "id": "operationmode_usedemoimages", "name": "operationmode.usedemoimages", "t": "switch", "def": "false", "adv": true},
        ],
      },
      {
        "id": "capture", "title": "Image Capturing", "adv": true,
        "rows": [
          {"h": "Flashlight"},
          {"label": "GPIO Mapping", "lvl": 1, "t": "info", "id": "takeimage_flashlightgpiomapping", "adv": true},
          {"label": "Flash Time", "lvl": 1, "id": "takeimage_flashlight_flashtime", "name": "takeimage.flashlight.flashtime", "t": "number", "def": "2000", "min": 100, "step": 100, "req": true, "int": true, "unit": "Milliseconds", "hide": "dup"},
          {"label": "Flash Intensity", "lvl": 1, "id": "takeimage_flashlight_flashintensity", "name": "takeimage.flashlight.flashintensity", "t": "number", "def": "50", "min": 0, "max": 100, "req": true, "int": true, "unit": "%", "hide": "dup"},
          {"h": "Camera"},
          {"label": "Frequency", "lvl": 1, "id": "takeimage_camera_camerafrequency", "name": "takeimage.camera.camerafrequency", "t": "select", "opts": [["20", "20 Mhz"], ["15", "15 Mhz"], ["10", "10 Mhz"], ["8", "8 Mhz"], ["6", "6 Mhz"]], "def": "10", "int": true, "adv": true},
          {"label": "Image Quality", "lvl": 1, "id": "takeimage_camera_imagequality", "name": "takeimage.camera.imagequality", "t": "number", "def": "12", "min": 8, "max": 63, "req": true, "int": true, "adv": true},
          {"label": "Brightness", "lvl": 1, "id": "takeimage_camera_brightness", "name": "takeimage.camera.brightness", "t": "number", "def": "0", "min": -2, "max": 2, "req": true, "int": true, "hide": "dup"},
          {"label": "Contrast", "lvl": 1, "id": "takeimage_camera_contrast", "name": "takeimage.camera.contrast", "t": "number", "def": "0", "min": -2, "max": 2, "req": true, "int": true, "hide": "dup"},
          {"label": "Saturation", "lvl": 1, "id": "takeimage_camera_saturation", "name": "takeimage.camera.saturation", "t": "number", "def": "0", "min": -2, "max": 2, "req": true, "int": true, "hide": "dup"},
          {"label": "Sharpness", "lvl": 1, "id": "takeimage_camera_sharpness", "name": "takeimage.camera.sharpness", "t": "number", "def": "0", "min": -3, "max": 3, "req": true, "int": true, "hide": "dup"},
          {"label": "Exposure Control Mode", "lvl": 1, "id": "takeimage_camera_exposurecontrolmode", "name": "takeimage.camera.exposurecontrolmode", "t": "select", "opts": [["0", "Manual"], ["1", "Auto"], ["2", "Auto (AEC2)"]], "def": "1", "int": true, "hide": "dup"},
          {"label": "Auto Exposure Level", "lvl": 2, "show": ["classvisibility_takeimage_exposurecontrolmode_auto"], "id": "takeimage_camera_autoexposurelevel", "name": "takeimage.camera.autoexposurelevel", "t": "number", "def": "0", "min": -2, "max": 2, "req": true, "int": true, "hide": "dup"},
          {"label": "Manual Exposure Value", "lvl": 2, "show": ["classvisibility_takeimage_exposurecontrolmode_manual"], "id": "takeimage_camera_manualexposurevalue", "name": "takeimage.camera.manualexposurevalue", "t": "number", "def": "300", "min": 0, "max": 1920, "req": true, "int": true, "hide": "dup"},
          {"label": "Gain Control Mode", "lvl": 1, "id": "takeimage_camera_gaincontrolmode", "name": "takeimage.camera.gaincontrolmode", "t": "select", "opts": [["0", "Manual"], ["1", "Auto"]], "def": "1", "int": true, "hide": "dup"},
          {"label": "Manual Gain Value", "lvl": 1, "show": ["classvisibility_takeimage_gaincontrolmode_manual"], "id": "takeimage_camera_manualgainvalue", "name": "takeimage.camera.manualgainvalue", "t": "number", "def": "0", "min": 0, "max": 30, "req": true, "int": true, "hide": "dup"},
          {"label": "Special Effect", "lvl": 1, "id": "takeimage_camera_specialeffect", "name": "takeimage.camera.specialeffect", "t": "select", "opts": [["0", "None"], ["1", "Negative"], ["2", "Grayscale"], ["7", "Gray+Negative"]], "def": "0", "int": true, "hide": "dup"},
          {"label": "Mirror Image", "lvl": 1, "id": "takeimage_camera_mirrorimage", "name": "takeimage.camera.mirrorimage", "t": "switch", "def": "false", "hide": "dup"},
          {"label": "Flip Image", "lvl": 1, "id": "takeimage_camera_flipimage", "name": "takeimage.camera.flipimage", "t": "switch", "def": "false", "hide": "dup"},
          {"label": "Zoom Factor", "lvl": 1, "id": "takeimage_camera_zoomfactor", "name": "takeimage.camera.zoomfactor", "t": "number", "def": "1000", "min": 1000, "max": 4000, "req": true, "int": true, "unit": "/ 1000x", "hide": "dup"},
          {"label": "Zoom Offset X", "lvl": 2, "show": ["classvisibility_takeimage_zoommode"], "id": "takeimage_camera_zoomoffsetx", "name": "takeimage.camera.zoomoffsetx", "t": "number", "def": "0", "min": 0, "max": 960, "req": true, "int": true, "unit": "Pixel", "hide": "dup"},
          {"label": "Zoom Offset Y", "lvl": 2, "show": ["classvisibility_takeimage_zoommode"], "id": "takeimage_camera_zoomoffsety", "name": "takeimage.camera.zoomoffsety", "t": "number", "def": "0", "min": 0, "max": 720, "req": true, "int": true, "unit": "Pixel", "hide": "dup"},
          {"h": "Debug"},
          {"label": "Save Raw Images", "lvl": 1, "id": "takeimage_debug_saverawimages", "name": "takeimage.debug.saverawimages", "t": "switch", "def": "false", "adv": true},
          {"label": "Raw Images Location", "lvl": 2, "show": ["classvisibility_takeimage_debug_saverawimages"], "id": "takeimage_debug_rawimageslocation", "name": "takeimage.debug.rawimageslocation", "t": "text", "req": true},
          {"label": "Raw Images Retention", "lvl": 2, "show": ["classvisibility_takeimage_debug_saverawimages"], "id": "takeimage_debug_rawimagesretention", "name": "takeimage.debug.rawimagesretention", "t": "number", "def": "5", "min": 0, "ph": "/log/source", "req": true, "int": true, "unit": "Days"},
        ],
      },
      {
        "id": "alignment", "title": "Image Alignment",
        "rows": [
          {"label": "Alignment Algorithm", "lvl": 1, "id": "imagealignment_alignmentalgo", "name": "imagealignment.alignmentalgo", "t": "select", "opts": [["0", "Rotate + Align (SAD:1CH)"], ["1", "Rotate + Align (SAD:3CH)"], ["2", "Rotate + Align (SAD:1CH + Similarity)*"], ["3", "Rotate only"], ["4", "Off"]], "def": "0", "int": true},
          {"label": "Search Field X", "lvl": 2, "show": ["classvisibility_imagealignment_algo_3"], "id": "imagealignment_searchfield_x", "name": "imagealignment.searchfield.x", "t": "number", "def": "20", "min": 1, "req": true, "int": true, "unit": "Pixel", "adv": true},
          {"label": "Search Field Y", "lvl": 2, "show": ["classvisibility_imagealignment_algo_3"], "id": "imagealignment_searchfield_y", "name": "imagealignment.searchfield.y", "t": "number", "def": "20", "min": 1, "req": true, "int": true, "unit": "Pixel", "adv": true},
          {"label": "Image Rotation", "lvl": 1, "show": ["classvisibility_imagealignment_algo_3", "classvisibility_imagealignment_algo_4"], "id": "imagealignment_imagerotation", "name": "imagealignment.imagerotation", "t": "number", "def": "0.0", "min": -180.0, "max": 180.0, "step": 0.1, "req": true, "unit": "Degree", "hide": "dup"},
          {"h": "Debug"},
          {"label": "Save Debug Info", "lvl": 1, "id": "imagealignment_debug_savedebuginfo", "name": "imagealignment.debug.savedebuginfo", "t": "switch", "def": "false", "adv": true},
        ],
      },
      {
        "id": "digit", "title": "Digit ROI Processing",
        "enable": {"id": "digit_enabled", "name": "digit.enabled", "t": "switch", "def": "false", "strong": true},
        "rows": [
          {"label": "Model", "lvl": 1, "show": ["classvisibility_digit_enabled"], "id": "digit_model", "name": "digit.model", "t": "select", "wide": true, "req": true, "opts": "models:dig", "dyn": true},
          {"h": "Debug", "show": ["classvisibility_digit_enabled"]},
          {"label": "Save ROI Images", "lvl": 1, "show": ["classvisibility_digit_enabled"], "id": "digit_debug_saveroiimages", "name": "digit.debug.saveroiimages", "t": "switch", "def": "false", "adv": true},
          {"label": "ROI Images Location", "lvl": 2, "show": ["classvisibility_digit_enabled", "classvisibility_digit_debug_saveroiimages"], "id": "digit_debug_roiimageslocation", "name": "digit.debug.roiimageslocation", "t": "text", "req": true},
          {"label": "ROI Images Retention", "lvl": 2, "show": ["classvisibility_digit_enabled", "classvisibility_digit_debug_saveroiimages"], "id": "digit_debug_roiimagesretention", "name": "digit.debug.roiimagesretention", "t": "number", "def": "5", "min": 0, "ph": "/log/digit", "req": true, "int": true, "unit": "Days"},
          {"label": "ROI Images Saving Size", "lvl": 2, "show": ["classvisibility_digit_enabled", "classvisibility_digit_debug_saveroiimages"], "id": "digit_debug_roisavingsize", "name": "digit.debug.roisavingsize", "t": "select", "opts": [["0", "Full"], ["1", "Resized"], ["2", "Full + Resized"]], "def": "0", "int": true},
        ],
      },
      {
        "id": "analog", "title": "Analog ROI Processing",
        "enable": {"id": "analog_enabled", "name": "analog.enabled", "t": "switch", "def": "false", "strong": true},
        "rows": [
          {"label": "Model", "lvl": 1, "show": ["classvisibility_analog_enabled"], "id": "analog_model", "name": "analog.model", "t": "select", "wide": true, "req": true, "opts": "models:ana", "dyn": true},
          {"h": "Debug", "show": ["classvisibility_analog_enabled"]},
          {"label": "Save ROI Images", "lvl": 1, "show": ["classvisibility_analog_enabled"], "id": "analog_debug_saveroiimages", "name": "analog.debug.saveroiimages", "t": "switch", "def": "false", "adv": true},
          {"label": "ROI Images Location", "lvl": 2, "show": ["classvisibility_analog_enabled", "classvisibility_analog_debug_saveroiimages"], "id": "analog_debug_roiimageslocation", "name": "analog.debug.roiimageslocation", "t": "text", "ph": "/log/analog", "req": true},
          {"label": "ROI Images Retention", "lvl": 2, "show": ["classvisibility_analog_enabled", "classvisibility_analog_debug_saveroiimages"], "id": "analog_debug_roiimagesretention", "name": "analog.debug.roiimagesretention", "t": "number", "def": "5", "min": 0, "req": true, "int": true, "unit": "Days"},
          {"label": "ROI Images Saving Size", "lvl": 2, "show": ["classvisibility_analog_enabled", "classvisibility_analog_debug_saveroiimages"], "id": "analog_debug_roisavingsize", "name": "analog.debug.roisavingsize", "t": "select", "opts": [["0", "Full"], ["1", "Resized"], ["2", "Full + Resized"]], "def": "0", "int": true},
        ],
      },
      {
        "id": "postprocessing", "title": "Post-Processing",
        "rows": [
          {"label": "Parameter per number sequence", "id": "postprocessing_sequence_0_sequencename", "name": "postprocessing.sequence.{i}.sequencename", "ix": "seq", "t": "select", "strong": true, "sel": "seq", "opts": "sequences"},
          {"label": "Dial-to-Wheel Detune", "lvl": 1, "id": "postprocessing_sequence_0_analogdigitsyncvalue", "name": "postprocessing.sequence.{i}.analogdigitsyncvalue", "ix": "seq", "t": "number", "def": "9.2", "min": 6.0, "max": 9.9, "step": 0.1, "req": true, "with": [["postprocessing_sequence_0_sequencename", false]]},
          {"label": "Decimal Scaling (10<sup>n</sup>)", "lvl": 1, "id": "postprocessing_sequence_0_decimalshift", "name": "postprocessing.sequence.{i}.decimalshift", "ix": "seq", "t": "number", "def": "0", "min": -9, "max": 9, "req": true, "int": true, "with": [["postprocessing_sequence_0_sequencename", false]]},
          {"label": "Extended Resolution", "lvl": 1, "id": "postprocessing_sequence_0_extendedresolution", "name": "postprocessing.sequence.{i}.extendedresolution", "ix": "seq", "t": "switch", "def": "true", "with": [["postprocessing_sequence_0_sequencename", false]]},
          {"label": "Allow Negative Rate / Flow", "lvl": 1, "id": "postprocessing_sequence_0_allownegativerate", "name": "postprocessing.sequence.{i}.allownegativerate", "ix": "seq", "t": "switch", "def": "false", "with": [["postprocessing_sequence_0_sequencename", false]]},
          {"label": "Max Rate Check Type", "lvl": 1, "id": "postprocessing_sequence_0_maxratechecktype", "name": "postprocessing.sequence.{i}.maxratechecktype", "ix": "seq", "t": "select", "opts": [["0", "No Rate Check"], ["1", "Rate Per Minute"], ["2", "Rate Per Interval"]], "def": "1", "int": true, "with": [["postprocessing_sequence_0_sequencename", false]]},
          {"label": "Max Rate", "lvl": 2, "show": ["classvisibility_postprocessing_maxratechecktype"], "id": "postprocessing_sequence_0_maxrate", "name": "postprocessing.sequence.{i}.maxrate", "ix": "seq", "t": "number", "def": "0.150", "min": 0.001, "step": 0.001, "req": true, "with": [["postprocessing_sequence_0_sequencename", false]]},
          {"label": "Use Fallback Value", "lvl": 1, "id": "postprocessing_sequence_0_usefallbackvalue", "name": "postprocessing.sequence.{i}.usefallbackvalue", "ix": "seq", "t": "switch", "def": "true", "with": [["postprocessing_sequence_0_sequencename", false]]},
          {"label": "Max. Age of Fallback Value", "lvl": 2, "show": ["classvisibility_postprocessing_usefallbackvalue"], "id": "postprocessing_sequence_0_fallbackvalueagestartup", "name": "postprocessing.sequence.{i}.fallbackvalueagestartup", "ix": "seq", "t": "number", "def": "720", "min": 0, "req": true, "int": true, "unit": "Minutes", "with": [["postprocessing_sequence_0_sequencename", false]]},
          {"h": "Debug"},
          {"label": "Save Debug Info", "lvl": 1, "id": "postprocessing_debug_savedebuginfo", "name": "postprocessing.debug.savedebuginfo", "t": "switch", "def": "false", "adv": true},
        ],
      },
      {
        "id": "mqtt", "title": "MQTT",
        "enable": {"id": "mqtt_enabled", "name": "mqtt.enabled", "t": "switch", "def": "false", "strong": true},
        "rows": [
          {"label": "URI", "lvl": 1, "show": ["classvisibility_mqtt_enabled"], "id": "mqtt_uri", "name": "mqtt.uri", "t": "text", "ph": "mqtt(s)://mqtt-server:1883", "req": true},
          {"label": "Main Topic", "lvl": 1, "show": ["classvisibility_mqtt_enabled"], "id": "mqtt_maintopic", "name": "mqtt.maintopic", "t": "text", "ph": "watermeter", "req": true},
          {"label": "Client ID", "lvl": 1, "show": ["classvisibility_mqtt_enabled"], "id": "mqtt_clientid", "name": "mqtt.clientid", "t": "text", "ph": "watermeter", "maxlen": 23, "pattern": "^[A-Za-z0-9]+$", "req": true, "adv": true},
          {"label": "Authentication / Security", "lvl": 1, "show": ["classvisibility_mqtt_enabled"], "id": "mqtt_authmode", "name": "mqtt.authmode", "t": "select", "opts": [["0", "None"], ["1", "Basic"], ["2", "TLS"]], "def": "0", "int": true, "with": [["mqtt_tls_cacert", false], ["mqtt_tls_clientcert", false], ["mqtt_tls_clientkey", false]], "withWhen": {"v": "2", "ids": ["mqtt_tls_cacert", "mqtt_tls_clientcert", "mqtt_tls_clientkey"]}},
          {"label": "Username", "lvl": 2, "show": ["classvisibility_mqtt_enabled", "classvisibility_mqtt_authmode_1"], "id": "mqtt_username", "name": "mqtt.username", "t": "text"},
          {"label": "Password", "lvl": 2, "show": ["classvisibility_mqtt_enabled", "classvisibility_mqtt_authmode_1"], "id": "mqtt_password", "name": "mqtt.password", "t": "password", "auto": "on"},
          {"label": "Server Certificate Verification", "lvl": 2, "show": ["classvisibility_mqtt_enabled", "classvisibility_mqtt_authmode_2"], "id": "mqtt_tls_servercertverification", "name": "mqtt.tls.servercertverification", "t": "select", "opts": [["0", "Disabled"], ["1", "Enabled (No Name Validation)"], ["2", "Enabled"]], "def": "2", "int": true, "adv": true},
          {"label": "CA Certificate", "lvl": 2, "show": ["classvisibility_mqtt_enabled", "classvisibility_mqtt_authmode_2", "classvisibility_mqtt_authmode_2_ca"], "id": "mqtt_tls_cacert", "name": "mqtt.tls.cacert", "t": "select", "wide": true, "opts": "certs:ca", "dyn": true},
          {"label": "Client Certificate", "lvl": 2, "show": ["classvisibility_mqtt_enabled", "classvisibility_mqtt_authmode_2"], "id": "mqtt_tls_clientcert", "name": "mqtt.tls.clientcert", "t": "select", "wide": true, "opts": "certs:none", "dyn": true},
          {"label": "Client Key", "lvl": 2, "show": ["classvisibility_mqtt_enabled", "classvisibility_mqtt_authmode_2"], "id": "mqtt_tls_clientkey", "name": "mqtt.tls.clientkey", "t": "select", "wide": true, "opts": "certs:none", "dyn": true},
          {"label": "Process Data Notation", "lvl": 1, "show": ["classvisibility_mqtt_enabled"], "id": "mqtt_processdatanotation", "name": "mqtt.processdatanotation", "t": "select", "opts": [["0", "JSON Topic"], ["1", "Single Topics"], ["2", "JSON + Topics"]], "def": "0", "int": true},
          {"label": "Retain Process Data", "lvl": 1, "show": ["classvisibility_mqtt_enabled"], "id": "mqtt_retainprocessdata", "name": "mqtt.retainprocessdata", "t": "switch", "def": "true", "adv": true},
          {"label": "Home Assistant Discovery", "lvl": 1, "show": ["classvisibility_mqtt_enabled"], "id": "mqtt_homeassistant_discoveryenabled", "name": "mqtt.homeassistant.discoveryenabled", "t": "switch", "def": "false"},
          {"label": "Discovery Prefix", "lvl": 2, "show": ["classvisibility_mqtt_enabled", "classvisibility_mqtt_homeassistant_discoveryenabled"], "id": "mqtt_homeassistant_discoveryprefix", "name": "mqtt.homeassistant.discoveryprefix", "t": "text", "ph": "homeassistant", "req": true, "adv": true},
          {"label": "Status Topic", "lvl": 2, "show": ["classvisibility_mqtt_enabled", "classvisibility_mqtt_homeassistant_discoveryenabled"], "id": "mqtt_homeassistant_statustopic", "name": "mqtt.homeassistant.statustopic", "t": "text", "ph": "homeassistant/status", "req": true, "adv": true},
          {"label": "Retain Discovery Topics", "lvl": 2, "show": ["classvisibility_mqtt_enabled", "classvisibility_mqtt_homeassistant_discoveryenabled"], "id": "mqtt_homeassistant_retaindiscovery", "name": "mqtt.homeassistant.retaindiscovery", "t": "switch", "def": "false", "adv": true},
        ],
      },
      {
        "id": "gpio", "title": "GPIO Pin Customization", "adv": true,
        "enable": {"id": "gpio_customizationenabled", "name": "gpio.customizationenabled", "t": "switch", "def": "false", "strong": true},
        "rows": [
          {"label": "Pin Selection", "show": ["classvisibility_gpio_customizationenabled"], "id": "gpio_gpiopin_0_gpionumber", "name": "gpio.gpiopin.{i}.gpionumber", "ix": "pin", "t": "select", "strong": true, "int": true, "sel": "pin", "opts": "pins"},
          {"label": "Pin Status", "show": ["classvisibility_gpio_customizationenabled"], "id": "gpio_gpiopin_0_pinenabled", "name": "gpio.gpiopin.{i}.pinenabled", "ix": "pin", "t": "switch", "def": "false", "with": [["gpio_gpiopin_0_gpionumber", true]]},
          {"label": "Pin Mode", "lvl": 1, "show": ["classvisibility_gpio_customizationenabled", "classvisibility_gpio_gpiopin_pinenabled"], "usageWarn": true, "id": "gpio_gpiopin_0_pinmode", "name": "gpio.gpiopin.{i}.pinmode", "ix": "pin", "t": "select", "opts": [["flashlight-default", "Flashlight Default"], ["flashlight-pwm", "Flashlight PWM"], ["flashlight-smartled", "Flashlight Smartled"], ["flashlight-digital", "Flashlight Digital"], ["input", "Input"], ["input-pullup", "Input Pullup"], ["input-pulldown", "Input Pulldown"], ["output", "Output"], ["output-pwm", "Output PWM"], ["trigger-cycle-start", "Trigger Cycle Start"], ["resume-wlan-connection", "Resume WLAN Connection"]], "def": "input", "with": [["gpio_gpiopin_0_gpionumber", true]]},
          {"label": "Pin Capture Mode", "lvl": 1, "show": ["classvisibility_gpio_customizationenabled", "classvisibility_gpio_gpiopin_pinenabled", "gpio_show_capture_mode"], "id": "gpio_gpiopin_0_capturemode", "name": "gpio.gpiopin.{i}.capturemode", "ix": "pin", "t": "select", "opts": [["cyclic-polling", "Cyclic Polling"], ["interrupt-rising-edge", "Interrupt Rising Edge"], ["interrupt-falling-edge", "Interrupt Falling Edge"], ["interrupt-rising-falling", "Interrupt Rising+Falling"]], "def": "cyclic-polling", "with": [["gpio_gpiopin_0_gpionumber", true]]},
          {"label": "Input Debounce Time", "lvl": 1, "show": ["classvisibility_gpio_customizationenabled", "classvisibility_gpio_gpiopin_pinenabled", "gpio_show_debounce_time"], "id": "gpio_gpiopin_0_inputdebouncetime", "name": "gpio.gpiopin.{i}.inputdebouncetime", "ix": "pin", "t": "number", "def": "500", "min": 0, "max": 5000, "req": true, "int": true, "unit": "ms", "with": [["gpio_gpiopin_0_gpionumber", true]]},
          {"label": "Pin PWM Frequency", "lvl": 1, "show": ["classvisibility_gpio_customizationenabled", "classvisibility_gpio_gpiopin_pinenabled", "gpio_show_pwm_frequency"], "id": "gpio_gpiopin_0_pwmfrequency", "name": "gpio.gpiopin.{i}.pwmfrequency", "ix": "pin", "t": "number", "def": "5000", "min": 5, "max": 1000000, "req": true, "int": true, "unit": "Hz", "with": [["gpio_gpiopin_0_gpionumber", true]]},
          {"label": "Pin Logic Level", "lvl": 1, "show": ["classvisibility_gpio_customizationenabled", "classvisibility_gpio_gpiopin_pinenabled", "gpio_show_logiclevel"], "id": "gpio_gpiopin_0_logicactivelow", "name": "gpio.gpiopin.{i}.logicactivelow", "ix": "pin", "t": "select", "opts": [["false", "Active High"], ["true", "Active Low"]], "def": "false", "with": [["gpio_gpiopin_0_gpionumber", true]]},
          {"label": "Pin Name", "lvl": 1, "show": ["classvisibility_gpio_customizationenabled", "classvisibility_gpio_gpiopin_pinenabled"], "id": "gpio_gpiopin_0_pinname", "name": "gpio.gpiopin.{i}.pinname", "ix": "pin", "t": "text", "ph": "gpioX", "with": [["gpio_gpiopin_0_gpionumber", true]]},
          {"label": "LED Type", "lvl": 1, "show": ["classvisibility_gpio_customizationenabled", "classvisibility_gpio_gpiopin_pinenabled", "gpio_show_smartled"], "id": "gpio_gpiopin_0_smartled_type", "name": "gpio.gpiopin.{i}.smartled.type", "ix": "pin", "t": "select", "opts": [["0", "WS2812"], ["1", "WS2812B (universal)"], ["2", "WS2812B (newer variant)"], ["3", "WS2812B (older variant)"], ["4", "SK6812"], ["5", "WS2813"]], "def": "0", "int": true, "with": [["gpio_gpiopin_0_gpionumber", true]]},
          {"label": "LED Color (RGB)", "lvl": 1, "show": ["classvisibility_gpio_customizationenabled", "classvisibility_gpio_gpiopin_pinenabled", "gpio_show_smartled"], "with": [["gpio_gpiopin_0_gpionumber", true]], "t": "multi", "id": "gpio_gpiopin_0_smartled", "fields": [{"id": "gpio_gpiopin_0_smartled_colorredchannel", "name": "gpio.gpiopin.{i}.smartled.colorredchannel", "ix": "pin", "t": "number", "def": "255", "min": 0, "max": 255, "req": true, "int": true, "pre": "R"}, {"id": "gpio_gpiopin_0_smartled_colorgreenchannel", "name": "gpio.gpiopin.{i}.smartled.colorgreenchannel", "ix": "pin", "t": "number", "def": "255", "min": 0, "max": 255, "req": true, "int": true, "pre": "G"}, {"id": "gpio_gpiopin_0_smartled_colorbluechannel", "name": "gpio.gpiopin.{i}.smartled.colorbluechannel", "ix": "pin", "t": "number", "def": "255", "min": 0, "max": 255, "req": true, "int": true, "pre": "B"}], "ix": "pin"},
          {"label": "LED Intensity Correction", "lvl": 1, "show": ["classvisibility_gpio_customizationenabled", "classvisibility_gpio_gpiopin_pinenabled", "gpio_show_smartled", "gpio_show_intersity_correction"], "id": "gpio_gpiopin_0_intensitycorrectionfactor", "name": "gpio.gpiopin.{i}.intensitycorrectionfactor", "ix": "pin", "t": "number", "def": "100", "min": 1, "max": 100, "req": true, "int": true, "unit": "%", "with": [["gpio_gpiopin_0_gpionumber", true]]},
        ],
      },
      {
        "id": "log", "title": "Log", "adv": true,
        "rows": [
          {"h": "Debug"},
          {"label": "Log Level", "lvl": 1, "id": "log_debug_loglevel", "name": "log.debug.loglevel", "t": "select", "opts": [["1", "Error"], ["2", "Warning"], ["3", "Info"], ["4", "Debug"]], "def": "2", "int": true},
          {"label": "Log Files Retention", "lvl": 1, "id": "log_debug_logfilesretention", "name": "log.debug.logfilesretention", "t": "number", "def": "5", "min": 0, "req": true, "int": true, "unit": "Days"},
          {"label": "Debug Files Retention", "lvl": 1, "id": "log_debug_debugfilesretention", "name": "log.debug.debugfilesretention", "t": "number", "def": "5", "min": 0, "req": true, "int": true, "unit": "Days"},
          {"h": "Data"},
          {"label": "Data Log", "lvl": 1, "id": "log_data_enabled", "name": "log.data.enabled", "t": "switch", "def": "false"},
          {"label": "Data Files Retention", "lvl": 2, "show": ["classvisibility_log_data_enabled"], "id": "log_data_datafilesretention", "name": "log.data.datafilesretention", "t": "number", "def": "30", "min": 0, "req": true, "int": true, "unit": "Days"},
        ],
      },
      {
        "id": "network", "title": "Network",
        "rows": [
          {"label": "Operation Mode", "lvl": 1, "id": "network_opmode", "name": "network.opmode", "t": "select", "opts": [["-1", "Disabled"], ["0", "WLAN Client"], ["1", "WLAN Client (Timed-Off)"], ["2", "WLAN Access Point"], ["3", "WLAN Access Point (Timed-Off)"]], "def": "0", "int": true, "reboot": true},
          {"label": "Timed-Off Delay", "lvl": 2, "show": ["classvisibility_network_opmode_offdelay"], "id": "network_timedoffdelay", "name": "network.timedoffdelay", "t": "number", "def": "60", "min": 1, "req": true, "int": true, "unit": "Minutes"},
          {"label": "Hostname", "lvl": 1, "id": "network_hostname", "name": "network.hostname", "t": "text", "ph": "watermeter", "req": true, "reboot": true},
          {"h": "WLAN Client Configuration", "show": ["classvisibility_network_opmode_client"]},
          {"label": "SSID", "lvl": 1, "show": ["classvisibility_network_opmode_client"], "id": "network_wlan_ssid", "name": "network.wlan.ssid", "t": "text", "ph": "SSID Name Access Point", "maxlen": 32, "req": true, "reboot": true, "scan": true},
          {"label": "Password", "lvl": 1, "show": ["classvisibility_network_opmode_client"], "id": "network_wlan_password", "name": "network.wlan.password", "t": "password", "auto": "on", "reboot": true},
          {"label": "Network Configuration", "lvl": 1, "show": ["classvisibility_network_opmode_client"], "id": "network_wlan_ipv4_networkconfig", "name": "network.wlan.ipv4.networkconfig", "t": "select", "opts": [["0", "DHCP"], ["1", "Static"]], "def": "0", "int": true, "reboot": true},
          {"label": "IP Address", "lvl": 2, "show": ["classvisibility_network_opmode_client", "classvisibility_network_wlan_ipv4_networkconfig"], "id": "network_wlan_ipv4_ipaddress", "name": "network.wlan.ipv4.ipaddress", "t": "ip", "ph": "192.168.xxx.xxx", "req": true, "reboot": true},
          {"label": "Subnet Mask", "lvl": 2, "show": ["classvisibility_network_opmode_client", "classvisibility_network_wlan_ipv4_networkconfig"], "id": "network_wlan_ipv4_subnetmask", "name": "network.wlan.ipv4.subnetmask", "t": "ip", "ph": "255.255.255.0", "req": true, "reboot": true},
          {"label": "Gateway Address", "lvl": 2, "show": ["classvisibility_network_opmode_client", "classvisibility_network_wlan_ipv4_networkconfig"], "id": "network_wlan_ipv4_gatewayaddress", "name": "network.wlan.ipv4.gatewayaddress", "t": "ip", "ph": "192.168.xxx.xxx", "req": true, "reboot": true},
          {"label": "DNS Server", "lvl": 2, "show": ["classvisibility_network_opmode_client", "classvisibility_network_wlan_ipv4_networkconfig"], "id": "network_wlan_ipv4_dnsserver", "name": "network.wlan.ipv4.dnsserver", "t": "ip", "ph": "192.168.xxx.xxx", "reboot": true},
          {"label": "Roaming", "lvl": 1, "show": ["classvisibility_network_opmode_client"], "id": "network_wlan_wlanroaming_enabled", "name": "network.wlan.wlanroaming.enabled", "t": "switch", "def": "false", "adv": true},
          {"label": "RSSI Threshold", "lvl": 2, "show": ["classvisibility_network_opmode_client", "classvisibility_network_wlan_wlanroaming_enabled"], "id": "network_wlan_wlanroaming_rssithreshold", "name": "network.wlan.wlanroaming.rssithreshold", "t": "number", "def": "-75", "min": -100, "max": 0, "req": true, "int": true, "unit": "dBm"},
          {"h": "WLAN Access Point Configuration", "show": ["classvisibility_network_opmode_ap", "classvisibility_network_wlan_fallbackap"]},
          {"label": "SSID", "lvl": 1, "show": ["classvisibility_network_opmode_ap", "classvisibility_network_wlan_fallbackap"], "id": "network_wlanap_ssid", "name": "network.wlanap.ssid", "t": "text", "ph": "AI-on-the-Edge Device", "maxlen": 32, "reboot": true},
          {"label": "Password", "lvl": 1, "show": ["classvisibility_network_opmode_ap", "classvisibility_network_wlan_fallbackap"], "id": "network_wlanap_password", "name": "network.wlanap.password", "t": "password", "minlen": 8, "auto": "on", "reboot": true},
          {"label": "Channel", "lvl": 1, "show": ["classvisibility_network_opmode_ap", "classvisibility_network_wlan_fallbackap"], "id": "network_wlanap_channel", "name": "network.wlanap.channel", "t": "number", "def": "11", "min": 1, "max": 14, "int": true, "reboot": true},
          {"label": "IP Address", "lvl": 1, "show": ["classvisibility_network_opmode_ap", "classvisibility_network_wlan_fallbackap"], "id": "network_wlanap_ipv4_ipaddress", "name": "network.wlanap.ipv4.ipaddress", "t": "ip", "ph": "192.168.4.1", "reboot": true},
          {"h": "Ethernet Configuration", "show": ["classvisibility_network_opmode_ethernet"]},
          {"label": "Network Configuration", "lvl": 1, "show": ["classvisibility_network_opmode_ethernet"], "id": "network_ethernet_ipv4_networkconfig", "name": "network.ethernet.ipv4.networkconfig", "t": "select", "opts": [["0", "DHCP"], ["1", "Static"]], "def": "0", "int": true, "reboot": true},
          {"label": "IP Address", "lvl": 2, "show": ["classvisibility_network_opmode_ethernet", "classvisibility_network_ethernet_ipv4_networkconfig"], "id": "network_ethernet_ipv4_ipaddress", "name": "network.ethernet.ipv4.ipaddress", "t": "ip", "ph": "192.168.xxx.xxx", "req": true, "reboot": true},
        ],
      },
      {
        "id": "time", "title": "Time",
        "rows": [
          {"label": "Set Time", "lvl": 0, "show": ["classvisibility_network_time_timesetmanual"], "id": "network_time_timesetmanual", "name": "network.time.timesetmanual", "t": "datetime", "ph": "YYYY-MM-DDTHH:MM:SS", "noload": true},
          {"label": "Time Zone", "lvl": 0, "id": "network_time_timezone", "name": "network.time.timezone", "t": "select", "opts": "timezones", "tz": true, "def": "CET-1CEST,M3.5.0,M10.5.0/3", "wide": true, "req": true},
          {"label": "Time Synchronization", "lvl": 0, "id": "network_time_ntp_timesyncenabled", "name": "network.time.ntp.timesyncenabled", "t": "switch", "def": "true"},
          {"label": "Time Server (NTP)", "lvl": 1, "show": ["classvisibility_network_time_ntp_timesyncenabled"], "id": "network_time_ntp_timeserver", "name": "network.time.ntp.timeserver", "t": "text", "ph": "pool.ntp.org"},
          {"label": "Process Start Interlock", "lvl": 0, "id": "network_time_processstartinterlock", "name": "network.time.processstartinterlock", "t": "switch", "def": "true", "adv": true},
        ],
      },
      {
        "id": "system", "title": "System", "adv": true,
        "rows": [
          {"label": "CPU Frequency", "lvl": 1, "id": "system_cpufrequency", "name": "system.cpufrequency", "t": "select", "opts": [["160", "160 MHz"], ["240", "240 MHz"]], "def": "160", "int": true, "reboot": true},
        ],
      },
      {
        "id": "metertheme", "title": "Meter Type & Theme",
        "rows": [
          {"label": "Meter Type", "lvl": 0, "id": "mqtt_homeassistant_metertype", "name": "mqtt.homeassistant.metertype", "t": "select", "opts": [["0", "Generic (No Units)"], ["1", "Water (Value: mÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³, Rate: mÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³/h)"], ["2", "Water (Value: L, Rate: L/h*)"], ["15", "Water (Value: L, Rate: L/min)"], ["3", "Water (Value: gal, Rate: gal/h*)"], ["16", "Water (Value: gal, Rate: gal/min)"], ["4", "Water (Value: ftÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³, Rate: ftÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³/min)"], ["5", "Gas (Value: mÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³, Rate: mÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³/h)"], ["6", "Gas (Value: ftÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³, Rate: ftÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³/min)"], ["7", "Energy (Value: Wh, Rate: W)"], ["8", "Energy (Value: kWh, Rate: kW)"], ["9", "Energy (Value: MWh, Rate: MW)"], ["10", "Energy (Value: GJ, Rate: GJ/h*)"], ["11", "Temperature (Value: ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°C, Rate: ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°C/min)"], ["12", "Temperature (Value: ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°F, Rate: ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°F/min)"], ["13", "Pressure (Value: bar, Rate: bar/min)"], ["14", "Pressure (Value: psi, Rate: psi/min)"]], "def": "1", "wide": true, "int": true},
        ],
      },
      {
        "id": "webui", "title": "WebUI",
        "rows": [
          {"label": "Authentication", "lvl": 1, "id": "webui_httpauth_authmode", "name": "webui.httpauth.authmode", "t": "switch", "on": "1", "off": "0", "def": "0", "int": true},
          {"label": "Username", "lvl": 2, "show": ["classvisibility_webui_authmode"], "id": "webui_httpauth_username", "name": "webui.httpauth.username", "t": "text"},
          {"label": "Password", "lvl": 2, "show": ["classvisibility_webui_authmode"], "id": "webui_httpauth_password", "name": "webui.httpauth.password", "t": "password", "auto": "on"},
          {"h": "Dashboard"},
          {"label": "Page Auto Refresh", "lvl": 1, "id": "webui_autorefresh_dashboard_enabled", "name": "webui.autorefresh.dashboard.enabled", "t": "switch", "def": "true", "hide": "obsolete"},
          {"label": "Refresh Time", "lvl": 2, "show": ["classvisibility_webui_autorefresh_dashboard_enabled"], "id": "webui_autorefresh_dashboard_refreshtime", "name": "webui.autorefresh.dashboard.refreshtime", "t": "number", "def": "5", "min": 1, "req": true, "int": true, "unit": "Seconds", "hide": "obsolete"},
        ],
      },
    ],
  };
  // END GENERATED SCHEMA

  /* ======================================================================== */
  /* Context help: plain-language explanation per parameter                   */
  /* ======================================================================== */
  const PARAM_HELP = {
    // ---- General
    operationmode_opmode: {
      title: 'Operation mode',
      text: 'Decides when the device takes and evaluates pictures.',
      options: {
        '-1': ['Setup', 'No automatic readings. Use this while you set up camera, markers and regions.'],
        '0': ['Manual', 'A reading is only taken when you trigger it (dashboard, REST API or MQTT).'],
        '1': ['Automatic', 'A reading is taken on a fixed schedule, see Automatic Process Interval.'],
      },
    },
    operationmode_automaticprocessinterval: {
      title: 'Automatic process interval',
      text: 'How often the device takes a picture and evaluates it, in minutes.',
      now: (g) => {
        const v = parseFloat(g('operationmode_automaticprocessinterval'));
        return v > 0 ? 'Every ' + v + ' min means about ' + Math.round(1440 / v) + ' readings per day.' : '';
      },
      tip: 'If an evaluation takes longer than the interval, the next one starts right after the previous one has finished. 1 to 5 minutes is usual for water and gas.',
    },
    operationmode_usedemoimages: {
      title: 'Use demo images',
      text: 'Evaluates built-in demo pictures instead of the camera. Handy to test the recognition without a meter.',
    },
    webui_httpauth_authmode: {
      title: 'Web interface protection',
      text: 'Asks for a username and password before the web interface and the API can be used.',
      now: (g) => (g('webui_httpauth_authmode') === '1' ? 'Protection is on: you must log in with the credentials below.' : 'Protection is off: anyone in your network can open and change settings.'),
      tip: 'The login is sent unencrypted over HTTP. It keeps casual visitors out, but use it only inside your own network.',
    },
    webui_httpauth_username: { title: 'Username', text: 'The name you log in with.' },
    webui_httpauth_password: { title: 'Password', text: 'The password you log in with. Leave the field unchanged to keep the current one.' },

    // ---- Recognition: alignment
    imagealignment_alignmentalgo: {
      title: 'Alignment algorithm',
      text: 'Before the numbers are read, the picture is straightened and shifted so it always matches your reference image. This chooses how that is done.',
      options: {
        '0': ['Rotate + Align (1 channel)', 'Rotates the picture, then finds your two alignment markers using the red color channel. Fast, right for most meters.'],
        '1': ['Rotate + Align (3 channels)', 'The same, but compares all three color channels. More accurate, but slower.'],
        '2': ['Rotate + Align (1 channel + similarity)', 'Adds a similarity check to the marker search. Experimental.'],
        '3': ['Rotate only', 'Only applies the image rotation, markers are not searched. Use it if the camera can not move at all.'],
        '4': ['Off', 'No rotation and no alignment, the picture is used exactly as taken.'],
      },
      now: (g) => (Number(g('imagealignment_alignmentalgo')) >= 3 ? 'Markers are not used with this option, so the search field values have no effect.' : ''),
    },
    imagealignment_searchfield_x: {
      title: 'Search field X',
      text: 'Alignment looks for each marker in an area around the position you set on the Configuration page. This is how far it searches to the left and right, in pixels.',
      now: (g) => 'Search area: ' + g('imagealignment_searchfield_x') + ' px to each side of the marker.',
      tip: 'Larger values cope with more camera movement but slow down processing. Leave at 20 unless the picture shifts a lot.',
    },
    imagealignment_searchfield_y: {
      title: 'Search field Y',
      text: 'The same as Search Field X, but how far it searches up and down, in pixels.',
      now: (g) => 'Search area: ' + g('imagealignment_searchfield_y') + ' px above and below the marker.',
    },
    imagealignment_debug_savedebuginfo: {
      title: 'Save debug info',
      text: 'Stores extra files that show how the alignment found its markers. Turn it on only while troubleshooting, it uses SD card space.',
    },

    // ---- Recognition: digit / analog
    digit_enabled: {
      title: 'Digit recognition',
      text: 'Reads the rolling number wheels of your meter. Switch it off if your meter only has dials.',
      now: (g) => 'Digit recognition is ' + (g('digit_enabled') === 'true' ? 'on.' : 'off.'),
    },
    analog_enabled: {
      title: 'Analog recognition',
      text: 'Reads the pointer dials of your meter. Switch it off if your meter only has rolling number wheels.',
      now: (g) => 'Analog recognition is ' + (g('analog_enabled') === 'true' ? 'on.' : 'off.'),
    },
    digit_model: {
      title: 'Digit model',
      text: 'The AI model that reads each digit. Test a few and keep the one with the fewest wrong readings.',
      options: {
        class100: ['class100', 'Value 0.0 to 9.9. Also reads a wheel between two numbers.'],
        class11: ['class11', 'Digits 0 to 9 or N (not recognized). Smallest model.'],
        cont: ['cont', 'Calculated value. Uncertain readings are rejected.'],
      },
      current: (g) => (/class100/i.test(g('digit_model')) ? 'class100' : /class11/i.test(g('digit_model')) ? 'class11' : /cont/i.test(g('digit_model')) ? 'cont' : ''),
      now: (g) => describeModel(g('digit_model')),
      tip: 'Name, e.g. dig-class100_0182_s2_q: type, version 1.82, size s2 (s0 is the largest), q = quantized (smaller, faster).',
    },
    analog_model: {
      title: 'Analog model',
      text: 'The AI model that reads each dial. Test a few and keep the one with the fewest wrong readings.',
      options: {
        class100: ['class100', 'One of 100 pointer positions (0.0 to 9.9).'],
        cont: ['cont', 'Pointer angle as a continuous value.'],
      },
      current: (g) => (/class100/i.test(g('analog_model')) ? 'class100' : /cont/i.test(g('analog_model')) ? 'cont' : ''),
      now: (g) => describeModel(g('analog_model')),
      tip: 'Name, e.g. ana-class100_0201_s1_q: type, version 2.01, size s1, q = quantized (smaller, faster).',
    },
    digit_debug_saveroiimages: {
      title: 'Save ROI images',
      text: 'Stores the small cut-out image of every digit in each cycle. Helpful to see why a digit was read wrongly. It fills the SD card over time, so switch it off afterwards.',
    },
    analog_debug_saveroiimages: {
      title: 'Save ROI images',
      text: 'Stores the small cut-out image of every dial in each cycle. Helpful to see why a dial was read wrongly. It fills the SD card over time, so switch it off afterwards.',
    },

    // ---- Recognition: post-processing
    postprocessing_sequence_0_sequencename: {
      title: 'Number sequence',
      text: 'A sequence is one counter value made of your digits and dials. The settings below belong to the sequence selected here.',
    },
    postprocessing_sequence_0_analogdigitsyncvalue: {
      title: 'Dial-to-wheel detune',
      text: 'Fine-tunes how the last digit wheel and the first dial are combined into one number. On many meters they do not move in perfect step, so the digit can be off by one around a carry-over.',
      now: (g) => 'Current value: ' + g('postprocessing_sequence_0_analogdigitsyncvalue') + ' (allowed range 6.0 to 9.9).',
      tip: 'Leave it at 9.2 unless the digits and the first dial disagree near a carry-over. Change it in small steps.',
    },
    postprocessing_sequence_0_decimalshift: {
      title: 'Decimal scaling',
      text: 'Moves the decimal point of the final result so it matches the unit you want. A meter in cubic meters that should report liters needs a shift of 3.',
      now: (g) => {
        const n = parseInt(g('postprocessing_sequence_0_decimalshift'), 10) || 0;
        const out = 12.345 * Math.pow(10, n);
        return 'Example: a reading of 12.345 becomes ' + String(Number(out.toPrecision(10))) + (n === 0 ? ' (unchanged).' : '.');
      },
      tip: 'Positive values multiply by 10 per step, negative values divide. Range -9 to 9.',
    },
    postprocessing_sequence_0_extendedresolution: {
      title: 'Extended resolution',
      text: 'Gets one more decimal place out of the picture by looking at where the last wheel or dial currently points between two numbers.',
      now: (g) => (g('postprocessing_sequence_0_extendedresolution') === 'true' ? 'On: the result has one decimal place more than your regions provide.' : 'Off: the result only has the decimal places your regions provide.'),
      tip: 'Works with the ana-/dig-class100 and -cont models only.',
    },
    postprocessing_sequence_0_allownegativerate: {
      title: 'Allow negative rate',
      text: 'Lets the value go down. Water and gas meters only count up, so keep this off: a lower reading is then treated as a recognition error and the last valid value is kept.',
      now: (g) => (g('postprocessing_sequence_0_allownegativerate') === 'true' ? 'On: decreasing readings are accepted.' : 'Off: a decreasing reading is rejected as a recognition error.'),
      tip: 'Switch it on only for meters that can count backwards.',
    },
    postprocessing_sequence_0_maxratechecktype: {
      title: 'Max rate check type',
      text: 'Protects against unrealistic jumps, for example when a digit is read wrongly once. It compares a new reading with the last valid one.',
      options: {
        '0': ['No rate check', 'Every reading is accepted, including a false jump.'],
        '1': ['Rate per minute', 'The change since the last valid reading is converted to a rate per minute. Self-healing: the longer no valid reading arrives, the lower the rate gets, until a reading passes again.'],
        '2': ['Rate per interval', 'The change since the last valid reading is compared directly. Not self-healing: the limit stays fixed, so choose it to cover real use plus some wrong readings.'],
      },
    },
    postprocessing_sequence_0_maxrate: {
      title: 'Max rate',
      text: 'The largest change you accept between two valid readings, up or down. Readings above it are rejected and the last valid value stays.',
      now: (g) => {
        const t = g('postprocessing_sequence_0_maxratechecktype');
        const r = parseFloat(g('postprocessing_sequence_0_maxrate'));
        if (t === '0') return 'Has no effect: the rate check is off.';
        if (!(r >= 0)) return '';
        return t === '1'
          ? 'At most ' + r + ' per minute, which is ' + Number((r * 60).toPrecision(6)) + ' per hour.'
          : 'At most ' + r + ' between two valid readings, however far apart they are.';
      },
    },
    postprocessing_sequence_0_usefallbackvalue: {
      title: 'Use fallback value',
      text: 'The fallback value is the last valid reading. It is the reference for the plausibility checks (negative rate, jumps, replacing unreadable digits).',
      tip: 'Expert setting. Only change it if you know what it does.',
      warn: true,
    },
    postprocessing_sequence_0_fallbackvalueagestartup: {
      title: 'Max age of fallback value',
      text: 'After a restart the device reloads the last valid reading from before the restart, but only if it is not older than this many minutes.',
      now: (g) => {
        const m = parseFloat(g('postprocessing_sequence_0_fallbackvalueagestartup'));
        if (!(m >= 0)) return '';
        return m === 0 ? 'The old value is never reloaded.' : m + ' min is about ' + Number((m / 60).toPrecision(4)) + ' hours.';
      },
      tip: 'Expert setting. Only change it if you know what it does.',
      warn: true,
    },
    postprocessing_debug_savedebuginfo: {
      title: 'Save debug info',
      text: 'Writes extra post-processing details to the log files. Use it only for troubleshooting.',
    },
  };

  // ---- model info (combo entries and the text below the field) -----------------------------------------
  // What a model type does (from the firmware: ClassFlowCNNGeneral) and facts about the models that ship with the firmware.
  // Release dates: first publication in the official repositories (jomjol, model changelogs); input size, classes and file size
  // are read from the .tflite files. Models that are not listed here (own models) are described by their file name only.
  const MODEL_TYPES = {
    'dig-class100': { chip: '100', kind: 'Digit', classes: 100, how: 'Picks one of 100 classes (0.0 to 9.9): a digit with a decimal place, for wheels that are between two numbers.' },
    'dig-class11': { chip: '11', kind: 'Digit', classes: 11, how: 'Picks one of 11 classes: the digits 0 to 9 or N (no digit recognized). Whole digits only.' },
    'dig-cont': { chip: 'cont', kind: 'Digit', classes: 10, how: 'Calculates a continuous value from 10 outputs. A fit check rejects uncertain readings (CNN good threshold).' },
    'ana-class100': { chip: '100', kind: 'Analog', classes: 100, how: 'Picks one of 100 pointer positions (0.0 to 9.9).' },
    'ana-cont': { chip: 'cont', kind: 'Analog', classes: 2, how: 'Calculates the pointer angle from two outputs (sine and cosine): a continuous value.' },
  };
  const MODEL_CATALOG = {
    'dig-class100_0182_s2_q': { date: '2025-12-29', input: '32 x 20', kb: 221, latest: true },
    'dig-class11_2000_s2_q': { date: '2025-04-23', input: '32 x 20', kb: 95, latest: true },
    'dig-cont_0900_s3_q': { date: '2025-04-06', input: '32 x 20', kb: 308, latest: true },
    'ana-class100_0201_s1_q': { date: '2025-08-30', input: '32 x 32', kb: 130, latest: true },
    'ana-class100_0171_s1_q': { date: '2023-12-22', input: '32 x 32', kb: 131 },
    'ana-cont_1901_s0_q': { date: '2025-08-30', input: '32 x 32', kb: 183, latest: true },
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function modelInfo(file) {
    const name = String(file || '').toLowerCase().replace(/\.tflite$/, '');
    if (!name) return null;
    const norm = name.replace(/-/g, '_');
    const m = /^(dig|ana)_(class100|class11|cont)_(\d{4})(?:_s(\d))?(_q)?$/.exec(norm);
    const type = m ? `${m[1]}-${m[2]}` : '';
    const t = MODEL_TYPES[type] || null;
    const cat = (m && MODEL_CATALOG[`${type}_${m[3]}${m[4] ? `_s${m[4]}` : ''}${m[5] || ''}`]) || null; // old files use dashes: dig-class100-0182-s2-q
    const version = m ? (parseInt(m[3], 10) / 100).toFixed(2) : '';
    let released = '';
    let age = '';
    if (cat?.date) {
      const d = new Date(cat.date + 'T00:00:00');
      released = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      const months = Math.max(0, (new Date().getFullYear() - d.getFullYear()) * 12 + new Date().getMonth() - d.getMonth());
      age = months < 1 ? 'this month' : months < 24 ? `${months} month${months === 1 ? '' : 's'} ago` : `${Math.floor(months / 12)} years ago`;
    }
    const quantized = !!(m && m[5]);
    const facts = [];
    if (version) facts.push(`v${version}`);
    if (released) facts.push(`${released} (${age})`);
    if (cat?.kb) facts.push(`${cat.kb} KB`);
    if (cat?.input) facts.push(`input ${cat.input}`);
    return { name, type, t, cat, version, released, age, quantized, chip: t ? t.chip : '?', sub: facts.join(' ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ') };
  }

  function describeModel(file) {
    const i = modelInfo(file);
    if (!i) return '';
    const status = i.cat ? (i.cat.latest ? 'Newest of its type in the official repositories.' : 'Older than the newest of its type.') : i.t ? 'No release date known.' : '';
    return [`Selected: ${i.name}.`, i.sub ? `${i.sub}.` : '', status].filter(Boolean).join(' ');
  }

  const paramValue = (key) => (S ? valueOfId(S, key) : '');

  /* ======================================================================== */
  /* State                                                                    */
  /* ======================================================================== */
  let S = null; // state of the mounted view

  function storageGet(kind, key) {
    try {
      return (kind === 'session' ? sessionStorage : localStorage).getItem(key);
    } catch (e) {
      return null;
    }
  }

  function storageSet(kind, key, value) {
    try {
      (kind === 'session' ? sessionStorage : localStorage).setItem(key, value);
    } catch (e) {
      /* storage not available: nothing remembered */
    }
  }

  const fieldsOf = (row) => row.fields || [row];
  const isHeading = (def) => def.h !== undefined;
  const flatKey = (path) => path.replace(/\./g, '_').toLowerCase();

  function pathOf(s, f) {
    return f.ix ? f.name.replace('{i}', String(s.ix[f.ix])) : f.name;
  }

  function keyOf(s, f) {
    return flatKey(pathOf(s, f));
  }

  /* ======================================================================== */
  /* Values of the controls                                                   */
  /* ======================================================================== */
  function getValue(fld) {
    const f = fld.f;
    switch (f.t) {
      case 'switch':
        return fld.el.checked ? (f.on ?? 'true') : (f.off ?? 'false');
      case 'cards':
        return fld.cur;
      case 'select':
        return fld.el.selectedIndex < 0 ? '' : fld.el.value;
      case 'info':
        return fld.el.textContent;
      default:
        return fld.el.value;
    }
  }

  function syncSwitch(fld) {
    fld.text.textContent = fld.el.checked ? 'On' : 'Off';
  }

  function setValue(fld, value) {
    const f = fld.f;
    const str = value === undefined || value === null ? '' : String(value);
    switch (f.t) {
      case 'switch':
        fld.el.checked = str.toLowerCase() === String(f.on ?? 'true').toLowerCase();
        syncSwitch(fld);
        break;
      case 'cards': {
        const hit = f.opts.find(([v]) => v.toLowerCase() === str.toLowerCase());
        if (hit) fld.cur = hit[0];
        fld.cards.forEach(({ value: v, btn }) => btn.classList.toggle('cfg-on', v === fld.cur));
        break;
      }
      case 'select': {
        let idx = Array.from(fld.el.options).findIndex((o) => o.value.toLowerCase() === str.toLowerCase());
        if (idx < 0 && f.tz && str) {
          // a time zone string that is not in the list stays selectable
          fld.el.add(new Option(`${str} (custom)`, str), 0);
          idx = 0;
        }
        if (idx >= 0) fld.el.selectedIndex = idx;
        fld.modelCombo?.sync();
        break;
      }
      case 'info':
        fld.el.textContent = str;
        break;
      default:
        fld.el.value = str;
    }
  }

  // value of a parameter by id (also of rows that are not rendered: duplicate / obsolete ones)
  function valueOfId(s, id) {
    if (id === '@anypwm') return s.anyPwm;
    if (id === '@anysmartled') return s.anySmartled;
    const fld = s.byId[id];
    if (fld) return String(getValue(fld));
    const row = s.rowById[id];
    if (!row) return '';
    const v = s.vals[keyOf(s, row)];
    return String(v !== undefined ? v : (row.def ?? ''));
  }

  /* ======================================================================== */
  /* Conditional visibility (rule table of the schema)                        */
  /* ======================================================================== */
  function evalCond(s, c) {
    if (c.all) return c.all.every((x) => evalCond(s, x));
    if (c.any) return c.any.some((x) => evalCond(s, x));
    const a = valueOfId(s, c.id);
    switch (c.op) {
      case '==': return a == c.v; // eslint-disable-line eqeqeq
      case '===': return a === c.v;
      case '!=': return a != c.v; // eslint-disable-line eqeqeq
      case '>': return a > c.v;
      case '>=': return a >= c.v;
      case '<': return a < c.v;
      case '<=': return a <= c.v;
      case 'in': return c.v.includes(String(a));
      case 'prefix': return String(a).startsWith(c.v);
      default: return true;
    }
  }

  const isShown = (s, def) => (def.show || []).every((cls) => !(cls in SCHEMA.rules) || s.active[cls]);

  function applyVisibility(s) {
    const active = {};
    for (const cls of Object.keys(SCHEMA.rules)) active[cls] = !!evalCond(s, SCHEMA.rules[cls]);
    s.active = active;

    for (const card of s.cards) {
      let heading = null;
      let count = 0;
      let any = false;
      const flush = () => {
        if (heading) heading.el.hidden = !(heading.own && count > 0);
      };
      for (const item of card.items) {
        const own = isShown(s, item.def) && (!item.def.adv || s.advOn);
        if (isHeading(item.def)) {
          flush();
          heading = { el: item.el, own };
          count = 0;
        } else {
          item.el.hidden = !own;
          if (own) {
            count++;
            any = true;
          }
        }
      }
      flush();
      card.el.hidden = (!!card.def.adv && !s.advOn) || !(card.def.enable || any);
    }

    // advanced navigation entries
    for (const el of s.root.querySelectorAll('[data-adv]')) el.hidden = !s.advOn;
  }

  /* ======================================================================== */
  /* Delta (changed parameters) and save bar                                  */
  /* ======================================================================== */
  function gatherFields(s, row, forceInt) {
    for (const fld of s.fieldsOfRow.get(row) || []) {
      if (fld.f.t === 'info') continue;
      const data = {};
      deepSet(data, pathOf(s, fld.f), getValue(fld), forceInt || !!fld.f.int);
      s.delta = deepMergeObjects(s.delta, data);
    }
  }

  function onChanged(s, fld) {
    const f = fld.f;
    if (f.t === 'number') clampNumber(f, fld.el);
    if (f.sel) {
      // another number sequence / GPIO pin selected: the dependent rows show the values of that entry
      s.ix[f.sel] = fld.el.selectedIndex;
      refreshIndexed(s, f.sel);
      if (f.sel === 'pin') updatePinUsage(s);
    }
    s.vals[keyOf(s, f)] = getValue(fld);

    gatherFields(s, fld.row, false);
    for (const [id, asInt] of fld.row.with || []) {
      const other = s.byId[id];
      if (other) gatherFields(s, other.row, asInt);
    }
    const when = fld.row.withWhen;
    if (when && String(getValue(fld)) === when.v) {
      for (const id of when.ids) {
        const other = s.byId[id];
        if (other) gatherFields(s, other.row, false);
      }
    }
    if (fld.row.reboot) s.reboot = true;
    afterEdit(s);
    updateSaveBar(s);
  }

  // the old page clamped number inputs to min/max when they lost focus
  function clampNumber(f, input) {
    if (input.value === '') return;
    const n = parseFloat(input.value);
    if (Number.isNaN(n)) return;
    if (f.min !== undefined && n < f.min) input.value = f.min;
    else if (f.max !== undefined && n > f.max) input.value = f.max;
  }

  function afterEdit(s) {
    applyVisibility(s);
    updateFlashMapping(s);
    renderHero(s);
    if (s.help.key) {
      renderHelp(s);
      placeHelp(s);
    }
  }

  function updateSaveBar(s) {
    const dirty = Object.keys(s.delta).length > 0;
    SaveBar.set({
      dirty,
      saveLabel: s.reboot ? 'Save and restart' : 'Save',
      text: s.reboot ? 'Unsaved changes ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ a restart is required' : 'Unsaved changes',
      onSave: () => save(s),
      onDiscard: () => discard(s),
    });
  }

  async function save(s) {
    const reboot = s.reboot;
    SaveBar.busy(true);
    try {
      await Api.config.save(s.delta, !reboot);
      if (s.dead) return;
      if (reboot) {
        s.timer = setTimeout(() => App.navigate(REBOOT_ROUTE), REBOOT_DELAY_MS);
      } else {
        s.delta = {}; // saved: nothing pending anymore
        updateSaveBar(s);
      }
    } catch (e) {
      /* error toast is shown by the API layer */
    } finally {
      SaveBar.busy(false);
    }
  }

  function discard(s) {
    s.delta = {};
    s.reboot = false;
    loadAndBuild(s);
  }

  /* ======================================================================== */
  /* Dynamic option lists                                                     */
  /* ======================================================================== */
  const stripExt = (name) => (name.lastIndexOf('.') > 0 ? name.substring(0, name.lastIndexOf('.')) : name);

  /* ======================================================================== */
  /* Time zones (name -> POSIX time zone string)                              */
  /* ======================================================================== */
  const TIMEZONE_CODES = [
    "GMT0",
    "EAT-3",
    "CET-1",
    "WAT-1",
    "CAT-2",
    "EET-2",
    "<+01>-1",
    "CET-1CEST,M3.5.0,M10.5.0/3",
    "SAST-2",
    "HST10HDT,M3.2.0,M11.1.0",
    "AKST9AKDT,M3.2.0,M11.1.0",
    "AST4",
    "<-03>3",
    "<-04>4<-03>,M10.1.0/0,M3.4.0/0",
    "EST5",
    "CST6CDT,M4.1.0,M10.5.0",
    "CST6",
    "<-04>4",
    "<-05>5",
    "MST7MDT,M3.2.0,M11.1.0",
    "CST6CDT,M3.2.0,M11.1.0",
    "MST7MDT,M4.1.0,M10.5.0",
    "MST7",
    "EST5EDT,M3.2.0,M11.1.0",
    "AST4ADT,M3.2.0,M11.1.0",
    "<-03>3<-02>,M3.5.0/-2,M10.5.0/-1",
    "CST5CDT,M3.2.0/0,M11.1.0/1",
    "PST8PDT,M3.2.0,M11.1.0",
    "<-03>3<-02>,M3.2.0,M11.1.0",
    "<-02>2",
    "<-04>4<-03>,M9.1.6/24,M4.1.6/24",
    "<-01>1<+00>,M3.5.0/0,M10.5.0/1",
    "NST3:30NDT,M3.2.0,M11.1.0",
    "<+11>-11",
    "<+07>-7",
    "<+10>-10",
    "AEST-10AEDT,M10.1.0,M4.1.0/3",
    "<+05>-5",
    "NZST-12NZDT,M9.5.0,M4.1.0/3",
    "<+03>-3",
    "<+00>0<+02>-2,M3.5.0/1,M10.5.0/3",
    "<+06>-6",
    "EET-2EEST,M2.5.4/24,M10.5.5/1",
    "<+12>-12",
    "<+04>-4",
    "EET-2EEST,M3.5.0/0,M10.5.0/0",
    "<+08>-8",
    "<+09>-9",
    "<+0530>-5:30",
    "EET-2EEST,M3.5.5/0,M10.5.5/0",
    "EET-2EEST,M3.5.0/3,M10.5.0/4",
    "EET-2EEST,M3.4.4/48,M10.5.5/1",
    "HKT-8",
    "WIB-7",
    "WIT-9",
    "IST-2IDT,M3.4.4/26,M10.5.0",
    "<+0430>-4:30",
    "PKT-5",
    "<+0545>-5:45",
    "IST-5:30",
    "CST-8",
    "WITA-8",
    "PST-8",
    "KST-9",
    "<+0330>-3:30<+0430>,J79/24,J263/24",
    "JST-9",
    "<+0630>-6:30",
    "WET0WEST,M3.5.0/1,M10.5.0",
    "<-01>1",
    "ACST-9:30ACDT,M10.1.0,M4.1.0/3",
    "AEST-10",
    "ACST-9:30",
    "<+0845>-8:45",
    "<+1030>-10:30<+11>-11,M10.1.0,M4.1.0",
    "AWST-8",
    "<+13>-13",
    "<+14>-14",
    "<+02>-2",
    "<-10>10",
    "<-11>11",
    "<-12>12",
    "<-06>6",
    "<-07>7",
    "<-08>8",
    "<-09>9",
    "UTC0",
    "EET-2EEST,M3.5.0,M10.5.0/3",
    "IST-1GMT0,M10.5.0,M3.5.0/1",
    "GMT0BST,M3.5.0/1,M10.5.0",
    "MSK-3",
    "<+1245>-12:45<+1345>,M9.5.0/2:45,M4.1.0/3:45",
    "<-06>6<-05>,M9.1.6/22,M4.1.6/22",
    "<+12>-12<+13>,M11.2.0,M1.2.3/99",
    "ChST-10",
    "HST10",
    "<-0930>9:30",
    "SST11",
    "<+11>-11<+12>,M10.1.0,M4.1.0/3"
  ];

  const TIMEZONE_LIST = [
    ["Africa/Abidjan", 0],
    ["Africa/Accra", 0],
    ["Africa/Addis_Ababa", 1],
    ["Africa/Algiers", 2],
    ["Africa/Asmara", 1],
    ["Africa/Bamako", 0],
    ["Africa/Bangui", 3],
    ["Africa/Banjul", 0],
    ["Africa/Bissau", 0],
    ["Africa/Blantyre", 4],
    ["Africa/Brazzaville", 3],
    ["Africa/Bujumbura", 4],
    ["Africa/Cairo", 5],
    ["Africa/Casablanca", 6],
    ["Africa/Ceuta", 7],
    ["Africa/Conakry", 0],
    ["Africa/Dakar", 0],
    ["Africa/Dar_es_Salaam", 1],
    ["Africa/Djibouti", 1],
    ["Africa/Douala", 3],
    ["Africa/El_Aaiun", 6],
    ["Africa/Freetown", 0],
    ["Africa/Gaborone", 4],
    ["Africa/Harare", 4],
    ["Africa/Johannesburg", 8],
    ["Africa/Juba", 4],
    ["Africa/Kampala", 1],
    ["Africa/Khartoum", 4],
    ["Africa/Kigali", 4],
    ["Africa/Kinshasa", 3],
    ["Africa/Lagos", 3],
    ["Africa/Libreville", 3],
    ["Africa/Lome", 0],
    ["Africa/Luanda", 3],
    ["Africa/Lubumbashi", 4],
    ["Africa/Lusaka", 4],
    ["Africa/Malabo", 3],
    ["Africa/Maputo", 4],
    ["Africa/Maseru", 8],
    ["Africa/Mbabane", 8],
    ["Africa/Mogadishu", 1],
    ["Africa/Monrovia", 0],
    ["Africa/Nairobi", 1],
    ["Africa/Ndjamena", 3],
    ["Africa/Niamey", 3],
    ["Africa/Nouakchott", 0],
    ["Africa/Ouagadougou", 0],
    ["Africa/Porto-Novo", 3],
    ["Africa/Sao_Tome", 0],
    ["Africa/Tripoli", 5],
    ["Africa/Tunis", 2],
    ["Africa/Windhoek", 4],
    ["America/Adak", 9],
    ["America/Anchorage", 10],
    ["America/Anguilla", 11],
    ["America/Antigua", 11],
    ["America/Araguaina", 12],
    ["America/Argentina/Buenos_Aires", 12],
    ["America/Argentina/Catamarca", 12],
    ["America/Argentina/Cordoba", 12],
    ["America/Argentina/Jujuy", 12],
    ["America/Argentina/La_Rioja", 12],
    ["America/Argentina/Mendoza", 12],
    ["America/Argentina/Rio_Gallegos", 12],
    ["America/Argentina/Salta", 12],
    ["America/Argentina/San_Juan", 12],
    ["America/Argentina/San_Luis", 12],
    ["America/Argentina/Tucuman", 12],
    ["America/Argentina/Ushuaia", 12],
    ["America/Aruba", 11],
    ["America/Asuncion", 13],
    ["America/Atikokan", 14],
    ["America/Bahia", 12],
    ["America/Bahia_Banderas", 15],
    ["America/Barbados", 11],
    ["America/Belem", 12],
    ["America/Belize", 16],
    ["America/Blanc-Sablon", 11],
    ["America/Boa_Vista", 17],
    ["America/Bogota", 18],
    ["America/Boise", 19],
    ["America/Cambridge_Bay", 19],
    ["America/Campo_Grande", 17],
    ["America/Cancun", 14],
    ["America/Caracas", 17],
    ["America/Cayenne", 12],
    ["America/Cayman", 14],
    ["America/Chicago", 20],
    ["America/Chihuahua", 21],
    ["America/Costa_Rica", 16],
    ["America/Creston", 22],
    ["America/Cuiaba", 17],
    ["America/Curacao", 11],
    ["America/Danmarkshavn", 0],
    ["America/Dawson", 22],
    ["America/Dawson_Creek", 22],
    ["America/Denver", 19],
    ["America/Detroit", 23],
    ["America/Dominica", 11],
    ["America/Edmonton", 19],
    ["America/Eirunepe", 18],
    ["America/El_Salvador", 16],
    ["America/Fort_Nelson", 22],
    ["America/Fortaleza", 12],
    ["America/Glace_Bay", 24],
    ["America/Godthab", 25],
    ["America/Goose_Bay", 24],
    ["America/Grand_Turk", 23],
    ["America/Grenada", 11],
    ["America/Guadeloupe", 11],
    ["America/Guatemala", 16],
    ["America/Guayaquil", 18],
    ["America/Guyana", 17],
    ["America/Halifax", 24],
    ["America/Havana", 26],
    ["America/Hermosillo", 22],
    ["America/Indiana/Indianapolis", 23],
    ["America/Indiana/Knox", 20],
    ["America/Indiana/Marengo", 23],
    ["America/Indiana/Petersburg", 23],
    ["America/Indiana/Tell_City", 20],
    ["America/Indiana/Vevay", 23],
    ["America/Indiana/Vincennes", 23],
    ["America/Indiana/Winamac", 23],
    ["America/Inuvik", 19],
    ["America/Iqaluit", 23],
    ["America/Jamaica", 14],
    ["America/Juneau", 10],
    ["America/Kentucky/Louisville", 23],
    ["America/Kentucky/Monticello", 23],
    ["America/Kralendijk", 11],
    ["America/La_Paz", 17],
    ["America/Lima", 18],
    ["America/Los_Angeles", 27],
    ["America/Lower_Princes", 11],
    ["America/Maceio", 12],
    ["America/Managua", 16],
    ["America/Manaus", 17],
    ["America/Marigot", 11],
    ["America/Martinique", 11],
    ["America/Matamoros", 20],
    ["America/Mazatlan", 21],
    ["America/Menominee", 20],
    ["America/Merida", 15],
    ["America/Metlakatla", 10],
    ["America/Mexico_City", 15],
    ["America/Miquelon", 28],
    ["America/Moncton", 24],
    ["America/Monterrey", 15],
    ["America/Montevideo", 12],
    ["America/Montreal", 23],
    ["America/Montserrat", 11],
    ["America/Nassau", 23],
    ["America/New_York", 23],
    ["America/Nipigon", 23],
    ["America/Nome", 10],
    ["America/Noronha", 29],
    ["America/North_Dakota/Beulah", 20],
    ["America/North_Dakota/Center", 20],
    ["America/North_Dakota/New_Salem", 20],
    ["America/Nuuk", 25],
    ["America/Ojinaga", 19],
    ["America/Panama", 14],
    ["America/Pangnirtung", 23],
    ["America/Paramaribo", 12],
    ["America/Phoenix", 22],
    ["America/Port_of_Spain", 11],
    ["America/Port-au-Prince", 23],
    ["America/Porto_Velho", 17],
    ["America/Puerto_Rico", 11],
    ["America/Punta_Arenas", 12],
    ["America/Rainy_River", 20],
    ["America/Rankin_Inlet", 20],
    ["America/Recife", 12],
    ["America/Regina", 16],
    ["America/Resolute", 20],
    ["America/Rio_Branco", 18],
    ["America/Santarem", 12],
    ["America/Santiago", 30],
    ["America/Santo_Domingo", 11],
    ["America/Sao_Paulo", 12],
    ["America/Scoresbysund", 31],
    ["America/Sitka", 10],
    ["America/St_Barthelemy", 11],
    ["America/St_Johns", 32],
    ["America/St_Kitts", 11],
    ["America/St_Lucia", 11],
    ["America/St_Thomas", 11],
    ["America/St_Vincent", 11],
    ["America/Swift_Current", 16],
    ["America/Tegucigalpa", 16],
    ["America/Thule", 24],
    ["America/Thunder_Bay", 23],
    ["America/Tijuana", 27],
    ["America/Toronto", 23],
    ["America/Tortola", 11],
    ["America/Vancouver", 27],
    ["America/Whitehorse", 22],
    ["America/Winnipeg", 20],
    ["America/Yakutat", 10],
    ["America/Yellowknife", 19],
    ["Antarctica/Casey", 33],
    ["Antarctica/Davis", 34],
    ["Antarctica/DumontDUrville", 35],
    ["Antarctica/Macquarie", 36],
    ["Antarctica/Mawson", 37],
    ["Antarctica/McMurdo", 38],
    ["Antarctica/Palmer", 12],
    ["Antarctica/Rothera", 12],
    ["Antarctica/Syowa", 39],
    ["Antarctica/Troll", 40],
    ["Antarctica/Vostok", 41],
    ["Arctic/Longyearbyen", 7],
    ["Asia/Aden", 39],
    ["Asia/Almaty", 41],
    ["Asia/Amman", 42],
    ["Asia/Anadyr", 43],
    ["Asia/Aqtau", 37],
    ["Asia/Aqtobe", 37],
    ["Asia/Ashgabat", 37],
    ["Asia/Atyrau", 37],
    ["Asia/Baghdad", 39],
    ["Asia/Bahrain", 39],
    ["Asia/Baku", 44],
    ["Asia/Bangkok", 34],
    ["Asia/Barnaul", 34],
    ["Asia/Beirut", 45],
    ["Asia/Bishkek", 41],
    ["Asia/Brunei", 46],
    ["Asia/Chita", 47],
    ["Asia/Choibalsan", 46],
    ["Asia/Colombo", 48],
    ["Asia/Damascus", 49],
    ["Asia/Dhaka", 41],
    ["Asia/Dili", 47],
    ["Asia/Dubai", 44],
    ["Asia/Dushanbe", 37],
    ["Asia/Famagusta", 50],
    ["Asia/Gaza", 51],
    ["Asia/Hebron", 51],
    ["Asia/Ho_Chi_Minh", 34],
    ["Asia/Hong_Kong", 52],
    ["Asia/Hovd", 34],
    ["Asia/Irkutsk", 46],
    ["Asia/Jakarta", 53],
    ["Asia/Jayapura", 54],
    ["Asia/Jerusalem", 55],
    ["Asia/Kabul", 56],
    ["Asia/Kamchatka", 43],
    ["Asia/Karachi", 57],
    ["Asia/Kathmandu", 58],
    ["Asia/Khandyga", 47],
    ["Asia/Kolkata", 59],
    ["Asia/Krasnoyarsk", 34],
    ["Asia/Kuala_Lumpur", 46],
    ["Asia/Kuching", 46],
    ["Asia/Kuwait", 39],
    ["Asia/Macau", 60],
    ["Asia/Magadan", 33],
    ["Asia/Makassar", 61],
    ["Asia/Manila", 62],
    ["Asia/Muscat", 44],
    ["Asia/Nicosia", 50],
    ["Asia/Novokuznetsk", 34],
    ["Asia/Novosibirsk", 34],
    ["Asia/Omsk", 41],
    ["Asia/Oral", 37],
    ["Asia/Phnom_Penh", 34],
    ["Asia/Pontianak", 53],
    ["Asia/Pyongyang", 63],
    ["Asia/Qatar", 39],
    ["Asia/Qyzylorda", 37],
    ["Asia/Riyadh", 39],
    ["Asia/Sakhalin", 33],
    ["Asia/Samarkand", 37],
    ["Asia/Seoul", 63],
    ["Asia/Shanghai", 60],
    ["Asia/Singapore", 46],
    ["Asia/Srednekolymsk", 33],
    ["Asia/Taipei", 60],
    ["Asia/Tashkent", 37],
    ["Asia/Tbilisi", 44],
    ["Asia/Tehran", 64],
    ["Asia/Thimphu", 41],
    ["Asia/Tokyo", 65],
    ["Asia/Tomsk", 34],
    ["Asia/Ulaanbaatar", 46],
    ["Asia/Urumqi", 41],
    ["Asia/Ust-Nera", 35],
    ["Asia/Vientiane", 34],
    ["Asia/Vladivostok", 35],
    ["Asia/Yakutsk", 47],
    ["Asia/Yangon", 66],
    ["Asia/Yekaterinburg", 37],
    ["Asia/Yerevan", 44],
    ["Atlantic/Azores", 31],
    ["Atlantic/Bermuda", 24],
    ["Atlantic/Canary", 67],
    ["Atlantic/Cape_Verde", 68],
    ["Atlantic/Faroe", 67],
    ["Atlantic/Madeira", 67],
    ["Atlantic/Reykjavik", 0],
    ["Atlantic/South_Georgia", 29],
    ["Atlantic/St_Helena", 0],
    ["Atlantic/Stanley", 12],
    ["Australia/Adelaide", 69],
    ["Australia/Brisbane", 70],
    ["Australia/Broken_Hill", 69],
    ["Australia/Currie", 36],
    ["Australia/Darwin", 71],
    ["Australia/Eucla", 72],
    ["Australia/Hobart", 36],
    ["Australia/Lindeman", 70],
    ["Australia/Lord_Howe", 73],
    ["Australia/Melbourne", 36],
    ["Australia/Perth", 74],
    ["Australia/Sydney", 36],
    ["Etc/GMT", 0],
    ["Etc/GMT-0", 0],
    ["Etc/GMT-1", 6],
    ["Etc/GMT-10", 35],
    ["Etc/GMT-11", 33],
    ["Etc/GMT-12", 43],
    ["Etc/GMT-13", 75],
    ["Etc/GMT-14", 76],
    ["Etc/GMT-2", 77],
    ["Etc/GMT-3", 39],
    ["Etc/GMT-4", 44],
    ["Etc/GMT-5", 37],
    ["Etc/GMT-6", 41],
    ["Etc/GMT-7", 34],
    ["Etc/GMT-8", 46],
    ["Etc/GMT-9", 47],
    ["Etc/GMT+0", 0],
    ["Etc/GMT+1", 68],
    ["Etc/GMT+10", 78],
    ["Etc/GMT+11", 79],
    ["Etc/GMT+12", 80],
    ["Etc/GMT+2", 29],
    ["Etc/GMT+3", 12],
    ["Etc/GMT+4", 17],
    ["Etc/GMT+5", 18],
    ["Etc/GMT+6", 81],
    ["Etc/GMT+7", 82],
    ["Etc/GMT+8", 83],
    ["Etc/GMT+9", 84],
    ["Etc/GMT0", 0],
    ["Etc/Greenwich", 0],
    ["Etc/UCT", 85],
    ["Etc/Universal", 85],
    ["Etc/UTC", 85],
    ["Etc/Zulu", 85],
    ["Europe/Amsterdam", 7],
    ["Europe/Andorra", 7],
    ["Europe/Astrakhan", 44],
    ["Europe/Athens", 50],
    ["Europe/Belgrade", 7],
    ["Europe/Berlin", 7],
    ["Europe/Bratislava", 7],
    ["Europe/Brussels", 7],
    ["Europe/Bucharest", 50],
    ["Europe/Budapest", 7],
    ["Europe/Busingen", 7],
    ["Europe/Chisinau", 86],
    ["Europe/Copenhagen", 7],
    ["Europe/Dublin", 87],
    ["Europe/Gibraltar", 7],
    ["Europe/Guernsey", 88],
    ["Europe/Helsinki", 50],
    ["Europe/Isle_of_Man", 88],
    ["Europe/Istanbul", 39],
    ["Europe/Jersey", 88],
    ["Europe/Kaliningrad", 5],
    ["Europe/Kiev", 50],
    ["Europe/Kirov", 39],
    ["Europe/Lisbon", 67],
    ["Europe/Ljubljana", 7],
    ["Europe/London", 88],
    ["Europe/Luxembourg", 7],
    ["Europe/Madrid", 7],
    ["Europe/Malta", 7],
    ["Europe/Mariehamn", 50],
    ["Europe/Minsk", 39],
    ["Europe/Monaco", 7],
    ["Europe/Moscow", 89],
    ["Europe/Oslo", 7],
    ["Europe/Paris", 7],
    ["Europe/Podgorica", 7],
    ["Europe/Prague", 7],
    ["Europe/Riga", 50],
    ["Europe/Rome", 7],
    ["Europe/Samara", 44],
    ["Europe/San_Marino", 7],
    ["Europe/Sarajevo", 7],
    ["Europe/Saratov", 44],
    ["Europe/Simferopol", 89],
    ["Europe/Skopje", 7],
    ["Europe/Sofia", 50],
    ["Europe/Stockholm", 7],
    ["Europe/Tallinn", 50],
    ["Europe/Tirane", 7],
    ["Europe/Ulyanovsk", 44],
    ["Europe/Uzhgorod", 50],
    ["Europe/Vaduz", 7],
    ["Europe/Vatican", 7],
    ["Europe/Vienna", 7],
    ["Europe/Vilnius", 50],
    ["Europe/Volgograd", 39],
    ["Europe/Warsaw", 7],
    ["Europe/Zagreb", 7],
    ["Europe/Zaporozhye", 50],
    ["Europe/Zurich", 7],
    ["Indian/Antananarivo", 1],
    ["Indian/Chagos", 41],
    ["Indian/Christmas", 34],
    ["Indian/Cocos", 66],
    ["Indian/Comoro", 1],
    ["Indian/Kerguelen", 37],
    ["Indian/Mahe", 44],
    ["Indian/Maldives", 37],
    ["Indian/Mauritius", 44],
    ["Indian/Mayotte", 1],
    ["Indian/Reunion", 44],
    ["Pacific/Apia", 75],
    ["Pacific/Auckland", 38],
    ["Pacific/Bougainville", 33],
    ["Pacific/Chatham", 90],
    ["Pacific/Chuuk", 35],
    ["Pacific/Easter", 91],
    ["Pacific/Efate", 33],
    ["Pacific/Enderbury", 75],
    ["Pacific/Fakaofo", 75],
    ["Pacific/Fiji", 92],
    ["Pacific/Funafuti", 43],
    ["Pacific/Galapagos", 81],
    ["Pacific/Gambier", 84],
    ["Pacific/Guadalcanal", 33],
    ["Pacific/Guam", 93],
    ["Pacific/Honolulu", 94],
    ["Pacific/Kiritimati", 76],
    ["Pacific/Kosrae", 33],
    ["Pacific/Kwajalein", 43],
    ["Pacific/Majuro", 43],
    ["Pacific/Marquesas", 95],
    ["Pacific/Midway", 96],
    ["Pacific/Nauru", 43],
    ["Pacific/Niue", 79],
    ["Pacific/Norfolk", 97],
    ["Pacific/Noumea", 33],
    ["Pacific/Pago_Pago", 96],
    ["Pacific/Palau", 47],
    ["Pacific/Pitcairn", 83],
    ["Pacific/Pohnpei", 33],
    ["Pacific/Port_Moresby", 35],
    ["Pacific/Rarotonga", 78],
    ["Pacific/Saipan", 93],
    ["Pacific/Tahiti", 78],
    ["Pacific/Tarawa", 43],
    ["Pacific/Tongatapu", 75],
    ["Pacific/Wake", 43],
    ["Pacific/Wallis", 43]
  ];

  // Default first: Europe/Berlin
  const TIMEZONE_COMMON = [
    ['CET-1CEST,M3.5.0,M10.5.0/3', 'Europe/Berlin, Paris, Rome, Madrid'],
    ['GMT0BST,M3.5.0/1,M10.5.0', 'Europe/London, Dublin, Lisbon'],
    ['EET-2EEST,M3.5.0/3,M10.5.0/4', 'Europe/Helsinki, Athens, Kyiv'],
    ['MSK-3', 'Europe/Moscow, Istanbul'],
    ['UTC0', 'UTC'],
    ['EST5EDT,M3.2.0,M11.1.0', 'US Eastern (New York)'],
    ['CST6CDT,M3.2.0,M11.1.0', 'US Central (Chicago)'],
    ['MST7MDT,M3.2.0,M11.1.0', 'US Mountain (Denver)'],
    ['PST8PDT,M3.2.0,M11.1.0', 'US Pacific (Los Angeles)'],
    ['<+04>-4', 'Asia/Dubai'],
    ['IST-5:30', 'Asia/Kolkata'],
    ['CST-8', 'Asia/Shanghai, Singapore'],
    ['JST-9', 'Asia/Tokyo'],
    ['AEST-10AEDT,M10.1.0,M4.1.0/3', 'Australia/Sydney'],
  ];

  const TIMEZONE_OPTIONS = TIMEZONE_LIST.map(([name, i]) => [TIMEZONE_CODES[i], name]);

  function optionsFor(s, f) {
    if (Array.isArray(f.opts)) {
      // ethernet modes exist only when the device configuration has an ethernet section
      if (f.id === NETWORK_OPMODE_ID && s.cfg.network && 'ethernet' in s.cfg.network) return f.opts.concat(ETHERNET_OPTIONS);
      return f.opts;
    }
    switch (f.opts) {
      case 'timezones':
        return TIMEZONE_OPTIONS;
      case 'sequences':
        return s.seqs.map((q) => [q.sequencename, q.sequencename]);
      case 'pins':
        return s.pins.map((p) => ['' + p.gpionumber, 'GPIO' + p.gpionumber]);
      case 'models:dig':
      case 'models:ana': {
        const kind = f.opts.slice(-3);
        return s.models
          .filter((m) => m.startsWith(kind) || !(m.startsWith('dig') || m.startsWith('ana')))
          .map((m) => [m, stripExt(m)]);
      }
      case 'certs:ca':
        return [['', 'Default (Built-In Certificate Bundle)'], ...s.certs.map((c) => [c, c])];
      case 'certs:none':
        return [['', 'None'], ...s.certs.map((c) => [c, c])];
      default:
        return [];
    }
  }

  /* ======================================================================== */
  /* GPIO / number sequence helpers                                           */
  /* ======================================================================== */
  function refreshIndexed(s, which) {
    for (const fld of s.fields) {
      if (fld.f.ix !== which || fld.f.sel) continue;
      const v = s.vals[keyOf(s, fld.f)];
      setValue(fld, v !== undefined ? v : fld.f.def);
    }
  }

  function updatePinUsage(s) {
    const pin = s.pins[s.ix.pin];
    const mode = s.byId[PIN_MODE_ID];
    if (!pin || !mode) return;
    const usage = String(pin.gpiousage || '');
    // the board default option is only offered for the pin the board uses for the flashlight
    const opt = Array.from(mode.el.options).find((o) => o.value === 'flashlight-default');
    if (opt) opt.hidden = !usage.startsWith('flashlight');
    if (mode.warn) {
      const restricted = usage.startsWith('restricted');
      mode.warn.hidden = !restricted;
      mode.warn.textContent = restricted ? '(ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â  DEFAULT: ' + usage.substring(12).replace(/-/g, ' ').toUpperCase() + ')' : '';
    }
  }

  // shows which GPIO drives the flashlight in the camera section
  function updateFlashMapping(s) {
    const info = s.byId[FLASH_MAPPING_ID];
    if (!info) return;
    let text = '';
    if (valueOfId(s, 'gpio_customizationenabled') === 'true') {
      text = 'Customized [GPIO Section]';
    } else {
      for (const pin of s.pins) {
        const usage = String(pin.gpiousage || '');
        if (usage.startsWith('flashlight')) text = 'Board Default [GPIO' + pin.gpionumber + ', ' + usage.substring(11).toUpperCase() + ']';
      }
    }
    info.el.textContent = text;
  }

  /* ======================================================================== */
  /* Rendering of the form from the schema                                    */
  /* ======================================================================== */
  function setLabel(target, text) {
    // labels may contain <sup>..</sup> (decimal scaling 10^n), everything else is plain text
    text.split(/(<sup>.*?<\/sup>)/).forEach((part) => {
      const m = /^<sup>(.*)<\/sup>$/.exec(part);
      if (m) target.append(App.el('sup', '', m[1]));
      else if (part) target.append(document.createTextNode(part));
    });
  }

  function buildInput(s, f) {
    const input = document.createElement('input');
    input.type = f.t === 'password' ? 'password' : f.t === 'number' ? 'number' : 'text';
    if (f.t === 'number') input.classList.add('cfg-num');
    const attrs = { min: f.min, max: f.max, step: f.step, placeholder: f.ph, maxlength: f.maxlen, minlength: f.minlen, pattern: f.pattern, autocomplete: f.auto };
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) input.setAttribute(k, v);
    if (f.req) input.required = true;
    if (f.t === 'ip') validateIpMasks([input]);
    if (f.t === 'datetime') validateDateTimeMasks([input]);
    return input;
  }

  function buildField(s, row, f, parent) {
    const fld = { f, row, n: s.fields.length };
    switch (f.t) {
      case 'switch': {
        const wrap = App.el('span', 'cfg-switch-wrap');
        const label = App.el('label', 'cfg-switch');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.setAttribute('aria-label', f.label || row.label || row.title || f.id);
        label.append(cb, document.createElement('span'));
        fld.text = App.el('span', 'cfg-switch-text');
        wrap.append(label, fld.text);
        fld.el = cb;
        parent.append(wrap);
        break;
      }
      case 'cards': {
        const host = App.el('div', 'cfg-opt-cards');
        fld.cards = f.opts.map(([value, label]) => {
          const btn = App.el('button', 'cfg-opt-card');
          btn.type = 'button';
          btn.dataset.action = 'pick';
          btn.dataset.value = value;
          btn.append(App.el('b', '', label), App.el('span', '', (f.desc && f.desc[value]) || ''));
          host.append(btn);
          return { value, btn };
        });
        fld.cur = f.def;
        fld.el = host;
        parent.append(host);
        break;
      }
      case 'select': {
        const sel = document.createElement('select');
        if (f.wide) sel.classList.add('cfg-wide');
        if (f.strong) sel.classList.add('cfg-strong');
        if (f.req) sel.required = true;
        if (f.tz) {
          // common time zones first, then the complete list (the value is the POSIX time zone string)
          const common = App.el('optgroup');
          common.label = 'Common';
          const all = App.el('optgroup');
          all.label = 'All time zones';
          TIMEZONE_COMMON.forEach(([value, label]) => common.append(new Option(label, value)));
          TIMEZONE_OPTIONS.forEach(([value, label]) => all.append(new Option(label, value)));
          sel.append(common, all);
        } else {
          for (const [value, label] of optionsFor(s, f)) sel.add(new Option(label, value));
        }
        if (f.dyn) {
          // file lists: nothing selected until the configured file is found in the list
          const empty = Array.from(sel.options).findIndex((o) => o.value === '');
          sel.selectedIndex = empty;
        }
        fld.el = sel;
        parent.append(sel);
        break;
      }
      case 'info': {
        fld.el = App.el('span', 'cfg-info');
        parent.append(fld.el);
        break;
      }
      default: {
        const input = buildInput(s, f);
        if (f.strong) input.classList.add('cfg-strong');
        fld.el = input;
        if (f.t === 'password') {
          const wrap = App.el('span', 'cfg-pw');
          const eye = App.el('button', 'cfg-eye', 'Show');
          eye.type = 'button';
          eye.dataset.action = 'toggle-password';
          eye.setAttribute('aria-label', 'Show or hide the password');
          wrap.append(input, eye);
          parent.append(wrap);
        } else {
          parent.append(input);
        }
      }
    }
    fld.el.dataset.fid = String(fld.n);
    if (f.t !== 'switch' && f.t !== 'cards' && f.t !== 'info') {
      fld.el.id = 'cfg-f' + fld.n;
    }
    s.fields.push(fld);
    s.byId[f.id] = fld;
    if (!s.fieldsOfRow.has(row)) s.fieldsOfRow.set(row, []);
    s.fieldsOfRow.get(row).push(fld);
    return fld;
  }

  function buildRow(s, row, bodyEl, card) {
    const el = App.el('div', 'cfg-row cfg-l' + (row.lvl || 0));
    const label = App.el('div', 'cfg-label');
    const text = App.el('span');
    setLabel(text, row.label || '');
    label.append(text);
    const ctl = App.el('div', 'cfg-ctl');
    el.append(label, ctl);

    let first = null;
    for (const f of fieldsOf(row)) {
      if (f.pre) ctl.append(App.el('span', 'cfg-pre', f.pre));
      const fld = buildField(s, row, f, ctl);
      if (f.t === 'number' && row.fields) fld.el.classList.add('cfg-num-sm');
      first = first || fld;
    }
    if (row.unit) ctl.append(App.el('span', 'cfg-unit', row.unit));
    if (row.scan) {
      const btn = App.el('button', 'button cfg-scan-btn', 'Find networks');
      btn.type = 'button';
      btn.dataset.action = 'open-scan';
      ctl.append(btn);
    }
    if (row.link) {
      const p = App.el('p', 'cfg-hint');
      const a = App.el('a', '', row.link.text);
      a.href = row.link.href;
      a.target = '_blank';
      a.rel = 'noopener';
      p.append(document.createTextNode(row.link.pre + ' '), a, document.createTextNode(' ' + row.link.post));
      ctl.append(p);
    }
    if (row.usageWarn) {
      first.warn = App.el('span', 'cfg-usage-warn');
      first.warn.hidden = true;
      label.append(first.warn);
    }
    if (first && first.el.id && !row.fields) {
      // the label belongs to the control (click focuses it)
      const l = App.el('label');
      l.htmlFor = first.el.id;
      setLabel(l, row.label || '');
      text.replaceWith(l);
    }
    attachHelp(s, row.id, label);
    bodyEl.append(el);
    card.items.push({ def: row, el });
  }

  // Custom combo box. items: [{ value, label, lead (HTML of the leading icon or color dot) }]; get(): current value;
  // pick(value): the user chose an entry. Returns { el, button, sync() }.
  function createCombo(items, get, pick) {
    const combo = App.el('div', 'theme-combo');
    const btn = App.el('button', 'theme-combo-btn');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    const list = App.el('ul', 'theme-combo-list');
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    combo.append(btn, list);

    const content = (it, suffix = '', withSub = false) => {
      const wrap = App.el('span', 'theme-opt');
      const lead = App.el('span', 'theme-opt-lead');
      lead.innerHTML = it.lead;
      const name = App.el('span', 'theme-opt-name', it.label + suffix);
      if (withSub && it.sub) name.append(App.el('small', 'theme-opt-sub', it.sub)); // second line (e.g. model facts)
      wrap.append(lead, name);
      return wrap;
    };
    let active = -1;
    const close = () => {
      list.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    };
    const mark = (i) => {
      active = i;
      [...list.children].forEach((li, k) => li.classList.toggle('active', k === i));
      list.children[i]?.scrollIntoView({ block: 'nearest' });
    };
    const indexOfCurrent = () => Math.max(0, items.findIndex((it) => String(it.value) === String(get())));
    const api = {
      el: combo,
      button: btn,
      suffix: '',
      markSelected: true,
      sync() {
        const found = items.findIndex((it) => String(it.value) === String(get()));
        const cur = found < 0 && api.placeholder ? { lead: '', label: api.placeholder } : items[indexOfCurrent()];
        btn.replaceChildren(content(cur, api.suffix, !!api.subInButton), App.el('span', 'theme-combo-chev', '\u25BE'));
        list.replaceChildren();
        items.forEach((it, i) => {
          const li = App.el('li', 'theme-combo-item');
          li.setAttribute('role', 'option');
          const selected = api.markSelected && String(it.value) === String(get());
          li.setAttribute('aria-selected', String(selected));
          li.classList.toggle('selected', selected);
          li.append(content(it, '', true));
          li.addEventListener('click', () => {
            close();
            btn.focus();
            pick(it.value);
          });
          li.addEventListener('pointermove', () => mark(i));
          list.append(li);
        });
      },
    };
    const open = () => {
      if (btn.disabled) return;
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      mark(indexOfCurrent());
    };
    btn.addEventListener('click', () => (list.hidden ? open() : close()));
    btn.addEventListener('keydown', (e) => {
      const n = items.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (list.hidden) open();
        else mark((active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
      } else if ((e.key === 'Enter' || e.key === ' ') && !list.hidden) {
        e.preventDefault();
        list.children[active]?.click();
      } else if (e.key === 'Escape' && !list.hidden) {
        e.stopPropagation();
        close();
      }
    });
    const onDoc = (e) => {
      if (!combo.isConnected) {
        document.removeEventListener('pointerdown', onDoc);
        return;
      }
      if (!combo.contains(e.target)) close();
    };
    document.addEventListener('pointerdown', onDoc);
    api.close = close;
    api.sync();
    return api;
  }

  // the wizard builds the same meter type combo as Setup > General
  App.createCombo = createCombo;
  App.meterTypeOptions = () => {
    for (const def of SCHEMA.cards) {
      for (const row of def.rows) if (row.id === 'mqtt_homeassistant_metertype') return row.opts || [];
    }
    return [];
  };

  // Meter Type: custom combo (icon of the meter type in front) in place of the native select, which stays as the form field
  function addMeterTypeCombo(s) {
    const fld = s.byId.mqtt_homeassistant_metertype;
    if (!fld || fld.meterCombo) return;
    const sel = fld.el;
    const items = Array.from(sel.options).map((o) => ({
      value: o.value,
      label: o.textContent,
      lead: logoSvg(METER_TYPE_THEME[Number(o.value)] || 'generic', 24),
    }));
    const combo = createCombo(items, () => sel.value, (value) => {
      sel.value = value;
      sel.dispatchEvent(new Event('change', { bubbles: true })); // the form takes the change over (delta, save bar)
      combo.sync();
      MeterTheme.apply(Number(value)); // icons and colors follow right away
    });
    combo.el.classList.add('is-wide');
    sel.hidden = true;
    sel.after(combo.el);
    fld.meterCombo = combo;
  }

  // Model selection (Digit / Analog ROI processing): custom combo with the model type in front and the facts of the model
  // (version, release date and age, size, input) as a second line. The native select stays as the form field.
  function addModelCombo(s, id) {
    const fld = s.byId[id];
    if (!fld || fld.modelCombo) return;
    const sel = fld.el;
    const items = Array.from(sel.options).filter((o) => o.value).map((o) => {
      const info = modelInfo(o.value);
      return {
        value: o.value,
        label: stripExt(o.textContent),
        lead: `<span class="model-chip" data-kind="${info?.t?.kind === 'Analog' ? 'ana' : 'dig'}">${info?.chip ?? '?'}</span>`,
        sub: info?.sub || '',
      };
    });
    const combo = createCombo(items, () => sel.value, (value) => {
      sel.value = value;
      sel.dispatchEvent(new Event('change', { bubbles: true })); // the form takes the change over (delta, save bar)
      combo.sync();
    });
    combo.placeholder = 'Select a model';
    combo.el.classList.add('is-wide', 'is-models');
    sel.hidden = true;
    sel.after(combo.el);
    combo.sync();
    fld.modelCombo = combo;
  }

  // Theme row (Setup > General > Meter Type & Theme): the main color of the interface follows the meter type (blue for generic).
  // The combo box is inactive until 'Override' is checked. Icons always follow the meter type. Stored in this browser.
  function addThemeRow(body) {
    const row = App.el('div', 'cfg-row cfg-l0 cfg-theme-row');
    const label = App.el('div', 'cfg-label');
    label.append(App.el('span', '', 'Theme'));
    const ctl = App.el('div', 'cfg-ctl');
    row.append(label, ctl);

    const items = Object.entries(COLOR_THEMES).map(([id, t]) => ({
      value: id,
      label: t.label,
      lead: `<span class="theme-dot" style="background:${t.primary}"></span>`,
    }));
    const combo = createCombo(items, () => MeterTheme.colorId, (id) => MeterTheme.setOverride(id));

    const overrideLabel = App.el('label', 'theme-override');
    const overrideBox = document.createElement('input');
    overrideBox.type = 'checkbox';
    overrideLabel.append(overrideBox, ' Override');
    ctl.append(combo.el, overrideLabel);
    body.append(row);

    const update = () => {
      const on = !!MeterTheme.override;
      overrideBox.checked = on;
      combo.button.disabled = !on;
      combo.el.classList.toggle('is-disabled', !on);
      combo.markSelected = on;
      combo.suffix = on ? '' : ' (automatic)';
      combo.sync();
    };
    overrideBox.addEventListener('change', () => {
      combo.close();
      // override on: starts with the color in use, off: back to the meter type
      MeterTheme.setOverride(overrideBox.checked ? MeterTheme.colorId : '');
    });
    const onTheme = () => {
      if (!row.isConnected) {
        window.removeEventListener('meter-theme', onTheme);
        return;
      }
      update();
    };
    window.addEventListener('meter-theme', onTheme); // the meter type or the override changed
    update();
  }

  function buildCard(s, def) {
    const el = App.el('div', 'card cfg-card');
    el.dataset.card = def.id;
    const head = App.el('div', 'card-header');
    const title = App.el('span', 'cfg-card-title', def.title);
    head.append(title);
    const body = App.el('div', 'card-body cfg-body');
    el.append(head, body);
    const card = { def, el, items: [] };
    if (def.enable) {
      const row = { ...def.enable, label: def.title };
      buildField(s, row, def.enable, head).el.classList.add('cfg-enable');
      attachHelp(s, def.enable.id, title);
    }
    for (const row of def.rows) {
      if (row.id) s.rowById[row.id] = row;
      for (const f of row.fields || []) s.rowById[f.id] = f;
    }
    for (const row of def.rows) {
      if (row.hide) continue; // moved to the Configuration page or obsolete: kept in the schema, not shown
      if (isHeading(row)) {
        const h = App.el('div', 'cfg-heading', row.h);
        body.append(h);
        card.items.push({ def: row, el: h });
      } else {
        buildRow(s, row, body, card);
      }
    }
    s.cards.push(card);
    s.cardById[def.id] = card;
    return el;
  }

  /* ---------------------------------------------------------------------- */
  /* Shell: header, navigation, panels                                       */
  /* ---------------------------------------------------------------------- */
  function buildShell(s) {
    const root = s.root;
    root.classList.add('cfg');
    const container = App.el('div', 'container');
    const header = App.el('div', 'container-header');
    header.append(App.el('div', 'container-title', 'Setup'), App.el('div', 'page-sub', 'Device, recognition and integration settings.'));

    const details = App.el('details', 'cfg-desc');
    details.append(App.el('summary', '', 'How it works'));
    const panel = App.el('div', 'help-panel');
    [
      ['Topics', 'Settings are grouped into General, Network, Recognition and MQTT. Rarely needed options appear when you switch on Advanced settings.'],
      ['Descriptions', 'Hover over or click the question mark next to a setting to read what it does.'],
      ['Saving', 'As soon as you change something, a save bar appears at the bottom. If a change needs a restart, it says Save and restart. Discard drops your changes.'],
    ].forEach(([h, p]) => {
      const item = App.el('div', 'help-item');
      item.append(App.el('h4', '', h), App.el('p', '', p));
      panel.append(item);
    });
    details.append(panel);
    if (s.ctx.query && s.ctx.query.has('description')) details.open = true;

    const toggle = App.el('label', 'cfg-adv-toggle');
    s.advBox = document.createElement('input');
    s.advBox.type = 'checkbox';
    s.advBox.checked = s.advOn;
    toggle.append('Advanced settings', s.advBox);
    header.append(details, toggle);

    s.content = App.el('div', 'container-content');
    s.loading = App.el('div', 'cfg-loading', 'Loading configuration ...');
    s.content.append(s.loading);
    container.append(header, s.content);

    s.scanDlg = buildScanDialog();
    root.append(container, s.scanDlg);
  }

  function buildScanDialog() {
    const dlg = App.el('dialog', 'dlg cfg-scan');
    const body = App.el('div', 'dlg-body');
    body.append(App.el('h2', '', 'Available Networks'));
    const list = App.el('div', 'cfg-scan-list');
    list.append(App.el('div', '', 'Scan to list available networks'));
    const actions = App.el('div', 'dlg-actions');
    const scan = App.el('button', 'button btn-action', 'Scan Networks');
    scan.type = 'button';
    scan.dataset.action = 'run-scan';
    const close = App.el('button', 'button ghost', 'Close');
    close.type = 'button';
    close.dataset.action = 'close-scan';
    actions.append(close, scan);
    body.append(list, actions);
    dlg.append(body);
    return dlg;
  }

  function buildForm(s) {
    const cfg = s.cfg;
    s.vals = {};
    for (const [key, value] of jsonObjectKeyify(cfg)) s.vals[key.toLowerCase()] = value;
    s.pins = (cfg.gpio && cfg.gpio.gpiopin) || [];
    s.seqs = (cfg.numbersequences && cfg.numbersequences.sequence) || [];
    s.anyPwm = s.pins.some((p) => p.gpiousage === 'flashlight-pwm');
    s.anySmartled = s.pins.some((p) => p.gpiousage === 'flashlight-smartled');
    // first enabled pin is selected, sequence 0 is selected
    const firstEnabled = s.pins.findIndex((p) => p.pinenabled);
    s.ix = { pin: firstEnabled < 0 ? 0 : firstEnabled, seq: 0 };
    s.fields = [];
    s.byId = {};
    s.rowById = {};
    s.fieldsOfRow = new Map();
    s.cards = [];
    s.cardById = {};

    const panels = App.el('div', 'cfg-panels');
    s.panels = {};
    const nav = App.el('nav', 'cfg-nav');
    nav.setAttribute('aria-label', 'Setup sections');
    s.navButtons = {};
    s.sections = {};
    const cardEls = {};
    for (const def of SCHEMA.cards) cardEls[def.id] = buildCard(s, def);
    addThemeRow(cardEls.metertheme.querySelector('.cfg-body'));
    addMeterTypeCombo(s);
    addModelCombo(s, 'digit_model');
    addModelCombo(s, 'analog_model');

    for (const g of SCHEMA.groups) {
      const label = App.el('div', 'cfg-nav-group', g.label);
      if (g.adv) label.dataset.adv = '1';
      nav.append(label);
      for (const sec of g.sections) {
        const b = App.el('button', '', sec.label);
        b.type = 'button';
        b.dataset.action = 'section';
        b.dataset.section = sec.id;
        if (g.adv) b.dataset.adv = '1';
        nav.append(b);
        s.navButtons[sec.id] = b;
        s.sections[sec.id] = { ...sec, adv: !!g.adv };

        const panel = App.el('div', 'cfg-panel');
        panel.hidden = true;
        if (sec.id === 'general') {
          s.hero = App.el('div', 'cfg-hero');
          s.hero.append(App.el('div', 'cfg-hero-label', 'This device'), App.el('div', 'chips'));
          panel.append(s.hero);
        }
        if (sec.note) {
          const note = App.el('div', 'cfg-note');
          note.append(App.el('span', '', 'Camera image settings (zoom, brightness, exposure, flash), alignment markers and ROIs are set up on the Configuration page.'));
          const open = App.el('button', 'button', 'Open Configuration');
          open.type = 'button';
          open.dataset.action = 'open-setup';
          note.append(open);
          panel.append(note);
        }
        for (const id of sec.cards) panel.append(cardEls[id]);
        panels.append(panel);
        s.panels[sec.id] = panel;
      }
    }

    const layout = App.el('div', 'cfg-layout');
    layout.append(nav, panels);
    s.layout = layout;
    s.content.replaceChildren(layout);

    // initial values: configuration value where present, schema default otherwise
    for (const fld of s.fields) {
      const f = fld.f;
      if (f.t === 'info' || f.noload) continue;
      if (f.sel) {
        fld.el.selectedIndex = Math.min(s.ix[f.sel], fld.el.options.length - 1);
        continue;
      }
      const v = s.vals[keyOf(s, f)];
      setValue(fld, v !== undefined ? v : f.def);
    }
    s.byId.mqtt_homeassistant_metertype?.meterCombo?.sync();
    s.byId.digit_model?.modelCombo?.sync();
    s.byId.analog_model?.modelCombo?.sync();
    updatePinUsage(s);
    updateFlashMapping(s);
    attachHelpEvents(s);
    applyVisibility(s);
    renderHero(s);
    s.delta = {};
    s.reboot = false;
    updateSaveBar(s);
  }

  /* ---------------------------------------------------------------------- */
  /* Sections (sub routes)                                                   */
  /* ---------------------------------------------------------------------- */
  function showSection(s, requested) {
    if (!s.sections) return; // still loading, the route is applied after the build
    let id = requested && s.sections[requested] ? requested : null;
    if (!id) {
      const saved = storageGet('session', SECTION_STORAGE_KEY);
      id = saved && s.sections[saved] ? saved : DEFAULT_SECTION;
    }
    if (s.sections[id].adv && !s.advOn) setAdvanced(s, true);
    s.section = id;
    storageSet('session', SECTION_STORAGE_KEY, id);
    for (const [key, panel] of Object.entries(s.panels)) panel.hidden = key !== id;
    for (const [key, btn] of Object.entries(s.navButtons)) btn.classList.toggle('cfg-active', key === id);
    if (s.hero) s.hero.hidden = id !== 'general';
    applyVisibility(s);
  }

  function setAdvanced(s, on) {
    s.advOn = on;
    s.advBox.checked = on;
    storageSet('local', ADVANCED_STORAGE_KEY, on ? '1' : '0');
    if (s.sections) applyVisibility(s);
  }

  /* ---------------------------------------------------------------------- */
  /* General summary                                                         */
  /* ---------------------------------------------------------------------- */
  function renderHero(s) {
    if (!s.hero) return;
    const chips = s.hero.querySelector('.chips');
    chips.textContent = '';
    const add = (label, value) => {
      const c = App.el('span', 'chip');
      c.append(App.el('b', '', label), document.createTextNode(value));
      chips.append(c);
    };
    const mode = s.byId.operationmode_opmode;
    const hit = mode && mode.f.opts.find(([v]) => v === mode.cur);
    add('Mode', hit ? hit[1] : '-');
    if (paramValue('operationmode_opmode') === '1') add('Interval', paramValue('operationmode_automaticprocessinterval') + ' min');
    add('Host', paramValue('network_hostname') || '-');
    add('Digits', paramValue('digit_enabled') === 'true' ? 'on' : 'off');
    add('Analog', paramValue('analog_enabled') === 'true' ? 'on' : 'off');
    add('Protection', paramValue('webui_httpauth_authmode') === '1' ? 'on' : 'off');
  }

  /* ---------------------------------------------------------------------- */
  /* Help popover                                                            */
  /* ---------------------------------------------------------------------- */
  function ensureHelpPop(s) {
    const h = s.help;
    if (h.pop) return;
    h.pop = App.el('div', 'cfg-help-pop');
    h.pop.setAttribute('role', 'tooltip');
    h.pop.hidden = true;
    for (const cls of ['cfg-hp-title', 'cfg-hp-text', 'cfg-hp-opts', 'cfg-hp-now', 'cfg-hp-tip']) h.pop.append(App.el('div', cls));
    h.pop.addEventListener('mouseenter', () => clearTimeout(h.timer));
    h.pop.addEventListener('mouseleave', () => scheduleHideHelp(s));
    document.body.append(h.pop);
  }

  function renderHelp(s) {
    const h = s.help;
    if (!h.pop || !h.key) return;
    const info = PARAM_HELP[h.key];
    h.pop.querySelector('.cfg-hp-title').textContent = info.title;
    h.pop.querySelector('.cfg-hp-text').textContent = info.text;

    const optsHost = h.pop.querySelector('.cfg-hp-opts');
    optsHost.textContent = '';
    if (info.options) {
      const cur = info.current ? info.current(paramValue) : paramValue(h.key); // `current`: help keys that are not the field value
      for (const [value, [name, desc]] of Object.entries(info.options)) {
        const row = App.el('div', 'cfg-hp-opt' + (value === cur ? ' cfg-current' : ''));
        row.append(App.el('b', '', name), App.el('span', '', desc));
        optsHost.append(row);
      }
    }
    h.pop.querySelector('.cfg-hp-now').textContent = info.now ? info.now(paramValue) : '';
    const tip = h.pop.querySelector('.cfg-hp-tip');
    tip.textContent = info.tip || '';
    tip.classList.toggle('cfg-warn', !!info.warn);
  }

  function placeHelp(s) {
    const h = s.help;
    if (!h.btn || !h.pop) return;
    h.pop.hidden = false;
    const r = h.btn.getBoundingClientRect();
    const pw = h.pop.offsetWidth;
    const ph = h.pop.offsetHeight;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - pw - 12));
    let top = r.bottom + 10;
    if (top + ph > window.innerHeight - 12) top = Math.max(12, r.top - ph - 10);
    h.pop.style.left = left + 'px';
    h.pop.style.top = top + 'px';
  }

  function showHelp(s, btn, key) {
    const h = s.help;
    ensureHelpPop(s);
    clearTimeout(h.timer);
    if (h.btn && h.btn !== btn) h.btn.classList.remove('cfg-pinned');
    h.key = key;
    h.btn = btn;
    renderHelp(s);
    placeHelp(s);
  }

  function hideHelp(s) {
    const h = s.help;
    clearTimeout(h.timer);
    if (h.pop) h.pop.hidden = true;
    if (h.btn) h.btn.classList.remove('cfg-pinned');
    h.pinned = false;
    h.key = null;
    h.btn = null;
  }

  function scheduleHideHelp(s) {
    const h = s.help;
    if (h.pinned) return;
    clearTimeout(h.timer);
    h.timer = setTimeout(() => hideHelp(s), HELP_HIDE_DELAY_MS);
  }

  // adds the question mark button of a parameter that has an entry in PARAM_HELP
  function attachHelp(s, id, host) {
    const info = PARAM_HELP[id];
    if (!info) return;
    const btn = App.el('button', 'cfg-help-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Explain: ' + info.title);
    btn.dataset.help = id;
    host.append(btn);
    host.closest('.cfg-row') && host.closest('.cfg-row').classList.add('cfg-has-help');
  }

  // listeners of the help system (hover, focus, click delegated; document level ones die with the view)
  function attachHelpEvents(s) {
    const h = s.help;
    const btnOf = (e) => (e.target.closest ? e.target.closest('.cfg-help-btn') : null);
    s.layout.addEventListener('mouseover', (e) => {
      const b = btnOf(e);
      if (b && b !== h.btn) showHelp(s, b, b.dataset.help);
      else if (b) clearTimeout(h.timer);
    });
    s.layout.addEventListener('mouseout', (e) => {
      if (btnOf(e)) scheduleHideHelp(s);
    });
    s.layout.addEventListener('focusin', (e) => {
      const b = btnOf(e);
      if (b) showHelp(s, b, b.dataset.help);
    });
    s.layout.addEventListener('focusout', (e) => {
      if (btnOf(e)) scheduleHideHelp(s);
    });
    // keep an open help current while a value is edited
    for (const ev of ['change', 'input']) {
      s.layout.addEventListener(ev, () => {
        if (h.key) {
          renderHelp(s);
          placeHelp(s);
        }
      });
    }
  }

  // document / window level listeners: registered once per mount, removed by the abort signal on unmount
  function attachGlobalHelpEvents(s) {
    const h = s.help;
    const sig = s.ac.signal;
    document.addEventListener('click', () => {
      if (h.pinned) hideHelp(s);
    }, { signal: sig });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideHelp(s);
    }, { signal: sig });
    window.addEventListener('scroll', () => hideHelp(s), { capture: true, signal: sig });
  }

  function onHelpClick(s, btn) {
    const h = s.help;
    if (h.pinned && h.btn === btn) {
      hideHelp(s);
      return;
    }
    showHelp(s, btn, btn.dataset.help);
    h.pinned = true;
    btn.classList.add('cfg-pinned');
  }

  /* ---------------------------------------------------------------------- */
  /* WLAN scan dialog                                                        */
  /* ---------------------------------------------------------------------- */
  // 0..4 active bars of the signal strength, thresholds as in the dashboard
  const signalBars = (rssi) => (rssi >= -55 ? 4 : rssi >= -67 ? 3 : rssi >= -78 ? 2 : rssi >= -85 ? 1 : 0);

  function signalIcon(bars, secured) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 40 16');
    svg.setAttribute('class', 'cfg-scan-icon');
    svg.setAttribute('aria-hidden', 'true');
    const add = (tag, attrs, cls) => {
      const el = document.createElementNS(svgNs, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      if (cls) el.setAttribute('class', cls);
      svg.append(el);
    };
    if (secured) {
      add('rect', { x: 0, y: 7, width: 9, height: 8, rx: 1.5 }, 'cfg-scan-lock');
      add('path', { d: 'M2 7V5a2.5 2.5 0 0 1 5 0v2', fill: 'none', 'stroke-width': 1.5 }, 'cfg-scan-lock');
    }
    for (let i = 0; i < 4; i++) {
      add('rect', { x: 15 + i * 6.5, y: 15 - (i + 1) * 3.5, width: 4.5, height: (i + 1) * 3.5, rx: 1 }, i < bars ? 'cfg-scan-bar on' : 'cfg-scan-bar');
    }
    return svg;
  }

  // Visible networks only, one entry per SSID (the strongest), strongest first
  function cleanNetworks(networks) {
    const best = new Map();
    for (const n of networks) {
      const ssid = String(n.ssid ?? '').trim();
      if (!ssid) continue; // hidden network without name
      const known = best.get(ssid);
      if (!known || n.rssi > known.rssi) best.set(ssid, { ...n, ssid });
    }
    return [...best.values()].sort((x, y) => y.rssi - x.rssi);
  }

  async function runScan(s) {
    const list = s.scanDlg.querySelector('.cfg-scan-list');
    const token = ++s.scanToken;
    const scanBtn = s.scanDlg.querySelector('[data-action=run-scan]');
    scanBtn.disabled = true;
    list.replaceChildren(App.el('div', 'cfg-scan-empty', 'Scanning ...'));
    let networks = [];
    try {
      networks = await Api.config.wlanScan();
    } catch (e) {
      networks = [];
    }
    if (s.dead || token !== s.scanToken) return;
    scanBtn.disabled = false;
    list.replaceChildren();

    const visible = cleanNetworks(networks);
    if (!visible.length) {
      list.append(App.el('div', 'cfg-scan-empty', 'No networks found'));
      return;
    }
    const current = (s.byId[WLAN_SSID_ID]?.el.value || '').trim();
    for (const n of visible) {
      // SSIDs come from the air: textContent only
      const row = App.el('button', 'cfg-scan-item');
      row.type = 'button';
      row.dataset.action = 'pick-ssid';
      row.dataset.ssid = n.ssid;

      const text = App.el('span', 'cfg-scan-text');
      const name = App.el('span', 'cfg-scan-ssid', n.ssid);
      if (n.ssid === current) name.append(App.el('span', 'cfg-scan-current', 'current'));
      const secured = n.authmode !== 'OPEN';
      text.append(name, App.el('span', 'cfg-scan-meta', `Channel ${n.channel} \u00b7 ${n.rssi} dBm \u00b7 ${secured ? n.authmode : 'Open'}`));

      const icon = signalIcon(signalBars(n.rssi), secured);
      row.append(text, icon);
      list.append(row);
    }
  }

  function pickSsid(s, ssid) {
    const fld = s.byId[WLAN_SSID_ID];
    s.scanDlg.close();
    if (!fld) return;
    fld.el.value = ssid;
    fld.el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* ---------------------------------------------------------------------- */
  /* Events                                                                  */
  /* ---------------------------------------------------------------------- */
  function onClick(s, e) {
    const t = e.target.closest ? e.target.closest('[data-action],.cfg-help-btn') : null;
    if (!t || !s.root.contains(t)) return;
    if (t.classList.contains('cfg-help-btn')) {
      e.stopPropagation();
      onHelpClick(s, t);
      return;
    }
    switch (t.dataset.action) {
      case 'section':
        App.navigate('#/system/setup/' + t.dataset.section);
        break;
      case 'pick': {
        const fld = s.fields[Number(t.closest('[data-fid]').dataset.fid)];
        setValue(fld, t.dataset.value);
        onChanged(s, fld);
        break;
      }
      case 'toggle-password': {
        const input = t.previousElementSibling;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        t.textContent = show ? 'Hide' : 'Show';
        break;
      }
      case 'open-scan':
        s.scanDlg.showModal();
        break;
      case 'run-scan':
        runScan(s);
        break;
      case 'close-scan':
        s.scanDlg.close();
        break;
      case 'pick-ssid':
        pickSsid(s, t.dataset.ssid);
        break;
      case 'open-setup':
        App.navigate(SETUP_IMAGE_ROUTE);
        break;
      default:
    }
  }

  function onFieldEvent(s, e) {
    const fidEl = e.target.dataset && e.target.dataset.fid !== undefined ? e.target : null;
    if (!fidEl) return;
    const fld = s.fields[Number(fidEl.dataset.fid)];
    if (!fld) return;
    if (e.type === 'change') {
      onChanged(s, fld);
    } else {
      // typing: no delta yet (the old page commits on change), but summary / help follow along
      renderHero(s);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Loading                                                                 */
  /* ---------------------------------------------------------------------- */
  async function loadAndBuild(s) {
    s.content.replaceChildren(s.loading);
    s.loading.textContent = 'Loading configuration ...';
    SaveBar.set({ dirty: false });
    try {
      // the model / certificate lists are optional: the API layer already told the user when they fail
      const [cfg, models, certs] = await Promise.all([Api.config.load(), Api.config.models().catch(() => []), Api.config.certs().catch(() => [])]);
      if (s.dead) return;
      s.cfg = cfg;
      MeterTheme.applyFromConfig(); // an unsaved meter type preview is dropped
      s.models = models;
      s.certs = certs;
      buildForm(s);
      showSection(s, s.ctx.parts && s.ctx.parts[0]);
    } catch (error) {
      if (s.dead) return;
      const msg = `Failed loading configuration: ${error.message}`;
      s.loading.textContent = msg;
      firework.launch(msg, 'danger', 30000);
      console.error(msg, error);
    }
  }

  /* ======================================================================== */
  /* View                                                                     */
  /* ======================================================================== */
  App.register('system-setup', {
    title: 'Setup',

    mount(root, ctx) {
      const s = (S = {
        root,
        ctx,
        dead: false,
        ac: new AbortController(),
        timer: null,
        scanToken: 0,
        help: { pop: null, key: null, btn: null, pinned: false, timer: null },
        advOn: storageGet('local', ADVANCED_STORAGE_KEY) === '1',
        delta: {},
        reboot: false,
        active: {},
      });
      buildShell(s);
      // the signal strength icons of the scan dialog are dark: invert them on the dark theme
      const applyTheme = (isDark) => root.classList.toggle('cfg-dark', !!isDark);
      applyTheme(document.documentElement.classList.contains('dark'));
      s.offTheme = App.onThemeChange(applyTheme);
      attachGlobalHelpEvents(s);
      const sig = s.ac.signal;
      root.addEventListener('click', (e) => onClick(s, e), { signal: sig });
      for (const ev of ['change', 'input']) root.addEventListener(ev, (e) => onFieldEvent(s, e), { signal: sig });
      s.advBox.addEventListener('change', () => {
        setAdvanced(s, s.advBox.checked);
        // an advanced section is not reachable without the switch
        if (!s.advOn && s.section && s.sections[s.section].adv) App.navigate('#/system/setup/' + DEFAULT_SECTION);
      }, { signal: sig });
      loadAndBuild(s);
    },

    // sub route changed (#/system/setup/network): the router does not remount the view
    route(ctx) {
      if (!S) return;
      S.ctx = ctx;
      showSection(S, ctx.parts && ctx.parts[0]);
    },

    unmount() {
      const s = S;
      if (!s) return;
      s.dead = true;
      clearTimeout(s.timer);
      s.ac.abort();
      if (typeof s.offTheme === 'function') s.offTheme();
      hideHelp(s);
      if (s.help.pop) s.help.pop.remove();
      if (s.scanDlg && s.scanDlg.open) s.scanDlg.close();
      SaveBar.set({ dirty: false });
      S = null;
    },
  });
})();

/* ========================================================================== */
/* Cycle monitor (sidebar): state of the main process, seconds counter, manual start */
/* ========================================================================== */

// Hint for a newer release: info icon next to the version in the sidebar footer and a dot at the Update menu item
const UpdateHint = {
  async check(installed) {
    const rel = window.UpdateCheck ? await window.UpdateCheck.newer(installed).catch(() => null) : null;
    const btn = document.getElementById('update-hint');
    if (btn) {
      btn.hidden = !rel;
      if (rel) {
        const text = `Newer version available: ${rel.tag}`;
        btn.title = text;
        btn.setAttribute('aria-label', text);
        btn.onclick = () => App.navigate('#/system/update');
      }
    }
    document.querySelectorAll('[data-route="system-update"], .nav-parent').forEach((n) => n.classList.toggle('has-update', !!rel));
  },
};

const CycleMonitor = (() => {
  const POLL_MS = 2000;
  let status = null; // last answer of Api.process.status()
  let fetchedAt = 0; // performance.now() of the answer
  let pollTimer = null;
  let tickTimer = null;
  let busy = false;
  let polling = false; // one request at a time: a busy device must not get a queue of status requests
  let lastAnswerAt = 0; // performance.now() of the last answer
  let stale = false; // the last request failed, the values are the last known ones

  const $ = (id) => document.getElementById(id);

  const formatSeconds = (s) => {
    s = Math.max(0, Math.floor(s));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  };

  // countdown 4:12 or 1:04:12
  const formatCountdown = (s) => {
    s = Math.max(0, Math.ceil(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };

  // Countdown / elapsed text of the current state (sidebar and dashboard use the same text); '' without a status
  function timerText() {
    if (!status) return '';
    const drift = (performance.now() - fetchedAt) / 1000;
    const paused = !!status.paused && status.autoStart;
    const waiting = status.autoStart && !status.running && status.nextRunSeconds >= 0;
    let timer;
    if (status.running && status.cycleSeconds !== undefined) {
      // Countdown: the duration of the last cycle (processTime) is the best estimate for this one
      const elapsed = status.cycleSeconds + drift;
      const left = status.processTime - elapsed;
      timer = `running for ${formatSeconds(elapsed)}`;
      if (status.processTime > 0) timer += left > 0 ? ` ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· about ${formatSeconds(Math.ceil(left))} left` : ' ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· finishing ...';
    } else if (waiting) {
      // Automatic mode: countdown to the next run instead of the idle time
      timer = paused
        ? `no automatic cycles ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${formatCountdown(status.nextRunSeconds)} left`
        : `next run in ${formatCountdown(status.nextRunSeconds - drift)}`;
    } else {
      timer = `${status.running ? 'running for' : 'in this state for'} ${formatSeconds(status.stateSeconds + drift)}`;
    }
    if (status.running && paused) timer += ' ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· paused afterwards';
    return timer;
  }

  function render() {
    const panel = $('cycle-panel');
    if (!panel) return;
    const btn = $('cycle-start');
    const pauseBtn = $('cycle-pause');
    const lastRow = $('cycle-last');

    // While the device computes an image it does not answer for a while: keep the last state ("busy") and
    // only report 'not reachable' when the silence lasts much longer than a cycle step
    // A tab in the background does not ask the device: that is no loss of connection, the last state stays
    const silence = performance.now() - lastAnswerAt;
    const unreachable = !status || (!document.hidden && silence > (status.running ? 90000 : 15000));

    if (unreachable) {
      panel.dataset.kind = 'offline';
      panel.dataset.phase = '';
      $('cycle-state').textContent = 'Device not reachable';
      $('cycle-count').textContent = '#-';
      $('cycle-timer').textContent = 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ';
      btn.disabled = true;
      btn.classList.remove('queue');
      btn.textContent = 'Start cycle';
      pauseBtn.hidden = true;
      lastRow.hidden = true;
      setFaviconState('offline');
      setTitleBadge('(no connection) ');
      return;
    }

    // paused: the countdown to the next automatic cycle stands still (config mode)
    const paused = !!status.paused && status.autoStart;
    const waiting = status.autoStart && !status.running && status.nextRunSeconds >= 0;
    const kind = status.error < 0 ? 'error' : status.error > 0 ? 'warn' : status.running ? 'running' : paused ? 'paused' : 'idle';
    panel.dataset.kind = kind;
    setFaviconState(status.error < 0 ? 'error' : status.error > 0 ? 'warn' : paused ? 'paused' : 'ok');
    setTitleBadge(status.error < 0 ? '(!) ' : paused ? '(paused) ' : '');
    panel.dataset.phase = status.running && /take/i.test(status.state || '') ? 'capture' : '';
    $('cycle-state').textContent = stale ? 'Computing ...' : paused && waiting ? 'Paused (config mode)' : status.state || '-';
    $('cycle-count').textContent = `#${status.cycle}`;
    if (stale && status.running) panel.dataset.kind = 'running';

    const drift = (performance.now() - fetchedAt) / 1000;
    const timer = timerText();
    $('cycle-timer').textContent = stale ? `${timer} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· device is busy` : timer;

    pauseBtn.hidden = !status.autoStart;
    pauseBtn.disabled = false; // also usable while a cycle runs or the device is busy
    panel.dataset.paused = paused ? '1' : '';
    pauseBtn.title = paused ? 'Resume automatic cycles' : 'Pause countdown (config mode)';
    pauseBtn.setAttribute('aria-label', pauseBtn.title);
    const last = formatLastSuccess(status, drift);
    lastRow.hidden = false;
    $('cycle-last-value').textContent = last.text;
    lastRow.title = last.title;

    const ready = status.cycleStart === 'ready' && !stale;
    const queued = status.cycleStart === 'queued' && !stale;
    btn.disabled = busy || stale || !(ready || queued);
    btn.classList.toggle('queue', queued);
    btn.textContent = queued ? 'Queue next cycle' : status.running ? 'Next cycle queued' : 'Start cycle';
    btn.title = ready ? 'Start a cycle now' : queued ? 'A cycle is running. The next one starts right after it.' : 'The process is not ready for a cycle start';
  }

  async function poll() {
    if (document.hidden || polling) return;
    polling = true;
    try {
      const answer = await Api.process.status();
      if (answer) {
        if (pausePending !== null) answer.paused = pausePending; // the request is still on its way
        status = answer;
        fetchedAt = performance.now();
        lastAnswerAt = fetchedAt;
        stale = false;
        window.dispatchEvent(new CustomEvent('cycle-status', { detail: answer }));
      } else if (status) {
        stale = true; // keep the last known state
        if (!lastAnswerAt) status = null;
      }
    } finally {
      polling = false;
    }
    render();
  }

  // Pause / resume: the button reacts right away (also while a cycle is running or the device is busy), the status polls
  // do not overwrite the wish until the device has answered
  let pausePending = null; // true / false while a request is on its way
  async function togglePause() {
    if (pausePending !== null || !status) return;
    const want = !status.paused;
    pausePending = want;
    status.paused = want;
    render();
    const ok = await Api.process.setPaused(want);
    pausePending = null;
    if (!ok && status) status.paused = !want; // not accepted: back to the old state
    await poll();
  }

  async function start() {
    if (busy) return;
    busy = true;
    render();
    await Api.process.cycleStart();
    busy = false;
    await poll();
  }

  return {
    last: () => status,
    timerText: () => (stale && status ? `${timerText()} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· device is busy` : timerText()),
    start() {
      $('cycle-start')?.addEventListener('click', start);
      $('cycle-pause')?.addEventListener('click', togglePause);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        lastAnswerAt = performance.now(); // back in the tab: time for the first answer before 'no connection' is shown
        poll();
      });
      poll();
      pollTimer = setInterval(poll, POLL_MS);
      tickTimer = setInterval(render, 1000); // seconds counter between two polls
    },
  };
})();


/* ========================================================================== */
/* Boot                                                                       */
/* ========================================================================== */

window.addEventListener('DOMContentLoaded', () => {
  App.start();
  CycleMonitor.start();
});
