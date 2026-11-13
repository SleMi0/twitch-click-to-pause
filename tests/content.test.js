'use strict';

// In-repo state-machine tests for Twitch Click to Pause.
// Loads the REAL src/content.js in a vm with a mocked DOM and fake timers.
// Run: node --test tests/content.test.js
// Optional subset: TEST_FILTER=... node --test tests/content.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test: nodeTest } = require('node:test');
const nodeAssert = require('node:assert/strict');

const SRC = path.join(__dirname, '..', 'src', 'content.js');
const code = fs.readFileSync(SRC, 'utf8');
const FILTER = process.env.TEST_FILTER || '';

const PLAYER_SELECTOR = '[data-a-target="video-player"], .video-player';
const PLAY_PAUSE = 'button[data-a-target="player-play-pause-button"]';
const FULLSCREEN = 'button[data-a-target="player-fullscreen-button"]';

const trackingMaps = [];
class TrackingMap extends Map {
  constructor(...args) { super(...args); trackingMaps.push(this); }
}

let fullscreenHook = null;

class MockElement {
  constructor(name, opts = {}) {
    this.name = name;
    this.tagName = opts.tagName || 'DIV';
    this.rect = opts.rect || { left: 0, top: 0, right: 800, bottom: 450, width: 800, height: 450 };
    this.parent = opts.parent || null;
    this.attrs = opts.attrs || {};
    this.matchSelectors = opts.matchSelectors || [];
    this.querySelectorMap = opts.querySelectorMap || {};
    this.querySelectorAllMap = opts.querySelectorAllMap || {};
    this.paused = opts.paused === undefined ? false : opts.paused;
    this.disabled = Boolean(opts.disabled);
    this.playCalls = 0;
    this.pauseCalls = 0;
    this.clickCalls = 0;
    this.clickHandler = opts.clickHandler || null;
    this.clientWidth = opts.clientWidth === undefined ? this.rect.width : opts.clientWidth;
    this.clientHeight = opts.clientHeight === undefined ? this.rect.height : opts.clientHeight;
    this.offsetWidth = opts.offsetWidth === undefined ? this.rect.width : opts.offsetWidth;
    this.offsetHeight = opts.offsetHeight === undefined ? this.rect.height : opts.offsetHeight;
    this.clientLeft = opts.clientLeft || 0;
    this.clientTop = opts.clientTop || 0;
    this.paddingLeft = opts.paddingLeft || 0;
    this.paddingRight = opts.paddingRight || 0;
    this.paddingTop = opts.paddingTop || 0;
    this.paddingBottom = opts.paddingBottom || 0;
    this.cursor = opts.cursor || 'auto';
  }
  getBoundingClientRect() { return this.rect; }
  matches(sel) { return this.matchSelectors.some((s) => sel.includes(s)); }
  closest(sel) {
    let el = this;
    while (el) {
      if (el.matches(sel)) return el;
      el = el.parent;
    }
    return null;
  }
  contains(el) {
    let cur = el;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parent;
    }
    return false;
  }
  querySelector(sel) { return this.querySelectorMap[sel] || null; }
  querySelectorAll(sel) { return this.querySelectorAllMap[sel] || []; }
  getAttribute(n) { return this.attrs[n] === undefined ? null : this.attrs[n]; }
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n); }
  get tabIndex() {
    const value = this.attrs.tabindex;
    if (value === undefined) return -1;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : -1;
  }
  click() {
    this.clickCalls += 1;
    if (this.disabled) return;
    if (this.clickHandler) this.clickHandler(this);
  }
  play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); }
  pause() { this.pauseCalls += 1; this.paused = true; }
  requestFullscreen() {
    if (fullscreenHook) return fullscreenHook(this);
    return Promise.resolve();
  }
}

class MockIframe extends MockElement {
  constructor(name, opts = {}) {
    super(name, { ...opts, tagName: 'IFRAME' });
    this.src = opts.src || '';
    this.contentWindow = opts.contentWindow || { frame: name };
  }
}

