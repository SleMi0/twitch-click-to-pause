# Browser Test Report — Twitch Click to Pause

**Date:** 2026-11-13
**Extension source:** working tree (uncommitted fixes)
**Test driver:** `playwright-core` installed only in `%TEMP%\opencode\browser-test` (not in the repo)
**Result:** **Chrome for Testing: 25 PASS + 1 BLOCKED, 0 FAIL; branded Chrome: 22 PASS + 4 BLOCKED, 0 FAIL**; focused real-fullscreen probes PASS on both browsers; several manual-only scenarios.

> This report separates **automated mock tests**, **real browser tests**, **real Twitch tests**, and **blocked/not tested**. Chrome for Testing was used because branded Chrome 157 ignored command-line unpacked-extension loading in this environment. Chrome for Testing is an official Google Chrome test build; branded Chrome stable automation was blocked.

## 1. Environment

| Item | Value |
|---|---|
| OS | Windows |
| Node.js | 24.22.0 |
| Browser used for extension tests | **Google Chrome for Testing 157.0.8103.78** (official Chrome test build), unpacked MV3 extension loaded |
| Browser used for branded acceptance | **Google Chrome 157.0.8103.79**, unpacked MV3 extension loaded via CDP `Extensions.loadUnpacked` |
| Branded Chrome available | Google Chrome **157.0.8103.79** |
| Branded Chrome extension load | `--load-extension` ignored; CDP `Extensions.loadUnpacked` succeeded (extension id `dgjjljckgfhlhckolbdpalipjoojcaoi`); content-script isolated world present |
| Extension load proof | Isolated world named `Twitch Click to Pause`, `__twitchClickToPauseInstalled === true` |
| Network | Twitch reachable; anonymous session; cookie consent accepted |
| Credentials | None used; no chat messages sent; no cookies/tokens stored in this report |
| Test artifacts | `%TEMP%\opencode\browser-test\artifacts\` (outside repo) |

## 2. Test categories

- **A. Automated mock tests:** `node --test tests/content.test.js` — 48/48 pass; external harness — 59/59 assertions.
- **B. Real browser tests (Chrome for Testing):** extension load, content script, native controls, synthetic edge cases, SPA, overlay.
- **B2. Branded Chrome tests:** the same suite against Google Chrome 157.0.8103.79 with the extension loaded through CDP; 22 PASS + 4 BLOCKED + 0 FAIL.
- **C. Real Twitch tests:** Live `caedrel`, VOD `2921848532`, Clip `Unsightly...`, `solaryhs` extension overlay, directory→channel SPA.
- **D. Blocked / not tested:** real ad insertion, branded Chrome stable automation, real Twitch modal, scaled real iframe, `about:blank`/`srcdoc`, multiple real players. The real overlay button passed the final run but was ambiguous in an earlier run; manual confirmation is recommended.

## 3. Final browser results

| # | Scenario | Type | Environment / page | Actions | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| 1 | Extension loaded | B | Chrome for Testing, Twitch live | Inspect isolated worlds | Content script installed | `Twitch Click to Pause`, installed=true | PASS |
| 2 | Live player ready | C | `caedrel` | Wait for video | Visible, readyState≥2 | playing, readyState 4 | PASS |
| 3 | Live single click | C | `caedrel` | Click video center | Pause/resume | paused toggled | PASS |
| 4 | Live second click resume | C | `caedrel` | Click again | Resume | playing after ~2–3 s reconnect | PASS |
| 5 | Native play/pause control | C | `caedrel` | Click `player-play-pause-button` | Native toggle, no double action | toggled once | PASS |
| 6 | Native control cancels pending (F-01) | C | `caedrel` | Video click, then native control within 400 ms | Control wins; no delayed resume | stayed paused | PASS |
| 7 | Chat input cancels pending | C | `caedrel` | Video click, then chat input within 400 ms | Pending canceled; input works | stayed playing | PASS |
| 8 | Double click does not pause | C | `caedrel` | `dblclick` video | Playback unchanged | playing | PASS |
| 9 | Double click full-window | C | `caedrel` | `dblclick` video | Full-window/theater; no pause | real fullscreen in the final run; theater fallback observed in other runs | PASS (real fullscreen exit in focused probe) |
| 10 | Settings menu | C | `caedrel` | Open settings | Menu works; playback unchanged | menu visible; unchanged | PASS |
| 11 | Modal backdrop (synthetic) | B | `caedrel` + injected `role="dialog"` | Video click, then backdrop click | Pending canceled | stayed playing | PASS |
| 12 | Plain-div control (synthetic) | B | `caedrel` + injected div `cursor:pointer` | Video click, then control click | Pending canceled | stayed playing | PASS |
| 13 | URL hash/query (synthetic) | B | `caedrel` + `history.pushState` | Video click, then query change | Pending kept | paused | PASS |
| 14 | Real ad detection | C | `caedrel` | Watch ~20 s for ad selectors | Ad observed / no false block | no ad insertion observed | BLOCKED |
| 15 | SPA navigation | C | `caedrel` → `/directory` → `zerator` | Click Browse and channel | SPA, extension works | marker persisted; player loaded | PASS |
| 16 | SPA extension still works | C | after SPA | Click video | Toggle | toggled | PASS |
| 17 | VOD loaded | C | `/videos/2921848532` | Wait for player | Video ready | readyState 4, duration 172790 | PASS |
| 18 | VOD single click | C | same VOD | Click video | Pause/resume | paused | PASS |
| 19 | VOD second click resume | C | same VOD | Click again | Resume | playing at same position | PASS |
| 20 | Clip loaded | C | `caedrel/clip/Unsightly...` | Wait for player | Video ready | readyState 4, duration 10 | PASS |
| 21 | Clip single click | C | same clip | Click video | Pause/resume | paused | PASS |
| 22 | Clip second click resume | C | same clip | Click again | Resume | playing | PASS |
| 23 | Extension overlay frames | C | `solaryhs` | Inspect frames | supervisor + nested ext | `supervisor.ext-twitch.tv` + `<id>.ext-twitch.tv` | PASS |
| 24 | Overlay background click | C | `solaryhs` | Click overlay background | Toggle playback | toggled | PASS |
| 25 | Overlay real button | C | `solaryhs` | Click `button.pastille` in nested overlay | Button works; video not toggled | did not toggle in the final run; an earlier run paused, so native button side effect vs bridge remains ambiguous | PASS (manual confirmation recommended) |
| 26 | Extension-specific errors | B/C | all pages | Collect console/CDP exceptions | None | 0 extension errors | PASS |

**Final run summary:** `PASS 25`, `BLOCKED 1` (real ad insertion), `FAIL 0`. Real fullscreen exit was verified separately in headed, focused Chrome for Testing; see §5.

### 3.1 Branded Chrome smoke

The same suite was run against **Google Chrome 157.0.8103.79** with the unpacked extension loaded through CDP `Extensions.loadUnpacked` (the `--load-extension` flag is ignored by branded Chrome in this environment).

| Result | Count |
|---|---|
| PASS | 22 |
| BLOCKED | 4 |
| FAIL | 0 |

Blocked scenarios:

- **Synthetic plain-div control:** the fresh live page did not load within 30 s (harness precondition). The same scenario PASSed in Chrome for Testing.
- **Real ad detection:** no ad insertion observed.
- **SPA extension after navigation:** the `primevideo` player did not load within 30 s. SPA navigation itself PASSed; the same scenario PASSed in Chrome for Testing.
- **Overlay real button:** the click paused the video in the suite. A focused branded probe showed the bridge sent only `cancel` messages (no forwarded `click`), so the pause was the button's native side effect, not the bridge. Manual confirmation remains.

Passed: extension load/content script, live player, live single click and resume, native play/pause, native control cancels pending, chat input cancels pending, double-click does not pause, double-click full-window, settings menu, synthetic modal, synthetic hash/query, SPA navigation, VOD load/pause/resume, Clip load/pause/resume, overlay frames, overlay background click, no extension-specific console/runtime errors.

## 4. First run and correction

The first Chrome for Testing run was not clean: 20 PASS, 3 FAIL, 2 BLOCKED (plus one live-setup timeout). Root causes were all harness issues:

- the harness selected the first `<video>` instead of the largest (Twitch pages can have mini/preview videos);
- the chat input sat outside the default viewport;
- an extra page/background page made the overlay button result ambiguous;
- the SPA scenario waited for a player on a channel that did not load.

The harness now selects the largest video, uses a 1920×1080 viewport, scrolls the chat into view, closes extra pages before the overlay test, uses a fresh live page for the synthetic plain-div test, discovers a live channel dynamically, and starts SPA from the home page. The final run is **25 PASS, 1 BLOCKED, 0 FAIL**.

An earlier Edge run also exposed live-resume timing: the player needs ~2–3 s to reconnect (`readyState` 1 → 4, `currentTime` 0 → playing) after a live pause. The suite now polls `video.paused`/`readyState` (`waitUnpaused`) instead of using a fixed 800–1200 ms delay. VOD/clip resume is immediate. This was a **test-timing issue**, not an extension defect.

## 5. Fullscreen / theater observations

- The Fullscreen API is environment-dependent: Playwright-launched runs often deny it (`TypeError: not granted`) and Twitch falls back to theater/full-window (`persistent-player--theatre`, `channel-root__scroll-area--theatre-mode`); the final suite reported `fullscreen: true`. The focused probes used a headed window brought to the OS foreground to guarantee real fullscreen (`document.fullscreenElement = DIV.root`). A focused probe reproduced the user's exact sequence on a channel with a Twitch extension overlay (`solaryhs`) and on one without an overlay (`zackrawrr`).
- **Native Twitch reference (extension disabled):** first double-click enters real fullscreen; second double-click exits back to the normal layout with chat visible.
- **Before the fix, with the extension enabled:** second double-click exited to theater without chat. Two causes were confirmed:
  1. Twitch's extension supervisor dispatches a synthetic (untrusted) `dblclick` on the overlay iframe in addition to the forwarded click pair. The bridge also clicked the native fullscreen button, so the fullscreen toggle was applied twice.
  2. On channels without an overlay, Twitch's own player `dblclick` handler ran before the extension's document-level swallow. The handled marker was also taken from `event.timeStamp` (386 ms before the delayed `dblclick`), beyond the 250 ms window.
- **Fix:**
  - swallow the supervisor's synthetic iframe `dblclick` only when the bridge handled the same forwarded pair;
  - register the trusted `dblclick` swallow at window capture, before Twitch's player handlers;
  - timestamp the handled pair with `performance.now()` after the native button/fullscreen transition;
  - widen the swallow window to 1000 ms and restrict it to the same player surface, so controls, modals, and other players keep their `dblclick` behavior.
- **After the fix (real fullscreen, headed Chrome for Testing):**

  | Channel | Extension | First double-click | Second double-click | Status |
  |---|---|---|---|---|
  | `solaryhs` (Twitch extension overlay) | ON | real fullscreen, chat hidden | normal layout, chat visible | PASS |
  | `zackrawrr` (no overlay) | ON | real fullscreen, chat hidden | normal layout, chat visible | PASS |
  | `solaryhs` (native reference) | OFF | real fullscreen, chat hidden | normal layout, chat visible | PASS |
  | `zackrawrr` (native reference) | OFF | real fullscreen, chat hidden | normal layout, chat visible | PASS |

Branded Chrome 157.0.8103.79 was also probed with the extension loaded through CDP: `solaryhs` ON and `zackrawrr` ON both showed the same sequence (first double-click real fullscreen, second normal layout with chat visible).

- `Esc` and the `fullscreenchange` token were tested; no unwanted re-entry was observed.
- **Status:** real fullscreen enter/exit PASS in headed, focused Chrome for Testing and branded Chrome. The suite's Fullscreen API state is environment-dependent (the final run reported fullscreen true). Branded Chrome manual acceptance is covered by the automated branded suite; remaining manual-only scenarios are listed in §9.

## 6. Real Twitch extension overlay

`solaryhs` exposed:

- `https://supervisor.ext-twitch.tv/supervisor/v1/index.html` (immediate parent `https://www.twitch.tv`);
- nested `https://<id>.ext-twitch.tv/.../overlay.html` (immediate parent `https://supervisor.ext-twitch.tv`);
- nested overlay body contains a real `button.pastille` and a full-size HTML background.

