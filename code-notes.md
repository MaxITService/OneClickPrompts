# Code Notes

Current architectural reference for the OneClickPrompts Chrome extension (Manifest V3, ES modules). The document keeps only present-tense details; no history.

## 1. Project Overview
- **Purpose**: Inject configurable prompt buttons and auxiliary UI into supported AI chat interfaces (ChatGPT, Claude, Copilot, DeepSeek, AI Studio, Grok, Gemini).
- **Interaction modes**: Inline toolbar rendered inside the target editor and a floating panel with queue automation.
- **Repo layout**: Core scripts in root, feature folders (`popup-page-scripts/`, `per-website-button-clicking-mechanics/`, `floating-panel-files/`, `modules/`, `common-ui-elements/`), assets (`icon*.png`, `Full_logo.png`, `Promo/`), onboarding (`welcome-page-files/`).

## 2. Architecture & Runtime Flow

### 2.1 Service Worker & Storage (config.js + modules)
- **`config.js`** (118 lines) - Refactored entry point runs as the single messaging hub and lifecycle handler (install/activate, welcome page launch, default profile creation via `default-config.json`). Imports `context-menu.js` to register the "Open Welcome page" action on extension icon right-click. Delegates all message handling to modular architecture while maintaining identical external API.
- **Modular Architecture** (refactored for maintainability):
  - **`modules/service-worker-config-helpers.js`** (40 lines) - Utility functions: `logConfigurationRelatedStuff()` for [config] prefixed logging, `handleStorageError()` for storage quota error handling, `loadDefaultConfig()` for loading default-config.json.
  - **`modules/service-worker-profile-manager.js`** (255 lines) - Profile CRUD operations: `createDefaultProfile()`, `getCurrentProfileConfig()`, `saveProfileConfig()`, `loadProfileConfig()`, `switchProfile()`, `broadcastProfileChange()`, `listProfiles()`, `deleteProfile()`, `areProfileConfigsEqual()`, plus `normalizeProfileConfig()` for backward compatibility (adds default queue/button properties).
  - **`modules/service-worker-message-router.js`** (518 lines) - Message routing switch statement handling 30+ message types. Exports `handleMessage(request, sender, sendResponse)` which processes all `chrome.runtime.onMessage` calls.
- **Exposes `chrome.runtime.onMessage` APIs** for profile lifecycle (`getConfig`, `saveConfig`, `switchProfile`, `listProfiles`, `deleteProfile`, `createDefaultProfile`), UI preferences (`getTheme`, `setTheme`, `getUiPopupState`, `setUiPopupState`), module state (`getCrossChatModuleSettings`, `saveCrossChatModuleSettings`, `getStoredPrompt`, `clearStoredPrompt`, `getInlineProfileSelectorSettings`, `saveInlineProfileSelectorSettings`, `getTokenApproximatorSettings`, `saveTokenApproximatorSettings`), floating panel state (`getFloatingPanelHostnames`, `resetFloatingPanelSettings`, `resetFloatingPanelSettingsForHostname`, `saveFloatingPanelSettings`, `getFloatingPanelSettings`), advanced selectors (`getCustomSelectors`, `saveCustomSelectors`, `resetAdvancedSelectors`), cross-chat broadcast (`triggerDangerCrossChatSend`), and misc utilities (`openSettingsPage` to launch `popup.html?isTab=true`, `clearStorage`).
- **Integration patterns**:
  - Popup scripts debounce saves (`debouncedSaveCurrentProfile`) and treat the worker as source of truth when switching profiles.
  - Floating panel settings are written back so host-specific layouts persist; broadcast events (e.g., `floatingPanelChanged`) trigger reconciles in active tabs.
  - Content scripts cache configuration (`window.globalMaxExtensionConfig`) and listen for worker broadcasts to call `__OCP_partialRefreshUI` or `__OCP_nukeAndRefresh`.
  - Cross-chat, inline selector, token approximator, and other modules use shared endpoints so settings survive regardless of which surface initiates the change.
  - Message flow: Content/Popup → `chrome.runtime.sendMessage({type})` → `config.js` listener → `modules/service-worker-message-router.js` (switch) → profile-manager/StateStore/helpers → `sendResponse()`.