function makeHarness(opts = {}) {
  const state = {
    now: 0,
    timers: [],
    timerSeq: 1,
    docListeners: {},
    winListeners: {},
    videos: [],
    iframes: [],
    playButtons: [],
    fullscreenButtons: [],
    connected: new Set(),
    topmost: null,
    fullscreenElement: null,
    exitCalls: 0,
    fullscreenClicks: 0,
    requestFullscreenCalls: 0,
    toggleCount: 0,
    parentMessages: [],
  };

  fullscreenHook = (el) => {
    state.requestFullscreenCalls += 1;
    state.fullscreenElement = el;
    return Promise.resolve();
  };

  const clock = {
    setTimeout(fn, delay, ...args) {
      const id = state.timerSeq++;
      state.timers.push({ id, at: state.now + (delay || 0), fn, args, seq: id });
      return id;
    },
    clearTimeout(id) { state.timers = state.timers.filter((t) => t.id !== id); },
    advance(ms) {
      const target = state.now + ms;
      for (;;) {
        const due = state.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.seq - b.seq);
        if (!due.length) break;
        const t = due[0];
        state.timers = state.timers.filter((x) => x.id !== t.id);
        state.now = t.at;
        t.fn(...t.args);
      }
      state.now = target;
    },
  };

  trackingMaps.length = 0;

  const body = new MockElement('body', { tagName: 'BODY' });
  const documentElement = new MockElement('html', { tagName: 'HTML' });
  body.parent = documentElement;

  const doc = {
    body,
    documentElement,
    get fullscreenElement() { return state.fullscreenElement; },
    set fullscreenElement(v) { state.fullscreenElement = v; },
    addEventListener(type, fn, capture) {
      (state.docListeners[type] ||= []).push({ fn, capture });
    },
    removeEventListener() {},
    querySelectorAll(sel) {
      if (sel === 'video') return state.videos.filter((v) => state.connected.has(v));
      if (sel === 'iframe') return state.iframes;
      if (sel === PLAY_PAUSE) return state.playButtons.filter((b) => state.connected.has(b));
      if (sel === FULLSCREEN) return state.fullscreenButtons.filter((b) => state.connected.has(b));
      return [];
    },
    querySelector(sel) {
      if (sel === 'video') return state.videos.find((v) => state.connected.has(v)) || null;
      if (sel === PLAY_PAUSE) return state.playButtons.find((b) => state.connected.has(b)) || null;
      if (sel === FULLSCREEN) return state.fullscreenButtons.find((b) => state.connected.has(b)) || null;
      return null;
    },
    contains(el) { return state.connected.has(el); },
    elementFromPoint() { return state.topmost; },
    exitFullscreen() {
      state.exitCalls += 1;
      state.fullscreenElement = null;
      return Promise.resolve();
    },
  };

  const parentMock = {
    postMessage(data, origin) { state.parentMessages.push({ data, origin }); },
  };

  const sandbox = {
    console,
    URL,
    Date,
    Math,
    Number,
    Map: TrackingMap,
    Promise,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    performance: { now: () => state.now },
    document: doc,
    location: {
      hostname: opts.hostname || 'www.twitch.tv',
      href: `https://${opts.hostname || 'www.twitch.tv'}/`,
      ancestorOrigins: [],
    },
    innerWidth: opts.innerWidth || 1280,
    innerHeight: opts.innerHeight || 720,
    getComputedStyle(el) {
      return {
        display: 'block',
        visibility: 'visible',
        cursor: el && el.cursor ? el.cursor : 'auto',
        borderLeftWidth: '0px',
        borderRightWidth: '0px',
        borderTopWidth: '0px',
        borderBottomWidth: '0px',
        paddingLeft: (el && el.paddingLeft ? el.paddingLeft : 0) + 'px',
        paddingRight: (el && el.paddingRight ? el.paddingRight : 0) + 'px',
        paddingTop: (el && el.paddingTop ? el.paddingTop : 0) + 'px',
        paddingBottom: (el && el.paddingBottom ? el.paddingBottom : 0) + 'px',
      };
    },
    Element: MockElement,
    HTMLIFrameElement: MockIframe,
    parent: opts.isIframe ? parentMock : null,
    addEventListener(type, fn, capture) {
      (state.winListeners[type] ||= []).push({ fn, capture });
    },
    removeEventListener() {},
  };

  const context = vm.createContext(sandbox);
  vm.runInContext('window = globalThis; if (!window.parent) window.parent = window;', context);
  vm.runInContext(code, context);

  function makeEvent(target, { x = 400, y = 225, detail = 1, timeStamp, isTrusted = true, button = 0 } = {}) {
    const event = {
      button,
      defaultPrevented: false,
      clientX: x,
      clientY: y,
      detail,
      timeStamp: timeStamp === undefined ? state.now : timeStamp,
      target,
      isTrusted,
      stopPropagation() { event.propagationStopped = true; },
      stopImmediatePropagation() { event.immediateStopped = true; },
    };
    return event;
  }

  function fireDoc(type, event) {
    for (const l of state.docListeners[type] || []) l.fn(event);
  }

  function fireWin(type, event) {
    for (const l of state.winListeners[type] || []) l.fn(event);
  }

  function userPointerDown(target, opts = {}) {
    const event = makeEvent(target, opts);
    fireDoc('pointerdown', event);
    return event;
  }

  function userClick(target, opts = {}) {
    const event = makeEvent(target, opts);
    fireDoc('click', event);
    return event;
  }

  function userKeyDown(key) {
    const event = { key, isTrusted: true, target: doc, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
    fireDoc('keydown', event);
    return event;
  }

  function userDblClick(target, opts = {}) {
    const event = makeEvent(target, { ...opts, detail: 2 });
    // Real propagation: window capture runs before document capture.
    fireWin('dblclick', event);
    fireDoc('dblclick', event);
    return event;
  }

  function fireFullscreenChange() {
    const event = { isTrusted: true, target: doc };
    fireDoc('fullscreenchange', event);
    return event;
  }

  function fireWinMessage(data, source, origin = 'https://abc.ext-twitch.tv') {
    const event = { data, source, origin };
    for (const l of state.winListeners.message || []) l.fn(event);
  }

  function makeVideo(name, { paused = false, rect } = {}) {
    const v = new MockElement(name, { tagName: 'VIDEO', paused, rect, matchSelectors: [] });
    v.player = null;
    v.closest = function (sel) {
      if (sel.includes('video-player')) return this.player;
      return MockElement.prototype.closest.call(this, sel);
    };
    state.videos.push(v);
    state.connected.add(v);
    return v;
  }

  function makePlayer(name, { rect, video, playButton, fullscreenButton } = {}) {
    const p = new MockElement(name, {
      rect,
      matchSelectors: ['.video-player'],
      querySelectorMap: { [PLAY_PAUSE]: playButton || null, [FULLSCREEN]: fullscreenButton || null },
    });
    p.video = video;
    if (video) { video.player = p; video.parent = p; }
    if (playButton) { playButton.video = video; playButton.parent = p; }
    if (fullscreenButton) { fullscreenButton.video = video; fullscreenButton.parent = p; }
    return p;
  }

  function makeButton(name, { rect, kind, video, asyncDelay, disabled, swallow, parent } = {}) {
    const b = new MockElement(name, { tagName: 'BUTTON', rect, matchSelectors: ['button'], disabled });
    b.video = video || null;
    b.parent = parent || null;
    b.clickHandler = () => {
      const apply = () => {
        if (kind === 'play') {
          state.toggleCount += 1;
          const v = b.video || state.videos.find((x) => state.connected.has(x)) || state.videos[0];
          if (v) v.paused = !v.paused;
        } else if (kind === 'fullscreen') {
          state.fullscreenClicks += 1;
          if (swallow) return;
          const targetPlayer = (b.video && b.video.player) || (state.videos[0] && state.videos[0].player) || null;
          state.fullscreenElement = state.fullscreenElement ? null : targetPlayer;
        }
      };
      if (asyncDelay) clock.setTimeout(apply, asyncDelay);
      else apply();
    };
    state.connected.add(b);
    if (kind === 'play') state.playButtons.push(b);
    if (kind === 'fullscreen') state.fullscreenButtons.push(b);
    return b;
  }

  function makeIframe(name, { src, rect, contentWindow } = {}) {
    const f = new MockIframe(name, { src, rect, contentWindow });
    state.iframes.push(f);
    return f;
  }

  return {
    state, clock, doc, sandbox, context,
    userPointerDown, userClick, userKeyDown, userDblClick, fireDoc, fireFullscreenChange, fireWinMessage,
    makeVideo, makePlayer, makeButton, makeIframe,
    get winListeners() { return state.winListeners; },
    get docListeners() { return state.docListeners; },
  };
}

// Node's built-in test runner is the only test dependency. The harness above is
// a mock DOM with fake timers; it is not a browser or a Twitch integration test.
function test(name, fn) {
  if (FILTER && !name.includes(FILTER)) return;
  nodeTest(name, () => { fn(); });
}

function assert(cond, msg, extra) {
  nodeAssert.ok(cond, msg + (extra ? ' | ' + JSON.stringify(extra) : ''));
  return cond;
}

function basicVideo(h, { paused = false } = {}) {
  const video = h.makeVideo('video', { paused });
  const play = h.makeButton('play', {
    kind: 'play',
    video,
    rect: { left: 380, top: 400, right: 420, bottom: 440, width: 40, height: 40 },
  });
  const fsBtn = h.makeButton('fullscreen', {
    kind: 'fullscreen',
    video,
    rect: { left: 740, top: 400, right: 780, bottom: 440, width: 40, height: 40 },
  });
  const player = h.makePlayer('player', { rect: video.rect, video, playButton: play, fullscreenButton: fsBtn });
  h.state.topmost = video;
  return { video, play, fsBtn, player };
}

// ---------------------------------------------------------------------------
// Regression: normal single click
// ---------------------------------------------------------------------------
test('single click toggles playback', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(500);
  assert(video.paused === true, 'video paused after single click', { paused: video.paused });
});

