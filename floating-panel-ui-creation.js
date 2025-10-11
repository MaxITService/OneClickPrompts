// Version: 1.1
// floating-panel-ui-creation.js
// Documentation:
// This file handles fetching and creating the floating panel from an HTML template.
// It also contains basic behavior methods for making the panel draggable, positioning it,
// and creating the toggle button that summons it.
//
// Methods included:
// - createFloatingPanel(): Fetches floating-panel-files/floating-panel.html and injects it into the page.
// - createProfileSwitcher(): Builds the profile dropdown in the panel footer.
// - makeDraggable(): Enables drag functionality on an element via a handle.
// - positionPanelAtCursor(): Positions the panel relative to the mouse cursor.
// - positionPanelBottomRight(): Positions the panel to the lower-right corner safely.
// - createPanelToggleButton(): Creates the toggle button for summoning the floating panel.
//
// Dependencies:
// - floating-panel.js provides the namespace (window.MaxExtensionFloatingPanel).
// - utils.js for logging via logConCgp.
// 
'use strict';

/**
 * Creates the floating panel element by fetching an HTML template and appending it.
 */
window.MaxExtensionFloatingPanel.createFloatingPanel = async function () {
    // Check if the panel element exists and is still attached to the document.
    if (this.panelElement && document.body.contains(this.panelElement)) {
        return this.panelElement;
    }

    // If the panel element reference exists but is not in the DOM, it's been detached.
    if (this.panelElement) {
        this.panelElement = null; // Reset reference to allow re-creation.
        logConCgp('[floating-panel] Panel element was detached from the DOM. It will be recreated.');
    }

    try {
        const response = await fetch(chrome.runtime.getURL('floating-panel-files/floating-panel.html'));
        if (!response.ok) {
            throw new Error(`Failed to fetch floating-panel-files/floating-panel.html: ${response.statusText}`);
        }
        const html = await response.text();

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const panel = tempDiv.firstElementChild;

        document.body.appendChild(panel);

        // Get references to all elements
        this.panelElement = panel;
        const panelHeader = document.getElementById('max-extension-floating-panel-header');
        const closeButton = document.getElementById('max-extension-panel-close-btn');
        const collapseButton = document.getElementById('max-extension-panel-collapse-btn');
        const transparencyButton = document.getElementById('max-extension-panel-transparency-btn');
        const transparencyPopover = document.getElementById('max-extension-transparency-popover');
        const transparencySlider = document.getElementById('max-extension-transparency-slider');
        const transparencyValue = document.getElementById('max-extension-transparency-value');
        const collapseFooterButton = document.getElementById('max-extension-panel-collapse-footer-btn');
        const profileSwitcherContainer = document.getElementById('max-extension-profile-switcher');

        // Ensure settings object exists before trying to access its properties.
        // This prevents errors on initial load if settings haven't been initialized yet.
        if (!this.currentPanelSettings) {
            this.currentPanelSettings = { ...this.defaultPanelSettings };
        }

        // Apply initial dynamic styles that can't be in the CSS file
        this.updatePanelFromSettings();

        // Attach event listeners
        collapseButton.addEventListener('click', () => {
            if (typeof this.toggleHeaderCollapse === 'function') {
                this.toggleHeaderCollapse();
            }
        });
        if (collapseFooterButton) {
            collapseFooterButton.addEventListener('click', () => {
                if (typeof this.toggleFooterCollapse === 'function') {
                    this.toggleFooterCollapse();
                }
            });
        }
        closeButton.addEventListener('click', () => {
            // If the user closes the panel, don’t auto-reopen it for this tab.
            try {
                window.__OCP_userDisabledFallback = true;
            } catch (_) {}
            this.togglePanel();
        });

        // --- Transparency controls ---
        const clampPercent = (p) => Math.min(70, Math.max(0, Math.round(p)));
        const clampOpacity = (o) => Math.min(1, Math.max(0.3, o));
        const updateTransparencyLabel = (p) => {
            if (transparencyValue) transparencyValue.textContent = `${p}%`;
        };
        const applyTransparencyPercent = (percent) => {
            const clampedPercent = clampPercent(percent);
            if (transparencySlider && String(transparencySlider.value) !== String(clampedPercent)) {
                transparencySlider.value = clampedPercent;
            }
            updateTransparencyLabel(clampedPercent);
            const newOpacity = clampOpacity(1 - (clampedPercent / 100));
            if (!this.currentPanelSettings) this.currentPanelSettings = { ...this.defaultPanelSettings };
            this.currentPanelSettings.opacity = newOpacity;
            this.updatePanelFromSettings();
            this.debouncedSavePanelSettings();
        };

        const getCurrentTransparencyPercent = () => {
            let currentOpacity = this.currentPanelSettings?.opacity;
            if (typeof currentOpacity !== 'number' || Number.isNaN(currentOpacity)) {
                currentOpacity = this.defaultPanelSettings.opacity;
            }
            currentOpacity = clampOpacity(currentOpacity);
            const percent = Math.round((1 - currentOpacity) * 100);
            return clampPercent(percent);
        };

        if (transparencyButton && transparencyPopover && transparencySlider) {
            // Initialize slider position from current settings
            const initialPercent = getCurrentTransparencyPercent();
            transparencySlider.value = initialPercent;
            updateTransparencyLabel(initialPercent);

            // Toggle popover
            transparencyButton.addEventListener('click', (e) => {
                e.stopPropagation();
                const isVisible = transparencyPopover.style.display === 'block';
                transparencyPopover.style.display = isVisible ? 'none' : 'block';
                if (!isVisible) {
                    // Sync slider each time it opens
                    const p = getCurrentTransparencyPercent();
                    transparencySlider.value = p;
                    updateTransparencyLabel(p);
                }
            });

            // Close on outside click
            const outsideClickHandler = (e) => {
                if (!transparencyPopover || transparencyPopover.style.display !== 'block') return;
                const withinPopover = transparencyPopover.contains(e.target);
                const onButton = transparencyButton.contains(e.target);
                if (!withinPopover && !onButton) {
                    transparencyPopover.style.display = 'none';
                }
            };
            document.addEventListener('mousedown', outsideClickHandler, true);

            // Close on ESC
            const escHandler = (e) => {
                if (e.key === 'Escape' && transparencyPopover.style.display === 'block') {
                    transparencyPopover.style.display = 'none';
                }
            };
            document.addEventListener('keydown', escHandler, true);

            // Slider input -> live preview + save (debounced)
            transparencySlider.addEventListener('input', (e) => {
                const val = Number(e.target.value);
                applyTransparencyPercent(val);
            });
            // Prevent drag interference while interacting with slider
            transparencySlider.addEventListener('mousedown', (event) => event.stopPropagation());
            transparencySlider.addEventListener('click', (event) => event.stopPropagation());
        }

        this.makeDraggable(panel, panelHeader);
        this.makeDraggable(panel, profileSwitcherContainer);

        // Resize listener
        panel.addEventListener('mouseup', () => {
            if (this.currentPanelSettings && (panel.style.width !== `${this.currentPanelSettings.width}px` ||
                panel.style.height !== `${this.currentPanelSettings.height}px`)) {

                this.currentPanelSettings.width = parseInt(panel.style.width);
                this.currentPanelSettings.height = parseInt(panel.style.height);
                this.debouncedSavePanelSettings();
            }
        });

        // Initialize the queue section with its logic
        this.initializeQueueSection();

        // Initially hide the panel
        panel.style.display = 'none';

        logConCgp('[floating-panel] Floating panel created from HTML template.');
        return panel;

    } catch (error) {
        logConCgp('[floating-panel] Error creating floating panel from template:', error);
        return null;
    }
};

