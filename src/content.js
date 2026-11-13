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
  // Do not retry a playback restore immediately: the native button may update
  // video.paused asynchronously (React state, re-render, live reconnect).
  const RESTORE_RETRY_GUARD = 600;
  // The browser dispatches dblclick after the second click. The fullscreen
  // transition can delay it by several hundred milliseconds, so the window is
  // wider than the click threshold. The target check below keeps a later
  // dblclick on an unrelated control from being swallowed.
  const DBLCLICK_SWALLOW_WINDOW = 1000;

  // One pending single click per video. A single global slot made clicks on
  // different players cancel each other, and let a stale entry outlive its
  // player. The map key is the video element itself.
  const pendingClicks = new Map();
  // Set when a real double click was handled, so the browser's own dblclick
  // event can be swallowed only for a pair we actually processed. The video is
  // remembered too, so a later dblclick on a control is left alone.
  let lastHandledDoubleClickTime = null;
  let lastHandledDoubleClickVideo = null;
  // Twitch's extension supervisor dispatches a synthetic dblclick on the
  // overlay iframe after the iframe's own click pair. When the bridge handled
  // that pair, letting Twitch handle the synthetic event too applies the
  // fullscreen toggle twice; the second exit then lands in theater mode.
  // Remember the forwarded pair so only that synthetic event is swallowed.
  let lastForwardedDoubleClickTime = null;

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
  const EXTENSION_CANCEL_MESSAGE = 'twitch-click-to-pause:cancel';
  // Twitch nests the extension inside a supervisor frame, so one click can be
  // relayed by more than one document. Every forwarded click carries an id so
  // the player can ignore the copies and handle the original click once.
  const FORWARDED_CLICK_TTL = 2000;
  // Bound the dedup map even when a source floods unique ids within the TTL.
  const MAX_FORWARDED_CLICKS = 100;
  let forwardedClickSequence = 0;
  const seenForwardedClicks = new Map();

  function isExtensionHost(hostname) {
    return hostname === EXTENSION_HOST || hostname.endsWith(`.${EXTENSION_HOST}`);
  }

  function isExtensionOrigin(origin) {
    if (typeof origin !== 'string' || !origin) return false;
    try {
      return isExtensionHost(new URL(origin).hostname);
    } catch {
      return false;
    }
  }

  // The immediate parent of an extension frame is a Twitch page or another
  // ext-twitch.tv supervisor. Chrome exposes its origin without a handshake.
  // Fall back to '*' only when the browser cannot provide it (opaque origins).
  function parentTargetOrigin() {
    const origins = location.ancestorOrigins;
    if (origins && origins.length > 0) {
      const origin = origins[0];
      if (origin && origin !== 'null') return origin;
    }
    return '*';
  }

  function isExtensionFrame(element) {
    if (!(element instanceof HTMLIFrameElement)) return false;
    try {
      return isExtensionHost(new URL(element.src, location.href).hostname);
    } catch {
      return false;
    }
  }

  // The supervisor can dispatch its synthetic dblclick on the iframe itself or
  // on a wrapper that contains it.
  function isExtensionFrameTarget(element) {
    if (isExtensionFrame(element)) return true;
    if (!(element instanceof Element)) return false;
    return Array.from(element.querySelectorAll('iframe')).some(isExtensionFrame);
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

  // Any visible ad element overlapping the video blocks clicks for the whole
  // video surface. This is deliberately conservative: it can disable the
  // feature if Twitch leaves a persistent ad element over the video, but it
  // avoids toggling playback during an ad. A per-click check would need a
  // reliable ad state, which the player does not expose.
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

  // Used only for cancelling a pending click. A click over any video rectangle
  // (even one covered by a modal/backdrop) is a new action; a control outside
  // the player is also a new action. Chat text and page background are not.
  function pointOverAnyVideo(x, y) {
    for (const video of document.querySelectorAll('video')) {
      if (!isVisible(video)) continue;
      const rect = video.getBoundingClientRect();
      if (rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT) continue;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
    return false;
  }

  function isLikelyInteractive(target) {
    if (!(target instanceof Element)) return false;
    if (
      target.closest(PLAYER_SELECTOR) ||
      target.closest(IGNORE_SELECTOR) ||
      target.closest(MODAL_SELECTOR)
    ) {
      return true;
    }
    if (target.hasAttribute('onclick')) return true;
    // tabindex="-1" is programmatic focus, not necessarily an interactive
    // control; keep it consistent with the extension background heuristic.
    if (typeof target.tabIndex === 'number' && target.tabIndex >= 0) return true;
    const style = window.getComputedStyle(target);
    return style.cursor === 'pointer' || style.cursor === 'grab' || style.cursor === 'grabbing';
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
        '[data-a-target="player-controls"], [data-a-target="player-seekbar"], [data-a-target*="menu"], [data-a-target*="unmute"], [data-a-target="player-settings-menu"], [data-a-target="player-overlay-content-gate"], [data-a-target="content-gate"], [data-test-selector="player-controls"]',
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
  // The extension clicks Twitch's own buttons. Such a click is untrusted and is
  // ignored by onClick() via event.isTrusted; the flag below is a second guard
  // for environments where the synthetic click is delivered differently.
  let clickingNativeButton = false;

  function clickNativeButton(button) {
    clickingNativeButton = true;
    try {
      button.click();
    } finally {
      clickingNativeButton = false;
    }
  }

  // A button found outside the clicked player could belong to another player on
  // the page. Uniqueness alone is not ownership.
  function belongsToSamePlayer(button, video) {
    const buttonPlayer = button.closest(PLAYER_SELECTOR);
    if (!buttonPlayer) return true; // Some embeds keep controls outside the root.
    const videoPlayer = video.closest(PLAYER_SELECTOR);
    return videoPlayer !== null && buttonPlayer === videoPlayer;
  }

  function isButtonDisabled(button) {
    return Boolean(button.disabled) || button.getAttribute('aria-disabled') === 'true';
  }

  function findPlayerButton(video, selector) {
    const root = video.closest(PLAYER_SELECTOR) || video.parentElement;
    const scoped = root ? root.querySelector(selector) : null;
    if (scoped && belongsToSamePlayer(scoped, video)) return scoped;

    // Some embeds keep the controls outside the player container. Accept only a
    // single visible match that is not owned by a different player.
    const all = Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .filter((button) => belongsToSamePlayer(button, video));
    return all.length === 1 ? all[0] : null;
  }

  function togglePlayback(video) {
    const button = findPlayerButton(video, PLAY_PAUSE_BUTTON_SELECTOR);
    if (button && !isButtonDisabled(button)) {
      clickNativeButton(button);
      return;
    }

    // The native button is missing or disabled (loading, ad, offline, unusual
    // embed). Fall back to the media API instead of swallowing the user's click.
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

  // A connected <video> can be reused for a different channel during SPA
  // navigation. The page URL is the navigation signal; currentSrc is
  // deliberately not part of the identity because Twitch recreates the
  // MediaSource for fullscreen quality switches and live reconnects, and the
  // restore loop exists to survive exactly those. Element replacement is
  // covered by document.contains(video).
  function pageIdentity() {
    const url = new URL(location.href);
    // Pathname catches channel/VOD/clip navigation. The channel/video query
    // params cover player.twitch.tv embeds; harmless hash/query changes (e.g.
    // a VOD timestamp) must not discard a pending click.
    return `${url.pathname}\n${url.searchParams.get('channel') || ''}\n${url.searchParams.get('video') || ''}`;
  }

  // Only actual fullscreen counts. The old rect heuristic treated a large
  // theater-mode player as fullscreen, so a double click entered fullscreen and
  // the fallback immediately exited it again.
  function isPlayerExpanded(video) {
    const fullscreen = document.fullscreenElement;
    return Boolean(fullscreen && fullscreen.contains(video));
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

  // A queued fullscreen fallback must not fight the user. fullscreenchange
  // (including Esc) and a new toggle cancel it; the token makes stale callbacks
  // harmless.
  let fullscreenToggleToken = 0;

  function cancelFullscreenFallback() {
    fullscreenToggleToken++;
  }

  function toggleFullscreen(video) {
    const wasFullscreen = isPlayerExpanded(video);
    const identity = pageIdentity();
    const button = findPlayerButton(video, FULLSCREEN_BUTTON_SELECTOR);
    const token = ++fullscreenToggleToken;

    if (button && !isButtonDisabled(button)) {
      clickNativeButton(button);
      // Twitch sometimes swallows the click (e.g. while the player is being
      // re-rendered), so verify the result and fall back to the browser API.
      setTimeout(() => {
        if (token !== fullscreenToggleToken) return;
        // If the clicked video is gone, do not fall back to another player.
        const target = document.contains(video) ? video : null;
        if (!target) return;
        if (pageIdentity() !== identity) return;
        if (isPlayerExpanded(target) === wasFullscreen) {
          requestNativeFullscreen(target, !wasFullscreen);
        }
      }, 400);
      return;
    }

    requestNativeFullscreen(video, !wasFullscreen);
  }

  function clearPendingClick(entry) {
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.cleanup) clearTimeout(entry.cleanup);
    if (pendingClicks.get(entry.video) === entry) pendingClicks.delete(entry.video);
  }

  function clearAllPendingClicks() {
    for (const entry of pendingClicks.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.cleanup) clearTimeout(entry.cleanup);
    }
    pendingClicks.clear();
  }

  // Put playback back into the state it had before the first click of a double
  // click, so a slow double click does not leave the video paused.
  let playbackRestoreToken = 0;

  // Any other interaction (a control, a key, a scroll) means the user took over,
  // so a queued restore must not fight them. Pending single clicks are cleared
  // by onPointerDown/onKeyDown; wheel only cancels the restore, because a scroll
  // after a click should not discard the click itself.
  function cancelPlaybackRestore() {
    playbackRestoreToken++;
  }

  function applyPlaybackState(video, shouldBePaused) {
    const token = ++playbackRestoreToken;
    // Never fall back to "the first video on the page": after SPA navigation or
    // a player re-render that is a different player, not the one we clicked.
    const activeVideo = () => (document.contains(video) ? video : null);
    const identity = pageIdentity();
    let lastToggleAt = performance.now();

    if (video.paused !== shouldBePaused) {
      togglePlayback(video);
    }

    // The player can swallow the toggle while it re-renders for fullscreen, or
    // while a live stream reconnects, so keep checking for a short while. The
    // token makes sure a newer click cancels the restore. The guard prevents a
    // retry while the previous toggle may still be settling.
    [300, 900, 1600, 2500, 4000].forEach((delay) => {
      setTimeout(() => {
        if (token !== playbackRestoreToken) return;
        const target = activeVideo();
        if (!target) return;
        if (pageIdentity() !== identity) return;
        if (target.paused === shouldBePaused) return;
        if (performance.now() - lastToggleAt < RESTORE_RETRY_GUARD) return;
        togglePlayback(target);
        lastToggleAt = performance.now();
      }, delay);
    });
  }

  // Shared by real clicks on the player and by clicks forwarded from an
  // extension iframe lying on top of the video.
  function handleVideoClick(video, detail, timeStamp) {
    // A third click in a multi-click chain is not a new single action: the
    // second click already toggled fullscreen. Ignore it instead of toggling
    // fullscreen again (or scheduling another playback toggle).
    if (detail > 2) return false;

    // A new click always supersedes any pending playback restore.
    cancelPlaybackRestore();

    const previous = pendingClicks.get(video) || null;
    // A previous entry from another page/stream must not be used for the
    // restore, even if the video element itself was reused.
    const previousMatches = previous !== null && previous.identity === pageIdentity();
    // detail and timeStamp are assigned by the browser when the event happens,
    // so they stay correct even when the page's main thread is busy and the two
    // clicks are processed far apart.
    const isDoubleClick =
      detail === 2 ||
      (previousMatches && timeStamp - previous.startedAt < DBLCLICK_THRESHOLD);

    if (isDoubleClick) {
      const alreadyToggled = previousMatches && previous.timer === null;
      const stateBeforeClick = previousMatches ? previous.wasPaused : null;
      clearPendingClick(previous);

      toggleFullscreen(video);
      if (alreadyToggled && stateBeforeClick !== null) {
        applyPlaybackState(video, stateBeforeClick);
      }
      return true;
    }

    clearPendingClick(previous);

    const entry = {
      video,
      startedAt: timeStamp,
      wasPaused: video.paused,
      identity: pageIdentity(),
      timer: null,
      cleanup: null,
    };

    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (pendingClicks.get(video) !== entry) return;
      // SPA navigation or a player re-render can remove the video during the
      // delay. Never let a stale click fall through to another player.
      if (!document.contains(video) || pageIdentity() !== entry.identity) {
        pendingClicks.delete(video);
        return;
      }
      togglePlayback(video);
    }, CLICK_DELAY);

    // Keep the entry around while a second click can still arrive, then forget it.
    entry.cleanup = setTimeout(() => {
      if (pendingClicks.get(video) === entry) pendingClicks.delete(video);
    }, PENDING_TTL);

    pendingClicks.set(video, entry);
    return false;
  }

  function onClick(event) {
    if (event.button !== 0) return;
    if (event.defaultPrevented) return;
    // A script-dispatched click is not a user action. Twitch's own synthetic
    // clicks should reach Twitch's handlers untouched.
    if (!event.isTrusted) return;
    // Ignore clicks the extension itself dispatched on Twitch's buttons.
    if (clickingNativeButton) return;

    const video = isVideoClickEvent(event);
    if (!video) return;

    // Twitch reacts to the same click on its own (it toggles playback on VODs
    // and enters fullscreen on double click), which caused a double toggle.
    // From here on the extension owns both actions, so Twitch must not see them.
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (handleVideoClick(video, event.detail, event.timeStamp)) {
      // performance.now() is taken after the native button click and the
      // resulting fullscreen transition. Using event.timeStamp here made the
      // marker look much older than the delayed dblclick and the swallow failed.
      lastHandledDoubleClickTime = performance.now();
      lastHandledDoubleClickVideo = video;
    }
  }

  // The browser fires dblclick on its own even when the click events were
  // stopped, so it has to be swallowed too - but only when this click pair was
  // actually handled by the extension and the event is still on the same
  // player surface.
  function onDoubleClick(event) {
    if (event.button !== 0) return;
    if (!event.isTrusted) return;
    if (lastHandledDoubleClickTime === null) return;

    if (event.timeStamp - lastHandledDoubleClickTime > DBLCLICK_SWALLOW_WINDOW) {
      lastHandledDoubleClickTime = null;
      lastHandledDoubleClickVideo = null;
      return;
    }

    // Only the player surface of the video we just handled may be swallowed.
    // A dblclick on a control, a modal, or another player keeps its behavior.
    const video = lastHandledDoubleClickVideo;
    const target = event.target;
    const player = video ? video.closest(PLAYER_SELECTOR) : null;
    const sameSurface = Boolean(
      video &&
      document.contains(video) &&
      target instanceof Element &&
      player &&
      player.contains(target) &&
      !target.closest(MODAL_SELECTOR) &&
      (!shouldIgnore(target) || isVideoSurfaceOverlay(target, video)),
    );

    lastHandledDoubleClickTime = null;
    lastHandledDoubleClickVideo = null;
    if (!sameSurface) return;

    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  // The extension supervisor also dispatches an untrusted dblclick on the
  // overlay iframe. If the bridge just handled the same pair, Twitch must not
  // handle it again: the duplicate toggle turns "exit fullscreen" into
  // "switch to theater mode". Anything not preceded by a forwarded pair is
  // left untouched, so Twitch keeps its native behavior when the bridge did
  // not act.
  function onSyntheticExtensionDoubleClick(event) {
    if (event.button !== 0) return;
    if (event.isTrusted) return;
    if (lastForwardedDoubleClickTime === null) return;
    if (event.timeStamp - lastForwardedDoubleClickTime > DBLCLICK_SWALLOW_WINDOW) {
      lastForwardedDoubleClickTime = null;
      return;
    }
    if (!isExtensionFrameTarget(event.target)) return;

    lastForwardedDoubleClickTime = null;
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
    // Require real numbers: Number(null) === 0 would otherwise turn malformed
    // data into a click at the frame's top-left corner.
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (!frame.clientWidth || !frame.clientHeight) return null;

    const style = window.getComputedStyle(frame);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    // clientWidth includes padding; the iframe's inner viewport is the content
    // box, so remove padding before bounds-checking and scaling.
    const innerWidth = frame.clientWidth - paddingLeft - paddingRight;
    const innerHeight = frame.clientHeight - paddingTop - paddingBottom;
    if (innerWidth <= 0 || innerHeight <= 0) return null;
    if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) return null;

    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    // offsetWidth/offsetHeight are the untransformed border-box layout size;
    // getBoundingClientRect is transformed. clientLeft/clientTop are the border
    // offsets. This handles border + padding + CSS scale in one step; rotation
    // and skew remain out of scope.
    const layoutWidth = frame.offsetWidth || frame.clientWidth;
    const layoutHeight = frame.offsetHeight || frame.clientHeight;
    if (!layoutWidth || !layoutHeight) return null;
    const scaleX = rect.width / layoutWidth;
    const scaleY = rect.height / layoutHeight;
    const offsetX = (frame.clientLeft || 0) + paddingLeft;
    const offsetY = (frame.clientTop || 0) + paddingTop;
    return {
      x: rect.left + offsetX * scaleX + x * scaleX,
      y: rect.top + offsetY * scaleY + y * scaleY,
    };
  }

  function postClickToParent(x, y, detail, id) {
    window.parent.postMessage(
      { type: EXTENSION_CLICK_MESSAGE, x, y, detail, id },
      parentTargetOrigin(),
    );
  }

  function postCancelToParent() {
    window.parent.postMessage({ type: EXTENSION_CANCEL_MESSAGE }, parentTargetOrigin());
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
    if (seenForwardedClicks.size > MAX_FORWARDED_CLICKS) {
      const cutoff = now - FORWARDED_CLICK_TTL;
      for (const [key, at] of seenForwardedClicks) {
        if (at < cutoff || seenForwardedClicks.size > MAX_FORWARDED_CLICKS) {
          seenForwardedClicks.delete(key);
        }
      }
    }
    return false;
  }

  // A click forwarded by an extension iframe. The iframe is cross-origin, so the
  // position is relative to its own viewport and has to be mapped back into this
  // document before the video under the cursor can be found.
  function onExtensionFrameClick(event) {
    const data = event.data;
    if (!data || (data.type !== EXTENSION_CLICK_MESSAGE && data.type !== EXTENSION_CANCEL_MESSAGE)) return;
    if (!isExtensionOrigin(event.origin)) return;

    const frame = event.source ? frameFromSource(event.source) : null;
    if (!frame || !isExtensionFrame(frame)) return;

    // A click on an extension control is not a pass-through click, but it is a
    // new user action: it must cancel a pending player click and restore.
    if (data.type === EXTENSION_CANCEL_MESSAGE) {
      cancelPlaybackRestore();
      clearAllPendingClicks();
      return;
    }

    if (isDuplicateForwardedClick(data.id)) return;

    const point = pointInFrame(frame, data.x, data.y);
    if (!point) return;

    const video = videoAtPoint(point.x, point.y);
    if (!video || isAdPlaying(video)) return;

    // Only a normal click (1) or a double click (2) is meaningful. Reject
    // non-numeric, missing, forged, or out-of-range values instead of turning
    // them into fullscreen.
    const detail = data.detail;
    if (typeof detail !== 'number' || (detail !== 1 && detail !== 2)) return;

    // The timestamp cannot be reused: each document has its own time origin.
    if (detail === 2) lastForwardedDoubleClickTime = performance.now();
    handleVideoClick(video, detail, performance.now());
  }

  // Only a click on the extension's non-interactive background should pass
  // through to the player. A cross-origin iframe cannot be inspected by the
  // parent, so this decision has to be made here. The old code forwarded every
  // non-semantic element, which made div/canvas-based extension controls pause
  // the stream while the user was interacting with them.
  function isExtensionBackgroundTarget(target) {
    if (!(target instanceof Element)) return false;

    // Explicit opt-out for extension authors and for future Twitch markup.
    if (target.closest('[data-twitch-click-to-pause-ignore]')) return false;
    if (target === document.documentElement || target === document.body) return true;

    // Non-semantic interactive surfaces and embedded media belong to the
    // extension, not to the player behind it.
    if (
      target.closest(
        'canvas, video, img, svg, input, textarea, select, button, a, label, summary, [contenteditable="true"], [draggable="true"], [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="slider"], [role="menu"], [role="menubar"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="textbox"], [role="combobox"], [role="tab"], [role="option"], [role="radio"], [role="radiogroup"], [role="application"], [role="grid"], [role="listbox"], [role="dialog"], [role="alertdialog"]',
      )
    ) {
      return false;
    }
    if (target.hasAttribute('onclick')) return false;

    const style = window.getComputedStyle(target);
    if (style.cursor === 'pointer' || style.cursor === 'grab' || style.cursor === 'grabbing') {
      return false;
    }

    // A pass-through background normally covers the whole overlay; cards and
    // controls are smaller. This is a heuristic, but it is deliberately
    // conservative: a false negative only means the extension background does
    // not pause the stream, while a false positive pauses it during interaction.
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    return rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9;
  }

  // Inside an extension iframe there is no video to toggle, but clicks still have
  // to reach the player that hosts the iframe.
  function installExtensionFrameBridge() {
    document.addEventListener(
      'click',
      (event) => {
        if (event.button !== 0) return;
        if (event.defaultPrevented) return;
        if (!event.isTrusted) return;
        // The extension's own controls (buttons, links, menus, ...) must not
        // pause the stream behind them. They still count as a user action, so
        // tell the player to cancel any pending click/restore.
        if (shouldIgnore(event.target) || !isExtensionBackgroundTarget(event.target)) {
          postCancelToParent();
          return;
        }

        postClickToParent(event.clientX, event.clientY, event.detail, createForwardedClickId());
      },
      true,
    );

    // Twitch nests the real extension inside a supervisor iframe, so a click can
    // arrive from a child frame. Map it into this document and pass it further
    // up: the video is only known to the page that owns the player.
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || (data.type !== EXTENSION_CLICK_MESSAGE && data.type !== EXTENSION_CANCEL_MESSAGE)) return;
      if (!isExtensionOrigin(event.origin)) return;

      const frame = event.source ? frameFromSource(event.source) : null;
      if (!frame || !isExtensionFrame(frame)) return;

      if (data.type === EXTENSION_CANCEL_MESSAGE) {
        postCancelToParent();
        return;
      }

      const point = pointInFrame(frame, data.x, data.y);
      if (!point) return;

      postClickToParent(point.x, point.y, data.detail, data.id);
    });
  }

  // A pointerdown on the video starts a possible video click; keep that video's
  // pending entry so a second click can still become a double click. A
  // pointerdown on a control, a modal, or other player UI means the user chose
  // another action, so stale pending toggles must not fire later.
  function onPointerDown(event) {
    if (!event.isTrusted) return;
    cancelPlaybackRestore();
    if (event.button !== 0) {
      clearAllPendingClicks();
      return;
    }
    // No geometry work unless a delayed click actually exists.
    if (pendingClicks.size === 0) return;

    // A click on the video itself starts a video click; keep its pending entry
    // so a second click can still become a double click. A control, a modal, a
    // covered video area, or any other interactive element means the user chose
    // another action. Chat text and the page background are left alone.
    if (isVideoClickEvent(event)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (pointOverAnyVideo(event.clientX, event.clientY) || isLikelyInteractive(target)) {
      clearAllPendingClicks();
    }
  }

  // A key press means the user took over (Space, shortcuts, chat, ...). It must
  // cancel both the pending toggle and the queued playback restore.
  function onKeyDown(event) {
    if (!event.isTrusted) return;
    cancelPlaybackRestore();
    clearAllPendingClicks();
    // Esc is an explicit request to leave fullscreen; do not let the queued
    // fallback re-enter it a moment later.
    if (event.key === 'Escape') cancelFullscreenFallback();
  }

  // Extension overlays are rendered in their own cross-origin document on top of
  // the player, so only the hosting document can toggle playback.
  if (isExtensionHost(location.hostname)) {
    if (window.parent !== window) installExtensionFrameBridge();
    return;
  }

  // Delegated capture-phase listeners survive SPA navigation and player
  // re-creation, so there is nothing to re-attach.
  document.addEventListener('click', onClick, true);
  // Window capture runs before Twitch's own player handlers. Twitch handles a
  // video dblclick itself (theater/fullscreen), so a document-level swallow is
  // too late and the action is applied twice.
  window.addEventListener('dblclick', onDoubleClick, true);
  // The extension supervisor's synthetic iframe dblclick is untrusted and is
  // handled separately; see onSyntheticExtensionDoubleClick.
  window.addEventListener('dblclick', onSyntheticExtensionDoubleClick, true);
  window.addEventListener('message', onExtensionFrameClick);

  // Clicking a control, pressing a key or scrolling means the user is back in
  // charge, so queued actions must stop instead of fighting them.
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('wheel', cancelPlaybackRestore, true);
  document.addEventListener('fullscreenchange', cancelFullscreenFallback, true);
})();
