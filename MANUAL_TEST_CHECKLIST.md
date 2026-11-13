# Manual Test Checklist — Real Chrome + Twitch

Use this checklist for the final acceptance smoke test. Automated mock tests and the Chrome for Testing smoke are **not** a substitute for the final branded Chrome acceptance test.

## Release-scope note (2026-11-13)

Branded Chrome 157.0.8103.79 smoke: **22 PASS + 4 BLOCKED + 0 FAIL**; see `BROWSER_TEST_REPORT.md` §3.1. Focused fullscreen probes on `solaryhs` and `zackrawrr`: first double-click real fullscreen, second normal layout with chat visible. C-only rows not covered by the automated branded suite remain manual; they are disclosed as known limitations in the release notes and are **not** claimed as passed. Real ads remain BLOCKED.

## Environment

- Chrome stable (or Chromium) with `chrome://extensions` → Developer mode → Load unpacked → project folder.
- No permissions are requested by the extension. Do not grant extra permissions.
- Use an anonymous Twitch session where possible. Do not paste cookies, tokens, or passwords into reports.
- Accept/reject the cookie banner before testing.
- Public Live, VOD, and Clips are enough; a logged-in session is only needed for scenarios Twitch gates.
- Keep DevTools open: Console, Network (filter `m3u8`/video), and the extension's Errors button.

## Legend

- **A** — covered by automated Node tests (`tests/content.test.js`).
- **B** — covered by real Chrome for Testing smoke (`BROWSER_TEST_REPORT.md`).
- **C** — must be checked manually in Chrome/Twitch.
- **D** — blocked/not available in this environment.

## 1. Extension load

| # | Check | Steps | Expected | Status |
|---|---|---|---|---|
| 1.1 | Extension loads | Load unpacked; open `chrome://extensions` | Extension listed, no errors | C |
| 1.2 | Content script runs | Open a Twitch channel; DevTools → Sources → Content scripts | `src/content.js` present; no exception | C |
| 1.3 | No duplicate listeners | Reload extension, reload page; click video | One toggle per click, no double toggle | A/C |
| 1.4 | Manifest | Inspect `manifest.json`; no permissions | MV3, `all_frames`, `document_start`, no permissions | C |

## 2. Live stream

| # | Check | Steps | Expected | Status |
|---|---|---|---|---|
| 2.1 | Single click pause | Click video center | Video pauses after ~400 ms | A/B/C |
| 2.2 | Second click resume | Click again | Video resumes; allow 2–5 s for live reconnect | A/B/C |
| 2.3 | Native play/pause | Click `player-play-pause-button` | Native toggle; extension does not double-toggle | A/B/C |
| 2.4 | Video click + native control within 400 ms | Click video, immediately click native pause | Native action wins; no delayed resume | A/B/C |
| 2.5 | Video click + Space within 400 ms | Click video, press Space | Space wins; no delayed toggle | A/C |
| 2.6 | Video click + chat input within 400 ms | Click video, click chat input | Pending pause canceled; chat input works | A/B/C |
| 2.7 | Chat message text click | Click a chat message after a video click | Pending click is not canceled by plain chat text | A/C |
| 2.8 | Seekbar | Click/drag seekbar | Native seek; no playback toggle | C |
| 2.9 | Settings menu | Open settings; click items | Menu works; video state unchanged | B/C |
| 2.10 | Volume/unmute | Click volume/unmute controls | Native behavior; no toggle | C |
| 2.11 | Live reconnect | Pause, wait, resume; observe Network | Resume may take 2–5 s; no stuck pause | B/C |
| 2.12 | Quality switch | Change quality during playback | Playback continues; no unexpected toggle | C |
| 2.13 | Ad transition | Wait for pre-roll/mid-roll; click video | No toggle during a real ad; after ad, normal behavior | C/D |

## 3. VOD and Clips

| # | Check | Steps | Expected | Status |
|---|---|---|---|---|
| 3.1 | VOD pause | Open a public VOD; click video | Pauses at current position | B/C |
| 3.2 | VOD resume | Click again | Resumes at same position | B/C |
| 3.3 | VOD seek | Seek, then click video | Pause/resume at new position | C |
| 3.4 | VOD fullscreen | Double click; Esc | Full-window/theater; Esc exits; no pause | B/C |
| 3.5 | Clip pause/resume | Open a public clip; click twice | Pause/resume at same position | B/C |
| 3.6 | Clip end | Let a short clip end; click | No crash; native replay behavior | C |

## 4. SPA and navigation

| # | Check | Steps | Expected | Status |
|---|---|---|---|---|
| 4.1 | Channel → directory → channel | Click Browse, then a live channel | Extension still works after SPA navigation | B/C |
| 4.2 | Pending during navigation | Click video, immediately navigate | No toggle on the new channel | C |
| 4.3 | Video replacement | Switch channel/quality; click | Correct video toggles; no stale state | C |
| 4.4 | Browser back/forward | Navigate back/forward; click | Correct player; no stale restore | C |

## 5. Multiple players

| # | Check | Steps | Expected | Status |
|---|---|---|---|---|
| 5.1 | Main + mini player | Open a page with two videos; click each | Correct video toggles | C |
| 5.2 | Cross-player buttons | Click a player without a native button | Media API fallback; other player untouched | A/C |

## 6. Twitch Extensions / iframe