- **StateStore** (`modules/service-worker-auxiliary-state-store.js`):
  - Namespaced schema (`ui`, `modules`, `floatingPanel`, `global`, `meta`) with dual read/write to legacy keys. Provides methods for theme, popup state, cross-chat data, inline selector, token approximator (including per-site `enabledSites`), floating panel settings, custom selectors, and debug flags.
  - Broadcasts change payloads through `StateStore.broadcast()` (wraps `chrome.tabs.sendMessage`) so tabs refresh automatically.
  - Logging policy: use `logConCgp` (from `log.js`) everywhere outside the worker; inside the worker `logConfigurationRelatedStuff` (from service-worker-config-helpers.js) tags lifecycle messages.
- **Backward Compatibility**: External API unchanged (all message types, requests, responses identical). Zero changes required in content scripts, popup, or other components. Refactoring is purely internal code organization.

### 2.2 Profiles & Default Bootstrap
- **`default-config.json`** seeds the “Default” profile with queue disabled, 5-minute delay (with equivalent seconds value), randomization off, queue toggles false, curated button list (including magic Settings button `%OCP_APP_SETTINGS_SYSTEM_BUTTON%`, separators, translation/summarization/emotion toggles), and global toggles (`globalAutoSendEnabled`, `enableShortcuts`).
- **`createDefaultProfile()`** loads this JSON via `loadDefaultConfig()`, persists it under `profiles.Default`, and sets `currentProfile`. Install fails fast if the JSON cannot be fetched.

### 2.3 Content Script Director (`init.js`)
- Acts as the SPA coordinator: pulls configuration from the worker, stores it on `window.globalMaxExtensionConfig`, detects the active site via `InjectionTargetsOnWebsite`, and decides whether to render inline buttons, floating panel, or both.
- Provides global refresh helpers (`__OCP_partialRefreshUI`, `__OCP_nukeAndRefresh`) that distinguish between panel-present and inline-only scenarios; site-specific modules call these when profiles change.
- Watches SPA navigation through MutationObserver plus history API patch, dispatching `ocp-page-navigated`. Debounces reinitialization to avoid thrashing on rapid route changes.
- Manages keyboard shortcuts (Alt+1‒0) with idempotent listener registration and respects the `enableShortcuts` flag.
- Cleans up resiliency timers and observers before re-running `publicStaticVoidMain()` to prevent duplicates.

### 2.4 Selector Auto-Detection System
- **Purpose**: Robustly handle DOM structure changes on AI websites by decoupling site scripts from direct DOM queries and implementing self-healing capabilities.
- **`modules/selector-auto-detector/index.js`** ("The Brain"): Manages detection state, tracks failure counts/cooldowns, orchestrates the recovery workflow (Failure -> Wait -> Heuristics -> Notify), and persists new selectors.
- **`modules/selector-auto-detector/selector-guard.js`** ("The Guard"): Adapter that replaces direct `document.querySelector` calls. Wraps lookups in a Promise, reporting success/failure to the Brain.
- **`modules/selector-auto-detector/base-heuristics.js`**: Contains logic to "guess" new selectors when known ones fail (currently a stub).
- **Integration**: Site-specific scripts (e.g., `buttons-clicking-grok.js`) use `SelectorGuard.findEditor()` and `findSendButton()` instead of direct queries.

## 3. UI Surfaces

