# Code Notes

Current architecture reference for the OneClickPrompts Chrome extension (Manifest V3, ES modules).

## Project Overview
- Purpose: inject configurable prompt buttons and auxiliary UI into supported AI chat interfaces (ChatGPT, Claude, Copilot, DeepSeek, AI Studio, Grok, Gemini).
- Modalities: inline toolbar in the site editor and an optional floating panel with prompt queue controls.
- Source structure: root JS modules plus feature folders (`popup-page-scripts/`, `per-website-button-clicking-mechanics/`, `floating-panel-files/`, `modules/`, `common-ui-elements/`).

## Runtime Flow Overview
1. Browser navigates to a matched domain (`manifest.json`) and loads declared CSS then the ordered JS stack.
2. `config.js` service worker handles installation, opens `welcome.html`, manages storage, and answers `chrome.runtime` messages.
3. `init.js` runs last on the page, pulls configuration via the service worker, chooses inline or floating panel UI (or both), wires SPA navigation observers, and triggers button rendering.
4. `utils.js` exposes selector helpers; `buttons.js` builds button elements and routes clicks to site-specific handlers; `buttons-init-and-render.js` composes the toolbar with toggles, cross-chat buttons, profile selector, and panel toggle.
5. Site handler modules in `per-website-button-clicking-mechanics/` perform DOM interactions specific to each platform.

## Service Worker & Storage
- Primary entry point: `config.js`
  - Registers context menu (`context-menu.js`), runs `StateStore`, migrates sync→local storage, creates the default profile using `default-config.json`, and logs via `logConfigurationRelatedStuff`.
- Message APIs handled here (all invoked via `chrome.runtime.sendMessage` from popup/content scripts):
  - Profile lifecycle: `getConfig`, `saveConfig`, `switchProfile`, `listProfiles`, `deleteProfile`.
  - Theme & UI prefs: `getTheme`, `setTheme`, `getUiPopupState`, `setUiPopupState`.
  - Feature modules: `getCrossChatModuleSettings`, `saveCrossChatModuleSettings`, `getStoredPrompt`, `clearStoredPrompt`, `getInlineProfileSelectorSettings`, `saveInlineProfileSelectorSettings`, `getTokenApproximatorSettings`, `saveTokenApproximatorSettings`.
  - Advanced selectors & floating panel: `getCustomSelectors`, `saveCustomSelectors`, `resetAdvancedSelectors`, `getFloatingPanelHostnames`, `resetFloatingPanelSettings`, `resetFloatingPanelSettingsForHostname`.
  - Misc utility actions: `openSettingsPage` (launch `popup.html?isTab=true`) and welcome page tab creation during install.
- Integration patterns:
  - Popup scripts batch-save via debounced handlers (`debouncedSaveCurrentProfile`) and rely on the service worker to rehydrate state after profile switches; `popup-page-script.js` stores the working profile locally but treats the worker as source of truth.
- Floating panel controls (`floating-panel-settings.js`) post updates back to the worker so host-specific layouts persist; content scripts listen for broadcast events like `floatingPanelChanged` to reconcile.
- Content scripts (`init.js`, `buttons.js`) request configuration once, cache it in `window.globalMaxExtensionConfig`, then listen for broadcasts triggered by service-worker writes (e.g., theme, queue resets). Broadcasts arrive via `chrome.tabs.sendMessage`; handlers call `window.__OCP_partialRefreshUI` or `_nukeAndRefresh` depending on the change.
- Cross-chat, inline selector, and token approximator modules in both popup and page contexts exchange data through shared worker endpoints, ensuring settings persist regardless of which surface initiated the change.
- Popup feature modules call worker endpoints to persist their toggles and rely on `StateStore.broadcast()` to synchronize UI (e.g., token approximator UI updates when settings change from content script).
- Queue automation actions inside the floating panel use worker messages when the queue toggles alter profile/global settings so the popup reflects the same state next time it opens.
- Central storage module: `modules/service-worker-auxiliary-state-store.js`
  - Maintains non-profile state under namespaced keys (`ui`, `modules`, `floatingPanel`, `global`, `meta`) with dual-read/write to legacy keys.
  - Provides API methods for theme, popup UI state, cross-chat, inline selector, token approximator, floating panel per-host configs, custom selectors, and debug meta toggles.
  - Broadcasts tab messages when state changes to keep inline UI and popup synchronized.