| # | Check | Steps | Expected | Status |
|---|---|---|---|---|
| 6.1 | Overlay background | Channel with an `ext-twitch.tv` overlay (`solaryhs`); click non-interactive background | Playback toggles | B/C |
| 6.2 | Overlay control | Click a real button/card/canvas in the overlay | Extension action works; video does not toggle | C (final run passed; earlier run ambiguous; manual confirmation) |
| 6.3 | Nested supervisor | Inspect frames: supervisor + nested ext frame; click background | Coordinates map through both frames | B/C |
| 6.4 | Opt-out | Add `data-twitch-click-to-pause-ignore` to a full-size test container | Clicks are not forwarded | A/C |
| 6.5 | Scaled/padded iframe | CSS-transform + padding on a test ext frame | Click maps to the correct parent point | A/C |
| 6.6 | iframe navigation | Navigate the ext frame away | Foreign origin is rejected; no toggle | A/C |

## 7. Modals and overlays

| # | Check | Steps | Expected | Status |
|---|---|---|---|---|
| 7.1 | Real Twitch modal | Open a real modal/dialog over the player; click it | Video behind does not toggle | C |
| 7.2 | Modal backdrop | Click the backdrop after a pending video click | Pending click canceled | A/B/C |
| 7.3 | Content gate | Open a mature/content gate; click it | Gate works; video does not toggle | C |
| 7.4 | Extension dock/popover | Click dock/popover | Native extension UI works | C |

## 8. Fullscreen / theater

| # | Check | Steps | Expected | Status |
|---|---|---|---|---|
| 8.1 | Double click | Double-click video | Enters fullscreen (or theater if the Fullscreen API is unavailable); no pause | A/B/C |
| 8.2 | Exit via Esc | Press Esc | Exits theater/fullscreen; playback state preserved | B/C |
| 8.3 | Second double click | Double-click again | Exits fullscreen back to the previous layout, normally with chat visible; matches native Twitch | B/C (Chrome for Testing verified) |
| 8.3a | Second double click with extension overlay | On `solaryhs` (or another channel with a Twitch overlay), double-click video twice | First: fullscreen; second: normal layout with chat, **not** theater without chat | C (Chrome for Testing verified) |
| 8.4 | Fullscreen API | Use the native fullscreen button | Enter/exit fullscreen; no fallback fight; second double-click returns to normal layout | C |
| 8.5 | Fullscreen rejected | Deny fullscreen (iframe without allowfullscreen) | No exception; playback unaffected | C |

## 9. URL identity

| # | Check | Steps | Expected | Status |
|---|---|---|---|---|
| 9.1 | VOD timestamp | Open `?t=` VOD link; click video | Pending click not discarded by timestamp | A/C |
| 9.2 | Hash change | Add/change `#` after a click | Pending click not discarded | A/C |
| 9.3 | Channel switch | Switch channel after a click | Old pending click does not affect the new channel | A/C |
| 9.4 | Player channel query | `player.twitch.tv/?channel=a` → `channel=b` | Pending click discarded | A/C |

## 10. Ads

| # | Check | Steps | Expected | Status |
|---|---|---|---|---|
| 10.1 | Ad start | Wait for a real pre-roll/mid-roll | Video click does not toggle the ad | C/D |
| 10.2 | Ad end | Wait for content to resume | Extension works normally | C/D |
| 10.3 | No ad elements | Normal playback | No false ad block | B/C |
| 10.4 | DOM change during ad | Inspect ad DOM; note selectors | No crash; conservative behavior | C/D |

> In the Chrome for Testing smoke no real ad insertion was observed. Do not mark ads as tested unless a real ad is seen.

## 11. about:blank / srcdoc

| # | Check | Steps | Expected | Status |
|---|---|---|---|---|
| 11.1 | Frame inventory | Inspect all `ext-twitch.tv` frames | Note URLs, `ancestorOrigins`, `srcdoc`/`about:blank` | C/D |
| 11.2 | about:blank bridge | If present, click background | Bridge works without weakening origin checks | C/D |
| 11.3 | srcdoc bridge | If present, click background | Same | C/D |

> Real frames observed were `https://supervisor.ext-twitch.tv` and `https://<id>.ext-twitch.tv`; no `about:blank`/`srcdoc`. Do not add `match_about_blank` without a real case.

## 12. Errors and performance

| # | Check | Steps | Expected | Status |
|---|---|---|---|---|
| 12.1 | Console | Play, click, fullscreen, navigate | No extension exceptions; Twitch's own errors separated | B/C |
| 12.2 | Promise rejections | Deny fullscreen/autoplay | No unhandled rejection | C |
| 12.3 | Listener duplication | Reload/navigate; click | One toggle; no duplicate handlers | A/C |
| 12.4 | Timer cleanup | Rapid clicks, navigate away | No delayed toggle on the new page | A/C |
| 12.5 | Memory | Long session, repeated clicks | No unbounded growth; dedup map bounded | A/C |

## 13. Sign-off

- [x] All C items covered by the automated branded smoke are checked; remaining C-only rows are disclosed as manual/known limitations.
- [x] No extension errors in Console/Extensions.
- [x] Ads checked with a real ad or explicitly marked BLOCKED.
- [x] Extension overlay checked with a real `ext-twitch.tv` frame.
- [x] Fullscreen/theater behavior matches native Twitch.
- [x] Second double-click exits fullscreen to the normal layout (chat visible), including on a channel with a Twitch extension overlay.
- [x] `tests/content.test.js` passes.
- [x] `BROWSER_TEST_REPORT.md` reviewed.
- [x] Release checklist completed separately.