// ---------------------------------------------------------------------------
// Regression: normal double click
// ---------------------------------------------------------------------------
test('double click toggles fullscreen and keeps playback', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  h.userPointerDown(video);
  h.userClick(video, { detail: 2 });
  h.clock.advance(1000);
  assert(h.state.fullscreenClicks === 1, 'fullscreen toggled once', { fullscreenClicks: h.state.fullscreenClicks });
  assert(video.paused === false, 'video remains playing after double click', { paused: video.paused });
});

// ---------------------------------------------------------------------------
// F-01: control click cancels pending single click
// ---------------------------------------------------------------------------
test('control click cancels pending single click', () => {
  const h = makeHarness();
  const { video, play } = basicVideo(h, { paused: false });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  // Twitch's native control pauses, and the user's pointerdown is on a control.
  video.paused = true;
  h.userPointerDown(play, { x: 400, y: 420 });
  h.userClick(play, { x: 400, y: 420, detail: 1 });
  h.clock.advance(300);
  assert(video.paused === true, 'control click wins; pending toggle was cancelled', {
    paused: video.paused,
    toggleCount: h.state.toggleCount,
  });
});

// ---------------------------------------------------------------------------
// F-01: Space cancels pending single click
// ---------------------------------------------------------------------------
test('Space cancels pending single click', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  video.paused = true;
  h.userKeyDown(' ');
  h.clock.advance(300);
  assert(video.paused === true, 'keyboard action wins; pending toggle was cancelled', {
    paused: video.paused,
    toggleCount: h.state.toggleCount,
  });
});

// ---------------------------------------------------------------------------
// F-12: two videos both receive their single clicks
// ---------------------------------------------------------------------------
test('two videos both receive their single clicks', () => {
  const h = makeHarness();
  const a = h.makeVideo('A', { paused: false });
  const playA = h.makeButton('playA', { kind: 'play', video: a });
  const fsA = h.makeButton('fsA', { kind: 'fullscreen', video: a });
  h.makePlayer('playerA', { rect: a.rect, video: a, playButton: playA, fullscreenButton: fsA });

  const bRect = { left: 900, top: 0, right: 1200, bottom: 300, width: 300, height: 300 };
  const b = h.makeVideo('B', { paused: false, rect: bRect });
  const playB = h.makeButton('playB', { kind: 'play', video: b });
  const fsB = h.makeButton('fsB', { kind: 'fullscreen', video: b });
  h.makePlayer('playerB', { rect: bRect, video: b, playButton: playB, fullscreenButton: fsB });

  h.state.topmost = a;
  h.userPointerDown(a, { x: 400, y: 225 });
  h.userClick(a, { x: 400, y: 225, detail: 1 });
  h.clock.advance(100);
  h.state.topmost = b;
  h.userPointerDown(b, { x: 1000, y: 150 });
  h.userClick(b, { x: 1000, y: 150, detail: 1 });
  h.clock.advance(1000);
  assert(a.paused === true, 'first video toggled', { aPaused: a.paused });
  assert(b.paused === true, 'second video toggled', { bPaused: b.paused });
});

// ---------------------------------------------------------------------------
// F-03: double click on second video must not inherit first state
// ---------------------------------------------------------------------------
test('double click on second video does not inherit first state', () => {
  const h = makeHarness();
  const a = h.makeVideo('A', { paused: false });
  const playA = h.makeButton('playA', { kind: 'play', video: a });
  const fsA = h.makeButton('fsA', { kind: 'fullscreen', video: a });
  h.makePlayer('playerA', { rect: a.rect, video: a, playButton: playA, fullscreenButton: fsA });

  const bRect = { left: 900, top: 0, right: 1200, bottom: 300, width: 300, height: 300 };
  const b = h.makeVideo('B', { paused: true, rect: bRect });
  const playB = h.makeButton('playB', { kind: 'play', video: b });
  const fsB = h.makeButton('fsB', { kind: 'fullscreen', video: b });
  h.makePlayer('playerB', { rect: bRect, video: b, playButton: playB, fullscreenButton: fsB });

  h.state.topmost = a;
  h.userPointerDown(a, { x: 400, y: 225 });
  h.userClick(a, { x: 400, y: 225, detail: 1 });
  h.clock.advance(500); // A toggled to paused
  h.state.topmost = b;
  h.userPointerDown(b, { x: 1000, y: 150 });
  h.userClick(b, { x: 1000, y: 150, detail: 2 });
  h.clock.advance(1000);
  assert(b.paused === true, 'second video stays paused; no cross-video restore', {
    bPaused: b.paused,
    bToggle: playB.clickCalls,
  });
});

// ---------------------------------------------------------------------------
// F-04: stale pending click after removal is discarded
// ---------------------------------------------------------------------------
test('stale pending click after removal is discarded', () => {
  const h = makeHarness();
  const a = h.makeVideo('A', { paused: false });
  const playA = h.makeButton('playA', { kind: 'play', video: a });
  const fsA = h.makeButton('fsA', { kind: 'fullscreen', video: a });
  const playerA = h.makePlayer('playerA', { rect: a.rect, video: a, playButton: playA, fullscreenButton: fsA });
  playerA.querySelectorMap[PLAY_PAUSE] = null;
  playerA.querySelectorMap[FULLSCREEN] = null;

  const b = h.makeVideo('B', { paused: false });
  const playB = h.makeButton('playB', { kind: 'play', video: b });
  const fsB = h.makeButton('fsB', { kind: 'fullscreen', video: b });
  h.makePlayer('playerB', { rect: b.rect, video: b, playButton: playB, fullscreenButton: fsB });

  h.state.topmost = a;
  h.userPointerDown(a);
  h.userClick(a, { detail: 1 });
  h.clock.advance(100);
  h.state.connected.delete(a);
  h.state.connected.delete(playA);
  h.state.connected.delete(fsA);
  h.clock.advance(300);
  assert(h.state.toggleCount === 0, 'stale pending click did not touch the new player', {
    toggleCount: h.state.toggleCount,
    bPaused: b.paused,
  });
});

// ---------------------------------------------------------------------------
// F-05: restore after removal does not touch another video
// ---------------------------------------------------------------------------
test('restore after removal does not touch another video', () => {
  const h = makeHarness();
  const a = h.makeVideo('A', { paused: false });
  const playA = h.makeButton('playA', { kind: 'play', video: a });
  const fsA = h.makeButton('fsA', { kind: 'fullscreen', video: a });
  h.makePlayer('playerA', { rect: a.rect, video: a, playButton: playA, fullscreenButton: fsA });

  const b = h.makeVideo('B', { paused: true });
  const playB = h.makeButton('playB', { kind: 'play', video: b });
  const fsB = h.makeButton('fsB', { kind: 'fullscreen', video: b });
  h.makePlayer('playerB', { rect: b.rect, video: b, playButton: playB, fullscreenButton: fsB });

  h.state.topmost = a;
  h.userPointerDown(a);
  h.userClick(a, { detail: 1 });
  h.clock.advance(500); // A paused
  h.userClick(a, { detail: 2 }); // applyPlaybackState(A, false)
  h.state.connected.delete(a);
  h.state.connected.delete(playA);
  h.clock.advance(300);
  assert(b.paused === true, 'restore did not resume unrelated video B', {
    bPaused: b.paused,
    bToggle: playB.clickCalls,
  });
});

