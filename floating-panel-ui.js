// floating-panel-ui.js
// Version: 1.0
//
// Documentation:
// This file contains all UI-related functionality for the floating panel,
// including creation, layout, drag behavior, and button moving logic.
// It extends the window.MaxExtensionFloatingPanel namespace with the corresponding methods.
//
// Key Components:
// 1. Panel Creation - Creates the panel with header, content area, and profile switcher
// 2. Drag Behavior - Makes the panel draggable by the header or footer
// 3. Panel Visibility - Toggles the panel and handles state persistence
// 4. Button Movement - Moves buttons between the original container and floating panel
// 5. Profile Switching UI - Creates and manages the profile dropdown in the panel footer
//
// Key Methods:
// - createFloatingPanel(): Creates the panel DOM structure with styling
// - makeDraggable(): Adds drag functionality to specified elements
// - togglePanel(): Handles panel visibility toggling and button movement
// - moveButtonsToPanel(): Moves buttons from their original container to the panel
// - restorePanelState(): Ensures panel visibility matches saved settings
// - positionPanelAtCursor(): Positions the panel relative to mouse cursor
// - createPanelToggleButton(): Creates the button that summons the floating panel
//
// Known Issues & Fixes:
// - The togglePanel() method avoids loadPanelSettings() when initially creating the panel
//   to prevent race conditions that could cause the panel to disappear after summoning
// - restorePanelState() only toggles the panel if its current state doesn't match the desired state
//   to prevent unintended toggling when loading settings
//
// Dependencies:
// - floating-panel.js: Provides the namespace and shared properties
// - floating-panel-settings.js: Provides settings management methods
// - utils.js: For logging functionality

'use strict';

/**
 * Creates the floating panel element and appends it to the document body.
 * (UI creation, header, content container, and footer.)
 */
