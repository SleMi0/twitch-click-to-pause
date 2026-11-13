# FIX_PROGRESS — Twitch Click to Pause

**Источник задач:** `AUDIT_REPORT.md`
**Инструкции проекта:** `AGENTS.md`
**Режим:** последовательные исправления, без коммитов и без изменения чужих незакоммиченных файлов.
**Ветка/состояние:** `main`, tracked-файлы изменены только в `src/content.js`; `AGENTS.md`, `opencode.json`, `AUDIT_REPORT.md` — untracked (pre-existing/аудит); `FIX_PROGRESS.md` — журнал.

## 0. Правила ведения журнала

- Один этап — одна логически связанная группа исправлений.
- Перед исправлением: проверить актуальность проблемы, воспроизвести, зафиксировать причину.
- После исправления: синтаксис, целевой тест, регрессионные сценарии, `git diff`.
- Статусы: `Pending`, `Investigating`, `In Progress`, `Fixed`, `Verified`, `Blocked`, `Won't Fix`, `False Positive`.
- `Verified` ставится только после фактического запуска проверок. Здесь это означает проверку внешним mock-DOM harness и статическими проверками; реальный Chrome/Twitch не проверялся (см. итоговый отчёт).
- Тестовая инфраструктура в репозиторий **не добавляется** (сохраняем минимализм расширения); для TDD/проверок используется внешний Node vm-harness с mock DOM (`%TEMP%\opencode\fix-harness.js`). Это ограничение фиксируется в итоговом отчёте.

## 1. Реестр проблем

