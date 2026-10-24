# Twitch Click to Pause

[Русский](README.md) | [English](README.en.md)

A Chrome extension that lets you pause and resume Twitch streams and videos by clicking directly on the player.

![Extension icon](icons/icon128.png)

## Features

- Click the video area to pause/resume playback
- Double click toggles fullscreen, just like Twitch itself (without pausing)
- Works on live streams, VODs, and clips
- Doesn't interfere with the control bar, chat, settings, seekbar, or menus
- Works with embedded players on `player.twitch.tv`
- Survives Twitch SPA navigation without page reloads
- Lightweight, no permissions, no network requests

## How it works

The extension attaches delegated click listeners in the capture phase to `document`. On click it:

1. Checks if the click lands inside the bounds of a visible `<video>` element.
2. Skips clicks on buttons, links, controls, the seekbar, menus, and other interactive elements. The full-size play button shown over a paused video is treated as part of the player surface.
3. Waits 250 ms to tell a single click from a double click.
4. A single click toggles playback by clicking Twitch's native `player-play-pause-button` to keep the player state in sync.
5. A double click undoes the pause and toggles fullscreen, so the video does not end up paused after going fullscreen.
6. Stops event propagation so Twitch does not perform the same action a second time.

## Installation

### Option 1. Download from Releases (easiest)
1. Go to the [Releases page](https://github.com/SleMi0/twitch-click-to-pause/releases)
2. Download the ZIP archive of the latest release (e.g., `twitch-click-to-pause-v1.0.1.zip`)
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
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── LICENSE
├── manifest.json
├── README.md
├── README.en.md
└── src/
    └── content.js
```

## Limitations

- **Live streams.** Twitch does not support timeshift for live broadcasts. Pausing freezes the picture, but the stream continues in real time. Resuming will continue from the current live moment, not from the point where you paused.
- **VODs and clips.** Pause and resume work from the exact playback position.
- **Ads.** The extension does not pause ad playback.
- **Third-party players.** Only works with the standard Twitch player.

## License

This project is licensed under the [MIT License](LICENSE).