window.MaxExtensionFloatingPanel.createFloatingPanel = function() {
    // Check if panel already exists
    if (this.panelElement) {
        return this.panelElement;
    }

    // Create the main panel element
    const panel = document.createElement('div');
    panel.id = 'max-extension-floating-panel';
    panel.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: ${this.currentPanelSettings.width}px;
        height: ${this.currentPanelSettings.height}px;
        background-color: rgba(50, 50, 50, ${this.currentPanelSettings.opacity});
        border: 1px solid #444;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
        display: flex;
        flex-direction: column;
        z-index: 10000;
        overflow: hidden;
        resize: both;
        pointer-events: auto;
        color: rgba(255, 255, 255, 0.9);
    `;

    // Create the panel header for dragging
    const panelHeader = document.createElement('div');
    panelHeader.id = 'max-extension-floating-panel-header';
    panelHeader.style.cssText = `
        padding: 8px 12px;
        background-color: rgba(40, 40, 40, ${this.currentPanelSettings.opacity + 0.1});
        cursor: move;
        display: flex;
        justify-content: space-between;
        align-items: center;
        user-select: none;
    `;

    // Create panel title
    const panelTitle = document.createElement('div');
    panelTitle.textContent = 'OneClickPrompts';
    panelTitle.style.cssText = `
        font-weight: bold;
        font-size: 14px;
        color: rgba(255, 255, 255, 0.9);
    `;

    // Create close button
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '×';
    closeButton.style.cssText = `
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        padding: 0 5px;
        line-height: 1;
        color: rgba(255, 255, 255, 0.9);
    `;
    closeButton.title = 'Close panel and return to injected buttons';
    closeButton.addEventListener('click', () => this.togglePanel());

    // Add title and close button to header
    panelHeader.appendChild(panelTitle);
    panelHeader.appendChild(closeButton);

    // Create content container for buttons
    const contentContainer = document.createElement('div');
    contentContainer.id = 'max-extension-floating-panel-content';
    contentContainer.style.cssText = `
        flex: 1;
        padding: 10px;
        overflow-y: auto;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-content: flex-start;
    `;

    // Create profile switcher footer
    const profileSwitcherContainer = document.createElement('div');
    profileSwitcherContainer.id = 'max-extension-profile-switcher';
    profileSwitcherContainer.style.cssText = `
        padding: 8px 12px;
        background-color: rgba(40, 40, 40, ${this.currentPanelSettings.opacity + 0.1});
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px solid rgba(100, 100, 100, 0.3);
        cursor: move;
    `;

    // Add drag functionality to header and profile switcher (backup if header is off-screen)
    this.makeDraggable(panel, panelHeader);
    this.makeDraggable(panel, profileSwitcherContainer);

    // Append elements to the panel
    panel.appendChild(panelHeader);
    panel.appendChild(contentContainer);
    panel.appendChild(profileSwitcherContainer);

    // Append the panel to the document body
    document.body.appendChild(panel);

    // Initially hide the panel
    panel.style.display = 'none';

    // Add resize event listener to save dimensions
    panel.addEventListener('mouseup', () => {
        if (panel.style.width !== `${this.currentPanelSettings.width}px` || 
            panel.style.height !== `${this.currentPanelSettings.height}px`) {
            
            this.currentPanelSettings.width = parseInt(panel.style.width);
            this.currentPanelSettings.height = parseInt(panel.style.height);
            this.debouncedSavePanelSettings();
        }
    });

    this.panelElement = panel;
    return panel;
};

/**
 * Creates the profile switcher UI inside the panel footer.
 */
window.MaxExtensionFloatingPanel.createProfileSwitcher = function() {
    const switcherContainer = document.getElementById('max-extension-profile-switcher');
    if (!switcherContainer) return;

    // Clear existing content
    switcherContainer.innerHTML = '';

    // Create profile label
    const profileLabel = document.createElement('div');
    profileLabel.textContent = 'Profile:';
    profileLabel.style.cssText = `
        font-size: 12px;
        color: rgba(255, 255, 255, 0.9);
    `;

    // Create profile selector dropdown
    const profileSelector = document.createElement('select');
    profileSelector.id = 'max-extension-profile-selector';
    profileSelector.style.cssText = `
        background-color: rgba(60, 60, 60, 1);
        color: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(100, 100, 100, 0.5);
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 12px;
        cursor: pointer;
        min-width: 120px;
    `;
    
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

    // Append label and selector to the container
    switcherContainer.appendChild(profileLabel);
    switcherContainer.appendChild(profileSelector);
};

/**
 * Makes an element draggable using a given handle element.
 */
window.MaxExtensionFloatingPanel.makeDraggable = function(element, handle) {
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
        element.style.left = (e.clientX - offsetX) + 'px';
        element.style.top = (e.clientY - offsetY) + 'px';
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
window.MaxExtensionFloatingPanel.positionPanelAtCursor = function(event) {
    if (!this.panelElement) return;
    const cursorX = event.clientX;
    const cursorY = event.clientY;
    this.panelElement.style.left = cursorX + 'px';
    this.panelElement.style.top = (cursorY - this.currentPanelSettings.height) + 'px';
    this.currentPanelSettings.posX = parseInt(this.panelElement.style.left);
    this.currentPanelSettings.posY = parseInt(this.panelElement.style.top);
    this.debouncedSavePanelSettings();
};

/**
 * Toggles the visibility of the floating panel.
 * (UI behavior for showing/hiding the panel and moving buttons.)
 */
window.MaxExtensionFloatingPanel.togglePanel = function(event) {
    if (!this.panelElement) {
        this.createFloatingPanel();
        // We load settings here but we won't call loadPanelSettings which would cause a double-toggle
        // We'll set isPanelVisible directly based on the intended action
        this.isPanelVisible = true;
        this.currentPanelSettings.isVisible = true;
        this.debouncedSavePanelSettings();
        
        // Show the floating panel
        this.panelElement.style.display = 'flex';
        // Position the panel
        if (event) {
            this.positionPanelAtCursor(event);
        } else {
            this.panelElement.style.left = this.currentPanelSettings.posX + 'px';
            this.panelElement.style.top = this.currentPanelSettings.posY + 'px';
        }
        // Move buttons to the panel
        this.moveButtonsToPanel();
        
        return;
    }
    
    this.isPanelVisible = !this.isPanelVisible;
    this.currentPanelSettings.isVisible = this.isPanelVisible;
    this.debouncedSavePanelSettings();
    
    if (this.isPanelVisible) {
        // Remove buttons from their original container
        const originalContainer = document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId);
        if (originalContainer) {
            originalContainer.style.display = 'none';
        }
        // Show the floating panel
        this.panelElement.style.display = 'flex';
        // Position the panel
        if (event) {
            this.positionPanelAtCursor(event);
        } else {
            this.panelElement.style.left = this.currentPanelSettings.posX + 'px';
            this.panelElement.style.top = this.currentPanelSettings.posY + 'px';
        }
        // Move buttons to the panel
        this.moveButtonsToPanel();
    } else {
        // Hide the floating panel and restore original buttons
        this.panelElement.style.display = 'none';
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
window.MaxExtensionFloatingPanel.moveButtonsToPanel = function() {
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
 * Creates a toggle button for the floating panel.
 */
window.MaxExtensionFloatingPanel.createPanelToggleButton = function() {
    const toggleButton = document.createElement('button');
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
    
    toggleButton.addEventListener('click', (event) => {
        this.togglePanel(event);
    });
    
    return toggleButton;
};

/**
 * Updates the panel's appearance and position based on current settings.
 */
window.MaxExtensionFloatingPanel.updatePanelFromSettings = function() {
    if (!this.panelElement) return;
    this.panelElement.style.width = `${this.currentPanelSettings.width}px`;
    this.panelElement.style.height = `${this.currentPanelSettings.height}px`;
    this.panelElement.style.left = `${this.currentPanelSettings.posX}px`;
    this.panelElement.style.top = `${this.currentPanelSettings.posY}px`;
    
    // Update opacity
    const bgOpacity = this.currentPanelSettings.opacity;
    this.panelElement.style.backgroundColor = `rgba(50, 50, 50, ${bgOpacity})`;
    
    // Update header and footer opacity
    const headerFooterOpacity = bgOpacity + 0.1;
    const header = document.getElementById('max-extension-floating-panel-header');
    const footer = document.getElementById('max-extension-profile-switcher');
    
    if (header) {
        header.style.backgroundColor = `rgba(40, 40, 40, ${headerFooterOpacity})`;
    }
    if (footer) {
        footer.style.backgroundColor = `rgba(40, 40, 40, ${headerFooterOpacity})`;
    }
};

/**
 * Restores the panel state based on saved settings.
 */
window.MaxExtensionFloatingPanel.restorePanelState = function() {
    if (this.currentPanelSettings.isVisible && !this.isPanelVisible) {
        logConCgp('[floating-panel] Restoring panel to visible state');
        this.togglePanel();
    }
};

/**
 * Refreshes the buttons in the floating panel after a profile switch.
 */
window.MaxExtensionFloatingPanel.refreshButtonsInPanel = function() {
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