| ID | Проблема | Приоритет | Категория | Исходный статус | Текущий статус | Проверки |
|---|---|---|---|---|---|---|
| F-01 | Отложенный одиночный клик не отменяется последующим действием пользователя | High | Logic/State | Confirmed | Verified | Harness: control click, Space, cancel message; 59/59 |
| F-02 | Extension-мост пересылает клики по div/canvas и вызывает паузу при взаимодействии с оверлеем | High | Logic/Compatibility | Confirmed code / Likely impact | Verified | Harness: background/div/canvas/role=main/opt-out; 59/59 |
| F-03 | Двойной клик по другому/заменённому видео применяет состояние предыдущего видео | Medium | Logic/State | Likely | Verified | Harness: cross-video double click; 59/59 |
| F-04 | Устаревший `pendingClick` после удаления плеера переключает новый плеер | Medium | State/SPA | Confirmed logic | Verified | Harness: stale pending + URL identity; source-only ignored; 59/59 |
| F-05 | Restore/fullscreen fallback через `document.querySelector('video')` управляет чужим видео | Medium | State/SPA | Confirmed logic | Verified | Harness: restore after removal; 59/59 |
| F-06 | `isPlayerExpanded` путает theater/large player с fullscreen | Medium | Logic/Fullscreen | Likely | Verified | Harness: theater-mode fullscreen; 59/59 |
| F-07 | Fullscreen fallback повторно входит в fullscreen после `Esc` | Medium | Logic/Fullscreen | Confirmed logic | Verified | Harness: Esc + swallowed native click; 59/59 |
| F-08 | Глобальный fallback `findPlayerButton` нажимает кнопку другого плеера | Medium | Logic/Multi-player | Confirmed logic | Verified | Harness: cross-player fallback; 59/59 |
| F-09 | Ad-детект блокирует все клики при любом пересечении ad-элемента с видео | Medium | Compatibility/Logic | Potential | Blocked | No real ad insertion observed in the live session; current conservative detection retained; manual ad test required |
| F-10 | `applyPlaybackState` предполагает синхронное обновление `video.paused` | Medium | State/Async | Potential modeled | Verified | Harness: async restore; 59/59 |
| F-11 | Triple click переключает fullscreen дважды (`detail >= 2`) | Low | Logic/Edge | Confirmed logic | Verified | Harness: triple click; 59/59 |
| F-12 | Одиночный клик по другому видео отменяет pending-клик по первому | Low | State/Multi-player | Confirmed logic | Verified | Harness: two videos; 59/59 |
| F-13 | `isVideoSurfaceOverlay` может принять полноразмерную игнорируемую кнопку за поверхность видео | Low | Logic/Compatibility | Potential | Verified | Harness: content-gate button; 59/59 |
| F-14 | `togglePlayback` не проверяет disabled native-кнопку и не делает fallback | Low | Logic/Robustness | Potential | Verified | Harness: disabled button; 59/59 |
| F-15 | Нет проверки `event.origin`, границ координат и `detail`; `src`-проверка может устареть | Low | Security/Validation | Confirmed code | Verified | Harness: origin/null/detail; 59/59 |
| F-16 | `seenForwardedClicks` растёт при flood уникальных id в пределах TTL | Low | Performance/Memory | Confirmed logic | Verified | Harness: 600-message flood, bounded map; 59/59 |
| F-18 | Нет проверки `event.isTrusted`; синтетические клики обрабатываются как пользовательские | Low | Event Handling | Potential | Verified | Harness: synthetic click; 59/59 |
| F-19 | `onDoubleClick` глотает dblclick по текущей точке, а не по фактически обработанным кликам | Low | Event Handling | Potential | Verified | Harness: handled/unhandled dblclick, stale marker; 59/59 |
| F-20 | `stopImmediatePropagation` блокирует все последующие click-обработчики | Low | Architecture/Compatibility | Potential | Won't Fix | Reason: intentional to prevent Twitch double toggle; no confirmed regression |
| F-21 | `postMessage(..., '*')` отправляет координаты клика любому родителю | Informational | Security/Privacy | Confirmed code | Verified | `location.ancestorOrigins[0]` used as concrete targetOrigin; `'*'` only as fallback; real supervisor/nested origins confirmed |
| F-22 | `pointInFrame` не проверяет границы координат и не учитывает border/rotation | Low | Compatibility/Coordinates | Confirmed code | Verified | Harness: null/bounds; border/padding code-reviewed; 59/59 |
| F-23 | `about:blank`/`srcdoc` extension-фреймы не получают content script | Low | Compatibility/Manifest | Potential | Blocked | Real supervisor/nested frames are https ext-twitch.tv; no about:blank/srcdoc observed; no change made |
| F-24 | Документация и комментарии расходятся с реализацией | Low | Documentation | Confirmed | Verified | READMEs updated with theater/fullscreen, overlay, ads, testing; comments updated |
| F-25 | Нет автоматических тестов для state-machine | Informational | Code Quality/Testing | Confirmed | Verified | `tests/content.test.js`: 48 Node built-in tests, no dependencies, all pass |
| F-26 | Хрупкие селекторы и дублирование списков исключений | Informational | Architecture/Compatibility | Potential | Partially addressed | Real player/controls/chat selectors verified; F-13/F-08 reduced divergence; no broad refactor |
| F-27 | Второй double click выходит из fullscreen в theater без чата (включая каналы с Twitch extension overlay) | High | Logic/Fullscreen/Overlay | Confirmed in real Chrome | Verified | Focused real-fullscreen Chrome for Testing и branded Chrome: `solaryhs`/`zackrawrr` ON → fullscreen → normal, chat visible; native reference same; 48/48 + 59/59 |

> F-17 (wheel non-passive) не включён: в аудите гипотеза проверена и отклонена (passive по умолчанию для wheel на Document). Не является проблемой.

**Итог:** 22 Verified, 1 Won't Fix (F-20), 2 Blocked (F-09, F-23), 1 Partially addressed (F-26).

## 2. План исправлений (выполнен)

