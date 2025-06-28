// Version: 1.1
//
// Documentation:
// This file contains the UI initialization logic for the prompt queue section
// within the floating panel. It finds the controls from the loaded HTML template
// and attaches the necessary event handlers and behavior.
// This function extends the window.MaxExtensionFloatingPanel namespace.
//
// Methods included:
// - initializeQueueSection(): Wires up the DOM structure for the queue UI.
//
// Dependencies:
// - floating-panel.js: Provides the namespace and shared properties.
// - interface.js: Provides UI creation helpers like createToggle.
// - config.js: Provides configuration values like enableQueueMode.

'use strict';

/**
 * Initializes the queue section UI inside the floating panel.
 * It finds elements from the pre-loaded HTML template and attaches functionality.
 */
window.MaxExtensionFloatingPanel.initializeQueueSection = function () {
    // Get references to elements from the loaded HTML
    this.queueSectionElement = document.getElementById('max-extension-queue-section');
    const togglePlaceholder = document.getElementById('max-extension-queue-toggle-placeholder');
    const expandableSection = this.queueSectionElement.querySelector('.expandable-queue-controls');
    this.delayInputElement = document.getElementById('max-extension-queue-delay-input');
    this.playQueueButton = document.getElementById('max-extension-play-queue-btn');
    this.resetQueueButton = document.getElementById('max-extension-reset-queue-btn');
    this.queueDisplayArea = document.getElementById('max-extension-queue-display');

    if (!this.queueSectionElement) {
        logConCgp('[floating-panel] Queue section element not found in the DOM.');
        return;
    }

    // Prevent dragging when interacting with the queue section
    this.queueSectionElement.addEventListener('mousedown', (event) => {
        event.stopPropagation();
    });

    // Set initial values and event listeners for controls
    this.delayInputElement.value = globalMaxExtensionConfig.queueDelaySeconds || 15;
    this.delayInputElement.addEventListener('change', (event) => {
        const delay = parseInt(event.target.value, 10);
        if (!isNaN(delay) && delay >= 0) {
            globalMaxExtensionConfig.queueDelaySeconds = delay;
            // The config will be saved on the next profile save action
        }
    });

    // Create and insert the Queue Mode toggle
    const isQueueEnabled = globalMaxExtensionConfig.enableQueueMode || false;
    this.queueModeToggle = MaxExtensionInterface.createToggle(
        'enableQueueMode',
        'Enable Queue Mode',
        isQueueEnabled,
        (state) => {
            globalMaxExtensionConfig.enableQueueMode = state;
            expandableSection.style.display = state ? 'contents' : 'none';
            this.queueDisplayArea.style.display = state ? 'flex' : 'none';
        }
    );
    this.queueModeToggle.style.margin = '0';
    this.queueModeToggle.title = 'When enabled, clicking buttons adds them to a queue instead of sending immediately.';
    togglePlaceholder.appendChild(this.queueModeToggle);

    // Set initial visibility of controls based on config
    expandableSection.style.display = isQueueEnabled ? 'contents' : 'none';
    this.queueDisplayArea.style.display = isQueueEnabled ? 'flex' : 'none';
};