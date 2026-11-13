# Twitch Click to Pause — Technical Audit Report

**Дата аудита:** 2026-11-12
**Версия проекта:** 1.1.0 (коммит `1c6a880`, тег `v1.1.0`)
**Режим:** read-only аудит. Исходный код, `manifest.json` и тесты не изменялись. Создан только этот отчёт.
**Репозиторий:** https://github.com/SleMi0/twitch-click-to-pause

---

## 1. Executive Summary

Проект представляет собой компактное MV3-расширение (один content script, ~569 строк) с хорошей базовой гигиеной: изолированный мир content script, отсутствие permissions, сетевых запросов, `innerHTML`/`eval`, удалённого кода и фонового service worker. Обычный сценарий «один клик — пауза, двойной клик — fullscreen» реализован продуманно: используется нативная кнопка Twitch, есть fallback на `HTMLMediaElement`, защита от повторной обработки синтетических кликов и дедупликация forwarded-кликов из extension-iframe.

Однако аудит выявил **два High-дефекта и восемь Medium-дефектов**, преимущественно в машине состояний и в обработке кросс-доменных iframe:

- **F-01 (High):** отложенный одиночный клик (`pendingClick`, 100 мс) не отменяется последующим действием пользователя. Клик по нативной кнопке паузы, `Space` или другой контрол в течение 100 мс приводит к повторному переключению воспроизведения и отмене действия пользователя. Это прямо нарушает инвариант AGENTS.md §1.1 «новые пользовательские действия должны иметь приоритет над устаревшими отложенными операциями».
- **F-02 (High):** мост extension-iframe пересылает клики по любым элементам, не попавшим в семантический `IGNORE_SELECTOR`. Многие Twitch Extensions используют `div`/`canvas`/`span` без `button`/`link`/`role`; клик по такому элементу одновременно выполняет действие расширения и переключает воспроизведение потока. README утверждает обратное.
- **Medium:** переиспользование состояния предыдущего видео при `detail >= 2` (F-03); устаревший `pendingClick` после удаления плеера может переключить новый плеер (F-01); restore/fullscreen fallback через `document.querySelector('video')` может управлять чужим видео (F-05); эвристика `isPlayerExpanded` путает theater mode с fullscreen (F-06); fullscreen-fallback повторно входит в fullscreen после `Esc` (F-07); глобальный fallback кнопки может нажать кнопку другого плеера (F-08); ad-детект блокирует все клики при любом пересечении ad-элемента с видео (F-09); restore-цикл предполагает синхронное обновление `video.paused` (F-10).

**Общая оценка:** базовый путь работает, но проект нельзя называть «надёжным» без исправления F-01/F-02 и группы stale-video/state-дефектов. Security-риски низкие по impact (нет XSS/утечки данных/сетевых запросов), но в обработчике `postMessage` отсутствует часть проверок, которые требует сам AGENTS.md §1.6. Производительность в обычном режиме приемлемая; подтверждённых утечек памяти нет, кроме потенциального роста `seenForwardedClicks` при flood. Manifest и release-артефакт корректны. Автотестов нет — это главный организационный риск для такой stateful-логики.

---

## 2. Audit Scope

### 2.1. Исследованные файлы

| Файл | Что проверено |
|---|---|
| `src/content.js` (569 строк) | Вся логика: обработчики, состояние, таймеры, геометрия, fullscreen, iframe-мост, дедупликация, безопасность |
| `manifest.json` | MV3, `matches`, `all_frames`, `run_at`, paths, permissions, icons |
| `README.md`, `README.en.md` | Соответствие фактическому поведению, паритет версий, ограничения |
| `AGENTS.md` | Архитектурные инварианты и обязательные проверки |
| `LICENSE` | MIT, без изменений |
| `icons/*.png` | Формат и размеры |
| `twitch-click-to-pause-v1.1.0.zip` | Соответствие исходникам и manifest |
| Git history/tags | `d3de32a` → `1c6a880`, теги `v1.0.0`–`v1.1.0`, изменения v1.1.0 |

### 2.2. Исследованные функции

`isExtensionHost`, `isExtensionFrame`, `isExtensionOverlayAtPoint`, `rectsOverlap`, `isExposedAtPoint`, `videoAtPoint`, `isAdPlaying`, `isVisible`, `shouldIgnore`, `isVideoSurfaceOverlay`, `isVideoClickEvent`, `clickNativeButton`, `findPlayerButton`, `togglePlayback`, `playerElement`, `isPlayerExpanded`, `requestNativeFullscreen`, `toggleFullscreen`, `clearPendingClick`, `cancelPlaybackRestore`, `applyPlaybackState`, `handleVideoClick`, `onClick`, `onDoubleClick`, `frameFromSource`, `pointInFrame`, `postClickToParent`, `createForwardedClickId`, `isDuplicateForwardedClick`, `onExtensionFrameClick`, `installExtensionFrameBridge`.

### 2.3. Использованные Skills и методологии

| Skill / метод | Использование |
|---|---|
| `using-superpowers` | Правило выбора и применения skills |
| `writing-plans` | Структурирование этапов аудита |
| `systematic-debugging` | Фазы исследования: воспроизведение, сбор доказательств, гипотезы, проверка |
| `verification-before-completion` | Разделение подтверждённых и неподтверждённых результатов |
| `security-category-pointer` | Навигация по security-библиотеке; ручной security-аудит |
| `reviewing-security` | **Недоступен под этим именем** в текущем каталоге; не имитировался. Security-аудит выполнен вручную по AGENTS.md §1.6 и §6.1 |
| `investigating-performance` | **Недоступен под этим именем**; performance-аудит выполнен вручную по AGENTS.md §6.2 |
| `test-driven-development` | Не применим: в проекте нет тестовой инфраструктуры; не устанавливалась |
| `requesting-code-review` / `receiving-code-review` | Независимый code review выполнен в рамках этого отчёта; отдельный subagent не привлекался |

### 2.1. Что не изменялось

- Исходный код и `manifest.json` — не изменялись.
- Зависимости — не устанавливались.
- Коммиты — не создавались.
- Git-состояние — сохранено (кроме нового `AUDIT_REPORT.md`).
- Временный harness для воспроизведения находится вне репозитория (`%TEMP%\opencode\audit-harness.js`) и не является частью проекта.

---

## 3. Architecture Overview

### 3.1. Точка входа и глобальные слушатели

`src/content.js` — IIFE в изолированном мире content script. Защита от повторной инъекции — `window.__twitchClickToPauseInstalled` (строки 1–6). На `document` в capture-фазе регистрируются:

- `click` → `onClick` (строка 560);
- `dblclick` → `onDoubleClick` (561);
- `pointerdown`, `keydown`, `wheel` → `cancelPlaybackRestore` (566–568).

На `window` — `message` → `onExtensionFrameClick` (562). В extension-iframe (`*.ext-twitch.tv`) вместо этого устанавливается `installExtensionFrameBridge()` и выполняется `return` (553–556). Глобальных per-element listeners и `MutationObserver` нет; это осознанное решение для SPA-выживания.

### 3.2. Цепочка обработки клика

```
click (document, capture)
  → onClick
    → isVideoClickEvent
      → videoAtPoint(x, y)
        → document.querySelectorAll('video') + rect/visibility
        → isExposedAtPoint(video, x, y)
          → document.elementFromPoint
          → modal check
          → player.contains(topmost) || isExtensionOverlayAtPoint
        → isAdPlaying(video)
      → shouldIgnore(event.target)
      → isVideoSurfaceOverlay(event.target, video)  // big play overlay exception
    → stopPropagation + stopImmediatePropagation
    → handleVideoClick(video, event.detail, event.timeStamp)
      → cancelPlaybackRestore()
      → double-click? → toggleFullscreen (+ applyPlaybackState if already toggled)
      → single-click? → pendingClick entry + 100 ms timer + 1200 ms cleanup
```

### 3.3. Управление воспроизведением

- Приоритет — нативная кнопка `button[data-a-target="player-play-pause-button"]`.
- `clickNativeButton()` ставит флаг `clickingNativeButton`, вызывает `button.click()` синхронно и снимает флаг в `finally`; `onClick` игнорирует этот синтетический клик.
- Fallback — `video.play()`/`video.pause()`; rejection от `play()` проглатывается.
- `findPlayerButton()` ищет кнопку в `video.closest(PLAYER_SELECTOR) || video.parentElement`, затем глобально среди видимых кнопок, если нашлась ровно одна.

### 3.1. Fullscreen

- `isPlayerExpanded()`: `document.fullscreenElement.contains(video)` ИЛИ прямоугольник плеера ≥95% viewport по обеим осям.
- `toggleFullscreen()`: нативная кнопка + fallback через 100 мс, если `isPlayerExpanded` не изменился; иначе `requestFullscreen`/`exitFullscreen` с проглатыванием rejection.

### 3.5. Восстановление состояния после двойного клика

- `playbackRestoreToken` — монотонный счётчик; любое новое действие/клик инкрементирует его и отменяет старые restore-callback.
- `applyPlaybackState(video, shouldBePaused)` проверяет `video.paused`, переключает и планирует проверки на 300/900/1600/2500/1000 мс. Каждая проверка сверяет токен и `video.paused`.

### 3.6. Extension-мост и postMessage

- В `*.ext-twitch.tv` iframe: capture-listener `click` → `postClickToParent(x, y, detail, id)` → `window.parent.postMessage(..., '*')`.
- Вложенные supervisor-фреймы: `message`-listener пересчитывает координаты через `pointInFrame()` и передаёт выше с тем же `id`.
- В документе плеера: `onExtensionFrameClick` проверяет `data.type`, `event.source` → `frameFromSource`, `isExtensionFrame(frame)`, дедупликацию `seenForwardedClicks`, затем `pointInFrame` → `videoAtPoint` → `handleVideoClick`.
- Дедупликация: `Map<id, performance.now()>`, TTL 2000 мс, очистка только при `size > 100`.

### 3.7. Критические state-переменные

| Переменная | Создание | Изменение | Чтение | Сброс | Риск |
|---|---|---|---|---|---|
| `pendingClick` | `handleVideoClick` | single-click path | double-click path, timers | `clearPendingClick`, cleanup timer | **F-01, F-03, F-01, F-12** |
| `playbackRestoreToken` | module init | `cancelPlaybackRestore`, `applyPlaybackState` | restore callbacks | только инкремент | F-05, F-10 |
| `clickingNativeButton` | module init | `clickNativeButton` | `onClick` | `finally` | низкий (синхронный) |
| `seenForwardedClicks` | module init | `isDuplicateForwardedClick` | то же | TTL-очистка при >100 | **F-16** |
| `forwardedClickSequence` | module init | `createForwardedClickId` | id | не сбрасывается | низкий |
| `pendingClick.timer` | entry | timer callback | double-click path | `clearPendingClick` | F-01 |
| `pendingClick.cleanup` | entry | cleanup callback | — | `clearPendingClick` | низкий |
| `pendingClick.wasPaused` | entry | — | double-click restore | entry drop | **F-03** |
| `pendingClick.video` | entry | — | double-click match | entry drop | **F-03, F-01** |

---

## 1. Findings Summary