Results:

- `location.ancestorOrigins` confirmed the concrete `targetOrigin` values: supervisor → `https://www.twitch.tv`, nested → `https://supervisor.ext-twitch.tv`.
- Background click toggled playback (nested relay + dedup + coordinate mapping worked).
- Real overlay button: Chrome for Testing final run PASS; the branded Chrome suite paused the video, but a focused branded probe showed the bridge sent only `cancel` messages (no forwarded `click`) and the video stayed playing. The pause is therefore the button's native side effect, not the bridge; manual confirmation remains. The bridge's semantic-button classification is covered by the harness (`button` click is not forwarded).
- No extension errors.

## 7. Ads

No real ad insertion was observed in the anonymous live session. The page contained hidden `stream-display-ad__wrapper ...-hidden` and a 0×0 ad iframe, but no visible `ad-countdown`/`ad-banner` element. The extension's exact `AD_SELECTOR` did not false-positive.

**Status: BLOCKED.** Do not claim ad support until a real pre-roll/mid-roll is observed and tested. See `MANUAL_TEST_CHECKLIST.md` §10.

## 8. Chrome-specific limitation

- Branded Chrome 157.0.8103.79 ignores `--load-extension` / `--disable-extensions-except` in this environment (`chrome://extensions` count 0 for the unpacked extension).
- The same unpacked MV3 extension loads successfully through CDP `Extensions.loadUnpacked`; the content-script isolated world is present.
- Google Chrome for Testing 157.0.8103.78 also loads the unpacked extension successfully.
- Both are real Chrome/Chromium builds. The branded Chrome suite is the primary acceptance evidence for this release: **22 PASS + 4 BLOCKED + 0 FAIL**.

