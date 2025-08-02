# Code Notes

Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.

This document summarizes the non-profile state centralization changes and how to work with them. Profile management remains unchanged and continues to use the existing implementation and keys.

## Overview

- Centralized non-profile state is handled by a new service-worker module: modules/state-store.js.
- config.js remains the single messaging entry point and now delegates only non-profile handlers to StateStore.
- Backward compatibility is preserved via dual-read (prefer new schema, fallback to legacy) and dual-write (mirror writes to legacy keys).

Profiles are explicitly excluded. Keys under currentProfile and profiles.* remain owned by their existing logic.

## New Module

1) modules/state-store.js
- Purpose: Encapsulate non-profile state (UI and module/global settings) with a stable API and event broadcasts.
- Context: Imported and executed in the service worker. It exports StateStore.
- Responsibilities:
  - Theme
  - UI popup state (firstOpen, collapsibles, lastOpenedSection)
  - Cross-Chat module global settings and stored prompt
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
- uiThemeChanged, uiPopupChanged, crossChatChanged, crossChatPromptChanged, floatingPanelChanged, floatingPanelResetAll, floatingPanelReset, customSelectorsChanged

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

## Future Adoption (Optional)

- ui.popup.firstOpen/collapsibles/lastOpenedSection are available for a future pass to persist popup section states.
- A thin client SDK (modules/state-store-client.js) can be added later to simplify callers and consume broadcasts.
- A versioning policy and quotas/backoff strategy can be layered into StateStore without affecting existing endpoints.

## Testing Notes

Recommended checks:
- Theme toggle reads/writes both ui.theme and legacy darkTheme.
- Cross-Chat module settings and stored prompt round-trip; legacy keys mirrored.
- Floating panel per-host settings round-trip with legacy mirroring; list and reset functions operate correctly.
- Custom selectors get/save/reset work; legacy customSelectors mirrored.
- Profiles remain fully functional and unaffected.

## File References

- Service worker: ['config.js'](config.js)
- Centralized state (non-profile): ['modules/state-store.js'](modules/state-store.js)
