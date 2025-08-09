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
        autoSendToggle.title = "If unchecked, this will disable all autosend for all buttons.";
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
        hotkeysToggle.title = "If unchecked this will disable all hotkeys so your keyboard will never trigger any button pushes";
        container.appendChild(hotkeysToggle);
        logConCgp('[init] Hotkeys toggle has been created and appended.');
    },

    /**
     * Creates and appends custom send buttons to the specified container.
     * @param {HTMLElement} container - The DOM element to which custom buttons will be appended.
     * @param {boolean} isPanel - Flag indicating if the container is the floating panel.
     */
    generateAndAppendAllButtons: async function (container, isPanel) {
       // --- Create a unified list of all buttons to be rendered ---
       const allButtonDefs = [];
       let nonSeparatorCount = 0;

       // 1. Add Cross-Chat buttons if they should be placed 'before'
       if (window.globalCrossChatConfig?.enabled && window.globalCrossChatConfig.placement === 'before') {
           allButtonDefs.push({ type: 'copy' });
           allButtonDefs.push({ type: 'paste' });
       }

       // 2. Add standard custom buttons
       globalMaxExtensionConfig.customButtons.forEach(config => {
           allButtonDefs.push({ type: 'custom', config: config });
       });

       // 3. Add Cross-Chat buttons if they should be placed 'after'
       if (window.globalCrossChatConfig?.enabled && window.globalCrossChatConfig.placement === 'after') {
           allButtonDefs.push({ type: 'copy' });
           allButtonDefs.push({ type: 'paste' });
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
           if (def.type === 'copy' || def.type === 'paste') {
               buttonElement = MaxExtensionButtons.createCrossChatButton(def.type, shortcutKey);
           } else { // 'custom'
               buttonElement = MaxExtensionButtons.createCustomSendButton(def.config, index, processCustomSendButtonClick, shortcutKey);
           }

           container.appendChild(buttonElement);
           nonSeparatorCount++;
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
        // Prevent duplication by checking if the container already exists using dynamic selector
        const existingContainer = document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId);
        if (existingContainer && existingContainer.parentElement === targetContainer) {
            logConCgp('[init] Custom buttons container already exists in this target. Skipping creation.');
            return;
        }

        const customElementsContainer = document.createElement('div');
        // This should be created already by 
        customElementsContainer.id = window.InjectionTargetsOnWebsite.selectors.buttonsContainerId; // where to insert buttons
        customElementsContainer.style.cssText = `
            display: flex;
            justify-content: flex-start;
            flex-wrap: wrap;
            gap: 8px;
            padding: 8px;
            width: 100%;
            z-index: 1000;
        `;

        // Determine if we are creating buttons for the panel or for an inline container.
        const isPanel = targetContainer.id === 'max-extension-floating-panel-content';

        // Append custom send buttons, passing the context.
        // Note: toggles are now appended within generateAndAppendAllButtons() at the very end
        this.generateAndAppendAllButtons(customElementsContainer, isPanel);

        targetContainer.appendChild(customElementsContainer);
        logConCgp('[init] Custom elements have been inserted into the DOM.');
    },

    /**
     * Updates all buttons and toggles in response to a profile change.
     * Requires an `origin` parameter to specify which UI to update:
     *  - 'panel'  => only update the floating panel UI
     *  - 'inline' => only update the inline buttons UI
     */
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
                    panelContent.innerHTML = '';
                    this.generateAndAppendAllButtons(panelContent, true);
                    logConCgp('[init] Updated buttons in floating panel for profile change (panel origin).');
                }
            }
            return;
        }
    
        // If origin is 'inline', only update the inline/original container
        if (origin === 'inline') {
            const originalContainer = document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId);
            if (originalContainer) {
                originalContainer.innerHTML = '';
                this.generateAndAppendAllButtons(originalContainer, false);
                logConCgp('[init] Updated buttons in original container for profile change (inline origin).');
            }
            return;
        }

        logConCgp(`[init] Warning: updateButtonsForProfileChange called with unknown origin '${origin}'. No action taken.`);
    }
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
        const label = document.createElement('span');
        label.textContent = ''; // Could be text like "Profile: " - no text for compactness 
        label.style.fontSize = '12px';
        // Don't hardcode color - let it inherit from theme
        const select = document.createElement('select');
        select.title = 'Switch active profile';
        select.style.padding = '2px 16px 2px 4px'; // Add padding on right for arrow
        select.style.zIndex = '100000';
        select.style.appearance = 'auto'; // Ensure dropdown arrow is visible
        select.style.backgroundImage = 'url("data:image/svg+xml;utf8,<svg fill=\'%23666\' height=\'24\' viewBox=\'0 0 24 24\' width=\'24\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M7 10l5 5 5-5z\'/></svg>")';
        select.style.backgroundRepeat = 'no-repeat';
        select.style.backgroundPosition = 'right 2px center';
        select.style.backgroundSize = '16px';
        select.tabIndex = 0;
        
        // Check if dark theme is active and apply appropriate styling
        const isDarkTheme = document.body.classList.contains('dark-theme') ||
                           document.documentElement.classList.contains('dark-theme') ||
                           window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        if (isDarkTheme) {
            select.style.background = '#333';
            select.style.color = '#eee';
            select.style.borderColor = '#555';
            select.style.backgroundImage = 'url("data:image/svg+xml;utf8,<svg fill=\'%23eee\' height=\'24\' viewBox=\'0 0 24 24\' width=\'24\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M7 10l5 5 5-5z\'/></svg>")';
            select.style.backgroundRepeat = 'no-repeat';
            select.style.backgroundPosition = 'right 2px center';
            select.style.backgroundSize = '16px';
            label.style.color = '#eee';
        }

        // Prevent hostile site handlers from closing the dropdown immediately on SPA UIs (e.g. ChatGPT)
        const stop = (e) => { e.stopPropagation(); };
        ['pointerdown','mousedown','mouseup','click','touchstart','touchend','keydown'].forEach(evt => {
            select.addEventListener(evt, stop, { capture: true });
        });

        // Load profiles and current profile
        const profilesResponse = await chrome.runtime.sendMessage({ type: 'listProfiles' });
        const { currentProfile } = await chrome.storage.local.get('currentProfile');

        const profileNames = Array.isArray(profilesResponse?.profiles) ? profilesResponse.profiles : [];
        profileNames.forEach((name) => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (name === currentProfile) opt.selected = true;
            select.appendChild(opt);
        });

        select.addEventListener('change', (e) => {
            const selected = e.target.value;
            // Request switch and refresh immediately using service worker response for reliability.
            // Include origin so receiver can limit refresh scope to inline UI only.
            chrome.runtime.sendMessage({ type: 'switchProfile', profileName: selected, origin: 'inline' }, (response) => {
                if (response && response.config) {
                    // Immediate local refresh; SW also broadcasts to other tabs
                    if (typeof window.__OCP_partialRefreshUI === 'function') {
                        window.__OCP_partialRefreshUI(response.config, 'inline');
                    } else if (typeof window.__OCP_nukeAndRefresh === 'function') {
                        window.__OCP_nukeAndRefresh(response.config, 'inline');
                    } else if (window.MaxExtensionButtonsInit && typeof window.MaxExtensionButtonsInit.updateButtonsForProfileChange === 'function') {
                        // Fallback: partial refresh
                        window.globalMaxExtensionConfig = response.config;
                        window.MaxExtensionButtonsInit.updateButtonsForProfileChange('inline');
                    }
                }
            });
        });

        container.appendChild(label);
        container.appendChild(select);
        return container;
    } catch (err) {
        logConCgp('[init] Error creating inline profile selector:', err?.message || err);
        return null;
    }
};

// Profile change messaging is handled centrally in init.js to avoid duplicate listeners.