// ---------------------------------------------------------------------------
// F-06: theater-mode double click stays fullscreen
// ---------------------------------------------------------------------------
test('theater-mode double click stays fullscreen', () => {
  const h = makeHarness({ innerWidth: 1000, innerHeight: 700 });
  const rect = { left: 0, top: 0, right: 960, bottom: 672, width: 960, height: 672 };
  const video = h.makeVideo('video', { paused: false, rect });
  const play = h.makeButton('play', { kind: 'play', video });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video });
  h.makePlayer('player', { rect, video, playButton: play, fullscreenButton: fsBtn });
  h.state.topmost = video;

  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  h.userPointerDown(video);
  h.userClick(video, { detail: 2 });
  h.clock.advance(400);
  assert(h.state.fullscreenClicks === 1, 'native fullscreen clicked once', { fullscreenClicks: h.state.fullscreenClicks });
  assert(h.state.exitCalls === 0, 'fallback did not exit fullscreen', { exitCalls: h.state.exitCalls });
  assert(h.state.fullscreenElement && h.state.fullscreenElement.name === 'player', 'player remains fullscreen', {
    fullscreenElement: h.state.fullscreenElement && h.state.fullscreenElement.name,
  });
});

// ---------------------------------------------------------------------------
// F-07: Escape cancels fullscreen fallback
// ---------------------------------------------------------------------------
test('Escape cancels fullscreen fallback', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  h.userPointerDown(video);
  h.userClick(video, { detail: 2 });
  h.clock.advance(100);
  h.state.fullscreenElement = null; // user pressed Esc
  h.fireFullscreenChange();
  h.userKeyDown('Escape');
  h.clock.advance(300);
  assert(h.state.requestFullscreenCalls === 0, 'fallback did not re-enter fullscreen after Esc', {
    requestFullscreenCalls: h.state.requestFullscreenCalls,
  });
});

// ---------------------------------------------------------------------------
// F-07 positive: swallowed native fullscreen click still falls back
// ---------------------------------------------------------------------------
test('swallowed native fullscreen click falls back', () => {
  const h = makeHarness();
  const video = h.makeVideo('video', { paused: false });
  const play = h.makeButton('play', { kind: 'play', video });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video, swallow: true });
  h.makePlayer('player', { rect: video.rect, video, playButton: play, fullscreenButton: fsBtn });
  h.state.topmost = video;

  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  h.userPointerDown(video);
  h.userClick(video, { detail: 2 });
  h.clock.advance(400);
  assert(h.state.requestFullscreenCalls === 1, 'fallback requested fullscreen after swallowed click', {
    requestFullscreenCalls: h.state.requestFullscreenCalls,
  });
  assert(h.state.fullscreenElement && h.state.fullscreenElement.name === 'player', 'player entered fullscreen', {
    fullscreenElement: h.state.fullscreenElement && h.state.fullscreenElement.name,
  });
});

// ---------------------------------------------------------------------------
// Disabled native fullscreen button falls back to the Fullscreen API
// ---------------------------------------------------------------------------
test('disabled native fullscreen button falls back to Fullscreen API', () => {
  const h = makeHarness();
  const video = h.makeVideo('video', { paused: false });
  const play = h.makeButton('play', { kind: 'play', video });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video, disabled: true });
  h.makePlayer('player', { rect: video.rect, video, playButton: play, fullscreenButton: fsBtn });
  h.state.topmost = video;

  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  h.userPointerDown(video);
  h.userClick(video, { detail: 2 });

  assert(fsBtn.clickCalls === 0, 'disabled fullscreen button was not clicked', { clickCalls: fsBtn.clickCalls });
  assert(h.state.requestFullscreenCalls === 1, 'Fullscreen API fallback was used', {
    requestFullscreenCalls: h.state.requestFullscreenCalls,
  });
  assert(h.state.fullscreenElement && h.state.fullscreenElement.name === 'player', 'player entered fullscreen', {
    fullscreenElement: h.state.fullscreenElement && h.state.fullscreenElement.name,
  });
});

// ---------------------------------------------------------------------------
// F-08: cross-player button fallback uses media API
// ---------------------------------------------------------------------------
test('cross-player button fallback uses media API', () => {
  const h = makeHarness();
  const a = h.makeVideo('A', { paused: false });
  h.makePlayer('playerA', { rect: a.rect, video: a, playButton: null, fullscreenButton: null });

  const bRect = { left: 900, top: 0, right: 1200, bottom: 300, width: 300, height: 300 };
  const b = h.makeVideo('B', { paused: false, rect: bRect });
  const playB = h.makeButton('playB', { kind: 'play', video: b });
  const fsB = h.makeButton('fsB', { kind: 'fullscreen', video: b });
  h.makePlayer('playerB', { rect: bRect, video: b, playButton: playB, fullscreenButton: fsB });

  h.state.topmost = a;
  h.userPointerDown(a, { x: 400, y: 225 });
  h.userClick(a, { x: 400, y: 225, detail: 1 });
  h.clock.advance(500);
  assert(a.paused === true, 'clicked video toggled via media API', { aPaused: a.paused });
  assert(b.paused === false, 'other player was not toggled', { bPaused: b.paused });
  assert(playB.clickCalls === 0, 'other player button was not clicked', { playBClicks: playB.clickCalls });
});

// ---------------------------------------------------------------------------
// F-14: disabled native button falls back to media API
// ---------------------------------------------------------------------------
test('disabled native button falls back to media API', () => {
  const h = makeHarness();
  const video = h.makeVideo('video', { paused: false });
  const play = h.makeButton('play', { kind: 'play', video, disabled: true });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video });
  h.makePlayer('player', { rect: video.rect, video, playButton: play, fullscreenButton: fsBtn });
  h.state.topmost = video;

  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(500);
  assert(video.paused === true, 'media API toggled playback', { paused: video.paused });
  assert(play.clickCalls === 0, 'disabled button was not clicked', { clickCalls: play.clickCalls });
});

// ---------------------------------------------------------------------------
// F-10: async restore eventually reaches target state
// ---------------------------------------------------------------------------
test('async restore eventually reaches target state', () => {
  const h = makeHarness();
  const video = h.makeVideo('video', { paused: false });
  const play = h.makeButton('play', { kind: 'play', video, asyncDelay: 350 });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video });
  h.makePlayer('player', { rect: video.rect, video, playButton: play, fullscreenButton: fsBtn });
  h.state.topmost = video;

  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(500); // pending toggle scheduled at 400, applies at 750
  h.userClick(video, { detail: 2 }); // slow double click
  h.clock.advance(1500);
  assert(video.paused === false, 'restore corrected async pause and left video playing', {
    paused: video.paused,
    toggleCount: h.state.toggleCount,
  });
});