| ID | Проблема | Категория | Приоритет | Статус |
|---|---|---|---|---|
| F-01 | Отложенный одиночный клик не отменяется последующим действием пользователя | Logic / State | High | Confirmed |
| F-02 | Extension-мост пересылает клики по div/canvas и вызывает паузу при взаимодействии с оверлеем | Logic / Compatibility | High | Confirmed (code) / Likely (impact) |
| F-03 | Двойной клик по другому/заменённому видео применяет состояние предыдущего видео | Logic / State | Medium | Likely |
| F-01 | Устаревший `pendingClick` после удаления плеера переключает новый плеер | State / SPA | Medium | Confirmed (logic) |
| F-05 | Restore/fullscreen fallback через `document.querySelector('video')` управляет чужим видео | State / SPA | Medium | Confirmed (logic) |
| F-06 | `isPlayerExpanded` путает theater/large player с fullscreen | Logic / Fullscreen | Medium | Likely |
| F-07 | Fullscreen fallback повторно входит в fullscreen после `Esc` | Logic / Fullscreen | Medium | Confirmed (logic) |
| F-08 | Глобальный fallback `findPlayerButton` нажимает кнопку другого плеера | Logic / Multi-player | Medium | Confirmed (logic) |
| F-09 | Ad-детект блокирует все клики при любом пересечении ad-элемента с видео | Compatibility / Logic | Medium | Potential |
| F-10 | `applyPlaybackState` предполагает синхронное обновление `video.paused` | State / Async | Medium | Potential (modeled) |
| F-11 | Triple click переключает fullscreen дважды (`detail >= 2`) | Logic / Edge | Low | Confirmed (logic) |
| F-12 | Одиночный клик по другому видео отменяет pending-клик по первому | State / Multi-player | Low | Confirmed (logic) |
| F-13 | `isVideoSurfaceOverlay` может принять полноразмерную игнорируемую кнопку за поверхность видео | Logic / Compatibility | Low | Potential |
| F-11 | `togglePlayback` не проверяет disabled native-кнопку и не делает fallback | Logic / Robustness | Low | Potential |
| F-15 | Нет проверки `event.origin`, границ координат и `detail`; `src`-проверка может устареть | Security / Validation | Low | Confirmed (code) |
| F-16 | `seenForwardedClicks` растёт при flood уникальных id в пределах TTL | Performance / Memory | Low | Confirmed (logic) |
| F-18 | Нет проверки `event.isTrusted`; синтетические клики обрабатываются как пользовательские | Event Handling | Low | Potential |
| F-19 | `onDoubleClick` глотает dblclick по текущей точке, а не по фактически обработанным кликам | Event Handling | Low | Potential |
| F-20 | `stopImmediatePropagation` блокирует все последующие click-обработчики | Architecture / Compatibility | Low | Potential |
| F-21 | `postMessage(..., '*')` отправляет координаты клика любому родителю | Security / Privacy | Informational | Confirmed (code) |
| F-22 | `pointInFrame` не проверяет границы координат и не учитывает border/rotation | Compatibility / Coordinates | Low | Confirmed (code) |
| F-23 | `about:blank`/`srcdoc` extension-фреймы не получают content script | Compatibility / Manifest | Low | Potential |
| F-21 | Документация и комментарии расходятся с реализацией | Documentation | Low | Confirmed |
| F-25 | Нет автоматических тестов для state-machine | Code Quality / Testing | Informational | Confirmed |
| F-26 | Хрупкие селекторы и дублирование списков исключений | Architecture / Compatibility | Informational | Potential |

**Итого:** 2 High, 8 Medium, 12 Low, 3 Informational.

> Примечание: ID `F-17` в таблице отсутствует намеренно. Первичная гипотеза «wheel listener не passive и блокирует скролл» была проверена и **отклонена**: по MDN/спецификации `passive` по умолчанию `true` для `wheel` на `Document`/`Window`/`body`/`documentElement`. Finding не регистрируется (см. раздел 10).

---

## 5. Critical Findings (High)

### [F-01] Отложенный одиночный клик не отменяется последующим действием пользователя

**Приоритет:** High

**Категория:** Bug / Logic / State

**Статус подтверждения:** Confirmed

**Местоположение:**
- `src/content.js:326-331` — `clearPendingClick()`
- `src/content.js:339-311` — `cancelPlaybackRestore()`
- `src/content.js:365-113` — `handleVideoClick()`
- `src/content.js:115-131` — `onClick()`
- `src/content.js:566-568` — глобальные `pointerdown`/`keydown`/`wheel`

**Описание:**

Одиночный клик по видео не переключает воспроизведение сразу: создаётся `pendingClick` и таймер на `CLICK_DELAY = 100` мс. Если пользователь в течение этих 100 мс выполняет другое действие, влияющее на воспроизведение (нажимает нативную кнопку play/pause, `Space`, кнопку в панели управления), `onClick` для этого действия обычно возвращается раньше (`isVideoClickEvent` → `null`), а глобальный `pointerdown`/`keydown` вызывает только `cancelPlaybackRestore()`. Эта функция инкрементирует `playbackRestoreToken`, но **не трогает `pendingClick`**. Через 100 мс устаревший таймер всё равно вызывает `togglePlayback(video)` и переключает воспроизведение второй раз.

**Причина:**

`pendingClick` очищается только:
1. в `handleVideoClick()` при новом клике по видео (`clearPendingClick()`);
2. по cleanup-таймеру через `PENDING_TTL = 1200` мс.

`cancelPlaybackRestore()` управляет только restore-циклом (`playbackRestoreToken`), а не отложенным одиночным кликом. Комментарий в строках 336–338 утверждает, что «any other interaction … means the user took over», но реализация применяет это только к restore, не к pending click.

**Сценарий воспроизведения:**

1. Видео играет.
2. Пользователь кликает по видео (планируется пауза через 100 мс).
3. В течение 100 мс пользователь нажимает нативную кнопку паузы (или `Space`).
1. Twitch ставит видео на паузу.
5. Через 100 мс `pendingClick.timer` вызывает `togglePlayback(video)` → нативная кнопка нажимается ещё раз → видео возобновляется.

**Ожидаемое поведение:**

Новое действие пользователя должно иметь приоритет; устаревший отложенный клик должен быть отменён. Видео остаётся на паузе.

**Фактическое поведение:**

Видео ставится на паузу действием пользователя, затем через 100 мс расширение возобновляет его. Пользователь видит, что его пауза «отменяется сама».

**Последствия:**

- Непредсказуемое воспроизведение при типичном взаимодействии «клик по видео, затем Space/кнопка паузы».
- Нарушение инварианта AGENTS.md §1.1: «Новые пользовательские действия должны иметь приоритет над устаревшими отложенными операциями».
- Аналогично для seekbar/других контролов, если они меняют состояние в течение 100 мс.

**Доказательства:**

- Код: `cancelPlaybackRestore()` (339–311) меняет только `playbackRestoreToken`; `pendingClick` не очищается.
- Внешний harness (реальный `content.js` в `vm`, мок-DOM, fake timers), сценарий T1:
  - после клика по нативной паузе: `pausedAfterControl = true`;
  - после срабатывания pending: `pausedAfterPending = false`, `toggleCount = 1`.
- Сценарий T12 (Space):
  - после `Space`: `paused = true`;
  - после pending: `paused = false`.
- Статический поиск: `clearPendingClick` вызывается только из `handleVideoClick` (double-click path, строка 382; single-click path, строка 391) и cleanup-таймера (109).

**Рекомендуемое направление исправления:**

- Инвалидировать `pendingClick` при любом новом пользовательском действии, которое не является продолжением того же клика: `pointerdown` по контролу/вне видео, `keydown`, клик по seekbar/настройкам, `wheel` (по ситуации).
- Нельзя просто очищать `pendingClick` на каждом `pointerdown`: это сломает slow-double-click restore, которому нужен `previous` (см. «Регрессионные риски»). Нужен признак «pending больше не имеет права переключать» или отмена только при действии, не являющемся вторым кликом по тому же видео.
- Альтернатива: хранить `pendingClick` с target/координатами и при новом действии сравнивать; если действие не является вторым кликом по тому же видео — отменять таймер, но сохранять `wasPaused` для возможного restore.

**Регрессионные риски:**

- Slow double click: второй клик приходит после 100 мс, первый toggle уже выполнен; `previous.wasPaused` нужен для `applyPlaybackState`. Преждевременная очистка `pendingClick` на `pointerdown` второго клика сломает восстановление (видео останется на паузе после fullscreen).
- Отмена на `keydown` может отменить клик, если пользователь нажал клавишу случайно; это, вероятно, желаемое поведение, но нужно проверить.
- Отмена на `wheel` может отменить клик при обычном скролле; возможно, скролл не должен отменять одиночный клик (в отличие от restore).
- Затрагивает F-03/F-12: необходим единый подход к жизненному циклу `pendingClick`.

---

### [F-02] Extension-мост пересылает клики по div/canvas и вызывает паузу при взаимодействии с оверлеем

**Приоритет:** High (в рамках функции «поддержка extension-оверлеев»)

**Категория:** Bug / Logic / Compatibility

**Статус подтверждения:** Confirmed (код) / Likely (реальный impact зависит от разметки конкретного расширения)

**Местоположение:**
- `src/content.js:520-519` — `installExtensionFrameBridge()`
- `src/content.js:187-190` — `shouldIgnore()`
- `src/content.js:31-60` — `IGNORE_SELECTOR`
- `src/content.js:500-516` — `onExtensionFrameClick()`

**Описание:**

В extension-iframe (`*.ext-twitch.tv`) capture-listener пересылает родителю каждый `click`, для которого `shouldIgnore(event.target)` вернул `false`. `shouldIgnore` — это семантическая эвристика: `button`, `a`, `input`, `select`, `textarea`, `label`, `summary`, `[contenteditable]`, `[role=button/link/slider/menu/...]`, а также несколько Twitch-специфичных селекторов. Многие Twitch Extensions реализуют интерактивные элементы как обычные `div`/`canvas`/`span` без ARIA-ролей: карточки, игровые поля, варианты голосования, drag-зоны, кастомные слайдеры. Такие клики не игнорируются, пересылаются родителю, точка над видео находится, и `handleVideoClick()` переключает воспроизведение. При этом само расширение тоже обрабатывает клик — действие выполняется, но поток неожиданно ставится на паузу/возобновляется.

README.md (строка 31) и README.en.md (строка 31) утверждают: «Clicks on the extension's own buttons and other interactive elements are left alone». Для div/canvas-элементов это неверно.

**Причина:**

- Родительский документ не может инспектировать DOM кросс-доменного iframe; единственная точка решения — сам iframe.
- `shouldIgnore` распознаёт только семантические элементы; произвольный `div` с обработчиком клика неотличим от фона оверлея.
- Нет протокола «прозрачный фон / интерактивная зона» (opt-in/opt-out), нет проверки `event.defaultPrevented`, `tabindex`, `cursor`, `draggable`, `onclick` и т.п.

**Сценарий воспроизведения:**

1. Открыть канал с Twitch Extension, который рисует интерактивную карточку/игру как `div` поверх видео.
2. Кликнуть по карточке (не `button`, не `a`, без `role`).
3. iframe-мост отправляет `{type, x, y, detail, id}` родителю (harness T11: `forwarded = 1`).
1. Родитель находит видео под точкой и вызывает `handleVideoClick` → пауза/возобновление.
5. Действие расширения также выполняется.

**Ожидаемое поведение:**

Клики по интерактивным элементам расширения не должны управлять потоком. Прозрачный фон оверлея может пересылать клик (это и есть цель функции), но интерактивные зоны — нет.

**Фактическое поведение:**

Любой клик по не-семантическому элементу над видео переключает воспроизведение.

**Последствия:**

- Поток ставится на паузу/возобновляется, пока пользователь взаимодействует с расширением (игры, опросы, карточки, canvas).
- README обещает обратное; пользователи и разработчики расширений вводятся в заблуждение.
- Для div/canvas-ориентированных расширений функция v1.1.0 практически небезопасна.

**Доказательства:**

- Код: `installExtensionFrameBridge` (521–532) → `if (shouldIgnore(event.target)) return;` → `postClickToParent(...)`.
- `shouldIgnore` (187–190) — только `closest(IGNORE_SELECTOR)`.
- Harness T11: клик по `DIV` → `parentMessages.length = 1`, data `{type, x:123, y:15, detail:1, id:...}`; клик по `BUTTON` → `0`.
- README.md:11/31, README.en.md:11/31.

**Рекомендуемое направление исправления:**

- Ввести контракт pass-through: пересылать только клики по фону/корню оверлея (`document.documentElement`, `body` или элемент с явным маркером), а не по произвольным `div`.
- Либо добавить opt-out для разработчиков расширений (атрибут/класс на интерактивных контейнерах), но это требует их cooperation.
- Либо эвристика: `getComputedStyle(target).cursor !== 'auto/default'`, `target.hasAttribute('onclick')`, `tabindex`, `draggable`, `contenteditable`, `role`, `data-*`, наличие дочерних интерактивных элементов; это снизит, но не устранит проблему.
- Если идеальное решение невозможно, честно задокументировать ограничение в README и не утверждать, что все интерактивные элементы игнорируются.

**Регрессионные риски:**

- Ограничение пересылки может сломать основную цель — клик «сквозь» неинтерактивный оверлей; нужно надёжно определить фон.
- Изменения `IGNORE_SELECTOR` влияют и на родительский путь (клики по Twitch UI).
- Нужны реальные тесты с Hearthstone Deck Tracker, опросами, играми, canvas-расширениями.

---

## 6. Functional Bugs

### [F-03] Двойной клик по другому/заменённому видео применяет состояние предыдущего видео

**Приоритет:** Medium

**Категория:** Bug / Logic / State

**Статус подтверждения:** Likely (код-путь подтверждён; триггер зависит от `detail >= 2` на другом видео/заменённом элементе)

