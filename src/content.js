(() => {
  'use strict';

  const INSTALLED_FLAG = '__twitchClickToPauseInstalled';
  if (window[INSTALLED_FLAG]) return;
  window[INSTALLED_FLAG] = true;

  const MIN_VIDEO_WIDTH = 80;
  const MIN_VIDEO_HEIGHT = 45;

  const PLAYER_SELECTOR = '[data-a-target="video-player"], .video-player';
  const PLAY_PAUSE_BUTTON_SELECTOR = 'button[data-a-target="player-play-pause-button"]';
  const FULLSCREEN_BUTTON_SELECTOR = 'button[data-a-target="player-fullscreen-button"]';

  // A single click is delayed briefly so a double click can cancel it. Without
  // the delay a double click would pause the video before going fullscreen.
  // Keep it at least as long as DBLCLICK_THRESHOLD, otherwise a double click in
  // between the two values would still toggle playback for a moment.
  const CLICK_DELAY = 400;
  // How long after the first click a second click is still treated as a double
  // click. The browser's own double click window (event.detail >= 2) can be
  // longer, so applyPlaybackState() still undoes the toggle in that case.
  const DBLCLICK_THRESHOLD = 400;
  // How long the last click is remembered, so a slow double click can still undo
  // the playback toggle that has already happened.
  const PENDING_TTL = 1200;

  let pendingClick = null;

  // Elements that must keep their native behavior (controls, menus, links, chat, etc.).
  const IGNORE_SELECTOR = [
    'button',
    'a',
    'input',
    'select',
    'textarea',
    'label',
    'summary',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="link"]',
    '[role="slider"]',
    '[role="menu"]',
    '[role="menubar"]',
    '[role="menuitem"]',
    '[data-a-target="player-controls"]',
    '[data-a-target="player-settings-menu"]',
    '[data-a-target="player-seekbar"]',
    '[data-a-target="player-overlay-content-gate"]',
    '[data-a-target="content-gate"]',
    '[data-a-target*="unmute"]',
    '[data-test-selector="player-controls"]',
    // Twitch extension UI: the dock on the right of the player, the extension
    // settings popover and its info balloon. The dock card is a plain div, so
    // it has to be matched by class rather than by tag/role.
    '[class*="extensions-dock"]',
    '[class*="extensions-popover"]',
    '[class*="extensions-info-balloon"]',
    '[class*="extensions-notifications"]',
  ].join(',');

  // Best-effort detection of a running ad inside the player.
  const AD_SELECTOR = [
    '[data-a-target="ad-countdown"]',
    '[data-a-target="video-ad-countdown"]',
    '[data-a-target="ad-banner"]',
    '[data-test-selector="ad-banner"]',
    '[data-test-selector="ad-countdown"]',
  ].join(',');

  // A click inside a modal must never reach the video behind it.
  const MODAL_SELECTOR = [
    'dialog[open]',
    '[role="dialog"]',
    '[aria-modal="true"]',
    '.ReactModal__Overlay',
  ].join(',');

  // Twitch extensions (Hearthstone Deck Tracker, polls, overlays, ...) live in
  // cross-origin iframes on top of the player. Clicks inside such an iframe are
  // dispatched in the iframe document only, so the player document never sees
  // them. The iframe forwards the click with a message instead.
  const EXTENSION_HOST = 'ext-twitch.tv';
  const EXTENSION_CLICK_MESSAGE = 'twitch-click-to-pause:click';
  // Twitch nests the extension inside a supervisor frame, so one click can be
  // relayed by more than one document. Every forwarded click carries an id so
  // the player can ignore the copies and handle the original click once.
  const FORWARDED_CLICK_TTL = 2000;
  let forwardedClickSequence = 0;
  const seenForwardedClicks = new Map();

  function isExtensionHost(hostname) {
    return hostname === EXTENSION_HOST || hostname.endsWith(`.${EXTENSION_HOST}`);
  }

  function isExtensionFrame(element) {
    if (!(element instanceof HTMLIFrameElement)) return false;
    try {
      return isExtensionHost(new URL(element.src, location.href).hostname);
    } catch {
      return false;
    }
  }

  // Extension overlays are sometimes wrapped in a container that captures the
  // pointer, so both the iframe itself and any element containing it count.
  function isExtensionOverlayAtPoint(element, x, y) {
    if (isExtensionFrame(element)) return true;
    if (!(element instanceof Element)) return false;

    for (const frame of element.querySelectorAll('iframe')) {
      if (!isExtensionFrame(frame)) continue;
      const rect = frame.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
    return false;
  }

  function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  // The video rectangle alone is not enough: modals and unrelated overlays can
  // be drawn on top of it. When the player root is known, only the player (or
  // the video itself) may be the topmost element under the cursor.
  function isExposedAtPoint(video, x, y) {
    const topmost = document.elementFromPoint(x, y);
    if (!topmost) return true;
    if (topmost === video || video.contains(topmost)) return true;
    if (topmost.closest(MODAL_SELECTOR)) return false;

    const player = video.closest(PLAYER_SELECTOR);
    // Without a player root overlays cannot be told apart from the player, so
    // stay permissive instead of breaking playback on unusual embeds.
    if (!player) return true;

    // Extension overlays are separate documents. The iframe element itself (or
    // its wrapper) is the topmost node here, but it is still part of the
    // player surface.
    return player.contains(topmost) || isExtensionOverlayAtPoint(topmost, x, y);
  }

  // Pick the largest visible video under the click. Using coordinates instead of
  // "first video on the page" keeps the mini player and the main player separate.
  function videoAtPoint(x, y) {
    let best = null;
    let bestArea = 0;

    for (const video of document.querySelectorAll('video')) {
      const rect = video.getBoundingClientRect();
      if (rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT) continue;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      if (!isExposedAtPoint(video, x, y)) continue;

      const style = window.getComputedStyle(video);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = video;
        bestArea = area;
      }
    }

    return best;
  }

  // Only an ad element drawn over the video counts, not an ad banner somewhere
  // else on the page (chat, sidebar), which would otherwise block every click.
  function isAdPlaying(video) {
    const player = video.closest(PLAYER_SELECTOR);
    const root = player || document;
    const videoRect = video.getBoundingClientRect();
    return Array.from(root.querySelectorAll(AD_SELECTOR)).some(
      (element) => isVisible(element) && rectsOverlap(element.getBoundingClientRect(), videoRect),
    );
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function shouldIgnore(target) {
    if (!(target instanceof Element)) return true;
    return Boolean(target.closest(IGNORE_SELECTOR));
  }

  // When the video is paused Twitch renders a full-size "play" button over the
  // whole player. It is not a control - it is the video surface - so clicks on it
  // must be handled like clicks on the video itself.
  function isVideoSurfaceOverlay(target, video) {
    if (!(target instanceof Element)) return false;

    // The click usually lands on an element nested inside the button (icon,
    // wrapper), so the whole button has to be measured, not just the target.
    const surface = target.closest('button, [role="button"]');
    if (!surface) return false;

    if (
      surface.closest(
        '[data-a-target="player-controls"], [data-a-target="player-seekbar"], [data-a-target*="menu"], [data-a-target*="unmute"], [data-test-selector="player-controls"]',
      )
    ) {
      return false;
    }

    const rect = surface.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();
    if (!videoRect.width || !videoRect.height) return false;

    return rect.width >= videoRect.width * 0.9 && rect.height >= videoRect.height * 0.9;
  }

  function isVideoClickEvent(event) {
    const video = videoAtPoint(event.clientX, event.clientY);
    if (!video) return null;
    if (isAdPlaying(video)) return null;
    if (!shouldIgnore(event.target) || isVideoSurfaceOverlay(event.target, video)) return video;
    return null;
  }

  // Twitch's own buttons keep the player state in sync, including for live
  // streams where calling video.play() directly can be aborted by the player's
  // internal state machine. Prefer them and fall back to the media API only when
  // the buttons are not available (e.g. unusual embeds).
  //
  // The extension clicks Twitch's own buttons, and such a synthetic click is
  // dispatched synchronously, so the flag below keeps onClick() from treating it
  // as a fresh user click (which would toggle playback a second time).
  let clickingNativeButton = false;

  function clickNativeButton(button) {
    clickingNativeButton = true;
    try {
      button.click();
    } finally {
      clickingNativeButton = false;
    }
  }

  function findPlayerButton(video, selector) {
    const root = video.closest(PLAYER_SELECTOR) || video.parentElement;
    const scoped = root ? root.querySelector(selector) : null;
    if (scoped) return scoped;

    // Some embeds keep the controls outside the player container. Accept only a
    // single visible match so a second player on the page is never touched.
    const all = Array.from(document.querySelectorAll(selector)).filter(isVisible);
    return all.length === 1 ? all[0] : null;
  }

  function togglePlayback(video) {
    const button = findPlayerButton(video, PLAY_PAUSE_BUTTON_SELECTOR);
    if (button) {
      clickNativeButton(button);
      return;
    }

    if (video.paused) {
      const result = video.play();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } else {
      video.pause();
    }
  }

  function playerElement(video) {
    return video.closest(PLAYER_SELECTOR) || video.parentElement || video;
  }

  function isPlayerExpanded(video) {
    const fullscreen = document.fullscreenElement;
    if (fullscreen) {
      // Only fullscreen that actually shows this video counts; a fullscreen
      // dialog or another player must not be mistaken for the player's state.
      return fullscreen.contains(video);
    }
    const rect = playerElement(video).getBoundingClientRect();
    return rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.95;
  }

  function requestNativeFullscreen(video, enter) {
    // Both APIs return promises that reject when the browser denies the request
    // (no user activation, iframe without allowfullscreen, ...). Swallow them so
    // the console stays clean and playback is never affected.
    const ignoreRejection = (result) => {
      if (result && typeof result.catch === 'function') result.catch(() => {});
    };

    try {
      if (!enter) {
        if (document.fullscreenElement) ignoreRejection(document.exitFullscreen());
        return;
      }
      if (!document.fullscreenElement) ignoreRejection(playerElement(video).requestFullscreen());
    } catch {
      // Fullscreen is a nice-to-have; never break playback because of it.
    }
  }

  function toggleFullscreen(video) {
    const wasExpanded = isPlayerExpanded(video);
    const button = findPlayerButton(video, FULLSCREEN_BUTTON_SELECTOR);

    if (button) {
      clickNativeButton(button);
      // Twitch sometimes swallows the click (e.g. while the player is being
      // re-rendered), so verify the result and fall back to the browser API.
      setTimeout(() => {
        const target = document.contains(video) ? video : document.querySelector('video');
        if (!target) return;
        if (isPlayerExpanded(target) === wasExpanded) {
          requestNativeFullscreen(target, !wasExpanded);
        }
      }, 400);
      return;
    }

    requestNativeFullscreen(video, !wasExpanded);
  }

  function clearPendingClick() {
    if (!pendingClick) return;
    if (pendingClick.timer) clearTimeout(pendingClick.timer);
    if (pendingClick.cleanup) clearTimeout(pendingClick.cleanup);
    pendingClick = null;
  }

  // Put playback back into the state it had before the first click of a double
  // click, so a slow double click does not leave the video paused.
  let playbackRestoreToken = 0;

  // Any other interaction (a control, a key, a scroll) means the user took over,
  // so a queued restore must not fight them.
  function cancelPlaybackRestore() {
    playbackRestoreToken++;
  }

  function applyPlaybackState(video, shouldBePaused) {
    const token = ++playbackRestoreToken;
    const activeVideo = () => (document.contains(video) ? video : document.querySelector('video'));

    if (video.paused === shouldBePaused) return;
    togglePlayback(video);

    // The player can swallow the toggle while it re-renders for fullscreen, or
    // while a live stream reconnects, so keep checking for a short while. The
    // token makes sure a newer click cancels the restore.
    [300, 900, 1600, 2500, 4000].forEach((delay) => {
      setTimeout(() => {
        if (token !== playbackRestoreToken) return;
        const target = activeVideo();
        if (!target) return;
        if (target.paused !== shouldBePaused) togglePlayback(target);
      }, delay);
    });
  }

  // Shared by real clicks on the player and by clicks forwarded from an
  // extension iframe lying on top of the video.
  function handleVideoClick(video, detail, timeStamp) {
    // A new click always supersedes any pending playback restore.
    cancelPlaybackRestore();

    const previous = pendingClick;
    // detail and timeStamp are assigned by the browser when the event happens,
    // so they stay correct even when the page's main thread is busy and the two
    // clicks are processed far apart.
    const isDoubleClick =
      detail >= 2 ||
      (previous !== null &&
        previous.video === video &&
        timeStamp - previous.startedAt < DBLCLICK_THRESHOLD);

    if (isDoubleClick) {
      const alreadyToggled = previous !== null && previous.timer === null;
      const stateBeforeClick = previous !== null ? previous.wasPaused : null;
      clearPendingClick();

      toggleFullscreen(video);
      if (alreadyToggled && stateBeforeClick !== null) {
        applyPlaybackState(video, stateBeforeClick);
      }
      return;
    }

    clearPendingClick();

    const entry = {
      video,
      startedAt: timeStamp,
      wasPaused: video.paused,
      timer: null,
      cleanup: null,
    };

    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (pendingClick !== entry) return;
      togglePlayback(video);
    }, CLICK_DELAY);

    // Keep the entry around while a second click can still arrive, then forget it.
    entry.cleanup = setTimeout(() => {
      if (pendingClick === entry) pendingClick = null;
    }, PENDING_TTL);

    pendingClick = entry;
  }

  function onClick(event) {
    if (event.button !== 0) return;
    if (event.defaultPrevented) return;
    // Ignore clicks the extension itself dispatched on Twitch's buttons.
    if (clickingNativeButton) return;

    const video = isVideoClickEvent(event);
    if (!video) return;

    // Twitch reacts to the same click on its own (it toggles playback on VODs
    // and enters fullscreen on double click), which caused a double toggle.
    // From here on the extension owns both actions, so Twitch must not see them.
    event.stopPropagation();
    event.stopImmediatePropagation();

    handleVideoClick(video, event.detail, event.timeStamp);
  }

  // The browser fires dblclick on its own even when the click events were
  // stopped, so it has to be swallowed too - the extension already handled it.
  function onDoubleClick(event) {
    if (event.button !== 0) return;
    if (!isVideoClickEvent(event)) return;

    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function frameFromSource(source) {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.contentWindow === source) return frame;
    }
    return null;
  }

  // Translate a point from an iframe's viewport into this document. The scale is
  // normally 1, but overlays can be resized with CSS transforms.
  function pointInFrame(frame, x, y) {
    const localX = Number(x);
    const localY = Number(y);
    if (!Number.isFinite(localX) || !Number.isFinite(localY)) return null;

    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const scaleX = frame.clientWidth ? rect.width / frame.clientWidth : 1;
    const scaleY = frame.clientHeight ? rect.height / frame.clientHeight : 1;
    return { x: rect.left + localX * scaleX, y: rect.top + localY * scaleY };
  }

  function postClickToParent(x, y, detail, id) {
    window.parent.postMessage(
      { type: EXTENSION_CLICK_MESSAGE, x, y, detail, id },
      '*',
    );
  }

  function createForwardedClickId() {
    forwardedClickSequence += 1;
    const random = Math.random().toString(36).slice(2);
    return `${Date.now().toString(36)}-${forwardedClickSequence}-${random}`;
  }

  // The same click may arrive several times when a click is relayed through more
  // than one nested frame. Handling the copies separately would look like a
  // double click to the player (which toggles fullscreen instead of playback).
  function isDuplicateForwardedClick(id) {
    if (typeof id !== 'string' || !id) return false;

    const now = performance.now();
    const previous = seenForwardedClicks.get(id);
    if (previous !== undefined && now - previous < FORWARDED_CLICK_TTL) return true;

    seenForwardedClicks.set(id, now);
    if (seenForwardedClicks.size > 100) {
      for (const [key, at] of seenForwardedClicks) {
        if (now - at > FORWARDED_CLICK_TTL) seenForwardedClicks.delete(key);
      }
    }
    return false;
  }

  // A click forwarded by an extension iframe. The iframe is cross-origin, so the
  // position is relative to its own viewport and has to be mapped back into this
  // document before the video under the cursor can be found.
  function onExtensionFrameClick(event) {
    const data = event.data;
    if (!data || data.type !== EXTENSION_CLICK_MESSAGE) return;

    const frame = event.source ? frameFromSource(event.source) : null;
    if (!frame || !isExtensionFrame(frame)) return;
    if (isDuplicateForwardedClick(data.id)) return;

    const point = pointInFrame(frame, data.x, data.y);
    if (!point) return;

    const video = videoAtPoint(point.x, point.y);
    if (!video || isAdPlaying(video)) return;

    // The timestamp cannot be reused: each document has its own time origin.
    handleVideoClick(video, Number(data.detail) || 1, performance.now());
  }

  // Inside an extension iframe there is no video to toggle, but clicks still have
  // to reach the player that hosts the iframe.
  function installExtensionFrameBridge() {
    document.addEventListener(
      'click',
      (event) => {
        if (event.button !== 0) return;
        // The extension's own controls (buttons, links, menus, ...) must not
        // pause the stream behind them.
        if (shouldIgnore(event.target)) return;

        postClickToParent(event.clientX, event.clientY, event.detail, createForwardedClickId());
      },
      true,
    );

    // Twitch nests the real extension inside a supervisor iframe, so a click can
    // arrive from a child frame. Map it into this document and pass it further
    // up: the video is only known to the page that owns the player.
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.type !== EXTENSION_CLICK_MESSAGE) return;

      const frame = event.source ? frameFromSource(event.source) : null;
      if (!frame || !isExtensionFrame(frame)) return;

      const point = pointInFrame(frame, data.x, data.y);
      if (!point) return;

      postClickToParent(point.x, point.y, Number(data.detail) || 1, data.id);
    });
  }

  // Extension overlays are rendered in their own cross-origin document on top of
  // the player, so only the hosting document can toggle playback.
  if (isExtensionHost(location.hostname)) {
    if (window.parent !== window) installExtensionFrameBridge();
    return;
  }

  // A single capture-phase listener on document survives SPA navigation and
  // player re-creation, so there is nothing to re-attach.
  document.addEventListener('click', onClick, true);
  document.addEventListener('dblclick', onDoubleClick, true);
  window.addEventListener('message', onExtensionFrameClick);

  // Clicking a control, pressing a key or scrolling means the user is back in
  // charge, so a pending playback restore must stop instead of fighting them.
  ['pointerdown', 'keydown', 'wheel'].forEach((type) => {
    document.addEventListener(type, cancelPlaybackRestore, true);
  });
})();