// ---------------------------------------------------------------------------
// F-11: triple click toggles fullscreen once
// ---------------------------------------------------------------------------
test('triple click toggles fullscreen once', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  h.userPointerDown(video);
  h.userClick(video, { detail: 2 });
  h.clock.advance(100);
  h.userPointerDown(video);
  h.userClick(video, { detail: 3 });
  assert(h.state.fullscreenClicks === 1, 'third click did not toggle fullscreen again', {
    fullscreenClicks: h.state.fullscreenClicks,
  });
});

// ---------------------------------------------------------------------------
// F-13: full-size content-gate button is not the video surface
// ---------------------------------------------------------------------------
test('full-size content-gate button is not video surface', () => {
  const h = makeHarness();
  const video = h.makeVideo('video', { paused: false });
  const gate = new MockElement('gate', {
    matchSelectors: ['[data-a-target="content-gate"]'],
    rect: video.rect,
  });
  const button = h.makeButton('gateButton', { kind: 'play', video, rect: video.rect, parent: gate });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video });
  const player = h.makePlayer('player', { rect: video.rect, video, playButton: null, fullscreenButton: fsBtn });
  gate.parent = player;
  h.state.topmost = button;

  h.userPointerDown(button, { x: 400, y: 225 });
  h.userClick(button, { x: 400, y: 225, detail: 1 });
  h.clock.advance(500);
  assert(h.state.toggleCount === 0, 'content-gate button did not toggle playback', {
    toggleCount: h.state.toggleCount,
  });
});

// ---------------------------------------------------------------------------
// F-15: forwarded message with foreign origin is rejected
// ---------------------------------------------------------------------------
test('forwarded message with foreign origin is rejected', () => {
  const h = makeHarness();
  const video = h.makeVideo('video', { paused: false });
  const play = h.makeButton('play', { kind: 'play', video });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video });
  h.makePlayer('player', { rect: video.rect, video, playButton: play, fullscreenButton: fsBtn });
  const ext = h.makeIframe('ext', {
    src: 'https://abc.ext-twitch.tv/x',
    rect: video.rect,
    contentWindow: { id: 'ext' },
  });
  h.state.topmost = ext;

  h.fireWinMessage({ type: 'twitch-click-to-pause:click', x: 400, y: 225, detail: 1, id: 'evil' }, ext.contentWindow, 'https://evil.example');
  h.clock.advance(500);
  assert(h.state.toggleCount === 0, 'foreign-origin message ignored', { toggleCount: h.state.toggleCount });

  h.fireWinMessage({ type: 'twitch-click-to-pause:click', x: 400, y: 225, detail: 1, id: 'ok' }, ext.contentWindow, 'https://abc.ext-twitch.tv');
  h.clock.advance(500);
  assert(h.state.toggleCount === 1, 'extension-origin message accepted', { toggleCount: h.state.toggleCount });
});

// ---------------------------------------------------------------------------
// F-15/F-22: null coordinates are rejected
// ---------------------------------------------------------------------------
test('forwarded message with null coordinates is rejected', () => {
  const h = makeHarness();
  const video = h.makeVideo('video', { paused: false });
  const play = h.makeButton('play', { kind: 'play', video });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video });
  h.makePlayer('player', { rect: video.rect, video, playButton: play, fullscreenButton: fsBtn });
  const ext = h.makeIframe('ext', {
    src: 'https://abc.ext-twitch.tv/x',
    rect: { left: 0, top: 0, right: 800, bottom: 450, width: 800, height: 450 },
    contentWindow: { id: 'ext' },
  });
  h.state.topmost = ext;

  h.fireWinMessage({ type: 'twitch-click-to-pause:click', x: null, y: null, detail: 1, id: 'null' }, ext.contentWindow);
  h.clock.advance(500);
  assert(h.state.toggleCount === 0, 'null coordinates did not toggle playback', { toggleCount: h.state.toggleCount });
});

// ---------------------------------------------------------------------------
// F-15: detail 99 is not treated as double click
// ---------------------------------------------------------------------------
test('forwarded message with detail 99 is not fullscreen', () => {
  const h = makeHarness();
  const video = h.makeVideo('video', { paused: false });
  const play = h.makeButton('play', { kind: 'play', video });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video });
  h.makePlayer('player', { rect: video.rect, video, playButton: play, fullscreenButton: fsBtn });
  const ext = h.makeIframe('ext', {
    src: 'https://abc.ext-twitch.tv/x',
    rect: video.rect,
    contentWindow: { id: 'ext' },
  });
  h.state.topmost = ext;

  h.fireWinMessage({ type: 'twitch-click-to-pause:click', x: 400, y: 225, detail: 99, id: 'detail' }, ext.contentWindow);
  assert(h.state.fullscreenClicks === 0, 'detail 99 did not force fullscreen', {
    fullscreenClicks: h.state.fullscreenClicks,
  });
});

// ---------------------------------------------------------------------------
// F-15: non-numeric detail is not treated as double click
// ---------------------------------------------------------------------------
test('forwarded message with string detail is rejected', () => {
  const h = makeHarness();
  const video = h.makeVideo('video', { paused: false });
  const play = h.makeButton('play', { kind: 'play', video });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video });
  h.makePlayer('player', { rect: video.rect, video, playButton: play, fullscreenButton: fsBtn });
  const ext = h.makeIframe('ext', {
    src: 'https://abc.ext-twitch.tv/x',
    rect: video.rect,
    contentWindow: { id: 'ext' },
  });
  h.state.topmost = ext;

  h.fireWinMessage({ type: 'twitch-click-to-pause:click', x: 400, y: 225, detail: '2', id: 'string-detail' }, ext.contentWindow);
  assert(h.state.fullscreenClicks === 0, 'string detail did not force fullscreen', {
    fullscreenClicks: h.state.fullscreenClicks,
  });
});

// ---------------------------------------------------------------------------
// F-16: dedup map is bounded
// ---------------------------------------------------------------------------
test('forwarded dedup map is bounded', () => {
  const h = makeHarness();
  const video = h.makeVideo('video', { paused: false });
  const play = h.makeButton('play', { kind: 'play', video });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video });
  h.makePlayer('player', { rect: video.rect, video, playButton: play, fullscreenButton: fsBtn });
  const ext = h.makeIframe('ext', {
    src: 'https://abc.ext-twitch.tv/x',
    rect: video.rect,
    contentWindow: { id: 'ext' },
  });
  h.state.topmost = ext;
  // pendingClicks is created first; seenForwardedClicks is the last Map created.
  const map = trackingMaps[trackingMaps.length - 1];

  for (let i = 0; i < 600; i += 1) {
    h.fireWinMessage({ type: 'twitch-click-to-pause:click', x: 400, y: 225, detail: 1, id: 'flood-' + i }, ext.contentWindow);
  }
  assert(!!map && map.size <= 100, 'dedup map stayed bounded', { size: map ? map.size : null });
});