**Местоположение:**
- `src/content.js:365-389` — `handleVideoClick()`, вычисление `isDoubleClick`, `alreadyToggled`, `stateBeforeClick`
- `src/content.js:313-361` — `applyPlaybackState()`

**Описание:**

`isDoubleClick` истинно, если `detail >= 2` **или** есть `previous` с тем же `video` и разница времени < 100 мс. В ветке double click:

```js
const alreadyToggled = previous !== null && previous.timer === null;
const stateBeforeClick = previous !== null ? previous.wasPaused : null;
...
if (alreadyToggled && stateBeforeClick !== null) {
  applyPlaybackState(video, stateBeforeClick);
}
```

Проверка `previous.video === video` есть только во втором условии `isDoubleClick`, но **не** в блоке restore. Если `detail >= 2` приходит для видео B, а `pendingClick` ещё ссылается на видео A (или на старый элемент заменённого плеера), `stateBeforeClick` берётся у A и применяется к B. B принудительно переводится в состояние A до клика.

**Причина:**

`detail >= 2` короткозамыкает проверку identity; `alreadyToggled`/`stateBeforeClick` не проверяют, что `previous.video === video`.

**Сценарий воспроизведения:**

1. Видео A играет. Клик по A (pending, `wasPaused = false`).
2. Через 500 мс pending срабатывает, A ставится на паузу; entry A ещё хранится до 1200 мс.
3. Быстрый `detail = 2` клик по видео B (B на паузе) — например, второй клик по mini-player или по пересозданному элементу плеера.
1. `previous` = entry A; `alreadyToggled = true`; `stateBeforeClick = false`.
5. `applyPlaybackState(B, false)` → B возобновляется, хотя пользователь этого не просил.

**Ожидаемое поведение:**

Двойной клик по B должен влиять только на B (fullscreen); состояние A не должно переноситься. Если `previous.video !== video`, restore не выполняется.

**Фактическое поведение:**

B принудительно переводится в состояние A до клика.

**Последствия:**

- Неожиданное воспроизведение на другом плеере (main + mini, пересозданный плеер).
- После SPA-перехода/перерисовки видео может «самопроизвольно» включиться или встать на паузу.
- Усложняет диагностику: зависит от `detail` и времени.

**Доказательства:**

- Код: строки 373–387; условие identity только в `isDoubleClick`, не в restore.
- Harness T3: A playing → через 500 мс A paused → `detail=2` по B (paused) → `bPaused = false`, `bToggle = 1` (B возобновлён).
- Логическая цепочка: `detail >= 2` → `alreadyToggled` от A → `stateBeforeClick` от A → `applyPlaybackState(B, ...)`.

**Рекомендуемое направление исправления:**

- В ветке double click требовать `previous !== null && previous.video === video` для restore. Если `detail >= 2`, но `previous` относится к другому видео (или отсутствует), выполнять только `toggleFullscreen(video)` без `applyPlaybackState`.
- Рассмотреть per-video `pendingClick` (см. F-12), чтобы состояния разных плееров не пересекались.

**Регрессионные риски:**

- Slow double click по тому же видео должен по-прежнему восстанавливать состояние; нельзя просто удалить restore.
- `detail` может быть 3+ при быстрых кликах; см. F-11.
- Нужны тесты с двумя видео (main + mini) и с пересозданием плеера.

---

### [F-01] Устаревший `pendingClick` после удаления плеера переключает новый плеер

**Приоритет:** Medium

**Категория:** Bug / State / SPA

**Статус подтверждения:** Confirmed (logic)

**Местоположение:**
- `src/content.js:101-105` — pending-таймер
- `src/content.js:215-251` — `findPlayerButton()`
- `src/content.js:256-269` — `togglePlayback()`

**Описание:**

Таймер pending-клика вызывает `togglePlayback(video)`, не проверяя, что `video` всё ещё в документе и относится к тому же плееру. Если плеер/видео удалены в течение 100 мс (SPA-переход, перерисовка), `findPlayerButton()` может не найти кнопку в отсоединённом плеере и уйти в глобальный fallback: `document.querySelectorAll(selector).filter(isVisible)` → ровно одна видимая кнопка → это кнопка **нового** плеера. В результате устаревший клик переключает новый канал.

**Причина:**

- Нет проверки `video.isConnected`/`document.contains(video)` в pending-таймере.
- Глобальный fallback не проверяет принадлежность кнопки кликнутому видео (см. F-08).
- `pendingClick` не очищается при навигации/удалении видео.

**Сценарий воспроизведения:**

1. Клик по видео A (pending на 100 мс).
2. В течение 100 мс Twitch перерисовывает плеер/происходит SPA-переход; A и его контролы удалены, смонтирован плеер B.
3. Таймер срабатывает; scoped-поиск в A не находит кнопку; глобальный fallback находит единственную видимую кнопку B.
1. `clickNativeButton(buttonB)` → B переключается.

**Ожидаемое поведение:**

Если исходное видео/плеер больше не в документе, отложенное действие отбрасывается. Никакой другой плеер не затрагивается.

**Фактическое поведение:**

Переключается новый плеер B.

**Последствия:**

- При переходе между каналами/перерисовке в течение 100 мс новый поток неожиданно ставится на паузу/возобновляется.
- Трудно воспроизвести, но реально при медленном клике/быстрой навигации.

**Доказательства:**

- Код: строки 101–105 (нет connectivity check), 252–253 (глобальный fallback).
- Harness T5: клик A → удаление A/его кнопок на 100 мс → на 100 мс `toggleCount = 1`, `bPaused = true` (переключён B).

**Рекомендуемое направление исправления:**

- В pending-таймере: `if (!document.contains(video) || !video.isConnected) return;` (или `video.isConnected`).
- Не использовать глобальный fallback для отсоединённого видео; лучше `video.play()/pause()` только если видео всё ещё connected.
- Очищать `pendingClick` при `popstate`/изменении URL/удалении видео (например, лёгкий `MutationObserver` или проверка на клике; но не усложнять без необходимости).

**Регрессионные риски:**

- При пересоздании того же логического видео (player re-render) клик может быть отброшен; это лучше, чем переключить чужой плеер, но нужно проверить поведение на Live/VOD/Clips.
- `document.contains` для видео внутри iframe работает в пределах своего документа; контент-скрипт уже выполняется в нужном фрейме.

---

### [F-05] Restore/fullscreen fallback через `document.querySelector('video')` управляет чужим видео

**Приоритет:** Medium

**Категория:** Bug / State / SPA

**Статус подтверждения:** Confirmed (logic)

**Местоположение:**
- `src/content.js:313-361` — `applyPlaybackState()`, `activeVideo`
- `src/content.js:305-321` — `toggleFullscreen()`, `target`

**Описание:**

Если исходное видео отсоединено, `applyPlaybackState` использует `document.querySelector('video')` — первое видео в документе. `toggleFullscreen` делает то же самое. Restore-цикл может работать до 1 секунд и переключить совершенно другое видео: новый канал, mini-player, скрытый/preview-элемент. Аналогично fullscreen-fallback может запросить fullscreen не для того плеера.

**Причина:**

- Fallback не проверяет identity (тот же ли это плеер/видео).
- «Первое видео» не эквивалентно «то видео, которое кликнули».
- Restore-токен отменяется только пользовательскими `pointerdown`/`keydown`/`wheel`; навигация без pointerdown (browser back/forward, Twitch route change) или перерисовка плеера оставляют токен активным.

**Сценарий воспроизведения:**

1. Двойной клик по видео A; первый клик уже переключил воспроизведение, `applyPlaybackState(A, wasPaused)` запланировал restore.
2. В течение 1 с A удалён/заменён (SPA-переход, перерисовка, raid).
3. На очередной проверке `activeVideo()` возвращает `document.querySelector('video')` = B.
1. Если `B.paused !== shouldBePaused`, B переключается.

**Ожидаемое поведение:**

Restore/fullscreen применяется только к исходному видео. Если его нет — операция отменяется. Никакое другое видео не затрагивается.

**Фактическое поведение:**

Управление переходит на первое видео в документе.

**Последствия:**

- Новый канал/mini-player неожиданно ставится на паузу/возобновляется.
- Fullscreen может открыться для чужого плеера.
- Потенциально затрагивает скрытые/preview-видео (первое в DOM), что делает поведение ещё более непредсказуемым.

**Доказательства:**

- Код: строка 315 (`document.contains(video) ? video : document.querySelector('video')`), строка 311 (аналогично для fullscreen).
- Harness T6: double click A → A удалён → restore на +300 мс возобновляет B (`bPaused = false`, `bToggle = 1`).

**Рекомендуемое направление исправления:**

- Никогда не подставлять другое видео: если исходное `!document.contains(video)`, прервать restore/fullscreen.
- Если плеер пересоздан, отслеживать новый video явно (например, по player root/URL) и только тогда переносить операцию.
- Добавить проверку видимости/идентичности (`video.isConnected`, тот же player root, `currentSrc`/`src`).

**Регрессионные риски:**

- Некоторые embeds пересоздают video во время легитимной операции; restore должен либо корректно перейти на новый элемент, либо безопасно отмениться.
- Нельзя ставить на паузу другое видео; лучше потерять restore, чем управлять чужим плеером.
- Затрагивает F-01/F-06/F-07.

---

### [F-06] `isPlayerExpanded` путает theater/large player с fullscreen

**Приоритет:** Medium

**Категория:** Bug / Logic / Fullscreen

**Статус подтверждения:** Likely (логика подтверждена; реальное условие зависит от размера плеера)

**Местоположение:**
- `src/content.js:275-281` — `isPlayerExpanded()`
- `src/content.js:305-321` — `toggleFullscreen()`

**Описание:**

`isPlayerExpanded` возвращает `true`, если прямоугольник плеера ≥95% viewport по ширине **и** высоте, даже когда `document.fullscreenElement` равен `null`. В theater mode на 16:9-мониторе плеер часто занимает весь viewport (100% × 100%), поэтому `wasExpanded = true`. Двойной клик нажимает нативную кнопку fullscreen (входит в fullscreen); через 100 мс fallback видит `isPlayerExpanded` всё ещё `true` и вызывает `requestNativeFullscreen(target, false)` → выходит из fullscreen. Итог: вход + выход, fullscreen не остаётся.

**Причина:**

- Эвристика «большой плеер = развёрнут» смешивает theater mode и настоящий fullscreen.
- Fallback сравнивает эвристику, а не фактическое состояние `document.fullscreenElement`.

**Сценарий воспроизведения:**

1. Включить theater mode (плеер занимает почти весь viewport, но не fullscreen).
2. Двойной клик по видео.
3. `wasExpanded = true` (по rect), нативная кнопка входит в fullscreen.
1. Fallback на 100 мс: `isPlayerExpanded` = true === `wasExpanded` → `requestNativeFullscreen(..., false)` → `exitFullscreen()`.
5. Fullscreen мигает и закрывается.

**Ожидаемое поведение:**

Если плеер не в fullscreen, двойной клик должен войти в fullscreen и остаться там. Выход — только если fullscreen реально активен.

**Фактическое поведение:**

Вход и немедленный выход (или мигание).

**Последствия:**

- Двойной клик не работает в theater mode/крупных layout-ах.
- Пользователь не понимает, почему fullscreen «не держится».

**Доказательства:**

- Код: строки 282–283 (rect ≥95%), 316–317 (сравнение `isPlayerExpanded`).
- Harness T7 (viewport 1000×700, player 960×672, не fullscreen): `fullscreenClicks = 1`, `exitCalls = 1`, итоговый `fullscreenElement = null`.

**Рекомендуемое направление исправления:**

- Решение о fullscreen должно опираться на `document.fullscreenElement` (фактический fullscreen), а не на rect-эвристику.
- Если theater mode нужно обрабатывать отдельно, использовать отдельный признак (например, наличие theater-класса/состояния) и не смешивать с fullscreen.
- Fallback должен сравнивать фактическое fullscreen-состояние до/после нативной кнопки.

**Регрессионные риски:**

- Изменение поведения theater mode; fallback, вероятно, добавлен для случаев, когда Twitch «проглатывает» клик при перерисовке. Нужно сохранить эту защиту для реального fullscreen.
- Проверить Live/VOD/Clips, theater ↔ fullscreen, перерисовку плеера.

---

### [F-07] Fullscreen fallback повторно входит в fullscreen после `Esc`

**Приоритет:** Medium

**Категория:** Bug / Logic / Fullscreen