| Этап | Проблемы | Результат |
|---|---|---|
| 1 | F-01, F-03, F-04, F-12 | `pendingClicks` Map per video; pointerdown/keydown cancellation; identity checks |
| 2 | F-02 | Background-only pass-through; cancel message for extension controls |
| 3 | F-05 | Removed unrelated-video fallback |
| 4 | F-06, F-07 | Actual fullscreen state; fullscreenchange/Esc token |
| 5 | F-08, F-14 | Button ownership; disabled fallback |
| 6 | F-10 | Async restore retry guard |
| 7 | F-11 | Ignore detail >2 |
| 8 | F-13 | Content-gate/unmute/menu exclusions |
| 9 | F-15, F-22 | Origin/source, coordinate bounds, detail validation, border/padding |
| 10 | F-16 | Bounded dedup map |
| 11 | F-18 | `event.isTrusted` for click/dblclick/bridge/pointerdown/keydown |
| 12 | F-19 | dblclick swallow marker with short window |
| 13 | F-09 | Investigated; Blocked (no real ad observed) |
| 14 | F-20, F-23, F-26 | Won't Fix / Blocked / Partial |
| 15 | F-24 | READMEs and comments updated |
| 16 | F-25 | In-repo Node tests added; Verified |
| 17 | F-21 | Concrete ancestor-origin targetOrigin; Verified |
| 18 | F-25 | 48 in-repo tests; Verified |
| 19 | F-26 / reviewer minors | URL identity, scaled+padded, modal/plain-div; Partial |
| 20 | Real browser smoke | 25 PASS + 1 BLOCKED; see BROWSER_TEST_REPORT.md |
| 21 | F-27 | Window-capture dblclick swallow; supervisor synthetic dblclick suppression; 1000 ms surface-scoped window; real fullscreen verified |

## 3. Журнал выполнения

### Этап 1 — F-01, F-03, F-04, F-12 (pending click lifecycle)

- **Причина:** единый глобальный `pendingClick` без identity/connectivity; `cancelPlaybackRestore` не отменял отложенный клик; новый клик по другому видео очищал предыдущий.
- **Изменения:** `pendingClicks = new Map()` per video; `clearPendingClick(entry)`/`clearAllPendingClicks()`; `handleVideoClick` работает с entry своего видео; pending timer проверяет `document.contains(video)` и identity; `onPointerDown`/`onKeyDown` отменяют pending; `pageIdentity()` (URL + element connectivity; source-only изменения намеренно игнорируются, чтобы не ломать restore при reconnect/quality switch); `detail > 2` игнорируется. Double-click restore проверяет identity предыдущего entry.
- **Проверки:** harness T1/T12 (control/Space), T3 (cross-video), T5 (stale removal), T21 (two videos), URL change discard, source-only change kept; 59/59 pass.
- **Остаточный риск:** identity по URL может не поймать смену потока при том же URL без замены элемента; source-only изменения намеренно игнорируются, чтобы restore переживал reconnect/quality switch. Это безопаснее, чем управлять чужим плеером.

### Этап 2 — F-02 (extension bridge)

- **Причина:** мост пересылал любой не-семантический клик, включая div/canvas-контролы.
- **Изменения:** `isExtensionBackgroundTarget()` — только неинтерактивный полноразмерный фон; semantic/media/role/tabindex/draggable/onclick/cursor checks; `data-twitch-click-to-pause-ignore`; cancel message для кликов по контролам; origin/source validation.
- **Проверки:** harness: body/full-size div/role=main forwarded; div/canvas/button/opt-out not forwarded; cancel message clears pending; 59/59.
- **Остаточный риск:** полноразмерный интерактивный div без role/cursor/tabindex неотличим от фона; README документирует ограничение.

### Этап 3 — F-05 (restore/fullscreen fallback)

- **Причина:** fallback на `document.querySelector('video')` после удаления исходного видео.
- **Изменения:** `activeVideo()` и fullscreen target возвращают `null`, если исходное видео отсутствует; никакого другого видео.
- **Проверки:** harness restore-after-removal; 59/59.

### Этап 4 — F-06, F-07 (fullscreen)

- **Причина:** rect-эвристика считала theater mode fullscreen; fallback не отменялся на Esc.
- **Изменения:** `isPlayerExpanded()` — только `document.fullscreenElement.contains(video)`; `fullscreenToggleToken`; `cancelFullscreenFallback()` на `fullscreenchange`, Esc и новом toggle; fallback проверяет токен/identity.
- **Проверки:** harness theater-mode, Esc, swallowed native click; 59/59.

### Этап 5 — F-08, F-14 (native button)

- **Причина:** глобальный fallback мог нажать кнопку другого плеера; disabled-кнопка проглатывала клик.
- **Изменения:** `belongsToSamePlayer()`; global fallback фильтрует чужие player roots; `isButtonDisabled()`; media API fallback.
- **Проверки:** harness cross-player, disabled button; 59/59.

### Этап 6 — F-10 (async restore)