// ---------------------------------------------------------------------------
// F-18: synthetic click is ignored
// ---------------------------------------------------------------------------
test('synthetic click is ignored', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  h.userClick(video, { detail: 1, isTrusted: false });
  h.clock.advance(500);
  assert(h.state.toggleCount === 0, 'untrusted synthetic click did not toggle playback', {
    toggleCount: h.state.toggleCount,
  });
});

// ---------------------------------------------------------------------------
// F-19: dblclick is swallowed only when double click was handled
// ---------------------------------------------------------------------------
test('dblclick is swallowed only when double click was handled', () => {
  const h = makeHarness();
  const { video, play } = basicVideo(h, { paused: false });

  // Two control clicks, then a dblclick whose point is over the video.
  h.state.topmost = play;
  h.userPointerDown(play, { x: 400, y: 420 });
  h.userClick(play, { x: 400, y: 420, detail: 1 });
  h.userPointerDown(play, { x: 400, y: 420 });
  h.userClick(play, { x: 400, y: 420, detail: 2 });
  h.state.topmost = video;
  const notHandled = h.userDblClick(video);
  assert(!notHandled.propagationStopped, 'dblclick not swallowed when clicks were on a control', {
    stopped: !!notHandled.propagationStopped,
  });

  // A real video double click must be swallowed.
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  h.userPointerDown(video);
  h.userClick(video, { detail: 2 });
  const handled = h.userDblClick(video);
  assert(handled.propagationStopped === true, 'dblclick swallowed after handled video double click', {
    stopped: !!handled.propagationStopped,
  });
});

// ---------------------------------------------------------------------------
// Regression: Twitch's supervisor synthetic dblclick must not double-toggle
// fullscreen after the bridge already handled the forwarded pair.
// ---------------------------------------------------------------------------
test('synthetic extension dblclick after a forwarded pair is swallowed', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  const ext = h.makeIframe('ext', {
    src: 'https://supervisor.ext-twitch.tv/supervisor/v1/index.html',
    rect: video.rect,
    contentWindow: { id: 'ext' },
  });
  h.state.topmost = ext;

  // Without a forwarded pair the synthetic event belongs to Twitch.
  const unrelated = h.userDblClick(ext, { isTrusted: false });
  assert(!unrelated.propagationStopped, 'synthetic dblclick without a forwarded pair is not swallowed', {
    stopped: !!unrelated.propagationStopped,
  });

  // The bridge handles the pair and toggles fullscreen once.
  h.fireWinMessage({ type: 'twitch-click-to-pause:click', x: 400, y: 225, detail: 1, id: 'pair-1' }, ext.contentWindow);
  h.fireWinMessage({ type: 'twitch-click-to-pause:click', x: 400, y: 225, detail: 2, id: 'pair-2' }, ext.contentWindow);
  assert(h.state.fullscreenClicks === 1, 'forwarded pair toggled fullscreen once', {
    fullscreenClicks: h.state.fullscreenClicks,
  });

  // Twitch's supervisor then dispatches its own untrusted dblclick.
  const duplicate = h.userDblClick(ext, { isTrusted: false });
  assert(duplicate.propagationStopped === true, 'duplicate synthetic dblclick is swallowed', {
    stopped: !!duplicate.propagationStopped,
  });

  // A single forwarded click must not suppress Twitch's own dblclick handling.
  h.fireWinMessage({ type: 'twitch-click-to-pause:click', x: 400, y: 225, detail: 1, id: 'single' }, ext.contentWindow);
  const afterSingle = h.userDblClick(ext, { isTrusted: false });
  assert(!afterSingle.propagationStopped, 'synthetic dblclick after a single forwarded click is not swallowed', {
    stopped: !!afterSingle.propagationStopped,
  });
  h.clock.advance(500);
});

// ---------------------------------------------------------------------------
// F-02: extension bridge forwards background, not div/button
// ---------------------------------------------------------------------------
test('extension bridge forwards background but not div/button', () => {
  const h = makeHarness({ hostname: 'abc.ext-twitch.tv', isIframe: true });
  const body = h.doc.body;
  const div = new MockElement('card', { tagName: 'DIV' });
  const button = new MockElement('btn', { tagName: 'BUTTON', matchSelectors: ['button'] });
  const clickMessages = () => h.state.parentMessages.filter((m) => m.data.type === 'twitch-click-to-pause:click');
  const cancelMessages = () => h.state.parentMessages.filter((m) => m.data.type === 'twitch-click-to-pause:cancel');

  h.userClick(body, { x: 10, y: 10, detail: 1 });
  assert(clickMessages().length === 1, 'background click forwarded', { forwarded: clickMessages().length });
  h.userClick(div, { x: 10, y: 10, detail: 1 });
  assert(clickMessages().length === 1, 'plain div click not forwarded', { forwarded: clickMessages().length });
  assert(cancelMessages().length === 1, 'plain div click sends cancel', { cancel: cancelMessages().length });
  h.userClick(button, { x: 10, y: 10, detail: 1 });
  assert(clickMessages().length === 1, 'button click not forwarded', { forwarded: clickMessages().length });
  assert(cancelMessages().length === 2, 'button click sends cancel', { cancel: cancelMessages().length });
});

// ---------------------------------------------------------------------------
// F-02 positive: a full-size non-interactive background still passes through
// ---------------------------------------------------------------------------
test('extension bridge forwards full-size background div but not canvas', () => {
  const h = makeHarness({ hostname: 'abc.ext-twitch.tv', isIframe: true });
  const full = { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 };
  const background = new MockElement('background', { tagName: 'DIV', rect: full, attrs: {} });
  const canvas = new MockElement('canvas', { tagName: 'CANVAS', rect: full, matchSelectors: ['canvas'] });
  const clickMessages = () => h.state.parentMessages.filter((m) => m.data.type === 'twitch-click-to-pause:click');
  const cancelMessages = () => h.state.parentMessages.filter((m) => m.data.type === 'twitch-click-to-pause:cancel');

  h.userClick(background, { x: 10, y: 10, detail: 1 });
  assert(clickMessages().length === 1, 'full-size background div forwarded', {
    forwarded: clickMessages().length,
  });
  h.userClick(canvas, { x: 10, y: 10, detail: 1 });
  assert(clickMessages().length === 1, 'full-size canvas not forwarded', {
    forwarded: clickMessages().length,
  });
  assert(cancelMessages().length === 1, 'full-size canvas sends cancel', {
    cancel: cancelMessages().length,
  });
});

// ---------------------------------------------------------------------------
// Regression: modal blocks video click
// ---------------------------------------------------------------------------
test('modal blocks video click', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  const modal = new MockElement('modal', { matchSelectors: ['[role="dialog"]'] });
  h.state.topmost = modal;
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(500);
  assert(h.state.toggleCount === 0, 'modal click did not toggle video', { toggleCount: h.state.toggleCount });
});