- Profile data: stored in `chrome.storage.local` under `profiles.<name>` with `currentProfile`; service worker functions marshal these records.
- Logging policy: use `logConCgp` from `log.js` everywhere outside the service worker (which keeps its own prefixed logger).
- Context menu customization: `context-menu.js` defines right-click actions (currently only Open Welcome page) and is imported by the service worker.

## Content Script Surfaces
- Inline toolbar:
  - `buttons-init-and-render.js` orchestrates button list, separators, toggles, floating panel toggle, and inline profile selector placement.
  - `buttons.js` assigns shortcuts, handles queue-aware click routing, and calls per-site injectors (`buttons-clicking-*.js`).
  - `buttons-injection.js` finds target containers, injects markup once, and runs resiliency loops/mutation observers to survive SPA changes.
  - `interface.js` builds reusable toggle UI and persists local toggle states.

## Floating Panel System
- Base namespace: `floating-panel.js` (state, defaults, queue properties).
- UI creation/layout: `floating-panel-ui-creation.js`, `floating-panel-ui-engine.js`.
- Interaction logic: `floating-panel-ui-interaction.js`, `floating-panel-ui-queue.js`, `floating-panel-ui-queue-dnd.js`.
- Settings persistence: `floating-panel-settings.js` calls service worker for host-specific storage and global queue toggles.
- Queue automation: supports scheduling, random delays, audio cues, and finish indicators.
- Standalone assets: `floating-panel-files/` hosts `floating-panel.css` and `floating-panel.html` for its visual structure.

## Popup & Management UI
- Root HTML: `popup.html` structures the interface into `<section>` blocks with `.collapsible` headers, shared toast container, hidden confirmation panels, and sequential `<script>` tags to guarantee dependency order.
- Main controller: `popup-page-scripts/popup-page-script.js`
  - Loads profile list, handles add/copy/delete, manages drag-and-drop ordering (`popup-page-customButtons.js`), updates global settings, and coordinates with backup/import.
  - Manages queue configuration toggles (`handleQueue*` functions) and triggers `chrome.runtime` messages.
- Supporting modules:
  - `popup-page-collapsible.js` activates `.collapsible` headers so feature modules can observe the `expanded` class instead of wiring their own togglers.
  - `popup-page-visuals.js` adds ripple/feedback helpers consumed by button actions.
  - `popup-page-profiles.js`: service worker messaging for profile CRUD.
  - `popup-page-advanced.js`, `popup-page-backup-handler.js`: advanced selector editor and profile export/import flow.
  - `popup-page-theme.js`: dark theme toggling persisted via service worker.
  - `popup-page-floating-window-handler.js`: manages per-host floating panel reset list and bulk reset actions.
- Popup modules:
  - `modules/popup-page-modules-promptShare.js`, `modules/popup-page-modules-inlineSelector.js`, `modules/popup-page-modules-tokenApproximator.js` mount feature-specific controls; each listens for `DOMContentLoaded`, syncs initial state via `chrome.runtime.sendMessage`, and uses observers to react to collapsible expansion.
  - Modules rely on helpers exposed on `window` (e.g., `showToast`, `resizeVerticalTextarea`, `updatebuttonCardsList`) that are created by the main controller/custom buttons script.
- Shared styling: `popup-page-styles/` and `common-ui-elements/` (`common-style.css`, `dark-theme.css`, `ocp_toast.css`, `popup-toggle.css`).

## Styling & Feedback Utilities
- Popup CSS is split between `popup-page-styles/` (base, layout, button cards, component chrome) and `common-ui-elements/` (global palette, dark-theme overrides, toggle widgets, shared toast styles).
- Floating panel visuals combine `floating-panel-files/floating-panel.css`, inline styles authored by `floating-panel-ui-creation.js`, and shared variables from the common stylesheets.
- `common-ui-elements/ocp_toast.js` exposes `OCPToast.show`; `popup-page-script.js` wraps it as `window.showToast` so popup modules share a consistent notification path.
- `popup-page-visuals.js` supplies ripple feedback helpers; modules invoke them for add/delete button actions.

## Inline Profile Selector
- Configuration UI: `modules/popup-page-modules-inlineSelector.js` exposes toggles in the popup and saves via service worker.
- Runtime integration: `buttons-init-and-render.js` injects selector before/after button stack; events trigger profile switching through existing refresh helpers.
- Profile change refresh: `window.__OCP_partialRefreshUI` and `window.__OCP_nukeAndRefresh` from `init.js` keep inline toolbar and floating panel synced without destroying the panel.

