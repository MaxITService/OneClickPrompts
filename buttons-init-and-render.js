// buttons-init-and-render.js
// Version: 1.0
//
// Documentation:
// Initialization and rendering of the *entire* buttons row for target containers (inline chat area
// or the floating panel). Prevents duplicates, composes all button types, and appends global toggles.
//
// What this module renders (in order):
//  1) Floating panel toggle (for inline containers only, if the panel feature exists)
//  2) Inline Profile Selector — optional, position configurable ("before" or "after")
//  3) A unified list of buttons:
//     - Cross-Chat buttons ("Copy", "Paste") placed "before" or "after" based on globalCrossChatConfig
//     - Custom buttons from globalMaxExtensionConfig.customButtons (honors separators)
//     - Numeric shortcuts (1–10) assigned to the first 10 non-separator buttons when enabled
//  4) Global toggles appended last: "Auto-send" and "Hotkeys"
//
// Functions:
// - createAndInsertCustomElements(targetContainer): Creates the container, renders everything once, and inserts it.
//   Uses a dynamic id from InjectionTargetsOnWebsite to avoid duplication.
// - generateAndAppendAllButtons(container, isPanel): Main renderer for all buttons + optional controls.
// - generateAndAppendToggles(container): Appends Auto-send and Hotkeys toggles and wires them to global config.
// - updateButtonsForProfileChange(origin): Scoped re-render — only "panel" or only "inline".
// - createInlineProfileSelector(): Builds the inline profile <select>, loads profile list, styles for theme,
//   blocks event bubbling on hostile SPAs, and triggers a partial refresh on change.
//
// Notes:
// - Cross-Chat placement and autosend behavior is driven by window.globalCrossChatConfig.
// - Shortcut keys appear in tooltips; Shift+click inversion happens in processCustomSendButtonClick.
//
// Usage:
// Ensure `buttons.js`, `utils.js`, and `init.js` are loaded first. Include in `content_scripts` so it runs
// on the target pages. This module only performs DOM composition; click routing is in buttons.js.
//
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS. This one too!
'use strict';

/**
 * Namespace object containing initialization functions for custom buttons and toggles.
 */
