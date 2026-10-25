#!/usr/bin/env node
/* Regression harness: the splash must leave even when the Supabase CDN SDK
 * is unavailable. This reproduces browsers where the key file loads but the
 * third-party UMD script is blocked or fails to load. */
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
const cutoff = source.indexOf('// --- 1단계: 닉네임 + 성별 ---');
if (cutoff < 0) throw new Error('startup cutoff marker not found');

function makeElement(id) {
  const classes = new Set(id === 'screen-splash' ? ['screen', 'active'] : id === 'screen-ob-profile' || id === 'screen-ob-email' ? ['screen'] : []);
  const target = {
    id,
    value: '',
    hidden: false,
    textContent: '',
    innerHTML: '',
    style: {},
    dataset: {},
    className: '',
    classList: {
      add: (...xs) => xs.forEach(x => classes.add(x)),
      remove: (...xs) => xs.forEach(x => classes.delete(x)),
      contains: x => classes.has(x),
      toggle: (x, force) => force === undefined ? (classes.has(x) ? (classes.delete(x), false) : (classes.add(x), true)) : (force ? classes.add(x) : classes.delete(x), force),
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    appendChild() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    closest() { return null; },
    focus() {},
  };
  return new Proxy(target, { get: (obj, key) => key in obj ? obj[key] : (() => {}) });
}

const elements = new Map();
const getElement = id => {
  if (!elements.has(id)) elements.set(id, makeElement(id));
  return elements.get(id);
};
getElement('screen-splash');
getElement('screen-ob-profile');
getElement('screen-ob-email');

const scheduled = [];
const document = {
  getElementById: getElement,
  querySelectorAll(selector) {
    if (selector === '.screen') return [getElement('screen-splash'), getElement('screen-ob-profile'), getElement('screen-ob-email')];
    return [];
  },
  querySelector() { return null; },
  addEventListener() {},
  createElement: id => makeElement(id),
};
const navigator = { userAgent: 'RegressionHarness', standalone: false, geolocation: {} };
const window = {
  SUPABASE_KEYS: { url: 'https://example.supabase.co', anonKey: 'public-anon-key' },
  // Deliberately no window.supabase: simulates a blocked/failed CDN script.
  // Keep map-dependent async setup pending; this harness targets the startup
  // path before external map dependencies become available.
  __kakaoReady: new Promise(() => {}),
  navigator,
  location: { search: '', href: 'https://example.test/' },
  addEventListener() {},
};

const context = {
  window,
  document,
  navigator,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
  location: window.location,
  history: { pushState() {}, replaceState() {} },
  URL,
  URLSearchParams,
  AbortController,
  Blob,
  FileReader: function FileReader() {},
  Image: function Image() {},
  fetch: async () => ({ ok: false, json: async () => ({}) }),
  console,
  Promise,
  Date,
  Math,
  setTimeout(fn, ms) { scheduled.push({ fn, ms }); return scheduled.length; },
  clearTimeout() {},
  setInterval() { return 1; },
  clearInterval() {},
};
vm.createContext(context);
vm.runInContext(source.slice(0, cutoff), context, { filename: 'app.js' });

const splashTimer = scheduled.find(x => x.ms === 1750);
if (!splashTimer) throw new Error('FAIL: splash transition timer was not scheduled');
splashTimer.fn();
// 새 사용자는 인증 서버에서 "인증됨"을 확인받기 전까지 학교 메일 인증 화면으로 간다(여기선 fetch가 실패한다).
// 스플래시에 갇히면 안 되고, 인증 없이 프로필 화면으로 새어 들어가도 안 된다.
setImmediate(() => {
  if (getElement('screen-ob-profile').classList.contains('active')) {
    throw new Error('FAIL: unverified new user must not reach the profile screen');
  }
  if (!getElement('screen-ob-email').classList.contains('active')) {
    throw new Error('FAIL: splash did not transition to school email verification');
  }
  console.log('PASS: splash exits to school email verification when Supabase SDK CDN is unavailable');
});