## Token Approximator
- Popup controls: `modules/popup-page-modules-tokenApproximator.js` (model selection, calibration, UI).
- Backend worker: `modules/backend-tokenApproximator.js` (creates estimator worker, manages chips in floating panel/inline UI, schedules refresh).
- Models: `modules/token-models/` (registry plus multiple counting strategies; default is `model-ultralight-state-machine.js`).
- State coordination: service worker methods to persist settings and broadcast updates to content scripts.

## Cross-Chat Prompt Sharing
- Popup controls: `modules/popup-page-modules-promptShare.js`.
- Runtime buttons: `buttons.js` exposes copy/paste buttons with autosend, tooltip feedback, and stored prompt retrieval.
- State entries run through `StateStore` to mirror legacy keys and broadcast updates.

## Site Detection & Utilities
- `utils.js` contains DOM helpers (wait for selectors, simulate clicks/paste, cursor management, separators).
- `init.js` builds `InjectionTargetsOnWebsite` (site-specific selectors) and attaches SPA observers:
  - Mutation observers and History API patches detect URL changes.
  - `publicStaticVoidMain()` fetches config, sets `window.globalMaxExtensionConfig`, bootstraps inline or panel UI, and registers keyboard shortcuts.
- `per-website-button-clicking-mechanics/` modules implement DOM writing and send-button activation for each supported site, respecting autosend and queue behavior.

## Configuration Assets & Misc
- `manifest.json`: declares permissions (`storage`, `contextMenus`), action popup, option page alias, service worker module, content script order, CSS, and web-accessible HTML for floating panel iframe usage.
- `default-config.json`: default profile payload consumed during first-run profile creation.
- `welcome.html` + `welcome-page-files/`: onboarding content, screenshots, and theming script for install flow.
- `floating-panel-files/`: html/css shell used when rendering the panel as an iframe resource; referenced via web accessible resources.
- `common-ui-elements/ocp_toast.js`: shared toast notifications for popup and floating panel.
- `log.js`: exports `logConCgp` logging helper used by all popup/content scripts; required in place of `console.log`.
- Icons (`icon*.png`, `Full_logo.png`) provide extension branding.
- `Promo/`: marketing captures (screenshots, video demos, PSD) used externally.
- Manual test harness (formerly `tests.js`) has been removed; rely on browser-driven verification per repo policy.
- `CI-CD.ps1`: PowerShell deployment script documenting build/release steps for Windows environments.
- `modules/SharedPrompt.js`: placeholder reserved for future shared prompt logic (currently unimplemented).

## Core Feature Summary
| Capability | Description | Primary Files |
|------------|-------------|----------------|
| Button Management System | Custom prompt buttons with emoji/text, separators, numeric shortcuts, site-aware click flows | `buttons.js`, `buttons-init-and-render.js`, `per-website-button-clicking-mechanics/*` |
| Profile System | Multiple button sets with create/copy/delete, current profile tracking, default bootstrap | `popup-page-scripts/popup-page-script.js`, `popup-page-profiles.js`, `config.js` |
| Drag-and-Drop Ordering | Reorder buttons and separators in popup interface | `popup-page-customButtons.js` |
| Floating Panel | Resizable panel with per-host persistence, toolbar mirror, global toggles | `floating-panel.js`, `floating-panel-ui-creation.js`, `floating-panel-settings.js` |
| Queue System | Sequential prompt execution with delays, automation toggles, randomization, finish cues | `floating-panel-ui-queue.js`, `floating-panel-ui-queue-dnd.js`, `floating-panel-ui-engine.js` |
| Cross-Chat Sharing | Copy/paste prompt storage across sites with autosend options | `buttons.js`, `modules/popup-page-modules-promptShare.js`, `modules/service-worker-auxiliary-state-store.js` |
| Token Approximation | Real-time token estimates using pluggable models | `modules/backend-tokenApproximator.js`, `modules/token-models/*`, `modules/popup-page-modules-tokenApproximator.js` |
| Platform Integration | Selector-driven injection into AI chat UIs with SPA resiliency | `manifest.json`, `init.js`, `utils.js`, `per-website-button-clicking-mechanics/*` |
| Configuration & Persistence | StateStore-backed storage for themes, popup state, module configs, custom selectors, backups | `config.js`, `modules/service-worker-auxiliary-state-store.js`, `popup-page-backup-handler.js` |
| Theme System | Light/dark theme sync with OS preference; shared stylesheets | `popup-page-theme.js`, `common-ui-elements/dark-theme.css`, `common-ui-elements/common-style.css` |
