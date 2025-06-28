// floating-panel-ui-creation.js
// Version: 1.0
//
// Documentation:
// This file contains UI creation and basic behavior methods for the floating panel.
// It handles creation of the panel DOM structure, profile switcher, drag functionality,
// positioning at the cursor, and the creation of the toggle button.
//
// Methods included:
// - createFloatingPanel(): Creates the panel element with header, content container, and footer.
// - createProfileSwitcher(): Builds the profile dropdown in the panel footer.
// - makeDraggable(): Enables drag functionality on an element via a handle.
// - positionPanelAtCursor(): Positions the panel relative to the mouse cursor.
// - createPanelToggleButton(): Creates the toggle button for summoning the floating panel.
//
// Dependencies:
// - floating-panel.js provides the namespace (window.MaxExtensionFloatingPanel).
// - utils.js for logging via logConCgp.
// 
'use strict';

/**
 * Creates the floating panel element and appends it to the document body.
 * (UI creation, header, content container, and footer.)
 */
window.MaxExtensionFloatingPanel.createFloatingPanel = function () {
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

    // --- Create and insert Queue Section ---
    const queueSection = this.createQueueSection();

    // Add drag functionality to header and profile switcher (backup if header is off-screen)
    this.makeDraggable(panel, panelHeader);
    this.makeDraggable(panel, profileSwitcherContainer);

    // Append elements to the panel
    panel.appendChild(panelHeader);
    panel.appendChild(contentContainer);
    panel.appendChild(queueSection);
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
window.MaxExtensionFloatingPanel.createProfileSwitcher = function () {
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
window.MaxExtensionFloatingPanel.positionPanelAtCursor = function (event) {
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
 * Creates a toggle button for the floating panel.
 */
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

    toggleButton.addEventListener('click', (event) => {
        this.togglePanel(event);
    });

    return toggleButton;
};


