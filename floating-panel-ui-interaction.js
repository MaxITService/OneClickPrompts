// Version: 1.1
//
// Documentation:
// This file contains UI interaction and state management methods for the floating panel.
// It handles toggling panel visibility, moving buttons between containers,
// updating the panel appearance from settings, restoring state, and refreshing buttons.
//
// Methods included:
// - togglePanel(): Toggles the floating panel’s visibility and manages button movement.
// - moveButtonsToPanel(): Moves buttons from the original container to the panel.
// - updatePanelFromSettings(): Updates the panel’s appearance and position.
// - restorePanelState(): Restores the panel visibility based on saved settings.
// - refreshButtonsInPanel(): Refreshes the buttons displayed in the panel after a profile switch.
//
// Dependencies:
// - floating-panel.js provides the namespace (window.MaxExtensionFloatingPanel).
// - utils.js for logging via logConCgp.
//
'use strict';

/**
 * Toggles the visibility of the floating panel.
 * Uses async/await to handle the initial creation of the panel from the HTML template.
 */
window.MaxExtensionFloatingPanel.togglePanel = async function (event) {
    if (!this.panelElement) {
        await this.createFloatingPanel();
        if (!this.panelElement) {
            logConCgp('[floating-panel] Panel creation failed, aborting toggle.');
            return;
        }

        // This is the first time the panel is being shown.
        this.isPanelVisible = true;
        this.currentPanelSettings.isVisible = true;

        // Show the floating panel
        this.panelElement.style.display = 'flex';
        // Position the panel
        if (event) {
            this.positionPanelAtCursor(event);
        } else {
            // This case is unlikely on first toggle, but good for robustness
            this.updatePanelFromSettings();
        }
        // Move buttons to the panel
        this.moveButtonsToPanel();
        this.debouncedSavePanelSettings();
        return;
    }

    this.isPanelVisible = !this.isPanelVisible;
    this.currentPanelSettings.isVisible = this.isPanelVisible;
    this.debouncedSavePanelSettings();

    if (this.isPanelVisible) {
        // Hide the original button container
        const originalContainer = document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId);
        if (originalContainer) {
            originalContainer.style.display = 'none';
        }
        // Show the floating panel
        this.panelElement.style.display = 'flex';
        // Position the panel if it's being opened by a click event
        if (event) {
            this.positionPanelAtCursor(event);
        } else {
            // Otherwise, just ensure its position is up to date with settings
            this.updatePanelFromSettings();
        }
        // Move buttons to the panel
        this.moveButtonsToPanel();
    } else {
        // Hide the floating panel
        this.panelElement.style.display = 'none';

        // Show the original button container and refresh its content
        const originalContainer = document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId);
        if (originalContainer) {
            originalContainer.style.display = 'flex';
            chrome.runtime.sendMessage({ type: 'getConfig' }, (response) => {
                if (response && response.config) {
                    window.globalMaxExtensionConfig = response.config;
                    if (window.MaxExtensionButtonsInit && window.MaxExtensionButtonsInit.updateButtonsForProfileChange) {
                        window.MaxExtensionButtonsInit.updateButtonsForProfileChange();
                        console.log('[floating-panel] Refreshed configuration and updated buttons after closing panel');
                    }
                }
            });
        }
    }
};

/**
 * Moves the buttons from their original container to the floating panel.
 */
window.MaxExtensionFloatingPanel.moveButtonsToPanel = function () {
    const originalContainer = document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId);
    const panelContent = document.getElementById('max-extension-floating-panel-content');

    if (!originalContainer || !panelContent) {
        logConCgp('[floating-panel] Cannot move buttons: container or panel content not found');
        return;
    }

    // Clear existing content in the panel
    panelContent.innerHTML = '';
    const buttonConfigs = globalMaxExtensionConfig.customButtons;
    let configIndex = 0;

    Array.from(originalContainer.children).forEach(child => {
        // Skip the toggle button (🔼)
        if (child.tagName === 'BUTTON' && child.innerHTML === '🔼') {
            return;
        }

        const clone = child.cloneNode(true);
        if (clone.tagName === 'BUTTON') {
            const currentConfigIndex = configIndex;
            clone.replaceWith(clone.cloneNode(true));
            const freshClone = clone;
            freshClone.addEventListener('click', (event) => {
                if (currentConfigIndex < buttonConfigs.length) {
                    const buttonConfig = buttonConfigs[currentConfigIndex];
                    if (buttonConfig && !buttonConfig.separator) {
                        processCustomSendButtonClick(event, buttonConfig.text, buttonConfig.autoSend);
                    }
                }
            });
            panelContent.appendChild(freshClone);
        } else {
            panelContent.appendChild(clone);
        }
        configIndex++;
    });
};

/**
 * Updates the panel's dynamic styles based on current settings.
 * Static styles are now in floating-panel.css.
 */
window.MaxExtensionFloatingPanel.updatePanelFromSettings = function () {
    if (!this.panelElement) return;

    // Position and size
    this.panelElement.style.width = `${this.currentPanelSettings.width}px`;
    this.panelElement.style.height = `${this.currentPanelSettings.height}px`;
    this.panelElement.style.left = `${this.currentPanelSettings.posX}px`;
    this.panelElement.style.top = `${this.currentPanelSettings.posY}px`;

    // Opacity
    const bgOpacity = this.currentPanelSettings.opacity;
    this.panelElement.style.backgroundColor = `rgba(50, 50, 50, ${bgOpacity})`;

    // Header, footer, and queue section opacity
    const headerFooterOpacity = bgOpacity + 0.1;
    const header = document.getElementById('max-extension-floating-panel-header');
    const footer = document.getElementById('max-extension-profile-switcher');
    const queueSection = document.getElementById('max-extension-queue-section');

    if (header) {
        header.style.backgroundColor = `rgba(40, 40, 40, ${headerFooterOpacity})`;
    }
    if (footer) {
        footer.style.backgroundColor = `rgba(40, 40, 40, ${headerFooterOpacity})`;
    }
    if (queueSection) {
        queueSection.style.backgroundColor = `rgba(60, 60, 60, ${headerFooterOpacity})`;
    }
};

/**
 * Restores the panel state based on saved settings.
 */
window.MaxExtensionFloatingPanel.restorePanelState = async function () {
    if (this.currentPanelSettings.isVisible && !this.isPanelVisible) {
        logConCgp('[floating-panel] Restoring panel to visible state');
        await this.togglePanel();
    }
};

/**
 * Refreshes the buttons in the floating panel after a profile switch.
 */
window.MaxExtensionFloatingPanel.refreshButtonsInPanel = function () {
    const panelContent = document.getElementById('max-extension-floating-panel-content');
    if (!panelContent) return;
    panelContent.innerHTML = '';
    window.MaxExtensionButtonsInit.generateAndAppendCustomSendButtons(panelContent);
    window.MaxExtensionButtonsInit.generateAndAppendToggles(panelContent);

    // If panel is not visible, also update the original container.
    if (!this.isPanelVisible) {
        const originalContainer = document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId);
        if (originalContainer) {
            originalContainer.innerHTML = '';
            window.MaxExtensionButtonsInit.generateAndAppendCustomSendButtons(originalContainer);
            window.MaxExtensionButtonsInit.generateAndAppendToggles(originalContainer);
        }
    }
};