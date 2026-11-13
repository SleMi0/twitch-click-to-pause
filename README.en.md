# Twitch Click to Pause

[Русский](README.md) | [English](README.en.md)

A Chrome extension that lets you pause and resume Twitch streams and videos by clicking directly on the player.

![Extension icon](icons/icon128.png)

## Features

- Click the video area to pause/resume playback
- Double click enters and exits Twitch's fullscreen/theater mode, just like Twitch itself (without pausing)
- Works on live streams, VODs, and clips
- Works through Twitch extension overlays: clicks on the non-interactive background pass through, while clicks on the extension's own controls are not forwarded
- Doesn't interfere with the control bar, chat, settings, seekbar, or menus
- Works with embedded players on `player.twitch.tv`
- Survives Twitch SPA navigation without page reloads
- Lightweight, no permissions, no network requests

## How it works

The extension attaches delegated click listeners in the capture phase to `document`. On click it:

1. Checks if the click lands inside the bounds of a visible `<video>` element.
2. Skips clicks on buttons, links, controls, the seekbar, menus, and other interactive elements. The full-size play button shown over a paused video is treated as part of the player surface.
3. Waits 400 ms to tell a single click from a double click. If the user presses a control, a key, opens a menu, or opens a modal during that window, the delayed click is cancelled: the newer action wins.
4. A single click toggles playback by clicking Twitch's native `player-play-pause-button` to keep the player state in sync. Delayed state is kept per video, so a click on one player does not cancel a click on another.
5. A double click undoes the pause and toggles Twitch's fullscreen/theater mode (enter and exit), so the video does not end up paused after going full-window. If the native button is missing or swallows the click, the Fullscreen API is used; `Esc` cancels the delayed fallback. Playback restoration accounts for asynchronous `video.paused` updates.
6. Stops event propagation so Twitch does not perform the same action a second time.

Twitch extension overlays (`*.ext-twitch.tv`) are rendered in a separate cross-origin iframe, and clicks inside it never reach the page that owns the player. Such an iframe forwards the click to its parent page via `postMessage` (nested frames pass it further up) only when the click lands on the overlay's non-interactive background. Clicks on buttons, links, `canvas`, cards, and other interactive elements are not forwarded; they also cancel a pending click in the player. The parent validates the message `origin`/`source`, coordinates, and `detail`, then verifies that the point really lies over the video. Extension authors can mark a container with `data-twitch-click-to-pause-ignore` to exclude it from pass-through.

## Installation

### Option 1. Download from Releases (easiest)
1. Go to the [Releases page](https://github.com/SleMi0/twitch-click-to-pause/releases)
2. Download the ZIP archive of the latest release (e.g., `twitch-click-to-pause-v1.1.1.zip`)
3. Extract the archive to a separate folder
4. Open `chrome://extensions/`
5. Enable **Developer mode** (toggle in the top-right corner)
6. Click **Load unpacked**
7. Select the extracted folder

### Option 2. Install from source
1. Download or clone the repository:
   ```bash
   git clone https://github.com/SleMi0/twitch-click-to-pause.git
   ```
2. Open `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `twitch-click-to-pause` folder

The extension will work on all `*.twitch.tv` pages immediately.

## Project structure

```
twitch-click-to-pause/
├── .gitattributes
├── .gitignore
├── CHANGELOG.md
├── AGENTS.md
├── AUDIT_REPORT.md
├── BROWSER_TEST_REPORT.md
├── FIX_PROGRESS.md
├── MANUAL_TEST_CHECKLIST.md
├── RELEASE_CHECKLIST.md
├── TECHNICAL_IMPROVEMENTS.md
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── LICENSE
├── manifest.json
├── README.md
├── README.en.md
├── src/
│   └── content.js
└── tests/
    ├── content.test.js
    └── README.md
```

The release ZIP contains only `icons/`, `src/`, `manifest.json`, `README*`, and `LICENSE`; audit/test documents are excluded.

## Testing

- `node --test tests/content.test.js` — 48 mock-DOM tests on the built-in Node test runner, no npm dependencies.
- These are not browser tests. Real checks are described in `MANUAL_TEST_CHECKLIST.md`; results are in `BROWSER_TEST_REPORT.md`.

## Limitations

- **Live streams.** Twitch does not support timeshift for live broadcasts. Pausing freezes the picture, but the stream continues in real time. Resuming will continue from the current live moment, not from the point where you paused.
- **VODs and clips.** Pause and resume work from the exact playback position.
- **Ads.** Ad detection is best-effort: if a visible ad element overlaps the video, clicks on the whole video surface are temporarily blocked. If Twitch changes its ad markup, an ad may be missed.
- **Extension overlays.** Pass-through works only for the non-interactive background. Full-screen games, `canvas` widgets, and cards with their own click handlers generally do not toggle the stream. A game implemented as a plain `div` without `role`/`cursor`/`tabindex` may be mistaken for background.
- **Multiple players.** If the clicked player has no native button or the button is disabled, `video.play()`/`video.pause()` is used. A button belonging to another player is never clicked.
- **Fullscreen/theater.** A double click toggles Twitch's fullscreen mode; a second double click exits back to the previous layout (normally with chat). If the Fullscreen API is unavailable, Twitch may use theater/full-window; the exact mode depends on the browser/environment. For extension overlays, the supervisor's duplicate synthetic `dblclick` is suppressed so exiting does not land in theater without chat. `Esc` or the player control also exits.
- **Third-party players.** Only works with the standard Twitch player.

## License

This project is licensed under the [MIT License](LICENSE).