- **Причина:** ранний return `applyPlaybackState` при синхронно «правильном» `video.paused`; retry мог дублировать toggle.
- **Изменения:** ранний return убран; `lastToggleAt` + `RESTORE_RETRY_GUARD = 600`; identity checks.
- **Проверки:** harness async restore; 59/59.
- **Остаточный риск:** при задержке native toggle >600 мс возможна повторная попытка; реальный timing Twitch не проверялся.

### Этап 7 — F-11 (triple click)

- **Изменения:** `detail > 2` → `return false`; `detail === 2` для double.
- **Проверки:** harness triple click; 59/59.

### Этап 8 — F-13 (surface rescue)

- **Изменения:** в exclusion list добавлены content-gate, player-settings-menu, unmute/menu.
- **Проверки:** harness content-gate full-size button; 59/59.

### Этап 9 — F-15, F-22 (message validation/coordinates)

- **Изменения:** `isExtensionOrigin()`; `event.origin` checks в player и relay; `pointInFrame` требует numbers, bounds, учитывает border/padding; `detail` только 1/2; bridge relay сохраняет detail.
- **Проверки:** harness foreign origin, null coords, detail 99, nested relay; 59/59.

### Этап 10 — F-16 (dedup cap)

- **Изменения:** `MAX_FORWARDED_CLICKS = 100`; eviction старых/лишних записей.
- **Проверки:** harness 600 unique ids → map ≤100; 59/59.

### Этап 11 — F-18 (synthetic events)

- **Изменения:** `event.isTrusted` checks в onClick/onDoubleClick/bridge/pointerdown/keydown.
- **Проверки:** harness synthetic click; 59/59.

### Этап 12 — F-19 (dblclick swallow)

- **Изменения:** `lastHandledDoubleClickTime` + `DBLCLICK_SWALLOW_WINDOW = 250`; swallow только для обработанной пары.
- **Проверки:** harness handled/unhandled dblclick, stale marker; 59/59.

### Этап 13 — F-09 (ads)

- **Решение:** Blocked. Причина: в реальной live-сессии не наблюдалась рекламная вставка; текущая консервативная блокировка предотвращает toggle рекламы. Per-click/class-based изменение без реального ad state не добавлялось. README документирует best-effort; ручная проверка — в `MANUAL_TEST_CHECKLIST.md`.

### Этап 14 — F-20, F-23, F-26

- **F-20:** Won't Fix — `stopImmediatePropagation` намеренно предотвращает double toggle Twitch; реальные native controls/chat/settings/extension buttons работают, подтверждённой регрессии нет.
- **F-23:** Blocked — реальные supervisor/nested frames оказались https ext-twitch.tv; about:blank/srcdoc не наблюдались; добавление `match_about_blank` не требуется без реального кейса.
- **F-26:** Partially addressed — реальные player/controls/chat selectors проверены; F-13/F-08 убрали часть расхождений; широкий refactor селекторов не выполнялся (scope/YAGNI).

### Этап 15 — F-24 (docs)

- **Изменения:** README.md/README.en.md: pass-through фон, cancel-поведение, per-video state, fullscreen/theater/Esc, ads best-effort, multi-player, opt-out attribute, tests/structure. Комментарии в `src/content.js` обновлены.
- **Проверки:** README parity manual; 48/48 tests; browser smoke.

### Этап 16 — F-25 (tests)

- **Решение:** добавлена минимальная in-repo инфраструктура `tests/content.test.js` на Node built-in `node:test`; 44 теста, без зависимостей/сборщика. Внешний harness остаётся для расширенных прогонов. Подробности — этап 18 и `tests/README.md`.

### Этап 17 — F-21 (postMessage targetOrigin)

- **Изменения:** `parentTargetOrigin()` использует `location.ancestorOrigins[0]`; `postClickToParent`/`postCancelToParent` передают конкретный origin; `'*'` остаётся fallback для opaque/недоступных origins. Receiver по-прежнему проверяет `event.origin`/`event.source`/iframe src.
- **Проверки:** harness targetOrigin/fallback; реальные frames: supervisor → `https://www.twitch.tv`, nested → `https://supervisor.ext-twitch.tv`; overlay click PASS.
- **Остаточный риск:** `ancestorOrigins` — Chrome/Chromium API; fallback `'*'` сохраняет совместимость. Получатель — всё ещё родительский документ; при встраивании extension-iframe на не-Twitch страницу она получит нечувствительные координаты клика by design.