### 3.1 Inline Toolbar & Buttons
- **`buttons-init-and-render.js`**: orchestrates container creation and rendering order (floating panel toggle, inline profile selector, cross-chat buttons, custom buttons, toggles). `createAndInsertCustomElements` reuses/moves existing containers (based on `InjectionTargetsOnWebsite.selectors.buttonsContainerId`) to avoid duplication; inline profile selector suppresses hostile SPA listeners, adapts to dark theme, and calls `switchProfile` with `origin` hints so responses are routed to `__OCP_partialRefreshUI`. Custom dropdown builder `createUnifiedProfileSelector` now powers the inline selector for all sites, with optional overrides for Perplexity-level z-index/pointer tweaks and consistent keyboard accessibility.
- **`buttons.js`**: builds button elements (`createCustomSendButton`, `createCrossChatButton`) with autosend/shortcut tooltips, handles Shift inversion, integrates queue mode by re-enqueuing when the panel is active, and routes clicks to per-site handlers. `determineShortcutKeyForButtonIndex` skips separators and respects cross-chat offset to keep Alt+n hints correct.
- **`buttons-injection.js`**: waits for container selectors, loads toggle states from `localStorage`, injects once, marks the tab as `__OCP_inlineHealthy`, and runs an adaptive watchdog (with pause on panel toggling, MutationObserver fallback for 2 hours) to reinject on SPA wipes. Prevents manual toggles from fighting with resiliency loops through `window.OneClickPrompts_isTogglingPanel`.
- **`interface.js`**: exposes reusable toggle builder and local toggle persistence (autosend, hotkeys, queue mode).
- **`utils.js`**: supplies DOM helpers such as `waitForElements`, `simulateClick`, `insertTextIntoEditor`, `moveCursorToEnd`, separator creation, and paste simulation—used by injection scripts and site handlers to normalize editor interaction across frameworks.
- **Profile Update Retry Mechanism**: handles transient config unavailability during UI updates with exponential backoff retries (limited to 5 attempts per origin), separate state tracking for inline vs panel refreshes, and adaptive selector reinitialization for missing container references. Creates resilience without blocking the UI during async config loading delays, prevents infinite retry loops through bounded attempts, maintains independence between inline/panel update surfaces to avoid cross-contamination, and integrates seamlessly with existing `__OCP_partialRefreshUI` flow to preserve panel state and SPA compatibility.
- **Cross-chat runtime**:
  - Buttons (`buttons.js`) render Copy/Paste icons with autosend hints; Copy reads the active editor, saves text via `saveStoredPrompt`, flashes tooltips, and mirrors state in StateStore; Paste retrieves cached prompt with hover previews.
  - Service worker mirrors legacy keys (`crossChatModuleSettings`, `crossChatStoredPrompt`) and broadcasts updates through `StateStore.broadcast()` so inline, panel, and popup stay consistent.
- **Inline profile selector module** (`modules/popup-page-modules-inlineSelector.js`): Popup component fires on `DOMContentLoaded`, syncs state via worker, observes collapsible expansion, and ensures the selector stops hostile event propagation while emitting `switchProfile` with `origin` hints.
- **Window helpers**: `popup-page-script.js` surfaces `window.showToast`, `window.resizeVerticalTextarea`, and `window.updatebuttonCardsList` for nested modules to reuse.
- **Site-specific send handlers** (`per-website-button-clicking-mechanics/*`):
  - **ChatGPT**: collapses selector lists to find the editor, bulk inserts text (textarea vs contenteditable), waits for send buttons via promise-based observer, and runs autosend through interval polling.
  - **Claude**: distinguishes between ProseMirror and standard contenteditable, clears placeholders, inserts text via `execCommand`, and observes send buttons with capped retries.
  - **Copilot**: writes through the native value setter for React-controlled textareas, restores caret position, and polls for send button (autosend only).
  - **DeepSeek**: scans visible editors, handles textareas/contenteditables with manual range insertion, filters disabled send buttons (SVG detection), and performs adaptive autosend retries.
  - **AI Studio**: appends text to Angular-backed textarea, dispatches `input`/`change`, resets caret, and triggers send with a slight delay.
  - **Grok**: mixes bulk insertion with simulated keystrokes to trigger auto-resize, includes delays for short prompts, and autosend loops for up to 5 seconds.
  - **Gemini**: targets Quill editor, rewrites content into `<p>` blocks, dispatches composed `input` events for Angular/Quill recognition, and polls until the `aria-disabled` attribute clears before clicking.

