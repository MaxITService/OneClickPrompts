/**
 * File: modules/selector-auto-detector/index.js
 * Version: 1.0
 *
 * Description:
 * The "Brain" of the selector auto-detection system.
 * Manages failure tracking, coordinates recovery attempts, and handles user notifications.
 */

'use strict';

window.OneClickPromptsSelectorAutoDetector = {
    state: {
        editor: {
            failures: 0,
            lastFailure: 0,
            recovering: false
        },
        sendButton: {
            failures: 0,
            lastFailure: 0,
            recovering: false
        },
        container: {
            failures: 0,
            lastFailure: 0,
            recovering: false
        }
    },

    config: {
        failureThreshold: 1, // Number of failures before triggering recovery (can be >1 to debounce)
        cooldownMs: 2000,    // Time to wait before re-alerting or re-trying
    },
    settings: {
        enableEditorHeuristics: true,
        enableSendButtonHeuristics: true,
        enableContainerHeuristics: true,
        loaded: false
    },
    lastOffers: {
        editor: { selector: null, site: null, at: 0 },
        sendButton: { selector: null, site: null, at: 0 },
        container: { selector: null, site: null, at: 0 }
    },

    /**
     * Reports a failure to find a specific element type.
     * @param {string} type - 'editor' or 'sendButton'
     * @param {Object} context - Additional context (e.g., selectors tried)
     */
    reportFailure: async function (type, context = {}) {
        const now = Date.now();
        const s = this.state[type];

        if (!s) {
            logConCgp(`[SelectorAutoDetector] Unknown type reported: ${type}`);
            return null;
        }

        // Debounce/Cooldown check
        if (s.recovering || (now - s.lastFailure < this.config.cooldownMs)) {
            return null;
        }

        s.failures++;
        s.lastFailure = now;

        logConCgp(`[SelectorAutoDetector] ${type} failure reported. Count: ${s.failures}`, context);

        if (s.failures >= this.config.failureThreshold) {
            return await this.triggerRecovery(type);
        }
        return null;
    },

    /**
     * Reports that an element was successfully found.
     * Resets failure counters.
     * @param {string} type - 'editor' or 'sendButton'
     */
    reportRecovery: function (type) {
        const s = this.state[type];
        if (s && s.failures > 0) {
            logConCgp(`[SelectorAutoDetector] ${type} recovered. Resetting state.`);
            s.failures = 0;
            s.recovering = false;
        }
    },

    /**
     * Initiates the recovery process.
     * @param {string} type - 'editor', 'sendButton', or 'container'
     * @returns {Promise<HTMLElement|null>}
     */
    triggerRecovery: async function (type) {
        const s = this.state[type];
        s.recovering = true;

        const heuristicsAllowed = type === 'editor'
            ? this.settings.enableEditorHeuristics !== false
            : type === 'sendButton'
                ? this.settings.enableSendButtonHeuristics !== false
                : this.settings.enableContainerHeuristics !== false;

        // Readable name for the type
        const typeName = type === 'editor' ? 'Text input area' : type === 'sendButton' ? 'send button' : 'button container';

        // Unified message logic
        const statusSuffix = heuristicsAllowed ? "Trying to find it..." : "Auto-detect is off.";
        const toastType = heuristicsAllowed ? 'info' : 'error';

        if (window.showToast) {
            window.showToast(`OneClickPrompts: ${typeName} not found. ${statusSuffix}`, toastType);
        } else {
            console.warn(`OneClickPrompts: ${typeName} not found. ${statusSuffix}`);
        }

        // If heuristics are disabled, stop here.
        if (!heuristicsAllowed) {
            logConCgp(`[SelectorAutoDetector] Heuristics disabled for ${type}; skipping recovery.`);
            s.recovering = false;
            return null;
        }

        const site = window.InjectionTargetsOnWebsite?.activeSite || 'Unknown';

        // Wait a moment for the UI to stabilize (e.g. if the button is just about to appear)
        await new Promise(resolve => setTimeout(resolve, 400));

        // Run Heuristics
        let result = null;

        if (type === 'container') {
            // Special handling for container type
            const failedSelectors = window.InjectionTargetsOnWebsite?.selectors?.containers || [];
            if (window.OneClickPromptsContainerHeuristics && typeof window.OneClickPromptsContainerHeuristics.findAlternativeContainer === 'function') {
                result = window.OneClickPromptsContainerHeuristics.findAlternativeContainer(failedSelectors);
            }

            if (result) {
                logConCgp(`[SelectorAutoDetector] Container heuristics found alternative!`, result);
                // For containers, trigger manual move mode instead of auto-save
                await this.offerContainerPlacement(result);
                s.failures = 0;
            } else {
                logConCgp(`[SelectorAutoDetector] Container heuristics failed. Triggering floating panel fallback.`);
                // Trigger floating panel as last resort
                await this.triggerFloatingPanelFallback();
            }
        } else {
            // Existing logic for editor and sendButton
            const heuristics = window.OneClickPromptsSiteHeuristics?.resolve
                ? window.OneClickPromptsSiteHeuristics.resolve(site)
                : window.OneClickPromptsSelectorAutoDetectorBase;

            if (type === 'editor') {
                result = await heuristics.detectEditor({ site });
            } else if (type === 'sendButton') {
                result = await heuristics.detectSendButton({ site });
            }

            if (result) {
                logConCgp(`[SelectorAutoDetector] Heuristics found new ${type}!`, result);
                const offered = await this.offerToSaveSelector(type, result);
                if (!offered && window.showToast) {
                    window.showToast(`OneClickPrompts: Found the ${typeName}.`, 'success');
                }
                s.failures = 0;
            } else {
                logConCgp(`[SelectorAutoDetector] Heuristics failed to find ${type}.`);
                if (window.showToast) window.showToast(`OneClickPrompts: Could not find ${typeName}. Please report this issue.`, 'error');
            }
        }

        s.recovering = false;
        return result;
    },

    loadSettings: async function () {
        if (!chrome?.runtime?.sendMessage) {
            return;
        }
        try {
            const response = await chrome.runtime.sendMessage({ type: 'getSelectorAutoDetectorSettings' });
            if (response && response.settings) {
                this.settings = {
                    enableEditorHeuristics: response.settings.enableEditorHeuristics !== false,
                    enableSendButtonHeuristics: response.settings.enableSendButtonHeuristics !== false,
                    enableContainerHeuristics: response.settings.enableContainerHeuristics !== false,
                    loaded: true
                };
            }
        } catch (error) {
            logConCgp('[SelectorAutoDetector] Failed to load settings, falling back to defaults.', error);
        }
    },

    ensureSelectorSaver: async function () {
        if (window.OCPSelectorPersistence) {
            return window.OCPSelectorPersistence;
        }
        const saverUrl = chrome?.runtime?.getURL ? chrome.runtime.getURL('modules/selector-auto-detector/selector-save.js') : null;
        if (!saverUrl) return null;
        try {
            const module = await import(saverUrl);
            return module?.OCPSelectorPersistence || window.OCPSelectorPersistence || null;
        } catch (error) {
            logConCgp('[SelectorAutoDetector] Failed to load selector saver module.', error);
            return null;
        }
    },

    /**
     * Triggers the floating panel as a last-resort fallback.
     * Called when container heuristics fail to find any alternative.
     * @returns {Promise<void>}
     */
    triggerFloatingPanelFallback: async function () {
        logConCgp('[SelectorAutoDetector] Creating floating panel as fallback.');

        if (!window.MaxExtensionFloatingPanel || typeof window.MaxExtensionFloatingPanel.createFloatingPanel !== 'function') {
            logConCgp('[SelectorAutoDetector] Floating panel module not available.');
            if (window.showToast) {
                window.showToast('OneClickPrompts: Could not find suitable container and floating panel is not available.', 'error', 5000);
            }
            return;
        }

        try {
            await window.MaxExtensionFloatingPanel.createFloatingPanel();
            const panelElement = window.MaxExtensionFloatingPanel.panelElement;
            const panelContent = document.getElementById('max-extension-floating-panel-content');

            if (panelElement && panelContent) {
                // Clear and populate panel
                panelContent.innerHTML = '';
                if (window.MaxExtensionButtonsInit && typeof window.MaxExtensionButtonsInit.createAndInsertCustomElements === 'function') {
                    window.MaxExtensionButtonsInit.createAndInsertCustomElements(panelContent);
                }

                // Position panel
                if (typeof window.MaxExtensionFloatingPanel.positionPanelTopRight === 'function') {
                    window.MaxExtensionFloatingPanel.positionPanelTopRight();
                } else if (typeof window.MaxExtensionFloatingPanel.positionPanelBottomRight === 'function') {
                    window.MaxExtensionFloatingPanel.positionPanelBottomRight();
                }

                // Make visible
                panelElement.style.display = 'flex';
                window.MaxExtensionFloatingPanel.isPanelVisible = true;

                // Save settings
                if (window.MaxExtensionFloatingPanel.currentPanelSettings) {
                    window.MaxExtensionFloatingPanel.currentPanelSettings.isVisible = true;
                    window.MaxExtensionFloatingPanel.debouncedSavePanelSettings?.();
                }

                if (window.showToast) {
                    window.showToast('OneClickPrompts: Using floating panel (no container found).', 'info', 4000);
                }

                logConCgp('[SelectorAutoDetector] Floating panel fallback activated successfully.');
            } else {
                logConCgp('[SelectorAutoDetector] Failed to create floating panel elements.');
            }
        } catch (err) {
            logConCgp('[SelectorAutoDetector] Error creating floating panel fallback:', err);
            if (window.showToast) {
                window.showToast('OneClickPrompts: Error activating floating panel.', 'error');
            }
        }
    },

    /**
     * Offers the user to accept alternative container placement with manual move mode.
     * @param {HTMLElement} alternativeContainer - The alternative container found by heuristics
     * @returns {Promise<void>}
     */
    offerContainerPlacement: async function (alternativeContainer) {
        if (!alternativeContainer || !window.MaxExtensionButtonsInit) {
            return;
        }

        logConCgp('[SelectorAutoDetector] Injecting buttons into alternative container and entering move mode.');

        // Inject buttons into the alternative container
        try {
            window.MaxExtensionButtonsInit.createAndInsertCustomElements(alternativeContainer);
            window.__OCP_inlineHealthy = true; // Mark as healthy since we found a place
        } catch (err) {
            logConCgp('[SelectorAutoDetector] Failed to inject into alternative container:', err);
            return;
        }

        // Trigger the move mode with floating panel option
        if (window.MaxExtensionContainerMover && typeof window.MaxExtensionContainerMover.enterMoveMode === 'function') {
            // Use the enhanced move mode that includes floating panel button
            window.MaxExtensionContainerMover.enterMoveMode('auto-recovery');
        } else {
            logConCgp('[SelectorAutoDetector] ContainerMover not available for manual placement.');
        }
    },

    /**
     * Offers the user to save a newly found selector via toast action.
     * @param {'editor'|'sendButton'} type
     * @param {HTMLElement} element
     * @returns {Promise<boolean>} whether an actionable toast was shown
     */
    offerToSaveSelector: async function (type, element) {
        const saver = await this.ensureSelectorSaver();
        if (!saver || typeof saver.deriveSelectorFromElement !== 'function' || typeof saver.saveSelectorFromElement !== 'function') {
            return false;
        }
        const site = window.InjectionTargetsOnWebsite?.activeSite || 'Unknown';
        const selector = saver.deriveSelectorFromElement(element);
        if (!selector || !window.showToast) {
            return false;
        }

        const now = Date.now();
        const previous = this.lastOffers[type] || { selector: null, site: null, at: 0 };
        if (previous.selector === selector && previous.site === site && now - previous.at < 15000) {
            logConCgp('[SelectorAutoDetector] Skipping duplicate save toast for selector.', { type, selector, site });
            return false;
        }
        this.lastOffers[type] = { selector, site, at: now };

        const typeName = type === 'editor' ? 'text input selector' : 'send button selector';
        logConCgp('[SelectorAutoDetector] Offering to save selector.', { type, selector, site });
        const tooltip = `Will save selector: ${selector}\nUsed automatically next time (skips auto-detect).\nYou can edit selectors in Settings → Advanced selectors (bottom).`;
        window.showToast(`OneClickPrompts: Found a ${typeName}. Save it to Custom selectors?`, 'success', {
            duration: 15000,
            tooltip,
            actionTooltip: tooltip,
            actionLabel: 'Save selector',
            onAction: async () => {
                const result = await saver.saveSelectorFromElement({
                    site,
                    type,
                    element,
                    selectorOverride: selector
                });
                if (result?.ok) {
                    logConCgp('[SelectorAutoDetector] Selector saved via toast action.', { type, selector: result.selector, site: result.site });
                    window.showToast('Selector saved to Custom selectors.', 'success', 2500);
                } else {
                    logConCgp('[SelectorAutoDetector] Selector save failed.', { type, selector, site, reason: result?.reason });
                    window.showToast('Could not save selector. Try Advanced settings.', 'error', 2500);
                }
            }
        });
        return true;
    }
};

// Initial settings sync and live updates
window.OneClickPromptsSelectorAutoDetector.loadSettings();

if (chrome?.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'selectorAutoDetectorSettingsChanged' && message.settings) {
            window.OneClickPromptsSelectorAutoDetector.settings = {
                enableEditorHeuristics: message.settings.enableEditorHeuristics !== false,
                enableSendButtonHeuristics: message.settings.enableSendButtonHeuristics !== false,
                enableContainerHeuristics: message.settings.enableContainerHeuristics !== false,
                loaded: true
            };
        }
    });
}