### Этап 18 — F-25 (in-repo tests)

- **Изменения:** `tests/content.test.js` — 44 теста на Node built-in `node:test` + mock DOM/fake timers; `tests/README.md`; без npm-зависимостей и сборщика.
- **Проверки:** `node --test tests/content.test.js` — 48/48 pass.
- **Ограничения:** mock DOM, не browser/Twitch; реальные сценарии — `MANUAL_TEST_CHECKLIST.md`/`BROWSER_TEST_REPORT.md`.

### Этап 19 — F-26 / reviewer minors

- **Изменения:** `pageIdentity()` — pathname + `channel`/`video` query (hash/query timestamp не отбрасывает pending); `pointInFrame` — border+padding+CSS scale через `offsetWidth`/`clientLeft`; `pointOverAnyVideo`/`isLikelyInteractive` для modal backdrop и plain-div controls; chat input остаётся control by design.
- **Проверки:** harness URL/source/scaled/padded/modal/plain-div; real browser synthetic modal/plain-div/hash PASS; real chat input PASS.
- **Остаточный риск:** rotation/skew не поддерживаются; same-URL stream swap без замены video — документированное ограничение; plain-div без cursor/role/tabindex вне player не классифицируется.

### Этап 20 — Real browser/Twitch smoke

- **Окружение:** Google Chrome for Testing 157.0.8103.78 (official Chrome test build) с unpacked extension; branded Google Chrome 157.0.8103.79 загружает unpacked extension через CDP `Extensions.loadUnpacked` (`--load-extension` игнорируется).
- **Проверки:** Chrome for Testing — 25 PASS + 1 BLOCKED; branded Chrome — 22 PASS + 4 BLOCKED; 0 FAIL. Live `caedrel`, VOD `2921848532`, clip `Unsightly...`, SPA directory→channel, `solaryhs` supervisor/nested overlay, native controls, chat input, fullscreen/theater, synthetic modal/plain-div/hash.
- **Наблюдения:** live resume после pause требует ~2–3 s reconnect; тест ожидает фактическое `video.paused/readyState`, а не фиксированную задержку. Fullscreen API в automation нестабилен: Playwright-launched прогоны часто получают theater/full-window fallback, но финальный suite сообщил `fullscreen: true`. Follow-up в headed focused Chrome выявил F-27 (см. этап 21).
- **Ограничения:** реклама не проверена (BLOCKED); real overlay button остаётся manual-confirmation (bridge отправляет только `cancel`, пауза — native side effect кнопки); scaled iframe/real modal/about:blank/multiple players/mobile не воспроизведены.

### Этап 21 — F-27 (double click: выход из fullscreen)

- **Воспроизведение:** headed Chrome for Testing и branded Google Chrome 157.0.8103.79, окно Chrome выведено на передний план (без этого Fullscreen API возвращает `TypeError: not granted`). `solaryhs` (supervisor/nested overlay) и `zackrawrr` (без overlay), extension ON.
- **Факт до исправления:** первый double click → real fullscreen (`document.fullscreenElement = DIV.root`), второй → выход в theater (`channel-root__scroll-area--theatre-mode`), чат скрыт. Native Twitch (extension OFF) на тех же каналах выходил в normal layout с чатом.
- **Причины:**
  1. Supervisor Twitch отправляет synthetic (untrusted) `dblclick` на iframe оверлея вдобавок к forwarded click pair; bridge также нажимал native fullscreen button → двойное действие.
  2. На каналах без overlay Twitch's player `dblclick` handler срабатывал раньше document-level swallow; marker брался из `event.timeStamp` и был на 386 ms старше delayed `dblclick` (окно 250 ms).
