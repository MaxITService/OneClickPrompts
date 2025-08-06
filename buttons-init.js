// Version: 1.0
//
// Documentation:
// This file handles the initialization of custom buttons and toggles within the ChatGPT extension.
// It ensures that custom buttons and toggles are created and appended to the DOM without duplication.
//
// Functions:
// - createAndInsertCustomElements: Creates and inserts custom buttons and toggles into the target container.
// - generateAndAppendToggles: Creates and appends toggle switches (e.g., Auto-send, Hotkeys) to a specified container.
// - updateButtonsForProfileChange: Updates all buttons and toggles in response to a profile change.
//
// Usage:
// Ensure that `buttons.js` and `init.js` are loaded before this script to utilize button initialization functionalities.
// This script should be included in the `content_scripts` section of the manifest to be injected into the target pages.
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
            'Enable Auto-send',
            globalMaxExtensionConfig.globalAutoSendEnabled,
            (state) => {
                globalMaxExtensionConfig.globalAutoSendEnabled = state;
            }
        );
        container.appendChild(autoSendToggle);
        logConCgp('[init] Auto-send toggle has been created and appended.');

        const hotkeysToggle = MaxExtensionInterface.createToggle(
            'hotkeys-toggle',
            'Enable Hotkeys',
            globalMaxExtensionConfig.enableShortcuts,
            (state) => {
                globalMaxExtensionConfig.enableShortcuts = state;
            }
        );
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
        this.generateAndAppendAllButtons(customElementsContainer, isPanel);
        // Append toggle switches
        this.generateAndAppendToggles(customElementsContainer);

        targetContainer.appendChild(customElementsContainer);
        logConCgp('[init] Custom elements have been inserted into the DOM.');
    },

    /**
     * Updates all buttons and toggles in response to a profile change.
     * This refreshes both the floating panel and the original container.
     */
    updateButtonsForProfileChange: function () {
        // Update buttons in the original container
        const originalContainer = document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId);
        if (originalContainer) {
            // Clear existing buttons and toggles
            originalContainer.innerHTML = '';

            this.generateAndAppendAllButtons(originalContainer, false); // Not panel
            this.generateAndAppendToggles(originalContainer);

            logConCgp('[init] Updated buttons in original container for profile change.');
        }

        // Update buttons in the floating panel if it exists and is initialized
        if (window.MaxExtensionFloatingPanel && window.MaxExtensionFloatingPanel.panelElement) {
            const panelContent = document.getElementById('max-extension-floating-panel-content');
            if (panelContent) {
                // Clear existing buttons and toggles
                panelContent.innerHTML = '';

                this.generateAndAppendAllButtons(panelContent, true); // This is the panel
                this.generateAndAppendToggles(panelContent);

                logConCgp('[init] Updated buttons in floating panel for profile change.');
            }
        }
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
        label.textContent = 'Profile:';
        label.style.fontSize = '12px';
        label.style.color = '#888';

        const select = document.createElement('select');
        select.title = 'Switch active profile';
        select.style.padding = '2px';
        select.style.zIndex = '100000';
        select.tabIndex = 0;

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
            chrome.runtime.sendMessage({ type: 'switchProfile', profileName: selected }, (response) => {
                if (response && response.config) {
                    // Immediate local refresh; SW also broadcasts to other tabs
                    if (typeof window.__OCP_partialRefreshUI === 'function') {
                        window.__OCP_partialRefreshUI(response.config);
                    } else if (typeof window.__OCP_nukeAndRefresh === 'function') {
                        window.__OCP_nukeAndRefresh(response.config);
                    } else if (window.MaxExtensionButtonsInit && typeof window.MaxExtensionButtonsInit.updateButtonsForProfileChange === 'function') {
                        // Fallback: partial refresh
                        window.globalMaxExtensionConfig = response.config;
                        window.MaxExtensionButtonsInit.updateButtonsForProfileChange();
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