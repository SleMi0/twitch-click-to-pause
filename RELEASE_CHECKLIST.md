# Release Checklist — Twitch Click to Pause

**Current release:** `v1.1.1` (`twitch-click-to-pause-v1.1.1.zip`)
**Current source:** matches the v1.1.1 ZIP (manifest, `src/content.js`, icons, READMEs, LICENSE).
**Status:** release prepared; branded Chrome smoke complete; publication pending.

## 1. Preconditions

- [x] All intended code fixes are committed/reviewed.
- [x] `node --check src/content.js` passes.
- [x] `manifest.json` parses and is valid MV3.
- [x] `node --test tests/content.test.js` passes (48 tests).
- [x] External harness passes (59 assertions).
- [x] `BROWSER_TEST_REPORT.md` reviewed; Chrome for Testing 25 PASS + 1 BLOCKED; branded Chrome 22 PASS + 4 BLOCKED; 0 FAIL.
- [x] `MANUAL_TEST_CHECKLIST.md` completed in **real branded Chrome** for the automated scope; remaining C-only rows are explicitly disclosed as manual/known limitations.
- [x] No extension-specific console/runtime errors.
- [x] Security review: origin/source/coords/detail validation, no new permissions, no network requests.
- [x] Ads tested with a real ad or explicitly marked BLOCKED.
- [x] Extension overlay tested with a real `ext-twitch.tv` frame.
- [x] about:blank/srcdoc either tested or explicitly N/A.
- [x] Fullscreen/theater behavior matches native Twitch; Esc exit verified; second double-click exits to normal layout with chat.
- [x] No user data, cookies, tokens, or secrets added to the repo/artifacts.

## 2. Version decision

- [x] Patch release: `1.1.0` → `1.1.1` (bug fixes, validation hardening, tests/docs; no new user-facing feature).
- [x] Updated `manifest.json` `"version"` to `1.1.1`.
- [x] Updated README release examples to `v1.1.1`.
- [x] Bumped after the real branded Chrome smoke completed.
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

Excluded:

- `tests/`
- `AGENTS.md`
- `AUDIT_REPORT.md`
- `FIX_PROGRESS.md`
- `TECHNICAL_IMPROVEMENTS.md`
- `BROWSER_TEST_REPORT.md`
- `MANUAL_TEST_CHECKLIST.md`
- `RELEASE_CHECKLIST.md`
- `CHANGELOG.md`
- `opencode.json`
- any `.zip`, logs, screenshots, profiles, or temp artifacts.

- [x] ZIP has no extra files; `manifest.json` is at the archive root (no nested folder).
- [x] Extracted ZIP loaded in a clean branded Chrome profile through CDP `Extensions.loadUnpacked`.
- [x] Extension name `Twitch Click to Pause`, version `1.1.1`, content script installed, `chrome.runtime.getManifest().version === "1.1.1"`.
- [x] SHA256 computed: `FD1F318B9EF7767E96DC43093036329C3D2DC97096B2B61B734EB538E5513247`.
- [x] ZIP size: `22486` bytes.

## 4. Chrome/Store checks

- [x] `chrome://extensions` loads without errors.
- [x] Content script runs on `*.twitch.tv`, `player.twitch.tv`, `clips.twitch.tv`, and `*.ext-twitch.tv` (suite covers Twitch pages and real `ext-twitch.tv` frames).
- [x] Manifest description is within store limits (114 characters).
- [x] Icons 16/32/48/128 valid.
- [x] No remote code, no analytics, no network requests.
- [x] Privacy policy/listing: N/A (GitHub release, no store listing).
- [x] Screenshots/store copy: N/A for this GitHub release; README describes current behavior.

## 5. Post-release

- [ ] Tag the release (`v1.1.1`).
- [ ] Publish GitHub Release with ZIP + SHA256.
- [ ] Update README release examples (already `v1.1.1`).
- [ ] Keep the previous ZIP for rollback.
- [ ] Announce known limitations: ads best-effort/BLOCKED, same-URL stream swap, about:blank/srcdoc unverified, real modal/multiple-player/mobile scenarios manual.

## 6. Do not release if

- Real Chrome smoke is incomplete. **Not triggered:** branded Chrome suite completed with 0 FAIL.
- Ads were not tested and the release notes claim ad support. **Not triggered:** ads are explicitly BLOCKED and the release notes do not claim ad support.
- Extension overlay tests were not repeated with a real extension. **Not triggered:** branded Chrome tested the real `solaryhs` supervisor/nested overlay.
- `tests/` or audit artifacts are included in the ZIP. **Not triggered:** ZIP contains only the distribution files listed above.
- Version/permissions/manifest were changed without review. **Not triggered:** version was reviewed; manifest_version/permissions unchanged.