### 3.2 Floating Panel
- **`floating-panel.js`**: establishes namespace with panel references, visibility flags, default settings, queue storage, and global flags (`acceptedQueueTOS`).
- **`floating-panel-ui-creation.js`**: builds panel DOM from `floating-panel-files/` template, wires transparency slider, header/footer collapse controls, profile switcher, queue toggle placement, and ensures inline/floating toggles coexist.
- **`floating-panel-ui-interaction.js`**: toggles panel visibility, synchronizes inline vs panel button containers, persists `isVisible`, clamps positions, restores header/footer collapse states, and handles footer collapse logic.
- **`floating-panel-settings.js`**: loads/saves per-host settings via the service worker, debounces writes, manages profile switching (with origin `panel` to limit refresh scope), and orchestrates initialization (`createFloatingPanel`, `loadPanelSettings`, `loadAvailableProfiles`).
- **Queue UI (`floating-panel-ui-queue.js`)**:
  - Connects DOM controls (play/pause/skip/reset buttons, delay inputs, random-delay badge, automation toggles) to `globalMaxExtensionConfig`.
  - Enforces queue TOS acceptance, updates progress bar width, synchronizes random delay status (🎲 vs 🚫🎲 with detailed tooltip including last sample), and provides helper hooks like `recalculateRunningTimer()` to recompute timers after delay adjustments.
  - Manages button state based on `isQueueRunning`, `remainingTimeOnPause`, and queue length.
- **Queue engine (`floating-panel-ui-engine.js`)**:
  - Stores queue items with stable `queueId`, reuses `processCustomSendButtonClick` for dispatch, and maintains timers (`queueTimerId`, `currentTimerDelay`, `remainingTimeOnPause`) for precise pause/resume behavior.
  - Calculates delays via `getQueueBaseDelayMs` and `getQueueDelayWithRandomMs`, logs base/offset, and resets progress animation per item.
  - Runs pre-send automation (`performQueuePreSendActions`) for scroll/beep/speech/finish beep, driven by config toggles persisted through `saveCurrentProfileConfig`.
  - Handles queue completion (`markQueueFinished`), clearing `autoSendInterval` before dispatch to avoid double sends.
- **Queue drag-and-drop (`floating-panel-ui-queue-dnd.js`)**:
  - Implements long-press pointer tracking, FLIP transitions, placeholder insertion, and eviction of stale drags when items dispatch mid-operation. Signals order changes with toasts.
- **Floating panel assets**: `floating-panel-files/` provides HTML and CSS (declared web-accessible) for iframe-based rendering if needed.

### 3.3 Popup & Management UI
- **`popup.html`**: organizes content into `<section>` blocks with `.collapsible` headers, sequential `<script>` tags to guarantee dependencies, shared toast container, hidden confirmation/error panels, and version banner.
- **Main controller (`popup-page-script.js`)**: loads profiles, handles add/copy/delete, orchestrates drag-and-drop (`popup-page-customButtons.js`), updates global settings, manages queue configuration toggles, wires open-in-tab, width toggle, textarea autosize, event listeners, and `logToGUIConsole`.
- **Supporting scripts**:
  - `popup-page-customButtons.js`: builds card UI for buttons/separators, shows hotkey hints (with cross-chat offset), manages drag handles and autosend toggles.
  - `popup-page-profiles.js`: wraps service worker messaging for profile CRUD and ensures fallback to current profile when list is empty.
  - `popup-page-advanced.js`: handles advanced selector editor (JSON per site) with dependency on centralized collapsible logic; includes validation and reset flows.
  - `popup-page-theme.js`: toggles light/dark theme via service worker persistence and OS preference detection.
  - `popup-page-visuals.js`: supplies ripple effect utility for interactive feedback.
  - `popup-page-collapsible.js`: centralizes `.collapsible` behavior so feature modules only observe `expanded` class changes.
  - `popup-page-floating-window-handler.js`: lists hostnames with floating panel settings, resets per-site/all hosts via service worker, and updates the UI when the collapsible expands.
