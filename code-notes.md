# Code Notes

Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.

This document summarizes the non-profile state centralization changes and how to work with them. Profile management remains unchanged and continues to use the existing implementation and keys.

## Overview

- Centralized non-profile state is handled by a new service-worker module: modules/service-worker-auxiliary-state-store.js.
- config.js remains the single messaging entry point and now delegates only non-profile handlers to StateStore.
- Backward compatibility is preserved via dual-read (prefer new schema, fallback to legacy) and dual-write (mirror writes to legacy keys).

Profiles are explicitly excluded. Keys under currentProfile and profiles.* remain owned by their existing logic.

## New Module

1) modules/service-worker-auxiliary-state-store.js
- Purpose: Encapsulate non-profile state (UI and module/global settings) with a stable API and event broadcasts.
- Context: Imported and executed in the service worker. It exports StateStore.
- Responsibilities:
  - Theme
  - UI popup state (firstOpen, collapsibles, lastOpenedSection)
  - Cross-Chat module global settings and stored prompt
  - Inline Profile Selector module settings
  - Floating panel per-host settings
  - Custom selectors per-site
  - Optional meta: schemaVersion, dev.debugLogging
- Backward compatibility (legacy keys mirrored):
  - ui.theme <-> darkTheme
  - modules.crossChat.settings <-> crossChatModuleSettings
  - modules.crossChat.storedPrompt <-> crossChatStoredPrompt
  - floatingPanel.{hostname} <-> floating_panel_{hostname}
  - global.customSelectors <-> customSelectors
- Not touching:
  - currentProfile, profiles.*, listProfiles/saveConfig/switchProfile/getConfig/deleteProfile and related behavior.

### StateStore API

Theme
- getUiTheme(): 'light' | 'dark'
- setUiTheme(theme: 'light' | 'dark'): Promise<void> (broadcasts uiThemeChanged)

UI popup
- getUiPopupState(): { firstOpen: boolean, lastOpenedSection?: string, collapsibles?: Record<string, boolean> }
- setUiPopupState(patch: Partial<UiPopupState>): Promise<void> (broadcasts uiPopupChanged)

Cross-Chat
- getCrossChat(): { settings: { enabled, autosendCopy, autosendPaste, placement }, storedPrompt: string }
- saveCrossChat(settingsPatch): Promise<void> (broadcasts crossChatChanged)
- getStoredPrompt(): string
- saveStoredPrompt(text: string): Promise<void> (broadcasts crossChatPromptChanged)
- clearStoredPrompt(): Promise<void> (broadcasts crossChatPromptChanged)

Inline Profile Selector
- getInlineProfileSelectorSettings(): { enabled: boolean, placement: 'before' | 'after' }
- saveInlineProfileSelectorSettings(settings): Promise<void> (broadcasts inlineProfileSelectorSettingsChanged)

Floating Panel
- getFloatingPanelSettings(hostname: string): object | null
- saveFloatingPanelSettings(hostname: string, settings: object): Promise<void> (broadcasts floatingPanelChanged)
- listFloatingPanelHostnames(): string[]
- resetFloatingPanelSettings(): Promise<number> (broadcasts floatingPanelResetAll)
- resetFloatingPanelSettingsForHostname(hostname: string): Promise<void> (broadcasts floatingPanelReset)

Custom Selectors
- getCustomSelectors(site?: string): object | null | map
- saveCustomSelectors(site: string, selectors: object | null): Promise<void> (broadcasts customSelectorsChanged)
- resetAdvancedSelectors(site?: string): Promise<number> (broadcasts customSelectorsChanged)

Meta
- getSchemaVersion(): number
- setSchemaVersion(v: number): Promise<void>
- getDebugLogging(): boolean
- setDebugLogging(enabled: boolean): Promise<void>

Broadcasts
- uiThemeChanged, uiPopupChanged, crossChatChanged, crossChatPromptChanged, inlineProfileSelectorSettingsChanged, floatingPanelChanged, floatingPanelResetAll, floatingPanelReset, customSelectorsChanged

## config.js Changes

- Imports StateStore and delegates only non-profile message handlers.
- No changes to profile handlers or keys.

Updated message handlers:
- Theme:
  - getTheme -> StateStore.getUiTheme()
  - setTheme -> StateStore.setUiTheme()
- Custom selectors:
  - getCustomSelectors -> StateStore.getCustomSelectors(site)
  - saveCustomSelectors -> StateStore.saveCustomSelectors(site, selectors)
  - resetAdvancedSelectors -> StateStore.resetAdvancedSelectors(site?)
- Floating panel:
  - getFloatingPanelSettings -> StateStore.getFloatingPanelSettings(hostname)
  - saveFloatingPanelSettings -> StateStore.saveFloatingPanelSettings(hostname, settings)
  - resetFloatingPanelSettings -> StateStore.resetFloatingPanelSettings()
  - getFloatingPanelHostnames -> StateStore.listFloatingPanelHostnames()
  - resetFloatingPanelSettingsForHostname -> StateStore.resetFloatingPanelSettingsForHostname(hostname)
- Cross-Chat module:
  - getCrossChatModuleSettings -> StateStore.getCrossChat().settings
  - saveCrossChatModuleSettings -> StateStore.saveCrossChat(settingsPatch)
  - saveStoredPrompt -> StateStore.saveStoredPrompt(text)
  - getStoredPrompt -> StateStore.getStoredPrompt()
  - clearStoredPrompt -> StateStore.clearStoredPrompt()
