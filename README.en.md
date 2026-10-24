# Twitch Click to Pause

[Русский](README.md) | [English](README.en.md)

A Chrome extension that lets you pause and resume Twitch streams and videos by clicking directly on the player.

![Extension icon](icons/icon128.png)

## Features

- Click the video area to pause/resume playback
- Works on live streams, VODs, and clips
- Doesn't interfere with the control bar, chat, settings, seekbar, or menus
- Works with embedded players on `player.twitch.tv`
- Survives Twitch SPA navigation without page reloads
- Lightweight, no permissions, no network requests

## How it works

The extension attaches a single delegated click listener in the capture phase to `document`. On click it:

1. Checks if the click lands inside the bounds of a visible `<video>` element.
2. Skips clicks on buttons, links, controls, the seekbar, menus, and other interactive elements.
3. Toggles playback by clicking Twitch's native `player-play-pause-button` to keep the player state in sync.
4. Stops event propagation to avoid a double-toggle on VODs.

## Installation from source

1. Download or clone the repository:
   ```bash
   git clone https://github.com/<username>/twitch-click-to-pause.git
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