- **Исправление:** `onDoubleClick` перенесён на window capture; marker = `performance.now()` после native button/fullscreen transition; окно 1000 ms; swallow только для того же player surface (controls/modal/other players не затрагиваются); synthetic iframe `dblclick` подавляется только после forwarded pair, которую обработал bridge.
- **Проверки:** `node --test tests/content.test.js` — 48/48; external harness — 59/59; real focused probe: `solaryhs` ON, `zackrawrr` ON, native reference OFF — первый double click fullscreen, второй normal с чатом. То же подтверждено в branded Chrome 157.0.8103.79. Fullscreen API в automation нестабилен; focused probe гарантирует real fullscreen через headed-окно на переднем плане.
- **Ограничения:** mobile/touch; реальная реклама; real overlay button side effect; real modal/multiple players.

## 4. Независимое Code Review

- **Первый review:** Critical не найдено; 3 Important (bridge role/tabindex, URL identity, iframe cancel) и 7 Minor.
- **Исправлено:** bridge role/tabindex narrowing; `pageIdentity` + double-click previous identity; extension cancel message; dblclick window 250 ms; padding mapping; opt-out order; pointerdown early return/narrowing; docs.
- **Follow-up review:** Important #1/#3 подтверждены; Important #2 уточнён: `currentSrc` нельзя включать в identity, потому что Twitch пересоздаёт MediaSource при fullscreen/quality/reconnect и restore должен это переживать. `currentSrc` убран; identity = `location.href` + `document.contains(video)`; double-click `previousMatches` проверяет identity.
- **Остаточные Minor:** chat input (control) cancels pending by design; plain-div controls without cursor/role/tabindex outside player don't cancel; undetected modal backdrops; scaled+padded iframe; same-URL stream swap remains; README structure lists untracked audit files; in-repo tests added plus external harness.
- **Real-browser review:** first Chrome for Testing run was 20 PASS / 3 FAIL / 2 BLOCKED due to harness issues (first video vs largest, chat off-screen, extra page/background, SPA setup). The harness now uses the largest video, 1920×1080 viewport, chat scroll, page cleanup, fresh plain-div page, dynamic live channel, and SPA from home; final is 25 PASS / 1 BLOCKED. An earlier Edge run had 6 live-resume timing FAILs; `waitUnpaused`/`readyState` polling fixed the test. VOD/clip resume is immediate. No extension code change was needed for the live reconnect delay.
- **Theater/fullscreen:** Fullscreen API в automation нестабилен: Playwright-launched прогоны часто дают theater/full-window (`persistent-player--theatre`), но финальный suite сообщил `fullscreen: true`. Follow-up в headed focused Chrome показал реальный fullscreen и выявил F-27: второй double click с расширением уходил в theater без чата, тогда как native Twitch выходил в normal. Причины и исправление — этап 21. После исправления solaryhs/zackrawrr ON и native reference выходят в normal с чатом.
- **Статус:** no Critical/Important regressions after the follow-up; 59/59 external harness assertions, 48/48 in-repo tests, Chrome for Testing 25 PASS + 1 BLOCKED, branded Chrome 22 PASS + 4 BLOCKED, 0 FAIL; overlay button remains manual-confirmation, focused real-fullscreen probes PASS.

## 5. Итоговые проверки

- `node --check src/content.js` — OK.
- `manifest.json` JSON parse — OK.
- In-repo tests: `node --test tests/content.test.js` — **48/48 pass**.
- External harness `fix-harness.js` — **59/59 assertions pass**.
- Real browser (Google Chrome for Testing 157.0.8103.78, unpacked extension loaded): **25 PASS + 1 BLOCKED** (no real ad insertion observed); live/VOD/clip/SPA/fullscreen/theater/native controls/chat/extension overlay/nested iframe tested. See `BROWSER_TEST_REPORT.md`.
- Branded Chrome 157.0.8103.79 (unpacked extension via CDP `Extensions.loadUnpacked`): **22 PASS + 4 BLOCKED, 0 FAIL**; same real-Twitch scenarios plus overlay and SPA.
- Focused real-fullscreen probe (headed Chrome for Testing, window focused): `solaryhs` ON, `zackrawrr` ON, native reference OFF — first double click fullscreen, second normal with chat. **4/4 PASS** after F-27 fix. The same sequence passed in branded Chrome on `solaryhs` and `zackrawrr`.
- `git diff` / `git status` — reviewed.
- Real Chrome/Twitch: Chrome for Testing and branded Chrome tested; remaining manual-only scenarios are listed in `BROWSER_TEST_REPORT.md` §9.