**Статус подтверждения:** Confirmed (logic)

**Местоположение:**
- `src/content.js:305-321` — `toggleFullscreen()`, fallback `setTimeout` на 100 мс

**Описание:**

После двойного клика fallback через 100 мс проверяет `isPlayerExpanded(target) === wasExpanded`. Если пользователь нажал `Esc` в течение этих 100 мс и браузер вышел из fullscreen, `isPlayerExpanded` возвращает `false`, что равно `wasExpanded` (до клика было `false`). Условие истинно → `requestNativeFullscreen(target, true)` → расширение снова входит в fullscreen. `keydown`-слушатель вызывает только `cancelPlaybackRestore`, а не отмену fullscreen-fallback.

**Причина:**

- Fallback не знает, что пользователь явно вышел из fullscreen.
- Нет отмены по `fullscreenchange`/`Esc`/токену.
- Сравнение эвристики не отличает «нативная кнопка не сработала» от «пользователь вышел».

**Сценарий воспроизведения:**

1. Двойной клик по видео → нативная кнопка входит в fullscreen.
2. Пользователь нажимает `Esc` через 100–300 мс (передумал/хочет выйти).
3. Браузер выходит из fullscreen.
1. Fallback на 100 мс видит `isPlayerExpanded = false === wasExpanded = false` → `requestFullscreen`.
5. Fullscreen снова открывается против воли пользователя.

**Ожидаемое поведение:**

Явный выход пользователя (`Esc`) отменяет fallback; fullscreen остаётся закрытым.

**Фактическое поведение:**

Fullscreen повторно открывается.

**Последствия:**

- Расширение «борется» с пользователем; невозможно быстро выйти из fullscreen.
- Fullscreen-мигание.

**Доказательства:**

- Код: строки 313–319; `keydown`-слушатель (566–568) не связан с fallback.
- Harness T19: double click → native fullscreen → `Esc` на +100 мс → fallback на +100 мс вызывает `requestFullscreen`; `requestFullscreenCalls = 1`, `fullscreenElement = player`.

**Рекомендуемое направление исправления:**

- Отменять fallback на `fullscreenchange`, когда `document.fullscreenElement` стал `null` после входа, или на `Esc`/любое пользовательское действие.
- Использовать токен/таймер, который очищается при выходе из fullscreen.
- Fallback выполнять только если нативная кнопка не изменила фактическое fullscreen-состояние и пользователь не взаимодействовал.

**Регрессионные риски:**

- `fullscreenchange` может сработать с задержкой/для другого элемента; нужна аккуратная проверка.
- Не сломать сценарий, ради которого fallback добавлен (Twitch проглотил клик при перерисовке).
- Проверить `Esc`, кнопку выхода, переключение вкладок, Live/VOD/Clips.

---

### [F-08] Глобальный fallback `findPlayerButton` нажимает кнопку другого плеера

**Приоритет:** Medium

**Категория:** Bug / Logic / Multi-player

**Статус подтверждения:** Confirmed (logic)

**Местоположение:**
- `src/content.js:215-251` — `findPlayerButton()`
- `src/content.js:256-269` — `togglePlayback()`
- `src/content.js:305-321` — `toggleFullscreen()`

**Описание:**

Если в плеере кликнутого видео нет кнопки play/pause (или fullscreen), код делает глобальный fallback:

```js
const all = Array.from(document.querySelectorAll(selector)).filter(isVisible);
return all.length === 1 ? all[0] : null;
```

Единственная видимая кнопка может принадлежать **другому** плееру. Комментарий «Accept only a single visible match so a second player on the page is never touched» неверен: уникальность не доказывает принадлежность. Дополнительно, scoped-поиск использует `video.closest(PLAYER_SELECTOR) || video.parentElement`; если `PLAYER_SELECTOR` не совпал, `video.parentElement` может быть широким контейнером с кнопкой другого плеера.

**Причина:**

- Нет проверки ownership: `root.contains(button)`, `button.closest(PLAYER_SELECTOR) === video.closest(PLAYER_SELECTOR)`.
- Глобальный fallback не привязан к кликнутому видео.
- `findPlayerButton` не проверяет `disabled` (см. F-11).

**Сценарий воспроизведения:**

1. На странице два плеера: у A нет кнопки play/pause (кастомный embed/перерисовка), у B есть одна видимая кнопка.
2. Клик по A → pending → `togglePlayback(A)`.
3. Scoped-поиск в A не находит кнопку; глобальный fallback возвращает кнопку B.
1. B переключается, A остаётся без изменений.

**Ожидаемое поведение:**

Использовать кнопку только из плеера A; иначе — `video.play()/pause()` для A. Никогда не нажимать кнопку другого плеера.

**Фактическое поведение:**

Переключается B.

**Последствия:**

- Неправильное видео ставится на паузу/возобновляется.
- Fullscreen-fallback может открыть fullscreen для B.
- Усугубляет F-01/F-05.

**Доказательства:**

- Код: строки 216–253.
- Harness T20: у A нет кнопки, у B одна видимая; клик по A → `aPaused = false`, `bPaused = true`, `playBClicks = 1`.

**Рекомендуемое направление исправления:**

- Проверять ownership: кнопка должна находиться внутри player root кликнутого видео или быть единственной и принадлежать тому же плееру.
- Если ownership не доказан — использовать `video.play()/pause()` (для fullscreen — `requestFullscreen` на player root).
- Для scoped-поиска не использовать `video.parentElement` как «плеер», если это широкий контейнер; ограничить поиск.

**Регрессионные риски:**

- Некоторые embeds держат контролы вне player root; строгая проверка может сломать их. Нужен media-API fallback и тесты на embed/multi-player.
- Не сломать основной сценарий с одной кнопкой в одном плеере.

---

### [F-09] Ad-детект блокирует все клики при любом пересечении ad-элемента с видео

**Приоритет:** Medium

**Категория:** Compatibility / Logic

**Статус подтверждения:** Potential (поведение подтверждено; реальный Twitch DOM не проверялся)

**Местоположение:**
- `src/content.js:170-177` — `isAdPlaying()`
- `src/content.js:218-221` — `isVideoClickEvent()`

**Описание:**

`isAdPlaying` возвращает `true`, если **любой** видимый элемент из `AD_SELECTOR` пересекается с прямоугольником видео, независимо от точки клика:

```js
return Array.from(root.querySelectorAll(AD_SELECTOR)).some(
  (element) => isVisible(element) && rectsOverlap(element.getBoundingClientRect(), videoRect),
);
```

Маленький постоянный ad-бейдж/баннер, пересекающий видео, отключает клики по **всей** поверхности видео, даже если пользователь кликает далеко от него. Обратная проблема: если Twitch меняет селекторы или countdown находится вне rect видео, ad не детектится, и расширение переключает воспроизведение рекламы. README обещает, что реклама не перехватывается.

**Причина:**

- Проверка глобальна для видео, а не для точки клика.
- Best-effort селекторы, без явного состояния «ad playing».
- `isVisible` не проверяет opacity/stacking; прозрачный/перекрытый ad-элемент может блокировать.

**Сценарий воспроизведения:**

1. На странице есть видимый ad-элемент, пересекающий видео (бейдж/баннер/countdown), но реклама не идёт.
2. Пользователь кликает в центр видео, далеко от ad-элемента.
3. `isAdPlaying` = true → `isVideoClickEvent` = null → `onClick` ничего не делает, propagation не останавливается.
1. Расширение «не работает».

**Ожидаемое поведение:**

Блокировать клики только при реально идущей рекламе (или только по ad-поверхности), не отключать функцию из-за постороннего ad-элемента.

**Фактическое поведение:**

Все клики по видео игнорируются при любом пересечении ad-элемента.

**Последствия:**

- Функция silently перестаёт работать на страницах с persistent ad-элементом.
- При miss-детекте — наоборот, перехватывает рекламу, вопреки README.

**Доказательства:**

- Код: строки 171–176 (нет x/y).
- Harness T1: ad 60×30 в левом верхнем углу, клик в центре (100,225) → `toggleCount = 0`.
- README.md:79, README.en.md:79.

**Рекомендуемое направление исправления:**

- Проверять, что точка клика попадает в ad-элемент (`elementFromPoint`/rect contains), а не только пересечение с видео.
- Либо использовать более надёжное состояние плеера (класс/атрибут/`data-a-target`), а селекторы оставить fallback.
- Задокументировать best-effort характер.

**Регрессионные риски:**

- Ослабление проверки может привести к переключению рекламы; усиление — к отключению функции.
- Нужны тесты с pre-roll/mid-roll, разными layout-ами, Live/VOD/Clips.

---

### [F-10] `applyPlaybackState` предполагает синхронное обновление `video.paused`

**Приоритет:** Medium

**Категория:** Bug / State / Async

**Статус подтверждения:** Potential (modeled; реальный timing Twitch не проверялся)

**Местоположение:**
- `src/content.js:313-361` — `applyPlaybackState()`
- `src/content.js:256-269` — `togglePlayback()`

**Описание:**

После первого клика (delayed toggle) slow double click вызывает `applyPlaybackState(video, wasPaused)`. Функция синхронно проверяет `video.paused` и возвращается, если состояние уже совпадает. Если нативная кнопка Twitch обновляет `video.paused` асинхронно (React state/effect, перерисовка, reconnect), проверка видит старое состояние, restore пропускается, а delayed toggle затем оставляет видео в неверном состоянии. Обратная проблема: если restore-toggle применяется с задержкой, проверка на 300 мс видит несовпадение и делает второй toggle → осцилляция.

**Причина:**

- Нет учёта «in-flight» состояния/ожидаемого состояния.
- Retry основан только на `video.paused` в фиксированные моменты.
- Ранний return предполагает, что состояние уже settled.

**Сценарий воспроизведения (modeled):**

1. Видео играет.
2. Первый клик; pending toggle на 100 мс; нативная кнопка применяет паузу с задержкой 350 мс (t=750).
3. Второй клик на 500 мс (`detail=2`); `applyPlaybackState` видит `paused = false` (старое) → считает, что уже playing → return.
1. На 750 мс delayed pause применяется → видео на паузе после double click.

**Ожидаемое поведение:**

Double click сохраняет состояние до клика независимо от timing нативной кнопки; итог детерминирован.

**Фактическое поведение:**

При асинхронном обновлении видео может остаться на паузе или осциллировать.

**Последствия:**

- Периодические «залипания» паузы/воспроизведения после fullscreen.
- Трудно воспроизвести; зависит от нагрузки/перерисовки/reconnect.

**Доказательства:**

- Код: строка 317 (`if (video.paused === shouldBePaused) return;`), 353–359 (retry).
- Harness T18 (modeled async delay 350 мс): итоговый `paused = true` после double click.
- Комментарий 350–352 сам признаёт, что плеер может «проглотить» toggle при перерисовке.

**Рекомендуемое направление исправления:**

- Отслеживать ожидаемое состояние и in-flight операцию; не возвращаться рано, если toggle ещё в процессе.
- Использовать события `play`/`pause`/`playing` с таймаутом вместо фиксированных задержек (см. `condition-based-waiting`).
- Проверять состояние после фактического применения, а не сразу.

**Регрессионные риски:**

- Ожидание события может зависнуть, если событие не придёт; нужен timeout.
- Механизм restore важен для Live/fullscreen; нельзя удалять.
- Проверить Live/VOD/Clips, fullscreen, reconnect, перерисовку.

---

## 7. Event Handling & State Management

### Дополнительные наблюдения по обработке событий

- **`mousedown`/`mouseup` не перехватываются.** Расширение использует `click` (capture) и `pointerdown` (только для `cancelPlaybackRestore`). Если Twitch переключает playback на `pointerup`/`mouseup`, остановка `click` не предотвратит double action. В текущем релизе double toggle, судя по истории, исправлен через `click`, но это остаётся compatibility-зависимостью (Unverified).
- **`preventDefault()` не вызывается.** `stopPropagation`/`stopImmediatePropagation` не отменяют default action. Для клика по `<video>` default action отсутствует, поэтому это допустимо; для игнорируемых контролов расширение не вмешивается. Если в будущем понадобится отменять default (например, drag/selection), это нужно делать явно.
- **`event.detail`/`event.timeStamp`** используются для real clicks; forwarded-клики используют `Number(data.detail)` и `performance.now()` (F-15/T11), поэтому cross-document timing приблизителен.
- **`dblclick`** глотается отдельным обработчиком (F-19); это необходимо, потому что браузер генерирует `dblclick` даже после остановки `click`.
- **`pointerdown`/`keydown`/`wheel`** не останавливаются и не отменяют default; они только инкрементируют restore-token. Это правильно для focus/scroll, но не отменяет `pendingClick` (F-01).

