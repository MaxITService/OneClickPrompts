// Version: 1.1
//
// Documentation:
// This file contains UI interaction and state management methods for the floating panel.
// It handles toggling panel visibility, moving buttons between containers,
// updating the panel appearance from settings, restoring state, and refreshing buttons.
//
// Methods included:
// - togglePanel(): Toggles the floating panel’s visibility and manages button movement.
// - updatePanelFromSettings(): Updates the panel’s appearance and position.
//
// Dependencies:
// - floating-panel.js provides the namespace (window.MaxExtensionFloatingPanel).
// - utils.js for logging via logConCgp.
//
'use strict';

/**
 * Toggles the visibility of the floating panel using a "destroy and re-create" approach.
 * This function is for user-driven toggling after the initial page load.
 * @param {Event} [event] - The click event that triggered the toggle.
 */
window.MaxExtensionFloatingPanel.togglePanel = async function (event) {
    // Suppress the resiliency watchdog while we perform this intentional DOM surgery.
    window.OneClickPrompts_isTogglingPanel = true;

    try {
        // Ensure panel DOM structure is available, creating it if it's the first time.
        await this.createFloatingPanel();
        if (!this.panelElement) {
            logConCgp('[floating-panel] Panel creation failed, aborting toggle.');
            return;
        }

        this.isPanelVisible = !this.isPanelVisible;
        this.currentPanelSettings.isVisible = this.isPanelVisible;

        // Await the save to ensure state is persisted before re-initializing. This is critical.
        await this.savePanelSettings();

        if (this.isPanelVisible) {
            logConCgp('[floating-panel] Toggling panel ON. Re-creating buttons in panel.');
            // 1. Destroy the inline buttons container.
            const originalContainer = document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId);
            if (originalContainer) {
                originalContainer.remove();
            }

            // 2. Create buttons directly in the panel.
            const panelContent = document.getElementById('max-extension-floating-panel-content');
            if (panelContent) {
                panelContent.innerHTML = ''; // Ensure it's clean before creating.
                window.MaxExtensionButtonsInit.createAndInsertCustomElements(panelContent);
            }

            // 3. Show and position the panel.
            this.panelElement.style.display = 'flex';
            if (event) {
                this.positionPanelAtCursor(event);
            } else {
                // Non-user summon: ensure we have a sane position
                logConCgp('[floating-panel][fallback] Non-user summon path engaged; ensuring default position (bottom-right) if needed.');
                this.updatePanelFromSettings();
            }

        } else {
            logConCgp('[floating-panel] Toggling panel OFF. Re-initializing extension for inline buttons.');
            // 1. Destroy buttons inside the panel.
            const panelContent = document.getElementById('max-extension-floating-panel-content');
            if (panelContent) {
                panelContent.innerHTML = '';
            }

            // 2. Hide the panel.
            this.panelElement.style.display = 'none';

            // 3. Re-run the entire, robust initialization script.
            // This will correctly detect that the panel is now hidden (since we just saved that setting)
            // and will proceed with the standard, resilient inline injection.
            publicStaticVoidMain();
        }
    } catch (error) {
        logConCgp('[floating-panel] CRITICAL ERROR in togglePanel try block:', error);
    }
    finally {
        // Re-enable the watchdog after a short delay to allow the DOM to settle.
        setTimeout(() => {
            window.OneClickPrompts_isTogglingPanel = false;
            logConCgp('[button-injection] Panel toggling complete. Resiliency check resumed.');
        }, 150);
    }
};


/**
 * Updates the panel's dynamic styles based on current settings.
 * Static styles are now in floating-panel.css.
 */
window.MaxExtensionFloatingPanel.updatePanelFromSettings = function () {
    if (!this.panelElement) return;

    // Position and size
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const width  = Number(this.currentPanelSettings?.width);
    const height = Number(this.currentPanelSettings?.height);
    const safeW = Number.isFinite(width)  && width  > 0 ? width  : (this.panelElement.offsetWidth  || 360);
    const safeH = Number.isFinite(height) && height > 0 ? height : (this.panelElement.offsetHeight || 320);
    this.panelElement.style.width  = `${safeW}px`;
    this.panelElement.style.height = `${safeH}px`;

    const posX = Number(this.currentPanelSettings?.posX);
    const posY = Number(this.currentPanelSettings?.posY);
    const withinX = Number.isFinite(posX) && posX >= 0 && posX <= Math.max(0, viewportW - safeW);
    const withinY = Number.isFinite(posY) && posY >= 0 && posY <= Math.max(0, viewportH - safeH);
    const hasValidSaved = withinX && withinY;

    if (hasValidSaved) {
        this.panelElement.style.left = `${posX}px`;
        this.panelElement.style.top  = `${posY}px`;
    } else {
        logConCgp('[floating-panel][fallback] No valid saved position; placing at bottom-right.');
        this.positionPanelBottomRight?.();
    }

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