# Release Checklist - Twitch Click to Pause

**Current release:** `v1.1.2` (`twitch-click-to-pause-v1.1.2.zip`)
**Current source:** matches the v1.1.2 ZIP (manifest, `src/content.js`, icons, READMEs, LICENSE).
**Status:** published.
**Release URL:** https://github.com/SleMi0/twitch-click-to-pause/releases/tag/v1.1.2
**Release commit:** `89e3762e9cb0ef3be49ab3591d5eb0809b49168c`
**Asset:** `twitch-click-to-pause-v1.1.2.zip`, 23476 bytes
**SHA256:** `3AE2FE06A0C8DCBC5B9870BBE11812C3CD8F2236DEFBEFAB1C1F29C071DD0AA4`
**Publication verification:** release tag `v1.1.2` points to `89e3762`, `main` and the tag are pushed, one asset attached, GitHub asset digest matches, and the downloaded asset SHA256 and size match the local archive.

## 1. Preconditions

- [x] All intended code fixes are committed/reviewed (independent subagent code review, two passes).
- [x] `node --check src/content.js` passes.
- [x] `manifest.json` parses and is valid MV3; `"version"` is `1.1.2`.
- [x] `node --test tests/content.test.js` passes (56 tests).
- [x] The new regression tests fail on the previous release source (`bed92b5`: 51/55 pass, 4 fail).
- [x] Real-browser checks for this patch: delayed-click inversion (before/after), live pause held for 8 s with exactly one synthetic toggle, live resume, VOD double click/native control/seekbar smoke, clip pause/resume, click after channel navigation.
- [x] The extracted release ZIP loads as an unpacked extension; the isolated world `Twitch Click to Pause` is present and pause/resume works on a real VOD.
- [x] No extension-specific console/runtime errors in the patch checks.
- [x] Security review: no new permissions, host permissions, network requests, remote code, or message surface; no tokens or secrets in the repo or ZIP.
- [ ] Real ad insertion remains **BLOCKED** (no ad observed, same as v1.1.1). The release notes must not claim ad support.
- [~] Extension overlay: the bridge code path is unchanged and covered by unit tests (including a new forwarded-click regression test). A real `ext-twitch.tv` overlay was not re-tested for this patch; see `BROWSER_TEST_REPORT.md` section 12.
- [~] Fullscreen: double click keeps playback and toggles full-window; in the headless run Twitch used its theater fallback (`document.fullscreenElement` was not set). The fullscreen code path is unchanged from the verified v1.1.1 release.

## 2. Version decision

- [x] Patch release: `1.1.1` -> `1.1.2` (bug fix only; no new user-facing feature).
- [x] Updated `manifest.json` `"version"` to `1.1.2`.
- [x] Updated README release examples to `v1.1.2` and the test count to 56.
- [x] Kept `manifest_version: 3`; no permissions added.

## 3. ZIP contents

Included:

```text
manifest.json
src/content.js
icons/icon16.png
icons/icon32.png
icons/icon48.png
icons/icon128.png
README.md
README.en.md
LICENSE
```

Excluded: `tests/`, `AGENTS.md`, `AUDIT_REPORT.md`, `FIX_PROGRESS.md`, `TECHNICAL_IMPROVEMENTS.md`, `BROWSER_TEST_REPORT.md`, `MANUAL_TEST_CHECKLIST.md`, `RELEASE_CHECKLIST.md`, `CHANGELOG.md`, `opencode.json`, `.zip`, logs, screenshots, profiles, temp artifacts.

- [x] ZIP has no extra files; `manifest.json` is at the archive root (no nested folder).
- [x] SHA256 of every extracted file matches the working tree (manifest, source, icons, READMEs, LICENSE).
- [x] Extracted ZIP loaded in a clean edge profile via `--load-extension`.
- [x] Extension name `Twitch Click to Pause`, version `1.1.2`, content script installed.
- [x] SHA256 computed: `3AE2FE06A0C8DCBC5B9870BBE11812C3CD8F2236DEFBEFAB1C1F29C071DD0AA4`.
- [x] ZIP size: `23476` bytes.

## 4. Chrome/Store checks

- [x] `chrome://extensions` equivalent load path: unpacked extension loads without errors.
- [x] Content script runs on `*.twitch.tv` pages (live, VOD, clip) and on `*.ext-twitch.tv` (unchanged matcher).
- [x] Manifest description is within store limits (114 characters).
- [x] Icons 16/32/48/128 valid.
- [x] No remote code, no analytics, no network requests.
- [x] Privacy policy/listing: N/A (GitHub release, no store listing).

## 5. Post-release

- [x] Tag the release (`v1.1.2`) and push it.
- [x] Publish the GitHub Release with the ZIP.
- [x] Record the release commit, asset size, and SHA256 in this file (follow-up documentation commit).
- [x] Keep the previous ZIP and release for rollback.
- [x] Announce the known limitations: ads best-effort/BLOCKED, same-URL stream swap, `about:blank`/`srcdoc` unverified, real modal/multiple-player/mobile scenarios manual, a slow double click on a live stream can still cancel the player's reconnect.

## 6. Do not release if

- Real Chrome smoke is incomplete. **Not triggered:** the patch checks listed above passed on Edge 157 (Chromium) against real Twitch.
- Ads were not tested and the release notes claim ad support. **Not triggered:** ads are explicitly BLOCKED and the notes do not claim ad support.
- `tests/` or audit artifacts are included in the ZIP. **Not triggered:** the ZIP contains only the distribution files listed above.
- Version/permissions/manifest were changed without review. **Not triggered:** version is the only metadata change; permissions and manifest structure are unchanged.

## Previous release (v1.1.1)

- Asset: `twitch-click-to-pause-v1.1.1.zip`, 22486 bytes, SHA256 `FD1F318B9EF7767E96DC43093036329C3D2DC97096B2B61B734EB538E5513247`, release commit `1e3ddecd031eb46c67fad617ab410b9d3808ea0a`.
- Verification and test details: `BROWSER_TEST_REPORT.md` sections 1-11.