### [F-11] Triple click переключает fullscreen дважды (`detail >= 2`)

**Приоритет:** Low

**Категория:** Bug / Logic / Edge

**Статус подтверждения:** Confirmed (logic)

**Местоположение:** `src/content.js:373-377` — `isDoubleClick`

**Описание:**

Любой клик с `detail >= 2` считается double click. Triple click даёт `detail` 1, 2, 3; третий клик снова проходит в double-ветку и переключает fullscreen второй раз (вход → выход). Четыре клика — ещё раз и т.д.

**Причина:** `detail >= 2` вместо `detail === 2`; нет cooldown/reset после обработки double click.

**Сценарий воспроизведения:** три быстрых клика по видео → fullscreenClicks = 2 (harness T2).

**Ожидаемое поведение:** triple click = double click + single click (или игнор), не два fullscreen-toggle.

**Фактическое поведение:** fullscreen мигает/закрывается.

**Последствия:** редкий, но заметный edge case; быстрые клики могут «выбить» из fullscreen.

**Доказательства:** harness T2 (`fullscreenClicks = 2`); строка 371.

**Рекомендуемое направление исправления:** считать double только `detail === 2`; после double click игнорировать клики в течение короткого cooldown/до конца серии; либо state machine.

**Регрессионные риски:** `detail` может быть 3+ для легитимных быстрых кликов; проверить single/double/triple на Live/VOD/Clips.

---

### [F-12] Одиночный клик по другому видео отменяет pending-клик по первому

**Приоритет:** Low

**Категория:** Bug / State / Multi-player

**Статус подтверждения:** Confirmed (logic)

**Местоположение:** `src/content.js:391` — `clearPendingClick()` в single-click path; `365-113`

**Описание:**

`pendingClick` — один глобальный слот. Новый одиночный клик по видео B безусловно вызывает `clearPendingClick()`, отменяя таймер видео A, даже если A ещё не переключился. Клик по A теряется; переключается только B.

**Причина:** один глобальный pending на все видео; `clearPendingClick` не проверяет `previous.video === video`.

**Сценарий воспроизведения:** click A (playing) на 0 мс, click B (playing) на 100 мс, wait 1000 мс → A остаётся playing, B paused (harness T21).

**Ожидаемое поведение:** оба клика применяются к своим видео (или первый не отменяется молча).

**Фактическое поведение:** A теряет клик.

**Последствия:** на страницах с main + mini-player один клик может не сработать.

**Доказательства:** harness T21 (`aPaused = false`, `bPaused = true`); строки 391, 112.

**Рекомендуемое направление исправления:** per-video pending (Map) или очищать только если `previous.video === video`; глобальный cleanup/timer.

**Регрессионные риски:** несколько таймеров/entries усложняют состояние; нужна очистка и защита от double toggle. Тестировать multi-player.

---

### [F-13] `isVideoSurfaceOverlay` может принять полноразмерную игнорируемую кнопку за поверхность видео

**Приоритет:** Low

**Категория:** Bug / Logic / Compatibility

**Статус подтверждения:** Potential

**Местоположение:** `src/content.js:195-216` — `isVideoSurfaceOverlay`; `218-221` — `isVideoClickEvent`; `31-60` — `IGNORE_SELECTOR`

**Описание:**

`shouldIgnore` считает content-gate/unmute и др. игнорируемыми, но `isVideoSurfaceOverlay` «спасает» любую кнопку/`[role=button]`, если она ≥90% размера видео и не входит в узкий список исключений (`player-controls`, `player-seekbar`, `*menu*`, `*unmute*`). Полноразмерная кнопка внутри content-gate/overlay может быть принята за big play overlay: `onClick` останавливает propagation и переключает воспроизведение вместо активации gate.

**Причина:** два расходящихся списка исключений; rescue-эвристика слишком широкая.

**Сценарий воспроизведения:** полноразмерный `<button>`/`[role=button]` внутри `[data-a-target="content-gate"]` над видео → `shouldIgnore = true`, `isVideoSurfaceOverlay = true` → `handleVideoClick`; клик по gate блокируется. Требует проверки реального DOM Twitch.

**Ожидаемое поведение:** rescue только для реального paused-play overlay; остальные игнорируемые контролы сохраняют native behavior.

**Фактическое поведение:** полноразмерный игнорируемый контрол может стать «поверхностью видео».

**Последствия:** content gate/mature warning может не запустить поток; другие полноразмерные контролы могут переключать воспроизведение.

**Доказательства:** строки 203–215; `IGNORE_SELECTOR` содержит content-gate, rescue-список — нет.

**Рекомендуемое направление исправления:** сделать rescue специфичным для известного play overlay (`data-a-target`/класс) или возвращать false для всего, что матчится `IGNORE_SELECTOR`, кроме play overlay; унифицировать списки.

**Регрессионные риски:** big paused overlay должен продолжать работать; ужесточение может сделать клик по paused-видео «мёртвым», если overlay — кнопка. Тестировать paused Live/VOD/Clips и content gate.

---

### [F-11] `togglePlayback` не проверяет disabled native-кнопку и не делает fallback

**Приоритет:** Low

**Категория:** Bug / Logic / Robustness

**Статус подтверждения:** Potential

**Местоположение:** `src/content.js:256-269` — `togglePlayback`; `236-213` — `clickNativeButton`; `215-251` — `findPlayerButton`

**Описание:**

Если `findPlayerButton` возвращает disabled/недоступную кнопку (ads/loading/offline) или кнопку, которая не управляет этим видео, `button.click()` ничего не делает, и функция возвращается без `video.play()/pause()`. `onClick` уже остановил propagation, поэтому клик пользователя теряется.

**Причина:** нет проверки `disabled`/`aria-disabled`/`isConnected`; нет проверки, что клик изменил состояние; нет fallback.

**Сценарий воспроизведения:** native-кнопка disabled; клик по видео → propagation остановлен, `.click()` на disabled-кнопке не диспатчит click, видео не меняется. Реальное состояние Twitch не проверялось.

**Ожидаемое поведение:** если кнопка недоступна — fallback на media API (или не перехватывать клик).

**Фактическое поведение:** клик «проглатывается» без эффекта.

**Последствия:** клик по loading/offline/ad-плееру ничего не делает; расширение кажется сломанным.

**Доказательства:** строки 257–261; статический поиск: `disabled` в файле отсутствует.

**Рекомендуемое направление исправления:** проверять `button.disabled`/`aria-disabled`, `document.contains(button)`, при необходимости — состояние после короткой задержки; fallback на `video.play()/pause()`.

**Регрессионные риски:** media API может быть прерван state machine Twitch (поэтому native-кнопка приоритетна); использовать только как fallback. Тестировать Live/VOD/Clips/offline/loading.

---

### [F-18] Нет проверки `event.isTrusted`; синтетические клики обрабатываются как пользовательские

**Приоритет:** Low

**Категория:** Event Handling / Robustness

**Статус подтверждения:** Potential

**Местоположение:** `src/content.js:115-131` — `onClick`; `135-111` — `onDoubleClick`; `520-532` — bridge click

**Описание:**

Обработчики не проверяют `event.isTrusted`. Скрипт страницы (или сам Twitch) может диспатчить синтетический `click` по видео/big overlay; расширение считает его пользовательским, останавливает propagation и планирует toggle. Собственные синтетические клики расширения покрыты флагом `clickingNativeButton`, но клики Twitch — нет. Security-impact низкий: скрипт на twitch.tv уже может вызвать native-кнопку/`video.pause()`. Но возможны задержки/дубли при программных кликах Twitch.

**Причина:** нет `isTrusted`; флаг покрывает только клики самого расширения.

**Сценарий воспроизведения:** `video.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:100, clientY:225, detail:1}))` → расширение планирует toggle и останавливает propagation.

**Ожидаемое поведение:** обрабатывать только доверенные пользовательские клики (кроме собственных native-кликов).

**Фактическое поведение:** синтетические клики обрабатываются.

**Последствия:** нежелательные toggle от скриптов/автоматизации; возможное вмешательство в программные клики Twitch. Низкий.

**Доказательства:** строки 115–131; `isTrusted` в файле отсутствует (статический поиск).

**Рекомендуемое направление исправления:** `if (!event.isTrusted) return;` в пользовательских обработчиках (forwarded-сообщения — отдельный канал). Проверить, не полагается ли Twitch на синтетические клики.

**Регрессионные риски:** accessibility/automation могут диспатчить события; Twitch может использовать синтетические клики намеренно. Тестировать с плеером и assistive tech.

---

### [F-19] `onDoubleClick` глотает dblclick по текущей точке, а не по фактически обработанным кликам

**Приоритет:** Low

**Категория:** Event Handling

**Статус подтверждения:** Potential

**Местоположение:** `src/content.js:135-111` — `onDoubleClick`; `218-221` — `isVideoClickEvent`

**Описание:**

`onDoubleClick` решает, глотать ли браузерный `dblclick`, заново вызывая `isVideoClickEvent(event)` в момент dblclick. Если DOM изменился между вторым кликом и dblclick (появился/исчез overlay, видео заменено, началась реклама), решение может не совпасть с тем, что реально обработали клики: расширение проглотит dblclick, который не обрабатывало, или наоборот — пропустит native double action Twitch.

**Причина:** нет записи «предыдущая пара кликов обработана»; решение по текущей точке.

**Сценарий воспроизведения:** требует изменения DOM между click и dblclick; детерминированно не воспроизводился.

**Ожидаемое поведение:** глотать dblclick тогда и только тогда, когда расширение обработало соответствующую пару кликов.

**Фактическое поведение:** решение по текущей точке.

**Последствия:** редкий double fullscreen/pause или заблокированный native dblclick.

**Доказательства:** строки 137–110; нет связи между `handleVideoClick` и `onDoubleClick`.

**Рекомендуемое направление исправления:** ставить короткоживущий флаг при обработке double click в `handleVideoClick` и использовать его в `onDoubleClick` (с timestamp/токеном).

**Регрессионные риски:** устаревший флаг может проглотить следующий dblclick; использовать timestamp/token. Тестировать dblclick во время overlay/перерисовки.

---

### [F-20] `stopImmediatePropagation` блокирует все последующие click-обработчики

**Приоритет:** Low

**Категория:** Architecture / Compatibility

**Статус подтверждения:** Potential (подтверждённого user-visible regression нет)

**Местоположение:** `src/content.js:127-128`, `139-110`

**Описание:**

Для каждого обработанного клика по видео вызываются `stopPropagation()` + `stopImmediatePropagation()` на `document` в capture-фазе. Это предотвращает доставку события всем последующим обработчикам: Twitch, другим content script/расширениям, странице. Решение осознанное (иначе double toggle), но это максимально широкое вмешательство. `pointerdown`/`keydown`/`wheel` не останавливаются, поэтому focus/drag могут работать; но click-handlers — нет.

**Причина:** нет способа адресно остановить только play/pause handler Twitch; останавливается всё.

**Сценарий воспроизведения:** другой content script/страничный listener на click по видео не получает событие. Реального Twitch-regression не подтверждено.

**Ожидаемое поведение:** вмешательство только в playback toggle, а не во всю обработку click.

**Фактическое поведение:** все downstream click-listeners блокируются для обработанных кликов.

**Последствия:** потенциальные compatibility-регрессии с функциями Twitch/другими расширениями; трудно обнаружить. README упоминает stop propagation только как защиту от double action, не описывая широту.

**Доказательства:** строки 127–128; других механизмов нет.

**Рекомендуемое направление исправления:** сохранить остановку (она нужна), но минимизировать поверхность и задокументировать trade-off; при возможности использовать `preventDefault` + точечный guard. Тестировать с другими расширениями/accessibility.

**Регрессионные риски:** удаление остановки вернёт double toggle (баг v1.0.1). Любое изменение требует Live/VOD/Clips тестов.

---

## 8. Twitch & iframe Compatibility

### [F-22] `pointInFrame` не проверяет границы координат и не учитывает border/rotation

**Приоритет:** Low

**Категория:** Compatibility / Coordinates

**Статус подтверждения:** Confirmed (code); edge

**Местоположение:** `src/content.js:152-163` — `pointInFrame`

**Описание:**

`Number(null) === 0`, `Number('') === 0`; нет проверки `0 <= x <= clientWidth`, поэтому сообщение может адресовать любую точку родителя. Масштаб считается как `rect.width / clientWidth`, но не учитываются `border-left/top` и rotation/skew; для iframe с border/поворотом точка смещается.

