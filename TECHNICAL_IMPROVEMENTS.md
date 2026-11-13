# Technical Improvements

**Project:** Twitch Click to Pause
**Date:** 2026-11-12
**Sources:** `AUDIT_REPORT.md`, `FIX_PROGRESS.md`, `BROWSER_TEST_REPORT.md`

## 1. Removed limitations

### Pending click lifecycle (F-01, F-03, F-04, F-12)

- Replaced the single global `pendingClick` with a per-video `Map`.
- A control click, modal/player UI click, keyboard action, or extension-control click cancels the pending click; a click on chat text/page background does not.
- A stale pending entry is discarded if the video is removed or the page/channel identity changes.
- Cross-video double-click no longer applies the previous video's playback state.
- Two videos no longer cancel each other's single clicks.

### Extension overlays (F-02)

- The bridge forwards only clicks on the non-interactive background (full-size, no interactive role/tabindex/cursor/onclick/media).
- Clicks on buttons, links, `canvas`, dialogs, cards, and other controls are not forwarded; they send a cancel message so a pending player click is invalidated.
- Added opt-out `data-twitch-click-to-pause-ignore`.
- Real Twitch supervisor + nested overlay (`solaryhs`) was tested: background click toggled playback; a real overlay button did not.

### Playback state and player identity (F-05, F-10)

- Removed the `document.querySelector('video')` fallback; restore/fullscreen never target another player.
- Added a restore retry guard for asynchronous native-button state updates.
- Identity uses page pathname + `channel`/`video` query + element connectivity. `currentSrc` is deliberately excluded so reconnect/quality changes do not discard the restore. Same-URL stream swap without element replacement remains a documented limitation.

### Fullscreen/theater (F-06, F-07)

- `isPlayerExpanded` no longer treats a large player as browser fullscreen.
- Added a fullscreen fallback token; `fullscreenchange`, Esc, and a new toggle cancel stale fallbacks.
- Real Twitch observation (headed Chrome for Testing with the window focused, so the Fullscreen API is granted): the first double-click enters real fullscreen; the second exits to the normal layout with chat visible. Native Twitch without the extension behaves the same. Headless automation denies fullscreen and falls back to theater, which is why the suite records theater there.
- F-27 fix: the supervisor's synthetic iframe `dblclick` is swallowed only after a forwarded pair handled by the bridge; the trusted player `dblclick` swallow moved to window capture (before Twitch's handler); the marker uses `performance.now()` after the native button/fullscreen transition; the window is 1000 ms and is restricted to the same player surface, so controls, modals, and other players keep their dblclick behavior.

### Native buttons and multiple players (F-08, F-14)

- A button found globally must belong to the clicked player or have no player owner.
- Disabled native buttons fall back to `video.play()`/`pause()`.

### Click classification (F-11, F-13, F-18, F-19)

- `detail > 2` is ignored (triple click no longer toggles fullscreen twice).
- Content-gate/settings/unmute/menu elements are excluded from the full-size play-overlay rescue.
- `event.isTrusted` is required for click/dblclick/bridge/pointerdown/keydown.
- `dblclick` is swallowed only for a pair the extension actually handled, at window capture, with a 1000 ms window and a same-player-surface check.

### iframe messages (F-15, F-16, F-21, F-22)

- `event.origin` is validated in the player and nested relay.
- Coordinates must be real numbers inside the iframe content box; border, padding, and CSS scale are accounted for.
- Only `detail` 1/2 is accepted.
- Dedup map is capped at 100 entries.
- `postMessage` uses the immediate ancestor origin from `location.ancestorOrigins[0]` (`https://www.twitch.tv` / `https://supervisor.ext-twitch.tv` in real frames); `'*'` is only a fallback when the browser cannot provide an origin.

### Testability (F-25)

- Added `tests/content.test.js`: 48 Node built-in tests using `node:test`, a mock DOM, and fake timers. No npm dependencies, no bundler.
- Added `tests/README.md` with run instructions, coverage, and limitations.

### Selectors (F-26)

- Verified in a real Twitch page: player root matches `[data-a-target="video-player"]`/`.video-player`; play/pause, fullscreen, settings, controls, and chat input match their expected attributes.
- The theater control is a button with an accessible `aria-label` (`Theatre Mode` / `Exit Theatre Mode`), not a data attribute.
- No mass selector replacement was performed.

## 2. Retained compromises

| Area | Decision | Reason |
|---|---|---|
| F-20 `stopImmediatePropagation` | Kept | Prevents Twitch from performing the same play/pause or double-click action; real native controls, chat, settings, and extension buttons still work. |
| F-09 ad detection | Kept conservative | No real ad insertion was observed in the test session. The current exact data-attribute selectors do not false-positive on the hidden `stream-display-ad` wrapper. A per-click or class-based change is unverified for real ads. |
| F-23 about:blank/srcdoc | No change | Real supervisor/nested frames were `https://*.ext-twitch.tv`; no `about:blank`/`srcdoc` extension frame was observed. Adding `match_about_blank` would broaden injection without evidence. |
| F-26 selectors | Partial | Real player/control/chat selectors verified; extension UI/ads remain unverified. Broad refactor was out of scope. |
| Source identity | URL + connectivity, not `currentSrc` | Twitch recreates MediaSource on reconnect/quality; `currentSrc` would discard the restore. Same-URL stream swap without element replacement remains a limitation. |
| F-21 targetOrigin | Concrete ancestor origin; the embedding parent still receives non-sensitive coordinates by design | The bridge's purpose is to send a click to its parent; no credentials/data are sent. |
| Overlay heuristic | Conservative | A full-size plain `div` game without role/tabindex/cursor/onclick can still be mistaken for background. |
| Chat input | Cancels pending by design | It is a control; clicking chat is a new user action. Chat message text does not cancel. |
| Plain-div control | Classified by `cursor:pointer`/`tabindex`/`onclick`/role | A plain div with none of these outside the player is not classified. |
| Modal backdrop | Covered-video point clears pending; real modal detection still depends on `MODAL_SELECTOR` | Synthetic `role="dialog"` backdrop passed; a custom backdrop with no role is only handled when it covers a video. |
| Scaled+padded iframe | Border/padding/scale formula tested in mock | Rotation/skew is out of scope; real scaled extension iframe was not available. |

## 3. Verification

- `node --check src/content.js` — OK.
- `manifest.json` parse — OK.
- `node --test tests/content.test.js` — 48/48 pass.
- External mock harness — 59/59 assertions.
- Real browser (Google Chrome for Testing 157.0.8103.78, unpacked extension) - 25 PASS + 1 BLOCKED (no ad insertion); branded Chrome 157.0.8103.79 (CDP `Extensions.loadUnpacked`) - 22 PASS + 4 BLOCKED, 0 FAIL; overlay button remains manual-confirmation; see `BROWSER_TEST_REPORT.md`.
- Branded Chrome ignores `--load-extension` in this environment, but the extension loads and runs through CDP `Extensions.loadUnpacked`.

## 4. Release status

Version and release ZIP were **not** changed. The current `twitch-click-to-pause-v1.1.0.zip` corresponds to the previous source and does not contain these fixes. See `RELEASE_CHECKLIST.md`.