window.MaxExtensionButtonsInit = {
    /**
     * Creates and appends toggle switches to the specified container.
     * @param {HTMLElement} container - The DOM element to which toggles will be appended.
     */
    generateAndAppendToggles: function (container) {
        const autoSendToggle = MaxExtensionInterface.createToggle(
            'auto-send-toggle',
            'Auto-send',
            globalMaxExtensionConfig.globalAutoSendEnabled,
            (state) => {
                globalMaxExtensionConfig.globalAutoSendEnabled = state;
            }
        );
        autoSendToggle.title = "If unchecked, this will disable all autosend for all buttons. For this tab only.";
        container.appendChild(autoSendToggle);
        logConCgp('[init] Auto-send toggle has been created and appended.');

        const hotkeysToggle = MaxExtensionInterface.createToggle(
            'hotkeys-toggle',
            'Hotkeys',
            globalMaxExtensionConfig.enableShortcuts,
            (state) => {
                globalMaxExtensionConfig.enableShortcuts = state;
            }
        );
        hotkeysToggle.title = "If unchecked this will disable all hotkeys so your keyboard will never trigger any button pushes. For this tab only.";
        container.appendChild(hotkeysToggle);
        logConCgp('[init] Hotkeys toggle has been created and appended.');
    },

    /**
     * Creates and appends custom send buttons to the specified container.
     * @param {HTMLElement} container - The DOM element to which custom buttons will be appended.
     * @param {boolean} isPanel - Flag indicating if the container is the floating panel.
     */
    generateAndAppendAllButtons: async function (container, isPanel) {
        const SETTINGS_BUTTON_MAGIC_TEXT = '%OCP_APP_SETTINGS_SYSTEM_BUTTON%';
        // --- Create a unified list of all buttons to be rendered ---
        const allButtonDefs = [];
        let nonSeparatorCount = 0;

        if (!Array.isArray(window?.globalMaxExtensionConfig?.customButtons)) {
            const fallbackOrigin = isPanel ? 'panel' : 'inline';
            logConCgp(`[init] Button generation halted: globalMaxExtensionConfig.customButtons unavailable (origin: ${fallbackOrigin}).`);
            this.__scheduleRefreshRetry(fallbackOrigin, 'Config unavailable during generation');
            return;
        }

        const crossChatConfig = window.globalCrossChatConfig || {};
        const crossChatEnabled = !!crossChatConfig.enabled;
        const hideStandardCrossChatButtons = !!crossChatConfig.hideStandardButtons;
        const crossChatPlacement = crossChatConfig.placement === 'before' ? 'before' : 'after';
        const dangerButtonActive = crossChatEnabled && !!crossChatConfig.dangerAutoSendAll;

        const crossChatButtonTypes = [];
        if (crossChatEnabled) {
            if (!hideStandardCrossChatButtons) {
                crossChatButtonTypes.push('copy', 'paste');
            }
            if (dangerButtonActive) {
                crossChatButtonTypes.push('broadcast');
            }
        }

        const appendCrossChatButtons = () => {
            crossChatButtonTypes.forEach(type => allButtonDefs.push({ type }));
        };

        // 1. Add Cross-Chat buttons if they should be placed 'before'
        if (crossChatEnabled && crossChatPlacement === 'before') {
            appendCrossChatButtons();
        }

        // 2. Add standard custom buttons
        globalMaxExtensionConfig.customButtons.forEach(config => {
            allButtonDefs.push({ type: 'custom', config: config });
        });

        // 3. Add Cross-Chat buttons if they should be placed 'after'
        if (crossChatEnabled && crossChatPlacement === 'after') {
            appendCrossChatButtons();
        }

        // --- Render all buttons from the unified list ---

        // Add floating panel toggle first, if applicable
        if (window.MaxExtensionFloatingPanel && !isPanel) {
            const floatingPanelToggleButton = window.MaxExtensionFloatingPanel.createPanelToggleButton();
            container.appendChild(floatingPanelToggleButton);
            logConCgp('[init] Floating panel toggle button has been created and appended for inline container.');
        }

        // Inline Profile Selector BEFORE buttons
        if (window.globalInlineSelectorConfig?.enabled && window.globalInlineSelectorConfig.placement === 'before' && !isPanel) {
            if (typeof this.createInlineProfileSelector === 'function') {
                const selectorElBefore = await this.createInlineProfileSelector();
                if (selectorElBefore) {
                    container.appendChild(selectorElBefore);
                    logConCgp('[init] Inline Profile Selector appended before buttons.');
                }
            }
        }

        // Process the unified list to create and append buttons
        allButtonDefs.forEach((def, index) => {
            // Handle separators from custom buttons
            if (def.type === 'custom' && def.config.separator) {
                const separatorElement = MaxExtensionUtils.createSeparator();
                container.appendChild(separatorElement);
                logConCgp('[init] Separator element has been created and appended.');
                return; // Skip to next item
            }

            // Assign a shortcut key if enabled and available
            let shortcutKey = null;
            if (globalMaxExtensionConfig.enableShortcuts && nonSeparatorCount < 10) {
                shortcutKey = nonSeparatorCount + 1;
            }

            let buttonElement;
            if (def.type === 'copy' || def.type === 'paste' || def.type === 'broadcast') {
                const appliedShortcut = def.type === 'broadcast' ? null : shortcutKey;
                buttonElement = MaxExtensionButtons.createCrossChatButton(def.type, appliedShortcut);
            } else { // 'custom' button type
                if (def.config.text === SETTINGS_BUTTON_MAGIC_TEXT) {
                    // Special handling for the settings button.
                    const settingsButtonConfig = { ...def.config, text: 'Settings', tooltip: 'Open extension settings in a new tab' };
                    const settingsClickHandler = () => {
                        // Send a message to the service worker to open the settings page.
                        // This avoids the popup blocker (ERR_BLOCKED_BY_CLIENT).
                        chrome.runtime.sendMessage({ type: 'openSettingsPage' });
                    };
                    buttonElement = MaxExtensionButtons.createCustomSendButton(settingsButtonConfig, index, settingsClickHandler, shortcutKey);
                } else {
                    buttonElement = MaxExtensionButtons.createCustomSendButton(def.config, index, processCustomSendButtonClick, shortcutKey);
                }
            }

            container.appendChild(buttonElement);
            if (def.type !== 'broadcast') {
                nonSeparatorCount++;
            }
            logConCgp(`[init] Button ${nonSeparatorCount} (${def.type}) has been created and appended.`);
        });

        // Inline Profile Selector AFTER buttons
        if (window.globalInlineSelectorConfig?.enabled && window.globalInlineSelectorConfig.placement === 'after' && !isPanel) {
            if (typeof this.createInlineProfileSelector === 'function') {
                const selectorElAfter = await this.createInlineProfileSelector();
                if (selectorElAfter) {
                    container.appendChild(selectorElAfter);
                    logConCgp('[init] Inline Profile Selector appended after buttons.');
                }
            }
        }

        // --- Add toggles at the very end, always after everything else ---
        this.generateAndAppendToggles(container);
    },

    /**
     * Creates and inserts custom buttons and toggles into the target container element.
     * @param {HTMLElement} targetContainer - The DOM element where custom elements will be inserted.
     */
    createAndInsertCustomElements: function (targetContainer) {
        // Prevent duplication across SPA re-renders by reusing or moving the existing container if present
        const containerId = window.InjectionTargetsOnWebsite.selectors.buttonsContainerId;
        let existingContainer = document.getElementById(containerId);
        const isPanel = targetContainer.id === 'max-extension-floating-panel-content';

        // If multiple containers with the same id exist (should not happen), keep the first and remove the rest
        try {
            const dups = Array.from(document.querySelectorAll(`[id="${containerId}"]`));
            if (dups.length > 1) {
                const [keep, ...extras] = dups;
                extras.forEach(el => {
                    try { el.remove(); } catch (_) { }
                });
                existingContainer = keep;
                logConCgp(`[init] Detected and removed ${extras.length} duplicate container(s) with id ${containerId}.`);
            }
        } catch (_) { /* safe best-effort cleanup */ }

        // If a container already exists, prefer moving it to the new target instead of creating a new one
        if (existingContainer) {
            if (existingContainer.parentElement !== targetContainer) {
                try {
                    targetContainer.appendChild(existingContainer); // This moves the node
                    logConCgp('[init] Moved existing custom buttons container to a new target container.');
                } catch (err) {
                    logConCgp('[init] Failed moving existing container, will re-create instead:', err?.message || err);
                    existingContainer = null; // Fallback to recreation below
                }
            } else {
                logConCgp('[init] Custom buttons container already exists in this target. Reusing it.');
            }
        }

        // If we do not have a reusable container, create a fresh one
        if (!existingContainer) {
            const customElementsContainer = document.createElement('div');
            customElementsContainer.id = containerId; // where to insert buttons
            customElementsContainer.style.cssText = `
                display: flex;
                justify-content: flex-start;
                flex-wrap: wrap;
                gap: 8px;
                padding: 8px;
                width: 100%;
                z-index: 1000;
            `;

            // Append custom send buttons, passing the context.
            // Note: toggles are appended within generateAndAppendAllButtons() at the very end
            this.generateAndAppendAllButtons(customElementsContainer, isPanel);

            targetContainer.appendChild(customElementsContainer);
            logConCgp('[init] Custom elements have been inserted into the DOM.');
            return;
        }

        // If a reusable container exists but is empty (e.g., after SPA wipe), re-render its contents
        if (existingContainer && existingContainer.children.length === 0) {
            this.generateAndAppendAllButtons(existingContainer, isPanel);
            logConCgp('[init] Existing container was empty; regenerated buttons and toggles.');
        }
    },

    /**
     * Updates all buttons and toggles in response to a profile change.
     * Requires an `origin` parameter to specify which UI to update:
     *  - 'panel'  => only update the floating panel UI
     *  - 'inline' => only update the inline buttons UI
     */
    __refreshRetryState: {
        inline: { count: 0, timer: null },
        panel: { count: 0, timer: null }
    },

    __resetRefreshRetry(origin) {
        const state = this.__refreshRetryState[origin];
        if (!state) return;
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        state.count = 0;
    },

    __scheduleRefreshRetry(origin, reason) {
        const state = this.__refreshRetryState[origin];
        if (!state) {
            logConCgp(`[init] Refresh retry skipped for unknown origin '${origin}'.`);
            return false;
        }
        if (state.timer) {
            logConCgp(`[init] Refresh retry already scheduled for ${origin}. Reason: ${reason}`);
            return true;
        }
        if (state.count >= 5) {
            logConCgp(`[init] Refresh retry limit reached for ${origin}. Last reason: ${reason}`);
            return false;
        }
        state.count += 1;
        const delay = 60 * state.count;
        state.timer = setTimeout(() => {
            state.timer = null;
            try {
                this.updateButtonsForProfileChange(origin);
            } catch (err) {
                logConCgp(`[init] Refresh retry threw for ${origin}:`, err?.message || err);
            }
        }, delay);
        logConCgp(`[init] Scheduled refresh retry #${state.count} for ${origin} (${delay}ms). Reason: ${reason}`);
        return true;
    },

    updateButtonsForProfileChange: function (origin) {
        if (!origin) {
            logConCgp('[init] Warning: updateButtonsForProfileChange called without origin parameter. No action taken.');
            return;
        }

        // If origin is 'panel', only update the floating panel
        if (origin === 'panel') {
            if (window.MaxExtensionFloatingPanel && window.MaxExtensionFloatingPanel.panelElement) {
                const panelContent = document.getElementById('max-extension-floating-panel-content');
                if (panelContent) {
                    const panelVisible = !!window.MaxExtensionFloatingPanel.isPanelVisible;
                    const containerId = window?.InjectionTargetsOnWebsite?.selectors?.buttonsContainerId || null;
                    const selector = containerId ? `#${CSS.escape(containerId)}` : null;
                    let panelButtonsContainer = selector ? panelContent.querySelector(selector) : null;

                    if (!panelVisible && !panelButtonsContainer) {
                        logConCgp('[init] Panel refresh skipped because panel is hidden and contains no buttons.');
                        return;
                    }

                    if (panelButtonsContainer) {
                        if (!Array.isArray(window?.globalMaxExtensionConfig?.customButtons)) {
                            this.__scheduleRefreshRetry('panel', 'Config unavailable');
                            return;
                        }
                        panelButtonsContainer.innerHTML = '';
                        this.generateAndAppendAllButtons(panelButtonsContainer, true);
                        logConCgp('[init] Updated buttons in floating panel for profile change (panel origin).');
                        this.__resetRefreshRetry('panel');
                    } else {
                        if (!panelVisible) {
                            logConCgp('[init] Panel container absent while hidden; skipping recreation to preserve inline buttons.');
                            return;
                        }
                        panelContent.innerHTML = '';
                        this.createAndInsertCustomElements(panelContent);
                        logConCgp('[init] Recreated floating panel button container after profile change (panel origin).');
                        this.__resetRefreshRetry('panel');
                    }
                }
            }
            return;
        }

        // If origin is 'inline', only update the inline/original container
        if (origin === 'inline') {
            const selectors = window?.InjectionTargetsOnWebsite?.selectors;
            const containerId = selectors?.buttonsContainerId;

            if (!containerId) {
                logConCgp('[init] Inline refresh skipped because buttonsContainerId is unavailable. Attempting selector reinitialization.');
                const maybeInitializer = window?.InjectionTargetsOnWebsite && window.InjectionTargetsOnWebsite.initializeSelectors;
                if (typeof maybeInitializer === 'function') {
                    try {
                        if (!this.__inlineSelectorRetryScheduled) {
                            this.__inlineSelectorRetryScheduled = true;
                            const maybePromise = maybeInitializer.call(window.InjectionTargetsOnWebsite);
                            if (maybePromise && typeof maybePromise.then === 'function') {
                                maybePromise.then(() => {
                                    logConCgp('[init] Retrying inline refresh after selector reinitialization.');
                                    try {
                                        window.MaxExtensionButtonsInit.updateButtonsForProfileChange('inline');
                                    } catch (retryErr) {
                                        logConCgp('[init] Retry inline refresh failed:', retryErr?.message || retryErr);
                                    }
                                }).catch((err) => {
                                    logConCgp('[init] Selector reinitialization failed:', err?.message || err);
                                }).finally(() => {
                                    this.__inlineSelectorRetryScheduled = false;
                                });
                            } else {
                                this.__inlineSelectorRetryScheduled = false;
                            }
                        } else {
                            logConCgp('[init] Inline selector reinitialization already scheduled; skipping duplicate request.');
                        }
                    } catch (err) {
                        this.__inlineSelectorRetryScheduled = false;
                        logConCgp('[init] Error invoking initializeSelectors during inline refresh:', err?.message || err);
                    }
                }
                return;
            }

            const originalContainer = document.getElementById(containerId);
            if (originalContainer) {
                if (!Array.isArray(window?.globalMaxExtensionConfig?.customButtons)) {
                    this.__scheduleRefreshRetry('inline', 'Config unavailable');
                    return;
                }
                originalContainer.innerHTML = '';
                this.generateAndAppendAllButtons(originalContainer, false);
                logConCgp('[init] Updated buttons in original container for profile change (inline origin).');
                this.__resetRefreshRetry('inline');
                return;
            }

            const containerSelectors = Array.isArray(selectors?.containers) ? selectors.containers : [];
            for (const selector of containerSelectors) {
                if (!selector) {
                    continue;
                }
                const target = document.querySelector(selector);
                if (target) {
                    logConCgp(`[init] Inline container missing; reinserting via selector '${selector}'.`);
                    if (!Array.isArray(window?.globalMaxExtensionConfig?.customButtons)) {
                        this.__scheduleRefreshRetry('inline', 'Config unavailable before reinsertion');
                        return;
                    }
                    this.createAndInsertCustomElements(target);
                    this.__resetRefreshRetry('inline');
                    return;
                }
            }

            logConCgp('[init] Inline refresh could not locate a valid target container.');
            return;
        }

        logConCgp(`[init] Warning: updateButtonsForProfileChange called with unknown origin '${origin}'. No action taken.`);
    }
};

