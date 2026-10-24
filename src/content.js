(() => {
  'use strict';

  const INSTALLED_FLAG = '__twitchClickToPauseInstalled';
  if (window[INSTALLED_FLAG]) return;
  window[INSTALLED_FLAG] = true;

  const MIN_VIDEO_WIDTH = 80;
  const MIN_VIDEO_HEIGHT = 45;

  const PLAYER_SELECTOR = '[data-a-target="video-player"], .video-player';
  const PLAY_PAUSE_BUTTON_SELECTOR = 'button[data-a-target="player-play-pause-button"]';

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

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
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

  function shouldIgnore(target) {
    if (!(target instanceof Element)) return true;
    return Boolean(target.closest(IGNORE_SELECTOR));
  }

  // Twitch's own play/pause button keeps the player state in sync, including
  // for live streams where calling video.play() directly can be aborted by the
  // player's internal state machine. Prefer it and fall back to the media API
  // only when the button is not available (e.g. unusual embeds).
  function findPlayPauseButton(video) {
    const player = video.closest(PLAYER_SELECTOR);
    const scoped = player ? player.querySelector(PLAY_PAUSE_BUTTON_SELECTOR) : null;
    if (scoped) return scoped;

    const all = document.querySelectorAll(PLAY_PAUSE_BUTTON_SELECTOR);
    return all.length === 1 ? all[0] : null;
  }

  function togglePlayback(video) {
    const button = findPlayPauseButton(video);
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

  function onClick(event) {
    if (event.button !== 0) return;
    if (event.defaultPrevented) return;
    if (shouldIgnore(event.target)) return;

    const video = videoAtPoint(event.clientX, event.clientY);
    if (!video) return;
    if (isAdPlaying(video)) return;

    // Twitch handles clicks on VODs itself, so stop the event to avoid a double toggle.
    event.stopPropagation();
    event.stopImmediatePropagation();

    togglePlayback(video);
  }

  // A single capture-phase listener on document survives SPA navigation and
  // player re-creation, so there is nothing to re-attach.
  document.addEventListener('click', onClick, true);
})();