- Inline Profile Selector module:
  - getInlineProfileSelectorSettings -> StateStore.getInlineProfileSelectorSettings()
  - saveInlineProfileSelectorSettings -> StateStore.saveInlineProfileSelectorSettings(settings)

Unchanged message handlers:
- Profiles: getConfig, saveConfig, switchProfile, listProfiles, deleteProfile, createDefaultProfile
- Global settings: getGlobalSettings, saveGlobalSettings
- Storage: clearStorage
- Install/welcome/migration: unchanged

## Storage Schema

New schema (logical paths):
- ui.theme: 'light' | 'dark' (mirrors darkTheme)
- ui.popup: { firstOpen: boolean, lastOpenedSection?: string, collapsibles?: Record<id, boolean> }
- modules.crossChat: { settings: { enabled, autosendCopy, autosendPaste, placement }, storedPrompt: string }
- modules.inlineProfileSelector: { enabled: boolean, placement: 'before' | 'after' }
- floatingPanel: { [hostname]: FloatingPanelSettings }
- global.customSelectors: { [site]: SelectorsConfig }
- state.schemaVersion: number
- dev.debugLogging: boolean

Legacy keys preserved during transition:
- darkTheme
- crossChatModuleSettings
- crossChatStoredPrompt
- floating_panel_{hostname}
- customSelectors

Read precedence and writes:
- Reads: prefer new schema; fallback to legacy; fallback to defaults.
- Writes: to new schema and legacy (dual-write) for compatibility.

## UI/Caller Expectations

- Existing popup and content scripts continue to send the same messages; behavior remains compatible.
- For per-site selector reset, popup uses saveCustomSelectors(site, null).
- For global selector reset (if any caller uses it): resetAdvancedSelectors is supported and will clear all or one site accordingly.

## UI Theming and Styles

- Shared vars: ['common-ui-elements/common-style.css'](common-ui-elements/common-style.css) defines root tokens (colors, hover, transitions, shadows, checkbox size). Used by popup and welcome.
- Dark theme: ['common-ui-elements/dark-theme.css'](common-ui-elements/dark-theme.css) applies on body.dark-theme; adjusts tokens and components (buttons, inputs, sections, links, toasts, dialogs).
- Dialogs: use .dialog with variants .dialog-confirmation and .dialog-error (see ['popup.html'](popup.html:284)).
- Toasts: base .toast plus type classes toast-success/error/info from ['popup-page-scripts/popup-page-visuals.js'](popup-page-scripts/popup-page-visuals.js:19). In dark mode, neutral fallback applies only without a type class.

## Inline Profile Selector Module

The Inline Profile Selector module adds a dropdown menu directly in the button row of chat interfaces, allowing users to quickly switch between profiles without opening the extension popup.

### Features
- Adds a dropdown selector in the button row that displays all available profiles
- Can be positioned either before or after custom buttons
- Automatically updates UI when profile is changed
- Preserves state across page refreshes and navigation
- Handles dark/light theme detection for appropriate styling

### Implementation
- UI settings in popup: ['modules/popup-page-modules-inlineSelector.js'](modules/popup-page-modules-inlineSelector.js)
- DOM creation: ['buttons-init-and-render.js'](buttons-init-and-render.js) (createInlineProfileSelector function)
- Storage: ['modules/service-worker-auxiliary-state-store.js'](modules/service-worker-auxiliary-state-store.js) (inlineProfileSelector key)
- Global config loading: ['init.js'](init.js) (loads settings during initialization)

### Integration Points
- Initialization: Settings loaded in init.js before main UI initialization
- Button Row: Rendered in generateAndAppendAllButtons based on placement setting
- Profile Switching: Uses the same profile switching mechanism as the floating panel
- UI Refresh: Leverages the centralized refresh helpers (__OCP_partialRefreshUI, __OCP_nukeAndRefresh)

## Future Adoption (Optional)

- ui.popup.firstOpen/collapsibles/lastOpenedSection are available for a future pass to persist popup section states.
- A thin client SDK (modules/state-store-client.js) can be added later to simplify callers and consume broadcasts.
- A versioning policy and quotas/backoff strategy can be layered into StateStore without affecting existing endpoints.

## Testing Notes

Recommended checks:
- Theme toggle, cross-chat, floating panel, custom selectors, and profiles behave as documented.
- UI theming:
  - .dialog and variants render correctly in light/dark.
  - Toasts show base + correct type classes; dark fallback applies when no type.
- Inline Profile Selector:
  - Verify dropdown appears in correct position (before/after buttons)
  - Test profile switching works correctly
  - Confirm dark/light theme styling is applied properly
  - Check event propagation blocking prevents dropdown from closing immediately

## File References

- Service worker: ['config.js'](config.js)
- State: ['modules/service-worker-auxiliary-state-store.js'](modules/service-worker-auxiliary-state-store.js)
- Styles: ['common-ui-elements/common-style.css'](common-ui-elements/common-style.css), ['common-ui-elements/dark-theme.css'](common-ui-elements/dark-theme.css)
- HTML: ['popup.html'](popup.html), ['welcome.html'](welcome.html)
- Inline Profile Selector: ['modules/popup-page-modules-inlineSelector.js'](modules/popup-page-modules-inlineSelector.js)
