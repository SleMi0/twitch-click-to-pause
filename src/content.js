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
  const CLICK_DELAY = 250;
  // How long after the first click a second click is still treated as a double click.
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
  ].join(',');

  // Best-effort detection of a running ad inside the player.
  const AD_SELECTOR = [
    '[data-a-target="ad-countdown"]',
    '[data-a-target="video-ad-countdown"]',
    '[data-a-target="ad-banner"]',
    '[data-test-selector="ad-banner"]',
    '[data-test-selector="ad-countdown"]',
  ].join(',');

  // Pick the largest visible video under the click. Using coordinates instead of
  // "first video on the page" keeps the mini player and the main player separate.
  function videoAtPoint(x, y) {
    let best = null;
    let bestArea = 0;

    for (const video of document.querySelectorAll('video')) {
      const rect = video.getBoundingClientRect();
      if (rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT) continue;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;

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

  function isAdPlaying(video) {
    const player = video.closest(PLAYER_SELECTOR) || document;
    return Array.from(player.querySelectorAll(AD_SELECTOR)).some(isVisible);
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
    if (target.tagName !== 'BUTTON' && target.getAttribute('role') !== 'button') return false;

    if (
      target.closest(
        '[data-a-target="player-controls"], [data-a-target="player-seekbar"], [data-a-target*="menu"], [data-a-target*="unmute"]',
      )
    ) {
      return false;
    }

    const rect = target.getBoundingClientRect();
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
  function findPlayerButton(video, selector) {
    const player = video.closest(PLAYER_SELECTOR);
    const scoped = player ? player.querySelector(selector) : null;
    if (scoped) return scoped;

    const all = document.querySelectorAll(selector);
    return all.length === 1 ? all[0] : null;
  }

  function togglePlayback(video) {
    const button = findPlayerButton(video, PLAY_PAUSE_BUTTON_SELECTOR);
    if (button) {
      button.click();
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
    if (document.fullscreenElement) return true;
    const rect = playerElement(video).getBoundingClientRect();
    return rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.95;
  }

  function requestNativeFullscreen(video, enter) {
    try {
      if (!enter) {
        if (document.fullscreenElement) document.exitFullscreen();
        return;
      }
      if (!document.fullscreenElement) playerElement(video).requestFullscreen();
    } catch {
      // Fullscreen is a nice-to-have; never break playback because of it.
    }
  }

  function toggleFullscreen(video) {
    const wasExpanded = isPlayerExpanded(video);
    const button = findPlayerButton(video, FULLSCREEN_BUTTON_SELECTOR);

    if (button) {
      button.click();
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

  function applyPlaybackState(video, shouldPause) {
    const token = ++playbackRestoreToken;
    const activeVideo = () => (document.contains(video) ? video : document.querySelector('video'));

    if (video.paused === shouldPause) return;
    togglePlayback(video);

    // The player can swallow the toggle while it re-renders for fullscreen, or
    // while a live stream reconnects, so keep checking for a short while. The
    // token makes sure a newer click cancels the restore.
    [300, 900, 1600, 2500, 4000].forEach((delay) => {
      setTimeout(() => {
        if (token !== playbackRestoreToken) return;
        const target = activeVideo();
        if (!target) return;
        if (target.paused !== shouldPause) togglePlayback(target);
      }, delay);
    });
  }

  function onClick(event) {
    if (event.button !== 0) return;
    if (event.defaultPrevented) return;

    const video = isVideoClickEvent(event);
    if (!video) return;

    // A new click always supersedes any pending playback restore.
    playbackRestoreToken++;

    const previous = pendingClick;
    // event.detail and event.timeStamp are assigned by the browser when the event
    // happens, so they stay correct even when the page's main thread is busy and
    // the two clicks are processed far apart.
    const isDoubleClick =
      event.detail >= 2 ||
      (previous !== null &&
        previous.video === video &&
        event.timeStamp - previous.startedAt < DBLCLICK_THRESHOLD);

    // Twitch reacts to the same click on its own (it toggles playback on VODs
    // and enters fullscreen on double click), which caused a double toggle.
    // From here on the extension owns both actions, so Twitch must not see them.
    event.stopPropagation();
    event.stopImmediatePropagation();

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
      startedAt: event.timeStamp,
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

  // The browser fires dblclick on its own even when the click events were
  // stopped, so it has to be swallowed too - the extension already handled it.
  function onDoubleClick(event) {
    if (event.button !== 0) return;
    if (!isVideoClickEvent(event)) return;

    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  // A single capture-phase listener on document survives SPA navigation and
  // player re-creation, so there is nothing to re-attach.
  document.addEventListener('click', onClick, true);
  document.addEventListener('dblclick', onDoubleClick, true);
})();