// ---------------------------------------------------------------------------
// Regression: duplicate forwarded id handled once
// ---------------------------------------------------------------------------
test('duplicate forwarded id handled once', () => {
  const h = makeHarness();
  const video = h.makeVideo('video', { paused: false });
  const play = h.makeButton('play', { kind: 'play', video });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video });
  h.makePlayer('player', { rect: video.rect, video, playButton: play, fullscreenButton: fsBtn });
  const ext = h.makeIframe('ext', { src: 'https://abc.ext-twitch.tv/x', rect: video.rect, contentWindow: { id: 'ext' } });
  h.state.topmost = ext;

  h.fireWinMessage({ type: 'twitch-click-to-pause:click', x: 400, y: 225, detail: 1, id: 'same' }, ext.contentWindow);
  h.fireWinMessage({ type: 'twitch-click-to-pause:click', x: 400, y: 225, detail: 1, id: 'same' }, ext.contentWindow);
  h.clock.advance(500);
  assert(h.state.toggleCount === 1, 'duplicate id handled once', { toggleCount: h.state.toggleCount });
});

// ---------------------------------------------------------------------------
// Regression: nested relay
// ---------------------------------------------------------------------------
test('nested relay preserves coordinates and id', () => {
  const h = makeHarness({ hostname: 'supervisor.ext-twitch.tv', isIframe: true });
  const child = h.makeIframe('child', {
    src: 'https://abc.ext-twitch.tv/x',
    rect: { left: 200, top: 100, right: 1000, bottom: 700, width: 800, height: 600 },
    contentWindow: { id: 'child' },
  });

  h.fireWinMessage({ type: 'twitch-click-to-pause:click', x: 100, y: 50, detail: 1, id: 'z1' }, child.contentWindow);
  const msg = h.state.parentMessages[0];
  assert(!!msg && msg.data.x === 300 && msg.data.y === 150 && msg.data.id === 'z1', 'relay coordinates/id', {
    message: msg && msg.data,
  });
});

// ---------------------------------------------------------------------------
// F-02: role=main background is forwarded; explicit opt-out is respected
// ---------------------------------------------------------------------------
test('extension bridge respects role=main and opt-out', () => {
  const h = makeHarness({ hostname: 'abc.ext-twitch.tv', isIframe: true });
  const full = { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 };
  const main = new MockElement('main', {
    tagName: 'DIV',
    rect: full,
    matchSelectors: ['[role="main"]'],
    attrs: { role: 'main' },
  });
  const optOut = new MockElement('optOut', {
    tagName: 'DIV',
    rect: full,
    matchSelectors: ['[data-twitch-click-to-pause-ignore]'],
    attrs: { 'data-twitch-click-to-pause-ignore': '' },
  });
  const clickMessages = () => h.state.parentMessages.filter((m) => m.data.type === 'twitch-click-to-pause:click');
  const cancelMessages = () => h.state.parentMessages.filter((m) => m.data.type === 'twitch-click-to-pause:cancel');

  h.userClick(main, { x: 10, y: 10, detail: 1 });
  assert(clickMessages().length === 1, 'role=main full-size background forwarded', {
    forwarded: clickMessages().length,
  });
  h.userClick(optOut, { x: 10, y: 10, detail: 1 });
  assert(clickMessages().length === 1, 'opt-out background not forwarded', {
    forwarded: clickMessages().length,
  });
  assert(cancelMessages().length === 1, 'opt-out sends cancel', { cancel: cancelMessages().length });
});

// ---------------------------------------------------------------------------
// F-01: cancel message from an extension control clears pending player click
// ---------------------------------------------------------------------------
test('extension cancel message clears pending player click', () => {
  const h = makeHarness();
  const video = h.makeVideo('video', { paused: false });
  const play = h.makeButton('play', { kind: 'play', video });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video });
  h.makePlayer('player', { rect: video.rect, video, playButton: play, fullscreenButton: fsBtn });
  const ext = h.makeIframe('ext', { src: 'https://abc.ext-twitch.tv/x', rect: video.rect, contentWindow: { id: 'ext' } });
  h.state.topmost = ext;

  h.fireWinMessage({ type: 'twitch-click-to-pause:click', x: 400, y: 225, detail: 1, id: 'bg' }, ext.contentWindow);
  h.fireWinMessage({ type: 'twitch-click-to-pause:cancel' }, ext.contentWindow);
  h.clock.advance(500);
  assert(h.state.toggleCount === 0, 'cancel message cleared the pending click', { toggleCount: h.state.toggleCount });
});

// ---------------------------------------------------------------------------
// F-04/F-05: source/URL identity change discards pending/restore
// ---------------------------------------------------------------------------
test('source-only change does not discard pending click', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  video.currentSrc = 'https://video/a';
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  video.currentSrc = 'https://video/b'; // reconnect / quality switch, same page
  h.clock.advance(500);
  assert(h.state.toggleCount === 1, 'source-only change kept the pending click', {
    toggleCount: h.state.toggleCount,
  });
});

test('double click previous identity mismatch does not restore', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(500); // first click already toggled A to paused
  h.sandbox.location.href = 'https://www.twitch.tv/another-channel';
  h.userClick(video, { detail: 2 }); // detail=2, previous entry is from the old page
  h.clock.advance(1000);
  assert(video.paused === true, 'old-page previous state was not applied', {
    paused: video.paused,
    toggleCount: h.state.toggleCount,
  });
});

test('pending click is discarded when page URL changes', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.sandbox.location.href = 'https://www.twitch.tv/another-channel';
  h.clock.advance(500);
  assert(h.state.toggleCount === 0, 'URL change discarded the pending click', { toggleCount: h.state.toggleCount });
});

// ---------------------------------------------------------------------------
// F-01: chat text click outside the player does not cancel a pending pause
// ---------------------------------------------------------------------------
test('chat click outside player does not cancel pending pause', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  const chat = new MockElement('chat', {
    tagName: 'DIV',
    rect: { left: 1000, top: 500, right: 1270, bottom: 700, width: 270, height: 200 },
  });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  h.state.topmost = chat;
  h.userPointerDown(chat, { x: 1100, y: 600 });
  h.clock.advance(300);
  assert(video.paused === true, 'pending pause survived a chat click', { paused: video.paused });
});

test('chat input cancels pending click', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  const chatInput = new MockElement('chatInput', {
    tagName: 'DIV',
    rect: { left: 1000, top: 500, right: 1270, bottom: 550, width: 270, height: 50 },
    attrs: { contenteditable: 'true' },
    matchSelectors: ['[contenteditable="true"]'],
  });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  h.state.topmost = chatInput;
  h.userPointerDown(chatInput, { x: 1100, y: 525 });
  h.clock.advance(300);
  assert(video.paused === false, 'pending pause canceled by chat input', { paused: video.paused });
});

test('tabindex=-1 chat text does not cancel pending click', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  const chatText = new MockElement('chatText', {
    tagName: 'DIV',
    rect: { left: 1000, top: 500, right: 1270, bottom: 550, width: 270, height: 50 },
    attrs: { tabindex: '-1' },
  });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  h.state.topmost = chatText;
  h.userPointerDown(chatText, { x: 1100, y: 525 });
  h.clock.advance(300);
  assert(video.paused === true, 'pending pause survived tabindex=-1 chat text', { paused: video.paused });
});