/**
 * Builds a custom inline profile selector dropdown shared by all supported sites.
 * Optional overrides allow site-specific tweaks without duplicating logic.
 * @param {HTMLElement} container
 * @param {string[]} profileNames
 * @param {string} currentProfile
 * @param {(selected: string) => void} onSwitch
 * @param {boolean} isDarkTheme
 * @param {object} [options]
 */
window.MaxExtensionButtonsInit.createUnifiedProfileSelector = function (container, profileNames, currentProfile, onSwitch, isDarkTheme, options) {
    const config = options && typeof options === 'object' ? options : {};
    const containerStyles = config.containerStyles && typeof config.containerStyles === 'object' ? config.containerStyles : null;
    const triggerStyleOverrides = config.triggerStyles && typeof config.triggerStyles === 'object' ? config.triggerStyles : null;
    const menuStyleOverrides = config.menuStyles && typeof config.menuStyles === 'object' ? config.menuStyles : null;
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const optionIdPrefix = `ocp-profile-option-${uniqueSuffix}`;

    container.setAttribute('data-ocp-profile-selector', 'true');
    container.style.position = 'relative';
    if (!container.style.pointerEvents) {
        container.style.pointerEvents = 'auto';
    }
    if (containerStyles) {
        Object.assign(container.style, containerStyles);
    }

    let activeProfile = currentProfile && profileNames.includes(currentProfile)
        ? currentProfile
        : profileNames[0];

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.title = 'Switch active profile';
    trigger.id = `ocp-profile-trigger-${uniqueSuffix}`;
    trigger.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 12px;
        border-radius: 6px;
        border: 1px solid ${isDarkTheme ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'};
        background: ${isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'};
        color: inherit;
        font-size: 13px;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease;
    `;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('data-ocp-profile-trigger', 'true');

    if (triggerStyleOverrides) {
        Object.assign(trigger.style, triggerStyleOverrides);
    }

    trigger.addEventListener('mouseenter', () => {
        trigger.style.background = isDarkTheme ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)';
    });
    trigger.addEventListener('mouseleave', () => {
        trigger.style.background = isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    });

    const triggerLabel = document.createElement('span');
    triggerLabel.textContent = activeProfile || 'Profiles';

    const triggerChevron = document.createElement('span');
    triggerChevron.textContent = '\u25BE';
    triggerChevron.style.opacity = '0.8';
    triggerChevron.setAttribute('aria-hidden', 'true');

    trigger.appendChild(triggerLabel);
    trigger.appendChild(triggerChevron);

    // Menu creation - NOT appended to container initially
    const menu = document.createElement('div');
    menu.style.cssText = `
        position: fixed;
        display: none;
        flex-direction: column;
        gap: 4px;
        padding: 6px;
        border-radius: 8px;
        background: ${isDarkTheme ? 'rgba(24, 24, 24, 0.95)' : 'rgba(255, 255, 255, 0.98)'};
        border: 1px solid ${isDarkTheme ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'};
        box-shadow: 0 10px 24px rgba(0,0,0,0.25);
        max-height: 280px;
        overflow-y: auto;
        z-index: 2147483601;
        min-width: 180px;
    `;
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('data-ocp-profile-menu', 'true');
    menu.setAttribute('aria-labelledby', trigger.id);
    menu.tabIndex = -1;

    if (menuStyleOverrides) {
        Object.assign(menu.style, menuStyleOverrides);
    }

    const optionMeta = [];

    const applyActiveStyles = (button, checkmark, isActive) => {
        button.style.background = isActive
            ? (isDarkTheme ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
            : 'transparent';
        button.style.fontWeight = isActive ? '600' : '400';
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        checkmark.style.opacity = isActive ? '1' : '0';
    };

    profileNames.forEach((name, index) => {
        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.title = name;
        optionButton.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            border: none;
            background: transparent;
            color: inherit;
            cursor: pointer;
            padding: 6px 10px;
            border-radius: 6px;
            text-align: left;
            font-size: 13px;
            transition: background 120ms ease;
        `;
        optionButton.dataset.profile = name;
        optionButton.setAttribute('role', 'option');
        optionButton.setAttribute('id', `${optionIdPrefix}-${index}`);
        optionButton.tabIndex = -1;

        optionButton.addEventListener('mouseenter', () => {
            optionButton.style.background = isDarkTheme ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
        });
        optionButton.addEventListener('mouseleave', () => {
            const isActive = optionButton.dataset.profile === activeProfile;
            optionButton.style.background = isActive
                ? (isDarkTheme ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
                : 'transparent';
        });

        const labelSpan = document.createElement('span');
        labelSpan.textContent = name;
        labelSpan.style.flex = '1';

        const checkmark = document.createElement('span');
        checkmark.textContent = '\u2713';
        checkmark.style.opacity = '0';
        checkmark.style.marginLeft = '8px';
        checkmark.style.transition = 'opacity 120ms ease';
        checkmark.setAttribute('aria-hidden', 'true');

        optionButton.appendChild(labelSpan);
        optionButton.appendChild(checkmark);

        optionButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (name === activeProfile) {
                toggleMenu(false);
                return;
            }
            setActiveProfile(name);
            toggleMenu(false);
            onSwitch?.(name);
        });

        optionButton.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                optionButton.click();
            }
        });

        optionMeta.push({ optionButton, checkmark, name, id: optionButton.id });
        menu.appendChild(optionButton);
    });

    const setActiveProfile = (name) => {
        activeProfile = name;
        triggerLabel.textContent = name;
        trigger.setAttribute('aria-label', `Active profile: ${name}`);
        let activeOptionId = '';
        optionMeta.forEach(({ optionButton, checkmark, name: candidate, id }) => {
            const isActive = candidate === activeProfile;
            applyActiveStyles(optionButton, checkmark, isActive);
            if (isActive) {
                activeOptionId = id;
            }
        });
        if (activeOptionId) {
            menu.setAttribute('aria-activedescendant', activeOptionId);
        } else {
            menu.removeAttribute('aria-activedescendant');
        }
    };

    const focusOptionByIndex = (index) => {
        if (!optionMeta.length) {
            return;
        }
        const normalized = (index + optionMeta.length) % optionMeta.length;
        const target = optionMeta[normalized];
        if (target) {
            target.optionButton.focus({ preventScroll: true });
        }
    };

    const focusActiveOption = () => {
        const activeIndex = optionMeta.findIndex(({ name }) => name === activeProfile);
        if (activeIndex >= 0) {
            focusOptionByIndex(activeIndex);
        }
    };

    let isMenuOpen = false;

    const updatePosition = () => {
        if (!isMenuOpen || !trigger.isConnected) return;

        const rect = trigger.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;
        const neededHeight = Math.min(280, optionMeta.length * 36 + 20); // Approx height

        // Reset positioning
        menu.style.top = 'auto';
        menu.style.bottom = 'auto';
        menu.style.left = rect.left + 'px';

        // Smart positioning logic
        if (spaceBelow >= neededHeight || spaceBelow > spaceAbove) {
            // Open down
            menu.style.top = (rect.bottom + 4) + 'px';
            menu.style.maxHeight = (spaceBelow - 10) + 'px';
        } else {
            // Open up
            menu.style.bottom = (viewportHeight - rect.top + 4) + 'px';
            menu.style.maxHeight = (spaceAbove - 10) + 'px';
        }
    };

    const onDocumentClick = (event) => {
        if (!menu.contains(event.target) && !trigger.contains(event.target)) {
            toggleMenu(false);
        }
    };

    const onDocumentKeydown = (event) => {
        if (event.key === 'Escape') {
            toggleMenu(false);
        }
    };

    const onWindowResizeOrScroll = () => {
        if (isMenuOpen) {
            toggleMenu(false);
        }
    };

    const onMenuKeyDown = (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const currentIndex = optionMeta.findIndex(({ optionButton }) => optionButton === document.activeElement);
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            const fallbackIndex = optionMeta.findIndex(({ name }) => name === activeProfile);
            const targetIndex = currentIndex >= 0 ? currentIndex + delta : fallbackIndex;
            focusOptionByIndex(targetIndex);
        } else if (event.key === 'Home') {
            event.preventDefault();
            focusOptionByIndex(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            focusOptionByIndex(optionMeta.length - 1);
        }
    };

    menu.addEventListener('keydown', onMenuKeyDown);

    const toggleMenu = (forceState) => {
        const nextState = typeof forceState === 'boolean' ? forceState : !isMenuOpen;
        if (nextState === isMenuOpen) {
            return;
        }

        isMenuOpen = nextState;
        trigger.setAttribute('aria-expanded', isMenuOpen ? 'true' : 'false');

        if (isMenuOpen) {
            document.body.appendChild(menu);
            menu.style.display = 'flex';
            updatePosition();
            focusActiveOption();

            document.addEventListener('click', onDocumentClick, true);
            document.addEventListener('keydown', onDocumentKeydown, true);
            window.addEventListener('resize', onWindowResizeOrScroll, { passive: true });
            window.addEventListener('scroll', onWindowResizeOrScroll, { capture: true, passive: true });
        } else {
            menu.style.display = 'none';
            if (menu.parentNode) {
                menu.parentNode.removeChild(menu);
            }

            document.removeEventListener('click', onDocumentClick, true);
            document.removeEventListener('keydown', onDocumentKeydown, true);
            window.removeEventListener('resize', onWindowResizeOrScroll);
            window.removeEventListener('scroll', onWindowResizeOrScroll, { capture: true });

            if (trigger.isConnected) {
                trigger.focus({ preventScroll: true });
            }
        }
    };

    const stopPropagationEvents = ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchend'];
    stopPropagationEvents.forEach((eventName) => {
        trigger.addEventListener(eventName, (event) => {
            event.stopPropagation();
        });
        menu.addEventListener(eventName, (event) => {
            event.stopPropagation();
        });
    });

    menu.addEventListener('click', (event) => {
        event.stopPropagation();
    });

    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleMenu();
    });

    trigger.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleMenu();
        } else if (event.key === 'Escape') {
            toggleMenu(false);
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            toggleMenu(true);
            focusActiveOption();
        }
    });

    setActiveProfile(activeProfile);
    container.appendChild(trigger);
    // Note: menu is not appended to container, it's appended to body on open.
};

