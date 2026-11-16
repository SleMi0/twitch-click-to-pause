# Changelog

All notable changes to Twitch Click to Pause are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [1.1.2] - 2026-11-16

### Fixed

- The first click after opening a stream no longer pauses and then resumes on its own. A single click now applies the state the user asked for instead of blindly toggling whatever state exists after the 400 ms double-click delay. If Twitch changes playback inside that window (its own click handling, the live start/reconnect sequence, or an asynchronous player/MSE update), the intended pause is kept instead of being inverted.
- A single click no longer toggles playback back when Twitch already paused or resumed the video during the delay.
- Pause enforcement is bounded and cancelled by any new user action, and it does not retry a resume: a live stream keeps its 1-3 s reconnect window.
- Playback enforcement is skipped while an ad is on screen, both in the click window and in the retry checks.

### Added

- Regression tests for the delayed-click inversion, a spontaneous live resume, the ad guard, the live resume/reconnect case, and the extension-iframe click path (56 tests total).

### Changed

- README release example and test count updated. No permissions, manifest structure, or architecture changes.

## [1.1.1] - 2026-11-13

### Fixed

- Double-click now exits fullscreen back to the previous layout (normally with chat visible) instead of switching to theater mode without chat. This includes channels with a Twitch extension overlay.
- Pending single clicks are cancelled correctly by native controls, keyboard input, chat, modals, and extension controls.
- Playback restore no longer targets a different or removed player after SPA navigation.
- Extension-overlay clicks are validated by origin, source frame, coordinates, and `detail`; non-numeric or out-of-range `detail` values are rejected.
- The extension bridge uses a concrete `targetOrigin` from `location.ancestorOrigins` when available.
- A disabled native fullscreen button falls back to the Fullscreen API instead of being clicked.

### Added

- In-repo Node tests (`tests/content.test.js`) covering click classification, pending state, playback restore, fullscreen fallback, iframe messaging, and regression cases.
- Browser and real-Twitch test reports, a manual acceptance checklist, and release documentation.
- `CHANGELOG.md`.

### Security

- No new permissions, network requests, remote code, analytics, or telemetry.
- Cross-origin extension messages require an `ext-twitch.tv` origin and a matching extension iframe; coordinates and `detail` are bounded.

### Known limitations

- Ad detection is best-effort. Real pre-roll/mid-roll insertion was not observed during testing, so ad behavior remains **BLOCKED** until verified with a real ad.
- `about:blank`/`srcdoc` extension frames were not observed; the bridge targets the real `https://*.ext-twitch.tv` frames.
- Same-URL stream replacement without a new `<video>` element remains a documented limitation.
- Mobile/touch and some real-Twitch modal/multi-player scenarios remain manual checks.

## [1.1.0] - 2026-10-29

### Added

- Support for Twitch extension overlays (`*.ext-twitch.tv`), including the supervisor and nested overlay frames.
- Click forwarding from extension iframes to the player with origin/source/coordinate validation and deduplication.
- Fullscreen/theater fallback handling and playback restoration.

## [1.0.2] - 2026-10-24

### Fixed

- False pauses and double-click handling regressions.

## [1.0.1] - 2026-10-24

### Fixed

- Double toggle on VOD while keeping double-click fullscreen.

## [1.0.0] - 2026-10-24

### Added

- Initial release: click the Twitch video to pause or resume playback.