- **Backup & restore** (`popup-page-backup-handler.js`):
  - Exports the active `currentProfile` as pretty-printed JSON via blob download; imports parse JSON, validate required keys, and either save directly or show an overwrite confirmation (`window.tempParsedProfile` stores the payload while the user decides).
  - Confirming overwrite calls `saveConfig`, reloads profiles, switches UI to the new profile, and hides the confirmation panel; cancel resets the temp payload and hides the panel.

### 3.4 Token Approximator
- **Popup module (`modules/popup-page-modules-tokenApproximator.js`)**: collects settings (enable, calibration, thread mode `withEditors` | `ignoreEditors` | `hide`, show editor counter, placement before/after buttons, counting method, enabled sites). Populates per-site checkbox grid, merges defaults with saved state (defaults now inline in `DEFAULTS.enabledSites`), and sends updates via `saveTokenApproximatorSettings`.
- **Service worker state** (`modules/service-worker-auxiliary-state-store.js`):
  - Normalizes settings, ensures all supported sites default to `true` in `enabledSites`, clamps calibration, and persists in namespaced storage. Broadcasts `tokenApproximatorSettingsChanged`.
- **Runtime backend (`modules/backend-tokenApproximator.js`)**:
  - Guards against multiple loads, logs through `logConCgp`, and defers to helper globals when they exist: `OCPTokenApproxHelpers` (debounce, logging, registry helper, default model enforcement), `OCPTokenApproxSettings` (async loader), `OCPTokenApproxUI` (style/placement/tooltip wrappers), and `OCPTokenApproxWorker` (worker factory with Gemini CSP fallback). Each helper has a local fallback path to keep legacy behaviour intact.
  - Registry bootstrap now lives in `modules/token-models/model-registry-global.js`, exposing `OCP_TOKEN_MODEL_CATALOG` and a factory used by both the backend script and worker builder. Local constructors remain available so blob workers can serialize the classes when helpers are missing.
  - Retrieves `InjectionTargetsOnWebsite` selectors; if a site lacks a safe `threadRoot` (common on high-CSP pages), it forces `threadMode: 'hide'` while leaving editor estimates available.
  - Builds UI chips inside the inline toolbar (`placeUi` respects placement before/after) and listens for SPA navigation through a debounced handler.
  - Runs independent schedulers: thread estimation (only when thread selector exists and mode is not `hide`) and editor estimation (when `showEditorCounter` true). Schedulers throttle updates, mark chips as loading, and support manual refresh on chip click.
  - Uses `enabledSites` to respect per-site toggles; disabling the token approximator for a site removes the chips entirely.
  - Handles frameworks with restrictive DOM APIs by preferring safe operations (no direct `console.log`, capture-phase listeners to avoid hijacking, normalization for sandboxed editors).
- **Manifest wiring**: content scripts load the shared model registry plus helper bundle (`modules/token-approximator/backend-helpers.js`, `backend-settings.js`, `backend-ui.js`, `backend-worker.js`) ahead of `modules/backend-tokenApproximator.js` so globals exist before the orchestrator runs.

### 3.5 Styling & Feedback Utilities
- Popup CSS split between `popup-page-styles/` (base, layout, button cards, components) and `common-ui-elements/` (global palette, dark theme overrides, toggle styles including `popup-toggle.css`, toast visuals via `ocp_toast.css`).
- Floating panel uses `floating-panel-files/floating-panel.css`, inline styles from `floating-panel-ui-creation.js`, and shared color variables.
- `common-ui-elements/ocp_toast.js` exposes `OCPToast.show`; `popup-page-script.js` wraps it as `window.showToast` so modules share the same notification channel.
- `popup-page-visuals.js` provides ripple feedback for popup interactions.

