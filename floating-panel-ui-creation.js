// Version: 1.1
//
// Documentation:
// This file handles fetching and creating the floating panel from an HTML template.
// It also contains basic behavior methods for making the panel draggable, positioning it,
// and creating the toggle button that summons it.
//
// Methods included:
// - createFloatingPanel(): Fetches floating-panel.html and injects it into the page.
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
        const response = await fetch(chrome.runtime.getURL('floating-panel.html'));
        if (!response.ok) {
            throw new Error(`Failed to fetch floating-panel.html: ${response.statusText}`);
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
        const profileSwitcherContainer = document.getElementById('max-extension-profile-switcher');

        // Ensure settings object exists before trying to access its properties.
        // This prevents errors on initial load if settings haven't been initialized yet.
        if (!this.currentPanelSettings) {
            this.currentPanelSettings = { ...this.defaultPanelSettings };
        }

        // Apply initial dynamic styles that can't be in the CSS file
        this.updatePanelFromSettings();

        // Attach event listeners
        closeButton.addEventListener('click', () => this.togglePanel());

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

    toggleButton.addEventListener('click', async (event) => {
        await this.togglePanel(event);
    });

    return toggleButton;
};