**Причина:** минимальная валидация; только scale, без offset/orientation.

**Сценарий воспроизведения:** harness T9: `x=null, y=null` → (0,0) → toggle. Для bordered iframe: `rect.left + x*scale` вместо `rect.left + borderLeft + x*scale`.

**Ожидаемое поведение:** отклонять out-of-viewport координаты; учитывать border/transform или документировать предположение.

**Фактическое поведение:** null/out-of-range принимаются; border/rotation смещают точку.

**Последствия:** buggy extension может переключить не ту точку; bordered/rotated overlay маппится неточно (редко).

**Доказательства:** строки 153–162; harness T9.

**Рекомендуемое направление исправления:** требовать `typeof === 'number'`, finite, `0 <= x < clientWidth`, `0 <= y < clientHeight`; добавить `borderLeft/Top` из `getComputedStyle`; для transforms — `DOMMatrix`/`getBoxQuads` при необходимости. Для обычных Twitch overlay scale-only, вероятно, достаточно.

**Регрессионные риски:** строгие границы могут отбросить клик на самом краю (использовать `<=`); border может изменить текущий маппинг. Тестировать transformed overlay.

---

### [F-23] `about:blank`/`srcdoc` extension-фреймы не получают content script

**Приоритет:** Low

**Категория:** Compatibility / Manifest

**Статус подтверждения:** Potential (не проверено на реальном Twitch)

**Местоположение:** `manifest.json:12-23`

**Описание:**

`content_scripts` имеет `all_frames: true`, но нет `match_about_blank`/`match_origin_as_fallback`. Если Twitch вкладывает extension/supervisor в `about:blank`/`srcdoc` iframe, мост там не инжектится, вложенные клики не ретранслируются.

**Причина:** Chrome не инжектит content scripts в about:blank/srcdoc без явной настройки.

**Сценарий воспроизведения:** требует реальной структуры extension-фреймов Twitch; не проверено.

**Ожидаемое поведение:** мост работает во всех фреймах, через которые ретранслируются клики.

**Фактическое поведение:** скрипт получают только http(s) twitch.tv/ext-twitch.tv фреймы.

**Последствия:** вложенные extension-оверлеи могут не работать, если supervisor — about:blank/srcdoc.

**Доказательства:** manifest lines; Chrome content-script docs.

**Рекомендуемое направление исправления:** если реальный Twitch использует такие фреймы — добавить `match_about_blank: true` и/или `match_origin_as_fallback: true` (проверив security-последствия). Не добавлять без доказательств.

**Регрессионные риски:** инъекция в about:blank может запускать скрипт в неожиданных контекстах; проверить origin-проверки. Это «verify first», не подтверждённый баг.

---

### [F-26] Хрупкие селекторы и дублирование списков исключений

**Приоритет:** Informational

**Категория:** Architecture / Compatibility

**Статус подтверждения:** Potential

**Местоположение:** `src/content.js:11-13` (`PLAYER_SELECTOR`), `31-60` (`IGNORE_SELECTOR`), `195-216` (`isVideoSurfaceOverlay`)

**Описание:**

`PLAYER_SELECTOR` опирается на `.video-player`/`data-a-target="video-player"`; `IGNORE_SELECTOR` использует подстроки классов (`[class*="extensions-dock"]` и т.п.) и широкий список; `isVideoSurfaceOverlay` дублирует подмножество ignore-списка. Twitch меняет class names/разметку; drift селекторов может отключить функцию или misclassify контролы. Расхождение списков привело к F-13.

**Причина:** нет единого source of truth для селекторов; reliance на class substrings.

**Сценарий воспроизведения:** изменение DOM Twitch (не проверено) → селекторы не находят элементы.

**Ожидаемое поведение:** стабильные `data-a-target`/`data-test-selector` где возможно; один общий список исключений.

**Фактическое поведение:** хрупко/дублировано.

**Последствия:** compatibility-регрессии после обновлений Twitch; сложнее поддерживать.

**Доказательства:** строки 11–13, 31–60, 195–216.

**Рекомендуемое направление исправления:** консолидировать селекторы; добавить manual smoke-checklist при изменениях Twitch DOM; предпочитать стабильные атрибуты; документировать.

**Регрессионные риски:** изменение селекторов может сломать текущее поведение; проверять на реальном Twitch.

---

## 9. Security Findings

### [F-15] Нет проверки `event.origin`, границ координат и `detail`; `src`-проверка может устареть

**Приоритет:** Low (Security; нарушает AGENTS.md §1.6)

**Категория:** Security / Validation

**Статус подтверждения:** Confirmed (code); impact Low

**Местоположение:**
- `src/content.js:500-516` — `onExtensionFrameClick`
- `src/content.js:152-163` — `pointInFrame`
- `src/content.js:96-103` — `isExtensionFrame`
- `src/content.js:181-195` — `isDuplicateForwardedClick`

**Описание:**

Обработчик доверяет любому сообщению с ожидаемым `type`, если `event.source` соответствует iframe, у которого `src` host — `ext-twitch.tv`. При этом:

- **не проверяется `event.origin`**;
- **x/y не обязаны быть числами** (`Number(null) === 0`), нет bounds-check;
- **`detail` не валидируется** (2 → fullscreen, огромное число → fullscreen);
- `isExtensionFrame` читает **атрибут `src`**, который не меняется при навигации фрейма; фрейм, ушедший на другой origin, может по-прежнему проходить проверку.

Третьестороннее/скомпрометированное extension может управлять воспроизведением/fullscreen с произвольными координатами. Утечки данных/XSS нет: данные сообщения не вставляются в DOM.

**Причина:** defense-in-depth gaps; `src` attribute ≠ actual origin; `Number(null)===0`; нет bounds/detail validation.

**Сценарий воспроизведения:**

- Harness T8: реальный `https://abc.ext-twitch.tv` iframe отправляет `detail=2` → fullscreen; `evil.example`/`evil-ext-twitch.tv` корректно отклоняются.
- Harness T9: `x=null, y=null` → (0,0) → toggle.
- Фрейм, навигировавший на другой origin, сохраняет старый `src` attribute → сообщение может быть принято.

**Ожидаемое поведение:** проверять `event.origin` (host ∈ ext-twitch.tv), требовать finite numeric coordinates в пределах viewport iframe, принимать только `detail` 1/2, использовать actual frame URL/origin где возможно.

**Фактическое поведение:** произвольные detail/coordinates принимаются от любого ext-twitch.tv фрейма; null → 0,0.

**Последствия:** third-party extension может pause/resume/fullscreen; buggy extension может вызвать unintended toggle. Impact низкий (нет данных/кода), но нарушает §1.6 AGENTS.md.

**Доказательства:** harness T8/T9; строки 502–515, 153–155; статический поиск: `event.origin` отсутствует.

**Рекомендуемое направление исправления:** добавить `event.origin`/host validation; `typeof x === 'number'`, finite, bounds; `detail` 1/2; handshake/nonce per frame; использовать `event.origin` в дополнение к `src`. Сохранить существующую source+iframe проверку.

**Регрессионные риски:** некоторые extension-фреймы могут иметь origin, отличный от `src` (redirects, srcdoc); строгая проверка может сломать их. Тестировать реальные extensions и nested supervisors. Не ослаблять source-check.

---

### [F-21] `postMessage(..., '*')` отправляет координаты клика любому родителю

**Приоритет:** Informational

**Категория:** Security / Privacy

**Статус подтверждения:** Confirmed (code)

**Местоположение:** `src/content.js:165-170` — `postClickToParent`; `520-519`

**Описание:**

Мост отправляет `{type,x,y,detail,id}` в `window.parent` с `targetOrigin = '*'`. Если ext-twitch.tv iframe встроен не-Twitch страницей, эта страница получает координаты клика и id. Данные нечувствительны (относительная позиция клика), а parent может быть cross-origin, поэтому `'*'` практичен; но это широкий target.

**Причина:** origin родителя неизвестен/варьируется; нет allowlist.

**Сценарий воспроизведения:** встроить ext-twitch.tv iframe в тестовую страницу; её message-listener получает данные. Harness T11: `parentMessages[0].origin = '*'`.

**Ожидаемое поведение:** отправлять только доверенному Twitch-родителю, если возможно.

**Фактическое поведение:** любой parent получает данные.

**Последствия:** minor privacy/telemetry leak (координаты клика); нет credentials/данных.

**Доказательства:** строки 166–169; harness T11.

**Рекомендуемое направление исправления:** использовать известный parent origin на Twitch (`https://www.twitch.tv`, `https://player.twitch.tv` и т.п.) или handshake; `'*'` оставить только если origin невозможно узнать. Не включать чувствительные данные.

**Регрессионные риски:** строгий targetOrigin может сломать embedded players/другие Twitch origins; тестировать `www`, `player`, `clips`, embedded.

---

### Security: положительные результаты

