# Tests

Minimal state-machine tests for `src/content.js`. No npm dependencies, no bundler, no browser required.

## Requirements

- Node.js 18 or newer (uses the built-in `node:test` runner).
- The tests load the real `src/content.js` into a Node `vm` with a mock DOM and fake timers.

## Run

```bash
node --test tests/content.test.js
```

Run a subset by name:

```powershell
$env:TEST_FILTER = "pending"
node --test tests/content.test.js
Remove-Item Env:TEST_FILTER
```

```bash
TEST_FILTER=pending node --test tests/content.test.js
```

## What is covered

- Single click, double click, slow double click, triple click.
- `pendingClick` cancellation by controls, keyboard, chat input, and extension-control cancel messages.
- Per-video pending state, cross-video isolation, stale video removal, URL identity (source changes intentionally ignored).
- Chat input (control) and chat text (`tabindex="-1"`) classification; re-initialization does not duplicate listeners.
- Playback restore, async native-toggle guard, disabled native button, cross-player button ownership.
- Fullscreen/theater fallback, Esc cancellation, swallowed native fullscreen click.
- Content-gate rescue, synthetic clicks, window-capture dblclick swallow, same-surface target check, supervisor synthetic iframe dblclick suppression.
- iframe message origin/source, coordinate bounds, detail validation, dedup cap, nested relay, scaled+padded mapping, concrete `targetOrigin`.
- Extension bridge background/control/canvas/role/opt-out classification.
- URL hash/query behavior and player channel query identity.
- Modal backdrop, chat text, and plain-div control classification.

## What is NOT covered

These require a real browser and real Twitch; see `MANUAL_TEST_CHECKLIST.md` and `BROWSER_TEST_REPORT.md`.

- Real Twitch DOM/selectors, Live/VOD/Clips, ads, live reconnect, raids.
- Real Fullscreen API, theater mode, autoplay policy.
- Real Twitch Extensions/supervisor/nested frames, `about:blank`/`srcdoc`.
- Real SPA navigation in a Twitch session.
- CSS rotation/skew; scaled+padded is covered only by the mock mapping test.
- Cross-browser behavior; the extension targets Chrome/Chromium.

## Notes

- Mock-DOM tests are **not** browser or integration tests. They prove code paths and state transitions, not Twitch behavior.
- The suite reads `src/content.js` directly; it does not import or modify production code.
- `tests/` is not part of the distributed extension and should be excluded from the release ZIP.
- Real-browser smoke results are in `BROWSER_TEST_REPORT.md`; manual checks are in `MANUAL_TEST_CHECKLIST.md`.