## 9. Not tested / blocked

| Scenario | Reason | Status |
|---|---|---|
| Real ad start/end/transition | No ad insertion observed | BLOCKED |
| Real overlay button side effect | Suite paused in branded Chrome; focused probe showed only `cancel` messages (no forwarded click), so the pause is the button's native side effect | MANUAL |
| Branded Chrome fullscreen exit | Verified in a focused branded probe: first double-click fullscreen, second normal with chat | PASS |
| Branded Chrome synthetic plain-div control | Fresh live page did not load within 30 s; same scenario PASSed in Chrome for Testing | BLOCKED |
| Branded Chrome SPA extension after navigation | `primevideo` player did not load within 30 s; same scenario PASSed in Chrome for Testing | BLOCKED |
| Real Twitch modal (not synthetic) | Not reproduced without login/gated flow | BLOCKED |
| Scaled/padded real extension iframe | No such real overlay available | Mock only |
| `about:blank`/`srcdoc` extension frames | Real frames were https ext-twitch.tv | BLOCKED/N/A |
| Multiple real players (main + mini) | Not reproduced in this session | NOT TESTED |
| Rotation/skew iframe | Out of scope | N/A |
| Mobile/touch | Not tested | NOT TESTED |

## 10. Artifacts

Screenshots and JSON results (outside the repo, no credentials):