// --- Helper to create Inline Profile Selector element ---
/**
 * Creates and returns a DOM element for the inline profile selector.
 * @returns {Promise<HTMLElement|null>}
 */
window.MaxExtensionButtonsInit.createInlineProfileSelector = async function () {
    try {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '4px';
        container.style.marginRight = '8px';
        // Load profiles and current profile
        const profilesResponse = await chrome.runtime.sendMessage({ type: 'listProfiles' });
        const { currentProfile } = await chrome.storage.local.get('currentProfile');
        const profileNames = Array.isArray(profilesResponse?.profiles) ? profilesResponse.profiles : [];
        if (!profileNames.length) {
            return null;
        }

        const activeSite = window?.InjectionTargetsOnWebsite?.activeSite || 'Unknown';
        const isDarkTheme = document.body.classList.contains('dark-theme') ||
            document.documentElement.classList.contains('dark-theme') ||
            window.matchMedia('(prefers-color-scheme: dark)').matches;

        const handleProfileSwitch = (selected) => {
            if (!selected) return;
            chrome.runtime.sendMessage({ type: 'switchProfile', profileName: selected, origin: 'inline' }, (response) => {
                if (response && response.config) {
                    if (typeof window.__OCP_partialRefreshUI === 'function') {
                        window.__OCP_partialRefreshUI(response.config, 'inline');
                    } else if (typeof window.__OCP_nukeAndRefresh === 'function') {
                        window.__OCP_nukeAndRefresh(response.config, 'inline');
                    } else if (window.MaxExtensionButtonsInit && typeof window.MaxExtensionButtonsInit.updateButtonsForProfileChange === 'function') {
                        window.globalMaxExtensionConfig = response.config;
                        window.MaxExtensionButtonsInit.updateButtonsForProfileChange('inline');
                    }
                }
            });
        };

        const dropdownOptions = {};
        if (activeSite === 'Perplexity') {
            dropdownOptions.containerStyles = {
                pointerEvents: 'auto',
                zIndex: '2147483600'
            };
            dropdownOptions.menuStyles = {
                zIndex: '2147483601'
            };
        }

        MaxExtensionButtonsInit.createUnifiedProfileSelector(
            container,
            profileNames,
            currentProfile,
            handleProfileSwitch,
            isDarkTheme,
            dropdownOptions
        );
        return container;
    } catch (err) {
        logConCgp('[init] Error creating inline profile selector:', err?.message || err);
        return null;
    }
};

// Profile change messaging is handled centrally in init.js to avoid duplicate listeners.