test('re-initialization does not duplicate listeners', () => {
  const h = makeHarness();
  const before = (h.docListeners.click || []).length;
  vm.runInContext(code, h.context);
  const after = (h.docListeners.click || []).length;
  assert(after === before, 'second injection did not add listeners', { before, after });
});

// ---------------------------------------------------------------------------
// F-19: stale dblclick marker expires after the swallow window
// ---------------------------------------------------------------------------
test('stale dblclick marker expires after the swallow window', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  h.userPointerDown(video);
  h.userClick(video, { detail: 2 }); // handled; marker set, dblclick not fired
  h.clock.advance(1100);
  const event = h.userDblClick(video);
  assert(!event.propagationStopped, 'unrelated dblclick after the window was not swallowed', {
    stopped: !!event.propagationStopped,
  });
});

// ---------------------------------------------------------------------------
// F-19: a control dblclick after a handled video pair keeps its behavior
// ---------------------------------------------------------------------------
test('control dblclick after a handled pair is not swallowed', () => {
  const h = makeHarness();
  const { video, play } = basicVideo(h, { paused: false });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  h.userPointerDown(video);
  h.userClick(video, { detail: 2 });
  const event = h.userDblClick(play);
  assert(!event.propagationStopped, 'control dblclick was not swallowed', {
    stopped: !!event.propagationStopped,
  });
});

// ---------------------------------------------------------------------------
// F-21: concrete parent targetOrigin when ancestorOrigins is available
// ---------------------------------------------------------------------------
test('extension bridge uses ancestor origin when available', () => {
  const h = makeHarness({ hostname: 'abc.ext-twitch.tv', isIframe: true });
  h.sandbox.location.ancestorOrigins = ['https://www.twitch.tv'];
  h.userClick(h.doc.body, { x: 10, y: 10, detail: 1 });
  assert(h.state.parentMessages[0] && h.state.parentMessages[0].origin === 'https://www.twitch.tv',
    'postMessage used the immediate ancestor origin', {
      origin: h.state.parentMessages[0] && h.state.parentMessages[0].origin,
    });

  const h2 = makeHarness({ hostname: 'abc.ext-twitch.tv', isIframe: true });
  h2.userClick(h2.doc.body, { x: 10, y: 10, detail: 1 });
  assert(h2.state.parentMessages[0] && h2.state.parentMessages[0].origin === '*',
    'postMessage falls back to wildcard without ancestorOrigins', {
      origin: h2.state.parentMessages[0] && h2.state.parentMessages[0].origin,
    });
});

// ---------------------------------------------------------------------------
// F-26/reviewer: URL hash/query identity
// ---------------------------------------------------------------------------
test('hash/query-only change does not discard pending click', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.sandbox.location.href = 'https://www.twitch.tv/?foo=bar#section';
  h.clock.advance(500);
  assert(h.state.toggleCount === 1, 'harmless URL change kept the pending click', {
    toggleCount: h.state.toggleCount,
  });
});

test('player channel query change discards pending click', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  h.sandbox.location.href = 'https://player.twitch.tv/?channel=a&parent=www.twitch.tv';
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.sandbox.location.href = 'https://player.twitch.tv/?channel=b&parent=www.twitch.tv';
  h.clock.advance(500);
  assert(h.state.toggleCount === 0, 'channel query change discarded the pending click', {
    toggleCount: h.state.toggleCount,
  });
});

// ---------------------------------------------------------------------------
// Reviewer minor: scaled + padded iframe coordinate mapping
// ---------------------------------------------------------------------------
test('scaled and padded iframe maps coordinates', () => {
  const h = makeHarness();
  const video = h.makeVideo('video', { paused: false });
  const play = h.makeButton('play', { kind: 'play', video });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video });
  h.makePlayer('player', { rect: video.rect, video, playButton: play, fullscreenButton: fsBtn });
  const ext = h.makeIframe('ext', {
    src: 'https://abc.ext-twitch.tv/x',
    rect: { left: 100, top: 100, right: 1108, bottom: 708, width: 1008, height: 608 },
    clientWidth: 500,
    clientHeight: 300,
    offsetWidth: 504,
    offsetHeight: 304,
    clientLeft: 2,
    clientTop: 2,
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 10,
    paddingBottom: 10,
    contentWindow: { id: 'ext' },
  });
  h.state.topmost = ext;

  // x=100,y=100 in the inner viewport maps to 324,324 in the parent.
  h.fireWinMessage({ type: 'twitch-click-to-pause:click', x: 100, y: 100, detail: 1, id: 'scaled' }, ext.contentWindow);
  h.clock.advance(500);
  assert(h.state.toggleCount === 1, 'scaled/padded coordinate mapping toggled the video', {
    toggleCount: h.state.toggleCount,
  });
});

// ---------------------------------------------------------------------------
// Reviewer minor: plain-div control outside player cancels pending
// ---------------------------------------------------------------------------
test('plain div control outside player cancels pending click', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  const control = new MockElement('customControl', {
    rect: { left: 1000, top: 500, right: 1100, bottom: 550, width: 100, height: 50 },
    cursor: 'pointer',
  });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  h.state.topmost = control;
  h.userPointerDown(control, { x: 1050, y: 525 });
  h.clock.advance(300);
  assert(video.paused === false, 'pending pause canceled by plain-div control', { paused: video.paused });
});

// ---------------------------------------------------------------------------
// Reviewer minor: modal backdrop over video cancels pending
// ---------------------------------------------------------------------------
test('modal backdrop over video cancels pending click', () => {
  const h = makeHarness();
  const { video } = basicVideo(h, { paused: false });
  const backdrop = new MockElement('backdrop', { rect: video.rect });
  h.userPointerDown(video);
  h.userClick(video, { detail: 1 });
  h.clock.advance(100);
  h.state.topmost = backdrop;
  h.userPointerDown(backdrop, { x: 400, y: 225 });
  h.clock.advance(300);
  assert(video.paused === false, 'pending pause canceled by modal backdrop', { paused: video.paused });
});

// ---------------------------------------------------------------------------
// Informational: ad overlap blocks clicks (known limitation, not a fix target)
// ---------------------------------------------------------------------------
test('ad overlap blocks clicks (known limitation)', () => {
  const h = makeHarness();
  const video = h.makeVideo('video', { paused: false });
  const play = h.makeButton('play', { kind: 'play', video });
  const fsBtn = h.makeButton('fullscreen', { kind: 'fullscreen', video });
  const ad = new MockElement('ad', { rect: { left: 0, top: 0, right: 60, bottom: 30, width: 60, height: 30 } });
  const player = h.makePlayer('player', { rect: video.rect, video, playButton: play, fullscreenButton: fsBtn });
  player.querySelectorAll = () => [ad];
  h.state.topmost = video;

  h.userPointerDown(video);
  h.userClick(video, { x: 400, y: 225, detail: 1 });
  h.clock.advance(1000);
  console.log('INFO: toggleCount=' + h.state.toggleCount + ' (expected 0 while ad element overlaps)');
});