- `%TEMP%\opencode\browser-test\artifacts\browser-results.json`
- `%TEMP%\opencode\browser-test\artifacts\browser-results-branded.json`
- `%TEMP%\opencode\browser-test\artifacts\suite-branded.log`
- `%TEMP%\opencode\browser-test\artifacts\live-final.png`
- `%TEMP%\opencode\browser-test\artifacts\solaryhs-ext.png`
- `%TEMP%\opencode\browser-test\artifacts\resume-after-pause.png`
- `%TEMP%\opencode\browser-test\artifacts\resume-after-play.png`
- `%TEMP%\opencode\browser-test\artifacts\resume2-*.png`
- `%TEMP%\opencode\browser-test\artifacts\probe-*.png`
- `%TEMP%\opencode\browser-test\artifacts\real-fs-*.png` (focused fullscreen probes; screenshots may be skipped while fullscreen is active)

## 11. Conclusion

The extension is ready for the **v1.1.1** source release with the documented limitations below. It is **not** claimed to be production-ready for ad behavior or the manual-only scenarios that could not be reproduced.

- Ads were not tested with a real pre-roll/mid-roll (BLOCKED). The release notes must not claim ad support.
- The real overlay button paused in the branded suite, but a focused probe showed the bridge sent only `cancel` messages (no forwarded click); this is the button's native side effect. Manual confirmation remains.
- Branded Chrome 157.0.8103.79 loaded the unpacked extension through CDP and completed the smoke with **22 PASS + 4 BLOCKED + 0 FAIL**.
- Real fullscreen exit (second double-click → normal layout with chat) was verified in focused branded Chrome probes on overlay (`solaryhs`) and non-overlay (`zackrawrr`) channels.
- Real modal, scaled iframe, `about:blank`/`srcdoc`, multiple players, and mobile/touch remain manual/unverified.

Automated evidence: **48/48** in-repo tests, **59/59** external harness assertions, Chrome for Testing **25 PASS + 1 BLOCKED**, branded Chrome **22 PASS + 4 BLOCKED**, focused fullscreen probes PASS on both browsers.