## 4. Additional Modules & Assets
- `manifest.json`: declares permissions (`storage`, `contextMenus`), popup page (`popup.html`), options alias, background service worker module (`config.js`), content script load order, and web accessible resources.
- `welcome.html` + `welcome-page-files/`: onboarding content, screenshots, theming script; shown on install and accessible via context-menu item.
- `log.js`: exports `logConCgp`, the required logging helper for popup/content scripts.
- `event-handlers.js`: placeholder hook for shared DOM event logic; currently empty but reserved for future editions.
- `Promo/`: marketing captures (screenshots, demo videos, PSD).
- Manual test harness formerly in `tests.js` has been removed; manual browser verification aligns with repo policy.
- `CI-CD.ps1`: Windows PowerShell deployment script documenting release steps.
- `modules/SharedPrompt.js`: placeholder for future shared prompt functionality (currently unimplemented).

## 5. Core Feature Summary
| Capability | Description | Primary Files |
|------------|-------------|----------------|
| Button Management System | Custom prompt buttons with emoji/text, separators, numeric shortcuts, site-aware click flows | `buttons.js`, `buttons-init-and-render.js`, `per-website-button-clicking-mechanics/*` |
| Profile System | Multiple button sets with create/copy/delete, current profile tracking, default bootstrap | `popup-page-scripts/popup-page-script.js`, `popup-page-profiles.js`, `config.js`, `modules/service-worker-profile-manager.js` |
| Drag-and-Drop Ordering | Reorder buttons and separators in popup interface | `popup-page-customButtons.js` |
| Floating Panel | Resizable panel with per-host persistence, toolbar mirror, global toggles | `floating-panel.js`, `floating-panel-ui-creation.js`, `floating-panel-settings.js` |
| Queue System | Sequential prompt execution with delays, automation toggles, randomization, finish cues | `floating-panel-ui-queue.js`, `floating-panel-ui-queue-dnd.js`, `floating-panel-ui-engine.js` |
| Cross-Chat Sharing | Copy/paste prompt storage across sites with autosend options | `buttons.js`, `modules/popup-page-modules-promptShare.js`, `modules/service-worker-auxiliary-state-store.js` |
| Danger Broadcast | Global "Danger" toggle reveals a broadcast button that sends the current editor text to every danger-enabled tab while hiding legacy copy/paste if requested. Tabs can shift-click the broadcast control to enter a shield mode that refuses remote dispatches but still pushes outbound messages. Broadcast payloads are trimmed, empty submissions are blocked with a toast, and the service worker prevents whitespace-only fan-outs. The initiating tab auto-sends using its existing input, while the service worker relays the prompt to remote tabs via `crossChatDangerDispatchPrompt`. State is persisted in the cross-chat module (`hideStandardButtons`, `dangerAutoSendAll`) and the inline toolbar dynamically adds or removes copy/paste/broadcast buttons based on those flags. | `buttons.js`, `modules/service-worker-message-router.js`, `init.js`, `buttons-init-and-render.js`, `modules/popup-page-modules-promptShare.js`, `modules/service-worker-auxiliary-state-store.js`, `popup.html` |
| Token Approximation | Real-time token estimates using pluggable models | `modules/backend-tokenApproximator.js`, `modules/token-models/*`, `modules/popup-page-modules-tokenApproximator.js` |
| Update Resilience | Config-dependent UI updates with bounded exponential retry mechanisms | `buttons-init-and-render.js`, `buttons-injection.js` |
| Platform Integration | Selector-driven injection with SPA resiliency | `manifest.json`, `init.js`, `utils.js`, `per-website-button-clicking-mechanics/*` |
| Configuration & Persistence | StateStore-backed storage for themes, popup state, module configs, custom selectors, backups | `config.js`, `modules/service-worker-message-router.js`, `modules/service-worker-profile-manager.js`, `modules/service-worker-auxiliary-state-store.js`, `popup-page-backup-handler.js` |
| Theme System | Light/dark theme sync with OS preference; shared stylesheets | `popup-page-theme.js`, `common-ui-elements/dark-theme.css`, `common-ui-elements/common-style.css` |
