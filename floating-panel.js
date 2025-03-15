// floating-panel.js
// Version: 1.0
//
// Documentation:
/**
 * This file implements a floating, customizable button panel for the OneClickPrompts extension.
 * The panel allows users to access their custom buttons in a draggable, resizable, 
 * and semi-transparent window that floats on top of the target website.
 * 
 * Features:
 * - Draggable and resizable floating panel
 * - Semi-transparent appearance for enhanced UX
 * - Toggle between this panel and injected buttons
 * - Persists panel position and size per website
 * - Closes with an "x" button
 * 
 * Usage:
 * This file should be included in the content_scripts section of the manifest.json
 * after buttons.js and before init.js to ensure proper functionality.
 * 
 * Dependencies:
 * - utils.js - Contains utility functions and selectors
 * - buttons.js - Manages custom button creation
 * - buttons-init.js - Handles button initialization
 * - interface.js - Manages UI element creation
 * - config.js - Service worker for saving/loading settings
 */
'use strict';

/**
 * Namespace object containing functions related to the floating panel.
 */
window.MaxExtensionFloatingPanel = {
    /**
     * The floating panel element itself.
     * @type {HTMLElement|null}
     */
    panelElement: null,

    /**
     * Flag indicating whether the floating panel is currently visible.
     * @type {boolean}
     */
    isPanelVisible: false,

    /**
     * Storage key prefix for panel settings.
     * This will be combined with the hostname to create website-specific settings.
     * @type {string}
     */
    storageKeyPrefix: 'floating_panel_',

    /**
     * Default panel settings.
     * @type {Object}
     */
    defaultPanelSettings: {
        width: 300,
        height: 400,
        posX: 100,
        posY: 100,
        opacity: 0.7,
        isVisible: false
    },

    /**
     * Current panel settings, will be loaded from localStorage or use defaults.
     * @type {Object}
     */
    currentPanelSettings: null,

    /**
     * Timer for debounced position saving.
     * @type {number|null}
     */
    savePositionTimer: null,

    /**
     * Creates the floating panel element and appends it to the document body.
     * The panel includes a draggable header, close button, and content area for buttons.
     * @returns {HTMLElement} The created floating panel element.
     */
    createFloatingPanel: function() {
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

        // Add drag functionality to header
        this.makeDraggable(panel, panelHeader);
        
        // Append elements to the panel
        panel.appendChild(panelHeader);
        panel.appendChild(contentContainer);
        
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
    },

    /**
     * Positions the floating panel at the mouse cursor's position.
     * @param {MouseEvent} event - The mouse event (usually a click event).
     */
    positionPanelAtCursor: function(event) {
        if (!this.panelElement) return;
        
        // Get cursor position
        const cursorX = event.clientX;
        const cursorY = event.clientY;
        
        // Position the panel so the bottom-left corner is at the cursor
        this.panelElement.style.left = cursorX + 'px';
        this.panelElement.style.top = (cursorY - this.currentPanelSettings.height) + 'px';
        
        // Update settings
        this.currentPanelSettings.posX = parseInt(this.panelElement.style.left);
        this.currentPanelSettings.posY = parseInt(this.panelElement.style.top);
        this.debouncedSavePanelSettings();
    },

    /**
     * Makes an element draggable by a handle element.
     * @param {HTMLElement} element - The element to make draggable.
     * @param {HTMLElement} handle - The handle element to use for dragging.
     */
    makeDraggable: function(element, handle) {
        let offsetX = 0;
        let offsetY = 0;
        
        const startDrag = (e) => {
            e.preventDefault();
            
            // Get current mouse position
            offsetX = e.clientX - element.getBoundingClientRect().left;
            offsetY = e.clientY - element.getBoundingClientRect().top;
            
            // Add mousemove and mouseup event listeners
            document.addEventListener('mousemove', dragElement);
            document.addEventListener('mouseup', stopDrag);
        };
        
        const dragElement = (e) => {
            e.preventDefault();
            
            // Calculate new position
            element.style.left = (e.clientX - offsetX) + 'px';
            element.style.top = (e.clientY - offsetY) + 'px';
        };
        
        const stopDrag = () => {
            // Remove event listeners
            document.removeEventListener('mousemove', dragElement);
            document.removeEventListener('mouseup', stopDrag);
            
            // Save the panel position with debouncing
            this.currentPanelSettings.posX = parseInt(element.style.left);
            this.currentPanelSettings.posY = parseInt(element.style.top);
            this.debouncedSavePanelSettings();
        };
        
        // Add mousedown event listener to the handle
        handle.addEventListener('mousedown', startDrag);
    },

    /**
     * Toggles the visibility of the floating panel.
     * If the panel is currently visible, it will be hidden and buttons will be injected.
     * If the panel is hidden, it will be shown and buttons will be removed from their original location.
     * @param {MouseEvent} [event] - Optional mouse event for positioning the panel.
     */
    togglePanel: function(event) {
        if (!this.panelElement) {
            this.loadPanelSettings();
            this.createFloatingPanel();
        }
        
        this.isPanelVisible = !this.isPanelVisible;
        this.currentPanelSettings.isVisible = this.isPanelVisible;
        this.debouncedSavePanelSettings();
        
        if (this.isPanelVisible) {
            // Remove buttons from their original location
            const originalContainer = document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId);
            if (originalContainer) {
                originalContainer.style.display = 'none';
            }
            
            // Show the floating panel
            this.panelElement.style.display = 'flex';
            
            // Position the panel at the cursor if an event is provided
            if (event) {
                this.positionPanelAtCursor(event);
            } else {
                // Otherwise use the saved position
                this.panelElement.style.left = this.currentPanelSettings.posX + 'px';
                this.panelElement.style.top = this.currentPanelSettings.posY + 'px';
            }
            
            // Move the buttons to the panel
            this.moveButtonsToPanel();
        } else {
            // Hide the floating panel
            this.panelElement.style.display = 'none';
            
            // Restore buttons to their original location
            const originalContainer = document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId);
            if (originalContainer) {
                originalContainer.style.display = 'flex';
            }
        }
    },

    /**
     * Moves the buttons from their original container to the floating panel.
     */
    moveButtonsToPanel: function() {
        const originalContainer = document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId);
        const panelContent = document.getElementById('max-extension-floating-panel-content');
        
        if (!originalContainer || !panelContent) {
            logConCgp('[floating-panel] Cannot move buttons: container or panel content not found');
            return;
        }
        
        // Clear existing content in the panel
        panelContent.innerHTML = '';
        
        // Clone buttons from the original container, excluding the toggle button
        Array.from(originalContainer.children).forEach(child => {
            // Skip the toggle button (the one with 🔼 emoji)
            if (child.tagName === 'BUTTON' && child.innerHTML === '🔼') {
                return; // Skip this button
            }
            
            const clone = child.cloneNode(true);
            
            // Reattach event listeners for buttons
            if (clone.tagName === 'BUTTON') {
                clone.addEventListener('click', (event) => {
                    // Extract button data
                    const buttonIndex = Array.from(originalContainer.children).findIndex(btn => 
                        btn.getAttribute('data-testid') === clone.getAttribute('data-testid')
                    );
                    
                    if (buttonIndex >= 0) {
                        const buttonConfig = globalMaxExtensionConfig.customButtons[buttonIndex];
                        if (!buttonConfig.separator) {
                            processCustomSendButtonClick(event, buttonConfig.text, buttonConfig.autoSend);
                        }
                    }
                });
            }
            
            panelContent.appendChild(clone);
        });
    },

    /**
     * Creates a toggle button for the floating panel.
     * This button will be placed before the user's custom emoji buttons.
     * @returns {HTMLButtonElement} The toggle button element.
     */
    createPanelToggleButton: function() {
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
    },

    /**
     * Debounced version of savePanelSettings.
     * Waits 150ms after the last call before actually saving.
     */
    debouncedSavePanelSettings: function() {
        // Clear any existing timer
        if (this.savePositionTimer) {
            clearTimeout(this.savePositionTimer);
        }
        
        // Set a new timer
        this.savePositionTimer = setTimeout(() => {
            this.savePanelSettings();
            this.savePositionTimer = null;
        }, 150);
    },

    /**
     * Loads panel settings from localStorage.
     * If no settings are found, default settings are used.
     */
    loadPanelSettings: function() {
        try {
            const hostname = window.location.hostname;
            const storageKey = this.storageKeyPrefix + hostname;
            const savedSettings = localStorage.getItem(storageKey);
            
            if (savedSettings) {
                this.currentPanelSettings = JSON.parse(savedSettings);
                logConCgp('[floating-panel] Loaded panel settings for ' + hostname);
            } else {
                this.currentPanelSettings = { ...this.defaultPanelSettings };
                logConCgp('[floating-panel] Using default panel settings for ' + hostname);
            }
        } catch (error) {
            logConCgp('[floating-panel] Error loading panel settings: ' + error.message);
            this.currentPanelSettings = { ...this.defaultPanelSettings };
        }
    },

    /**
     * Saves panel settings to localStorage.
     */
    savePanelSettings: function() {
        try {
            const hostname = window.location.hostname;
            const storageKey = this.storageKeyPrefix + hostname;
            localStorage.setItem(storageKey, JSON.stringify(this.currentPanelSettings));
            logConCgp('[floating-panel] Saved panel settings for ' + hostname);
        } catch (error) {
            logConCgp('[floating-panel] Error saving panel settings: ' + error.message);
        }
    },

    /**
     * Restores the panel state based on saved settings.
     * If the panel was previously visible, it will be shown again.
     */
    restorePanelState: function() {
        if (this.currentPanelSettings.isVisible) {
            logConCgp('[floating-panel] Restoring panel to visible state');
            this.togglePanel();
        }
    },

    /**
     * Initializes the floating panel functionality.
     * This method should be called when the extension is initialized.
     */
    initialize: function() {
        this.loadPanelSettings();
        this.createFloatingPanel();
        
        // Restore panel state after a short delay to ensure the DOM is fully loaded
        setTimeout(() => {
            this.restorePanelState();
        }, 300);
        
        logConCgp('[floating-panel] Floating panel initialized');
    }
};