- Content script работает в **ISOLATED** world по умолчанию; страница не имеет доступа к его функциям/переменным.
- Нет `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`eval`/`new Function`/`document.write`.
- Нет `fetch`/`XMLHttpRequest`/`WebSocket`/`localStorage`/`sessionStorage`/`chrome.*` API.
- Нет permissions/host_permissions; нет background/service worker; нет удалённого кода.
- Данные `postMessage` не вставляются в DOM; XSS-вектора нет.
- `isExtensionFrame` корректно отклоняет `evil.example`, `evil-ext-twitch.tv`, `ext-twitch.tv.evil.com` (harness T8; логика `endsWith('.ext-twitch.tv')`).
- `event.source` + `frameFromSource` — сильная проверка; сообщение от не-extension iframe отклоняется (harness T8).
- Дедупликация forwarded-кликов работает для повторного id (harness T15).
- Вложенная ретрансляция корректно пересчитывает координаты и сохраняет id (harness T17).

---

## 10. Performance & Memory

### [F-16] `seenForwardedClicks` растёт при flood уникальных id в пределах TTL

**Приоритет:** Low

**Категория:** Performance / Memory

**Статус подтверждения:** Confirmed (logic)

**Местоположение:** `src/content.js:181-195` — `isDuplicateForwardedClick`; `88-90`

**Описание:**

Map очищается только при `size > 100`, и только записи старше `FORWARDED_CLICK_TTL` (2 с). Источник может отправить тысячи уникальных id за 2 с; все останутся, map вырастет до этого количества. Каждое сообщение также вызывает `frameFromSource` (O(iframes)) и `videoAtPoint` (O(videos) + layout), т.е. flood расходует CPU.

**Причина:** нет hard cap/rate limit; очистка по возрасту, не по размеру.

**Сценарий воспроизведения:** harness T16: 600 уникальных сообщений → `map.size = 600`.

**Ожидаемое поведение:** bounded map (cap N, evict oldest) и/или rate limit.

**Фактическое поведение:** неограниченный рост в пределах TTL.

**Последствия:** memory/CPU DoS от скомпрометированного/buggy extension; обычные страницы не затронуты.

**Доказательства:** harness T16 (`size = 600`); строки 189–193.

**Рекомендуемое направление исправления:** cap size + LRU/ring buffer; rate-limit per frame; валидировать координаты до тяжёлой работы.

**Регрессионные риски:** агрессивное eviction может пропустить дубликаты (phantom double click); тестировать nested relay и быстрые клики.

### Performance: положительные результаты / отсутствие подтверждённых проблем

- **Wheel listener:** зарегистрирован как `document.addEventListener('wheel', cancelPlaybackRestore, true)`. По спецификации/MDN `passive` по умолчанию `true` для `wheel` на `Window`/`Document`/`Document.documentElement`/`Document.body`, поэтому listener **не блокирует скролл**. Это не дефект; явное `{ passive: true }` улучшило бы читаемость, но не требуется.
- **Отклонённая гипотеза (F-17, wheel non-passive):** первичная гипотеза о блокировке скролла не подтвердилась — `wheel` на `Document` пассивен по умолчанию (MDN `addEventListener`, раздел «Using passive listeners»). Finding не регистрируется, чтобы не создавать ложное срабатывание.
- **Количество listeners:** 1 click, 1 dblclick, 1 pointerdown, 1 keydown, 1 wheel, 1 message. Нет per-element listeners, нет MutationObserver, нет интервалов.
- **DOM-запросы:** `videoAtPoint` делает `querySelectorAll('video')` + `getBoundingClientRect`/`getComputedStyle` на каждый клик; `isAdPlaying` — `querySelectorAll(AD_SELECTOR)` + стили. Клики невысокочастотны; подтверждённой заметной нагрузки нет. Потенциальная оптимизация — ранний выход по `event.target`/координатам, но без измерений это не приоритет.
- **Таймеры:** pending (1) + cleanup (1) + restore (5) + fullscreen fallback (1) на действие; ограничены, очищаются/проверяются по токену. Утечек нет; при частых double click таймеры живут максимум ~1 с.
- **Map/Set:** `seenForwardedClicks` — единственный растущий Map (F-16); `forwardedClickSequence`/`playbackRestoreToken` — числа.
- **Память:** ссылки на video в `pendingClick`/restore живут ≤1 с; при удалении видео — до срабатывания таймера; незначительно.

---

## 11. Edge Cases

### 11.1. Покрытие обязательных сценариев из задания

| # | Сценарий | Где рассмотрен | Вывод |
|---|---|---|---|
| 1 | Одиночный клик по видео | F-01, F-11 | Нормальный путь работает; stale pending/disabled button — риски |
| 2 | Двойной клик по видео | F-03, F-06, F-07, F-10 | Нормальный путь работает; cross-video/fullscreen/async — дефекты |
| 3 | Тройной клик | F-11 | Fullscreen toggle дважды |
| 1 | Два быстрых последовательных клика | F-01, F-12, T11 | Pending/controls/cross-source — дефекты |
| 5 | Медленный двойной клик | F-03, F-10 | Restore state/async — риски |
| 6 | Клик непосредственно перед истечением таймера | F-01, T1 | Pending срабатывает после действия пользователя |
| 7 | Клик во время выполнения отложенной операции | F-01, F-12 | Pending не инвалидируется/отменяется |
| 8 | Новый клик до завершения предыдущей операции | F-01, F-12 | Глобальный pending-слот конфликтует |
| 9 | Клик при переключении fullscreen | F-06, F-07 | Theater/Esc fallback — дефекты |
| 10 | Клик по видео в момент его замены | F-03, F-01, F-05 | Stale identity/fallback — дефекты |

### 11.2. Дополнительные edge cases

Ниже — дополнительные сценарии, которые не оформлены как отдельные findings (нет достаточных доказательств или impact низкий), но должны быть учтены при исправлениях.

| Сценарий | Наблюдение / риск | Статус |
|---|---|---|
| Video ещё не загрузилось (`readyState` 0) | `togglePlayback` может нажать disabled-кнопку/`play()` reject; клик потерян (F-11) | Potential |
| Video уже удалено | Pending/restore может уйти в fallback на другое видео (F-01/F-05) | Confirmed logic |
| Video заменено во время клика | `previous.video !== video` → cross-video state (F-03) | Likely |
| Плеер скрыт (`display:none`) | `videoAtPoint` отбрасывает по rect/style; restore может toggle скрытое connected video (F-05) | Potential |
| Вкладка неактивна | `setTimeout` throttling: pending/restore может сработать позже, при возврате; restore token не отменён | Potential |
| Навигация во время клика | pending может переключить новый плеер (F-01) | Confirmed logic |
| Клик во время fullscreen transition | `isPlayerExpanded`/fallback race (F-06/F-07) | Likely |
| Fullscreen API reject | Проглатывается; клик не ломает playback | OK (by design) |
| `video.play()` reject (autoplay policy) | Проглатывается; клик может быть потерян; restore повторяет попытки | Potential |
| Несколько postMessage почти одновременно | Дедупликация по id; flood растит map/CPU (F-16) | Confirmed logic |
| iframe удалён до обработки | `frameFromSource`/`pointInFrame` вернут null → сообщение отброшено | OK |
| Вложенность iframe изменилась | Координаты/ретрансляция могут быть неверны; id дедуплицируется | Potential |
| Координаты отсутствуют/некорректны | `null → 0,0`, нет bounds-check (F-15/F-22) | Confirmed code |
| Видеоплеер временно недоступен | `findPlayerButton` fallback может нажать чужую кнопку (F-08) | Confirmed logic |
| Пользователь взаимодействует с рекламой | `isAdPlaying` best-effort; может miss/false positive (F-09) | Potential |
| Twitch изменил DOM | Селекторы могут не найти player/controls (F-26) | Potential |
| Один из штатных контролов отсутствует | Fallback на global button/Media API; cross-player риск (F-08/F-11) | Confirmed logic |
| Клик по `<iframe>` border внутри player | `shouldIgnore(iframe)` false → toggle; клик по самому iframe-border может переключить видео | Low/Potential |
| Клик по не-семантическому popover внутри player | `player.contains(topmost)` true → toggle + stop propagation; меню/поповер может не сработать | Low/Potential |
| `elementFromPoint` возвращает null | `isExposedAtPoint` возвращает true (permissive); клик может быть обработан | Low |
| Видео с `opacity:0`/скрытое, но connected | `isVisible` не проверяет opacity; restore может toggle невидимое видео | Low |
| iframe с border/rotation | `pointInFrame` смещает координаты (F-22) | Confirmed code |
| `srcdoc`/`about:blank` supervisor | Мост не инжектится (F-23) | Potential |
| Shadow DOM player/video | `document.querySelectorAll` не видит внутри shadow root; функция не работает | Low/Potential |
| Другой content script/расширение | `stopImmediatePropagation` блокирует click (F-20) | Potential |
| Keyboard focus/click handlers Twitch | Click propagation остановлен; pointerdown/mousedown не остановлены, focus может работать | Potential |
| Touch/double-tap | `dblclick` может не приходить; threshold может сработать; double-tap zoom | Unverified |
| Мобильный/встроенный плеер | Не проверялось; `player.twitch.tv` матчится | Unverified |
| Несколько видео, mini-player | Cross-video state/pending/button fallback (F-03/F-08/F-12) | Confirmed logic |
| Реклама в отдельном `<video>` | `isAdPlaying` может не найти ad-элемент; toggle рекламы | Potential |

---

## 12. Code Quality

**Общие наблюдения:** неиспользуемых функций не обнаружено — все helpers (`rectsOverlap`, `isVisible`, `playerElement`, `frameFromSource`, `pointInFrame` и т.д.) вызываются. Дублирование логики присутствует в двух местах: (а) `isVideoSurfaceOverlay` дублирует подмножество `IGNORE_SELECTOR` (F-13/F-26); (б) `activeVideo` в `applyPlaybackState` и `target` в `toggleFullscreen` дублируют один и тот же опасный fallback (F-05). Самая сложная функция — `handleVideoClick` (ветвление single/double, таймеры, restore); она заслуживает unit-тестов (F-25). Названия в целом понятные; скрытая зависимость — `clickingNativeButton` связывает `clickNativeButton` и `onClick` через глобальный флаг (работает синхронно, но неочевидна).

### [F-21] Документация и комментарии расходятся с реализацией

**Приоритет:** Low

**Категория:** Documentation

**Статус подтверждения:** Confirmed

**Местоположение:**
- `README.md:11,31`, `README.en.md:11,31`
- `src/content.js:168-169` — комментарий `isAdPlaying`
- `src/content.js:250-251` — комментарий `findPlayerButton`
- `src/content.js:336-338` — комментарий `cancelPlaybackRestore`
- `README.md:58-73`, `README.en.md:58-73` — структура проекта

**Описание:**

- README утверждает, что клики по «buttons and other interactive elements» расширения игнорируются; для div/canvas это неверно (F-02).
- README не упоминает 100 мс задержку и её взаимодействие с контролами (F-01).
- README-структура не включает `AGENTS.md`/`opencode.json` (мелочь).
- Комментарий `isAdPlaying` («Only an ad element drawn over the video counts») вводит в заблуждение: код считает любое пересечение с rect видео, а не точку клика (F-09).
- Комментарий `findPlayerButton` («so a second player on the page is never touched») неверен для single-visible-match fallback (F-08).
- Комментарий `cancelPlaybackRestore` («Any other interaction ... means the user took over») неверен для `pendingClick` (F-01).

**Причина:** документация описывает намерение, а не фактические edge cases.

**Сценарий воспроизведения:** сравнение README/комментариев с кодом.

**Ожидаемое поведение:** документация и комментарии отражают реальное поведение и ограничения.

**Фактическое поведение:** завышенные гарантии; вводящие в заблуждение комментарии.

**Последствия:** пользователи/разработчики доверяют неверному поведению; поддержка усложняется.

**Доказательства:** цитаты строк; harness T1/T11.

**Рекомендуемое направление исправления:** обновить оба README (ограничение overlay-семантики, 100 мс, best-effort ads, multi-player), исправить комментарии.

**Регрессионные риски:** нет (только docs).

---

### [F-25] Нет автоматических тестов для state-machine

**Приоритет:** Informational

**Категория:** Code Quality / Testing

**Статус подтверждения:** Confirmed (no test infrastructure)

**Местоположение:** корень репозитория; нет `package.json`, нет tests.

**Описание:**

Машина состояний (`pendingClick`, `playbackRestoreToken`, `clickingNativeButton`, `seenForwardedClicks`, таймеры) не покрыта автотестами. Аудит использовал внешний vm-harness; в репозитории нет test-команды. Баги F-01–F-12 — именно те, которые ловятся unit-тестами с fake timers.

**Причина:** минималистичный проект, нет test setup (по AGENTS.md это допустимо, но риск высок).

**Сценарий воспроизведения:** `Get-ChildItem` — нет tests/package.json; `node --check` — только синтаксис.

**Ожидаемое поведение:** хотя бы лёгкий harness для pure state machine (без браузера) или документированная manual-матрица.

**Фактическое поведение:** тестов нет.

**Последствия:** регрессии вероятны; изменения v1.1.0 трудно проверять.

**Доказательства:** структура репозитория; AGENTS.md §5.3.

**Рекомендуемое направление исправления:** добавить маленький Node-harness (fake timers + mock DOM) для state machine; без сборщика/зависимостей; либо manual-матрицу.

**Регрессионные риски:** нет (additive); сохранить dependency-free.

---

### F-26 — сводка по качеству кода (детали в разделе 8)

Полное описание F-26 находится в разделе 8; здесь краткое резюме по качеству кода.

- `PLAYER_SELECTOR`, `IGNORE_SELECTOR`, rescue-список `isVideoSurfaceOverlay` — три источника правды, которые расходятся.
- Class-substring селекторы (`[class*="extensions-dock"]`) хрупки к переименованиям.
- `activeVideo`/`toggleFullscreen` дублируют один и тот же опасный fallback.
- `findPlayerButton`/`togglePlayback`/`applyPlaybackState` переплетены; отсутствие явной state machine затрудняет проверку.
- Комментарии местами описывают намерение, а не код (F-21).

**Направление:** консолидировать селекторы, вынести общий helper для «того же плеера/видео», добавить smoke-checklist при изменениях Twitch DOM. Не делать масштабный рефакторинг без необходимости.

---

## 13. Verification Results

### 13.1. Автоматические/статические проверки

| Проверка | Команда/способ | Результат |
|---|---|---|
| JS syntax | `node --check src/content.js` | **OK**, exit 0 |
| Manifest JSON | `Get-Content manifest.json -Raw \| ConvertFrom-Json` | **OK** |
| Manifest MV3 | Ручная проверка полей | `manifest_version: 3`, `all_frames: true`, `run_at: document_start`, paths корректны |
| Icons | `System.Drawing.Image` | `16×16`, `32×32`, `18×18`, `128×128`, PNG |
| Release ZIP ↔ source | SHA256 `src/content.js` | **MATCH** (`0DBCFC1D…F951`) |
| Release ZIP ↔ manifest | SHA256 `manifest.json` | **MATCH** (`EB9E0E7D…6371`) |
| Line endings | byte scan | `CRLF=0`, `LF-only=569`; соответствует `.gitattributes` |
| Dangerous APIs | grep | Нет `innerHTML`/`eval`/`fetch`/`XHR`/`storage`/`chrome.*` |
| Security primitives | grep | Нет `event.origin`, `isTrusted`, `disabled`, `readyState`, `passive` |
| Git state | `git status --short` | Только pre-existing untracked `AGENTS.md`, `opencode.json`; исходники не изменены |
| Git tags | `git tag -l` | `v1.0.0`–`v1.1.0` |
| Harness | `node %TEMP%\opencode\audit-harness.js` | 21 сценарий; результаты ниже |

### 13.2. Внешний harness (реальный `content.js`, mock DOM + fake timers)

Harness загружает **фактический** `src/content.js` в Node `vm`, подменяет DOM/таймеры/iframe и воспроизводит сценарии. Он подтверждает код-пути и переходы состояний, но **не** является реальным браузером/Twitch.

| ID | Сценарий | Результат |
|---|---|---|
| T1 | Клик по видео → нативная пауза в течение 100 мс | **BUG confirmed:** пауза отменяется pending-кликом |
| T2 | Triple click | **BUG confirmed:** fullscreen toggle дважды |
| T3 | Double click по другому видео | **BUG confirmed:** состояние A применяется к B |
| T1 | Маленький ad-элемент пересекает видео, клик в центре | **BUG confirmed:** клик игнорируется |
| T5 | Удаление плеера до pending | **BUG confirmed:** переключается новый плеер |
| T6 | Удаление видео до restore | **BUG confirmed:** restore переключает чужое видео |
| T7 | Плеер ≥95% viewport, не fullscreen | **BUG confirmed:** вход+выход fullscreen |
| T8 | postMessage от evil/lookalike/ext frame, `detail=2` | Evil/lookalike отклонены; **ext frame форсирует fullscreen** |
| T9 | `x=null, y=null` | **BUG confirmed:** (0,0), toggle |
| T10 | Registration options | click/dblclick/pointerdown/keydown/wheel на document; message на window |
| T11 | Клик по DIV в extension iframe | **BUG confirmed:** forwarded; по BUTTON — нет |
| T12 | Клик по видео → Space | **BUG confirmed:** pending возобновляет видео |
| T13 | Клик по видео под модальным окном | **OK:** игнорируется |
| T11 | Клик по видео + клик по overlay в течение 100 мс | **BUG confirmed:** overlay-клик трактуется как double |
| T15 | Повторный forwarded id | **OK:** дедуплицируется |
| T16 | 600 уникальных forwarded id | **BUG confirmed:** map size 600 |
| T17 | Вложенная ретрансляция | **OK:** координаты (300,150), id сохранён |
| T18 | Modeled async native toggle + double click | **BUG (modeled):** видео остаётся на паузе |
| T19 | Esc до fullscreen-fallback | **BUG confirmed:** fallback снова входит в fullscreen |
| T20 | У плеера A нет кнопки, у B одна | **BUG confirmed:** нажимается кнопка B |
| T21 | Два одиночных клика по разным видео | **BUG confirmed:** клик по A отменён |

### 13.3. Что проверено вручную

- Полный code-path review всех функций и state-переходов.
- Сверка README/README.en.md с кодом.
- Сверка AGENTS.md §1.1–§1.7 с реализацией.
- Git history: изменения v1.1.0 (extension bridge), v1.0.2 (false pauses/double click), v1.0.1 (double toggle).
- Release ZIP: побайтовое соответствие source/manifest.

### 13.1. Что не запускалось

- Реальный Chrome с расширением на Twitch (нет браузерной тестовой инфраструктуры; не добавлялась).
- Playwright/ Puppeteer (не установлены; установка запрещена условиями аудита).
- ESLint/статический анализатор (не установлены; использован `node --check` + grep).
- Chrome Web Store validation (нет инструмента).
- Unit/integration tests (их нет в проекте).

---

## 11. Unverified Areas

Следующие области **не проверены** и не должны считаться подтверждёнными:

1. **Реальный DOM Twitch:** `PLAYER_SELECTOR`, `IGNORE_SELECTOR`, `AD_SELECTOR`, `MODAL_SELECTOR`, class-substrings. Возможны drift/переименования.
2. **Реальный event timing Twitch:** порядок capture/bubble, React delegation, синхронность native button, поведение `video.paused` (F-10).
3. **Theater mode:** фактический rect плеера на разных экранах/разрешениях (F-06).
1. **Реклама:** реальная разметка pre-roll/mid-roll, расположение countdown, persistent ad-элементы (F-09).
5. **Extension supervisor:** реальная структура `ext-twitch.tv` фреймов, наличие `about:blank`/`srcdoc`, origin/redirects (F-15/F-23).
6. **Fullscreen API:** реальное поведение promise/rejection, `fullscreenchange`, `Esc`, iframe `allowfullscreen`.
7. **Autoplay policy:** `video.play()` rejection после 100–1000 мс, transient activation, background tab throttling.
8. **Multi-player:** main + mini, несколько `<video>`, скрытые/preview-видео (F-03/F-05/F-08/F-12).
9. **SPA navigation:** точное время удаления/создания плеера, route changes без pointerdown (F-01/F-05).
10. **Другие расширения/accessibility:** влияние `stopImmediatePropagation` (F-20).
11. **Touch/mobile:** double-tap, `dblclick`, zoom.
12. **Другие браузеры:** проект Chrome-only; Firefox/Safari не проверялись.
13. **Chrome Web Store:** политика/ревью, поведение `description`/permissions.
11. **`detail` cross-target:** сбрасывается ли click count при смене target в конкретной версии Chrome/OS (F-03).
15. **Реальные extension-UI:** Hearthstone Deck Tracker, polls, games, canvas (F-02).

---

## 15. Recommended Fix Order

Порядок учитывает impact, вероятность и связи между дефектами. Не начинать масштабный рефакторинг; исправлять по одному с проверкой.

1. **F-01 — инвалидация `pendingClick` при новом действии пользователя.**
   Самый высокий пользовательский impact и фундамент для F-03/F-12. Нужен аккуратный дизайн, чтобы не сломать slow-double-click restore.

2. **F-02 — семантика extension-моста.**
   Определить pass-through контракт (фон vs интерактив), обновить README. Это headline-функция v1.1.0; без исправления она опасна для div/canvas-расширений.

3. **F-03, F-01, F-05 — identity/staleness видео.**
   Единая проверка «то же видео/плеер»: `previous.video === video`, `document.contains(video)`, никаких `document.querySelector('video')` fallback. Это устранит cross-video state, stale pending и restore на чужое видео.

1. **F-06, F-07, F-08 — fullscreen и ownership кнопок.**
   Решение по `document.fullscreenElement`, отмена fallback на `Esc`/`fullscreenchange`, ownership check для `findPlayerButton` + media-API fallback.

5. **F-09, F-10 — ad-детект и async state.**
   Проверка точки клика для ad; event-based/ожидаемое состояние для restore. Тестировать с рекламой и перерисовкой.

6. **F-11, F-12, F-13, F-11 — edge logic.**
   `detail === 2`, per-video pending, rescue только play overlay, disabled-button fallback.

7. **F-15, F-16 — security/rate limit.**
   `event.origin`, bounds, detail 1/2, bounded dedup map. Не ослаблять существующие проверки.

8. **F-18–F-23 — hardening/edge.**
   `isTrusted`, dblclick flag, документирование `stopImmediatePropagation`, `targetOrigin`, border/bounds, about:blank (verify first).

9. **F-21, F-25, F-26 — docs/tests/architecture.**
   Обновить README/комментарии, добавить лёгкий state-machine harness, консолидировать селекторы.

**Общий совет:** F-01/F-03/F-12 указывают на то, что `pendingClick` — глобальный одиночный слот. Прежде чем добавлять новые эвристики, рассмотреть минимальную явную модель: per-video pending + идентичность video + явные состояния (idle/pending/restore). Это не «большой рефакторинг», а снижение сложности и тестируемости. Однако сохранять простоту проекта: без фреймворков/сборщика.

---

## 16. Final Assessment

**Сильные стороны:**

- Компактный, читаемый Vanilla JS; нет лишних зависимостей/сборщика.
- Хорошая security-гигиена: isolated world, нет permissions/network/remote code/`innerHTML`.
- Продуманный обычный путь: native button приоритетна, есть media-API fallback, защита от synthetic click, дедупликация forwarded-кликов, обработка модальных окон и big play overlay.
- Manifest MV3 корректен; release ZIP побайтово соответствует исходникам; иконки валидны.
- SPA-подход через document-level listeners минимален и устойчив к перерисовкам (но state может устаревать — F-01/F-05).

**Слабые стороны:**

- Машина состояний (`pendingClick`, restore token, fullscreen fallback) имеет подтверждённые логические дефекты; F-01 особенно заметен в обычном взаимодействии.
- Extension-мост v1.1.0 не различает фон и div/canvas-интерактив; README обещает больше, чем реализовано.
- Несколько fallback-ов используют «первое видео/единственную кнопку», что может управлять чужим плеером.
- Нет автотестов; сложные state-переходы проверяются только вручную.
- Часть security-инвариантов AGENTS.md §1.6 (origin/bounds/detail) не реализована, хотя impact низкий.

**Итог:**

Проект **не находится в состоянии «полностью сломан»**: базовый сценарий «клик — пауза, двойной клик — fullscreen» работает в обычных условиях. Но заявлять о «надёжности» и «полной поддержке extension-оверлеев» преждевременно. Рекомендуется сначала устранить **F-01** и **F-02**, затем группу **F-03/F-01/F-05** (identity/staleness), затем fullscreen/ownership (**F-06/F-07/F-08**). После этого — добавить лёгкий state-machine harness (F-25), чтобы зафиксировать поведение и предотвратить регрессии.

**Готовность:** аудит завершён; исходный код не изменялся. Исправления — отдельная задача после рассмотрения отчёта.

---

*Отчёт подготовлен на основе статического анализа, git history, release-артефакта и внешнего vm-harness с mock DOM. Реальное тестирование в Chrome на Twitch не проводилось; см. раздел 11 «Unverified Areas».*

---

## 17. Post-Audit Fix Status (2026-11-12)

Первоначальные результаты аудита выше **не переписаны**. Актуальные статусы исправлений ведутся в `FIX_PROGRESS.md`; ниже — краткая сводка.

| ID | Итоговый статус | Комментарий |
|---|---|---|
| F-01 | Verified | Pending click per video + cancellation on controls/keys/extension controls |
| F-02 | Verified | Background-only pass-through + cancel message |
| F-03 | Verified | Per-video identity/restore |
| F-01 | Verified | Connectivity + URL identity; source-only changes are ignored to preserve reconnect/fullscreen restore |
| F-05 | Verified | No unrelated-video fallback |
| F-06 | Verified | Actual fullscreen state; real Twitch theater/full-window behavior documented |
| F-07 | Verified | fullscreenchange/Esc token |
| F-08 | Verified | Button ownership |
| F-09 | Blocked | No real ad insertion observed; conservative detection retained; manual ad test required |
| F-10 | Verified | Async restore retry guard (real Twitch timing unverified) |
| F-11 | Verified | detail >2 ignored |
| F-12 | Verified | Per-video pending map |
| F-13 | Verified | Content-gate exclusions |
| F-11 | Verified | Disabled button fallback |
| F-15 | Verified | Origin/source/coords/detail validation |
| F-16 | Verified | Bounded dedup map |
| F-18 | Verified | isTrusted checks |
| F-19 | Verified | Handled-pair dblclick swallow |
| F-20 | Won't Fix | Intentional stopImmediatePropagation |
| F-21 | Verified | Concrete targetOrigin via `location.ancestorOrigins`; `'*'` fallback only |
| F-22 | Verified | Bounds + border/padding mapping; rotation/skew remains out of scope |
| F-23 | Blocked | Real supervisor/nested frames are https ext-twitch.tv; no about:blank/srcdoc observed |
| F-24 | Verified | READMEs and comments updated |
| F-25 | Verified | `tests/content.test.js`: 48 Node built-in tests, no dependencies |
| F-26 | Partially addressed | Real player/controls/chat selectors verified; F-13/F-08 reduced divergence; no broad refactor |
| F-27 | Verified | Second double-click fullscreen exit fixed (window-capture swallow, synthetic overlay dblclick suppression); real Chrome focused probe PASS |

**Итог:** 22 Verified, 1 Won't Fix (F-20), 2 Blocked (F-09, F-23), 1 Partially addressed (F-26). Подробности, команды и остаточные риски — в `FIX_PROGRESS.md`.

**Real-browser smoke:** Google Chrome for Testing 157.0.8103.78: 25 PASS + 1 BLOCKED, 0 FAIL; branded Google Chrome 157.0.8103.79 (extension loaded via CDP `Extensions.loadUnpacked`): 22 PASS + 4 BLOCKED, 0 FAIL. Live/VOD/clip/SPA/fullscreen/theater/native controls/chat/extension overlay/nested iframe tested. Real fullscreen exit was verified in focused probes on both browsers. Branded Chrome ignores `--load-extension`, but the CDP load works. Remaining manual-only scenarios are listed in `BROWSER_TEST_REPORT.md` §9. Full details: `BROWSER_TEST_REPORT.md`.