/**
 * Creates the profile switcher UI inside the panel footer.
 */
window.MaxExtensionFloatingPanel.createProfileSwitcher = function () {
    const switcherContainer = document.getElementById('max-extension-profile-switcher');
    if (!switcherContainer) return;

    // Clear existing content
    switcherContainer.innerHTML = '';

    // Create a container for profile elements (label + dropdown)
    const profileContainer = document.createElement('div');
    profileContainer.className = 'profile-elements-container';
    profileContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
    `;

    // Create profile label
    const profileLabel = document.createElement('div');
    profileLabel.textContent = 'Profile:';

    // Create profile selector dropdown
    const profileSelector = document.createElement('select');
    profileSelector.id = 'max-extension-profile-selector';

    // Prevent dragging when interacting with the dropdown
    profileSelector.addEventListener('mousedown', (event) => {
        event.stopPropagation();
    });
    profileSelector.addEventListener('click', (event) => {
        event.stopPropagation();
    });

    // Populate the dropdown with available profiles
    this.availableProfiles.forEach(profileName => {
        const option = document.createElement('option');
        option.value = profileName;
        option.textContent = profileName;
        if (profileName === this.currentProfileName) {
            option.selected = true;
        }
        profileSelector.appendChild(option);
    });

    // Add change event listener to the profile selector
    profileSelector.addEventListener('change', (event) => {
        const selectedProfileName = event.target.value;
        this.switchToProfile(selectedProfileName);
    });

    // Append label and selector to the profile container
    profileContainer.appendChild(profileLabel);
    profileContainer.appendChild(profileSelector);

    // Create a container for the queue toggle (will be moved here when space allows)
    const queueToggleContainer = document.createElement('div');
    queueToggleContainer.id = 'max-extension-queue-toggle-footer';
    queueToggleContainer.className = 'queue-toggle-footer-container';
    queueToggleContainer.style.cssText = `
        display: none;
        margin-right: 16px;
    `;

    // Append queue toggle and profile containers to the switcher (they will appear on the left)
    switcherContainer.appendChild(queueToggleContainer);
    switcherContainer.appendChild(profileContainer);

    // Initialize responsive queue toggle positioning
    this.initializeResponsiveQueueToggle();
};

/**
 * Makes an element draggable using a given handle element.
 */
window.MaxExtensionFloatingPanel.makeDraggable = function (element, handle) {
    let offsetX = 0;
    let offsetY = 0;

    const startDrag = (e) => {
        e.preventDefault();
        offsetX = e.clientX - element.getBoundingClientRect().left;
        offsetY = e.clientY - element.getBoundingClientRect().top;
        document.addEventListener('mousemove', dragElement);
        document.addEventListener('mouseup', stopDrag);
    };

    const dragElement = (e) => {
        e.preventDefault();

        // Calculate the new position
        let newLeft = e.clientX - offsetX;
        let newTop = e.clientY - offsetY;

        // Get viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Get panel dimensions
        const panelWidth = element.offsetWidth;
        const panelHeight = element.offsetHeight;

        // Constrain the horizontal position (left)
        newLeft = Math.max(0, newLeft);
        newLeft = Math.min(newLeft, viewportWidth - panelWidth);

        // Constrain the vertical position (top)
        newTop = Math.max(0, newTop);
        newTop = Math.min(newTop, viewportHeight - panelHeight);

        // Apply the constrained position
        element.style.left = newLeft + 'px';
        element.style.top = newTop + 'px';
    };

    const stopDrag = () => {
        document.removeEventListener('mousemove', dragElement);
        document.removeEventListener('mouseup', stopDrag);
        this.currentPanelSettings.posX = parseInt(element.style.left);
        this.currentPanelSettings.posY = parseInt(element.style.top);
        this.debouncedSavePanelSettings();
    };

    handle.addEventListener('mousedown', startDrag);
};

/**
 * Positions the floating panel at the mouse cursor's position.
 */
window.MaxExtensionFloatingPanel.positionPanelAtCursor = function (event) {
    if (!this.panelElement) return;
    const cursorX = event.clientX;
    const cursorY = event.clientY;
    this.panelElement.style.left = cursorX + 'px';
    this.panelElement.style.top = (cursorY - this.currentPanelSettings.height) + 'px';
    this.currentPanelSettings.posX = parseInt(this.panelElement.style.left);
    this.currentPanelSettings.posY = parseInt(this.panelElement.style.top);
};

/**
 * Creates a toggle button for the floating panel.
 */

/**
 * Positions the floating panel in the bottom-right corner of the viewport.
 * Performs a secondary adjustment in the next animation frame to account for
 * late layout shifts (e.g. scrollbars).
 */
window.MaxExtensionFloatingPanel.positionPanelBottomRight = function () {
    if (!this.panelElement) return;
    const margin = 20;
    const panelWidth = this.panelElement.offsetWidth || this.currentPanelSettings.width || 300;
    const panelHeight = this.panelElement.offsetHeight || this.currentPanelSettings.height || 400;
    let newLeft = Math.max(window.innerWidth - panelWidth - margin, 0);
    let newTop = Math.max(window.innerHeight - panelHeight - margin, 0);
    this.panelElement.style.left = `${newLeft}px`;
    this.panelElement.style.top = `${newTop}px`;
    this.currentPanelSettings.posX = parseInt(newLeft);
    this.currentPanelSettings.posY = parseInt(newTop);
    this.debouncedSavePanelSettings?.();
    requestAnimationFrame(() => {
        const adjustedLeft = Math.max(window.innerWidth - this.panelElement.offsetWidth - margin, 0);
        const adjustedTop = Math.max(window.innerHeight - this.panelElement.offsetHeight - margin, 0);
        this.panelElement.style.left = `${adjustedLeft}px`;
        this.panelElement.style.top = `${adjustedTop}px`;
        this.currentPanelSettings.posX = parseInt(adjustedLeft);
        this.currentPanelSettings.posY = parseInt(adjustedTop);
        this.debouncedSavePanelSettings?.();
    });
};

/**
 * Positions the floating panel in the TOP-right corner of the viewport.
 */
window.MaxExtensionFloatingPanel.positionPanelTopRight = function () {
    if (!this.panelElement) return;
    const margin = 20;
    const panelWidth = this.panelElement.offsetWidth || this.currentPanelSettings.width || 300;
    // top-right = x near right edge, y near top
    let newLeft = Math.max(window.innerWidth - panelWidth - margin, 0);
    let newTop = margin;
    this.panelElement.style.left = `${newLeft}px`;
    this.panelElement.style.top = `${newTop}px`;
    this.currentPanelSettings.posX = parseInt(newLeft);
    this.currentPanelSettings.posY = parseInt(newTop);
    this.debouncedSavePanelSettings?.();
    // second pass after layout settles
    requestAnimationFrame(() => {
        const adjustedLeft = Math.max(window.innerWidth - this.panelElement.offsetWidth - margin, 0);
        const adjustedTop = margin;
        this.panelElement.style.left = `${adjustedLeft}px`;
        this.panelElement.style.top = `${adjustedTop}px`;
        this.currentPanelSettings.posX = parseInt(adjustedLeft);
        this.currentPanelSettings.posY = parseInt(adjustedTop);
        this.debouncedSavePanelSettings?.();
    });
};

window.MaxExtensionFloatingPanel.createPanelToggleButton = function () {
    const toggleButton = document.createElement('button');
    toggleButton.type = 'button'; // Prevent form submission!
    toggleButton.innerHTML = '🔼';
    toggleButton.style.cssText = `
        background-color: transparent;
        border: none;
        cursor: pointer;
        padding: 1px;
        font-size: 20px;
        margin-right: 5px;
        margin-bottom: 5px;
    `;
    toggleButton.title = 'Toggle floating button panel';

    toggleButton.addEventListener('click', async (event) => {
        await this.togglePanel(event);
    });

    return toggleButton;
};

/**
 * Ensures the floating panel stays fully within the current viewport.
 * Applies a single clamping adjustment and saves the corrected position.
 * This mirrors the drag-time bounds logic and is intended for a one-time
 * correction right after spawn or settings load.
 */
window.MaxExtensionFloatingPanel.ensurePanelWithinViewport = function () {
    if (!this.panelElement) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Prefer actual rendered size; fall back to settings if not measured yet
    const panelWidth = this.panelElement.offsetWidth || this.currentPanelSettings?.width || 300;
    const panelHeight = this.panelElement.offsetHeight || this.currentPanelSettings?.height || 400;

    // Read the intended position (style wins; then settings)
    let left = parseInt(this.panelElement.style.left, 10);
    if (Number.isNaN(left)) left = parseInt(this.currentPanelSettings?.posX, 10) || 0;
    let top = parseInt(this.panelElement.style.top, 10);
    if (Number.isNaN(top)) top = parseInt(this.currentPanelSettings?.posY, 10) || 0;

    const maxLeft = Math.max(0, viewportWidth - panelWidth);
    const maxTop = Math.max(0, viewportHeight - panelHeight);
    const clampedLeft = Math.min(Math.max(0, left), maxLeft);
    const clampedTop = Math.min(Math.max(0, top), maxTop);

    if (clampedLeft !== left || clampedTop !== top) {
        this.panelElement.style.left = clampedLeft + 'px';
        this.panelElement.style.top = clampedTop + 'px';
        if (this.currentPanelSettings) {
            this.currentPanelSettings.posX = clampedLeft;
            this.currentPanelSettings.posY = clampedTop;
            this.debouncedSavePanelSettings?.();
        }
        try { logConCgp('[floating-panel] Adjusted panel inside viewport bounds after spawn/settings load.'); } catch (_) {}
    }
};

/**
 * Initializes responsive positioning for the queue toggle based on available space.
 */
window.MaxExtensionFloatingPanel.initializeResponsiveQueueToggle = function () {
    // This will be called after the queue section is initialized
    // We'll add a resize observer to monitor panel width changes
    if (!this.panelElement) return;

    const checkSpaceAndMoveToggle = () => {
        const queueToggleOriginal = document.getElementById('max-extension-queue-toggle-placeholder');
        const queueToggleFooter = document.getElementById('max-extension-queue-toggle-footer');
        const profileSwitcher = document.getElementById('max-extension-profile-switcher');
        const queueSection = document.getElementById('max-extension-queue-section');
        const controlsContainer = queueSection?.querySelector('.controls-container');
        const expandableSection = queueSection?.querySelector('.expandable-queue-controls');
        const tosWarning = document.getElementById('max-extension-queue-tos-warning');

        if (!queueToggleOriginal || !queueToggleFooter || !profileSwitcher || !queueSection || !controlsContainer) return;

        const panelWidth = this.panelElement.offsetWidth;
        const minWidthForFooterPlacement = 350;
        const toggle = this.queueModeToggle;
        const isToggleInOriginal = toggle && toggle.parentElement === queueToggleOriginal;
        const toggleLabel = toggle?.querySelector('label');

        let forcedFooter = this.queueToggleForcedToFooter === true;
        let labelOverflowing = false;
        if (isToggleInOriginal && toggleLabel) {
            labelOverflowing = (toggleLabel.scrollWidth - toggleLabel.clientWidth) > 1;
            if (labelOverflowing) {
                forcedFooter = true;
                this.queueToggleForcedToFooter = true;
            }
        }

        if (panelWidth >= minWidthForFooterPlacement && !labelOverflowing) {
            forcedFooter = false;
            this.queueToggleForcedToFooter = false;
        }

        const shouldMoveToFooter = panelWidth >= minWidthForFooterPlacement || forcedFooter;

        // Determine if TOS warning is currently visible using computed style (works regardless of inline or stylesheet rules).
        const tosVisible = !!tosWarning && window.getComputedStyle(tosWarning).display !== 'none';

        if (shouldMoveToFooter) {
            if (toggle && toggle.parentElement === queueToggleOriginal) {
                queueToggleFooter.appendChild(toggle);
                queueToggleFooter.style.display = 'flex';
                queueToggleOriginal.style.display = 'none';
            }

            if (tosVisible) {
                queueSection.style.display = 'flex';
                if (expandableSection) expandableSection.style.display = 'none';
            } else {
                const isQueueEnabled = window.globalMaxExtensionConfig?.enableQueueMode || false;
                if (isQueueEnabled) {
                    queueSection.style.display = 'flex';
                    if (expandableSection) expandableSection.style.display = 'contents';
                } else {
                    queueSection.style.display = 'none';
                }
            }
        } else {
            if (toggle && toggle.parentElement === queueToggleFooter) {
                queueToggleFooter.style.display = 'none';
                queueToggleOriginal.style.display = 'block';
                queueToggleOriginal.appendChild(toggle);
                this.queueToggleForcedToFooter = false;

                if (toggleLabel && (toggleLabel.scrollWidth - toggleLabel.clientWidth) > 1) {
                    this.queueToggleForcedToFooter = true;
                    queueToggleFooter.appendChild(toggle);
                    queueToggleFooter.style.display = 'flex';
                    queueToggleOriginal.style.display = 'none';
                }
            }
            queueSection.style.display = 'flex';
        }
    };

    // Initial check
    setTimeout(checkSpaceAndMoveToggle, 100);

    // Monitor panel resize
    if (window.ResizeObserver) {
        const resizeObserver = new ResizeObserver(checkSpaceAndMoveToggle);
        resizeObserver.observe(this.panelElement);
        this.queueToggleResizeObserver = resizeObserver;
    }

    // Also check on window resize as fallback
    window.addEventListener('resize', checkSpaceAndMoveToggle);
};

/**
 * Updates the visibility of the queue section based on toggle placement and state.
 * This function now respects the TOS warning visibility: if the warning is showing,
 * the queue section must remain visible to display it.
 */
window.MaxExtensionFloatingPanel.updateQueueSectionVisibility = function (isToggleInFooter) {
    const queueSection = document.getElementById('max-extension-queue-section');
    const tosWarning = document.getElementById('max-extension-queue-tos-warning');
    if (!queueSection) return;

    const tosVisible = !!tosWarning && window.getComputedStyle(tosWarning).display !== 'none';

    if (tosVisible) {
        // Force visible to keep the warning accessible
        queueSection.style.display = 'flex';
        return;
    }

    if (isToggleInFooter) {
        // Hide the entire queue section when toggle is in footer and no TOS warning is shown
        queueSection.style.display = 'none';
    } else {
        // Show the queue section when toggle is back in original position
        queueSection.style.display = 'flex';
    }
};
