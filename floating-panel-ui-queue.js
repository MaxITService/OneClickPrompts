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
// - renderQueueDisplay(): Updates the visual display of queued items.
// - updateQueueControlsState(): Manages the state of play/pause/reset buttons.
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
    this.delayUnitToggle = document.getElementById('max-extension-delay-unit-toggle');
    this.playQueueButton = document.getElementById('max-extension-play-queue-btn');
    this.resetQueueButton = document.getElementById('max-extension-reset-queue-btn');
    this.queueDisplayArea = document.getElementById('max-extension-queue-display');
    this.queueProgressContainer = document.getElementById('max-extension-queue-progress-container');
    this.queueProgressBar = document.getElementById('max-extension-queue-progress-bar');

    if (!this.queueSectionElement) {
        logConCgp('[floating-panel-queue] Queue section element not found in the DOM.');
        return;
    }

    // Prevent dragging when interacting with the queue section
    this.queueSectionElement.addEventListener('mousedown', (event) => {
        event.stopPropagation();
    });

    // --- DELAY INPUT AND UNIT TOGGLE LOGIC ---

    const updateDelayUI = () => {
        const unit = globalMaxExtensionConfig.queueDelayUnit || 'min';
        if (unit === 'sec') {
            this.delayUnitToggle.textContent = 'sec';
            this.delayInputElement.value = globalMaxExtensionConfig.queueDelaySeconds;
            this.delayInputElement.title = "Delay in seconds between sending each queued prompt. Minimum 2 seconds.";
        } else {
            this.delayUnitToggle.textContent = 'min';
            this.delayInputElement.value = globalMaxExtensionConfig.queueDelayMinutes;
            this.delayInputElement.title = "Delay in minutes between sending each queued prompt. Minimum 2 minutes.";
        }
    };

    // Set initial state from config
    updateDelayUI();

    // Add listener for unit toggle
    this.delayUnitToggle.addEventListener('click', (event) => {
        event.preventDefault();
        globalMaxExtensionConfig.queueDelayUnit = (globalMaxExtensionConfig.queueDelayUnit === 'min') ? 'sec' : 'min';
        updateDelayUI();
        // The config is saved when profile settings are saved.
    });

    // Add listener for input value changes
    this.delayInputElement.addEventListener('change', (event) => {
        let delay = parseInt(event.target.value, 10);
        if (isNaN(delay) || delay < 2) {
            delay = 2;
            event.target.value = delay;
        }

        if (globalMaxExtensionConfig.queueDelayUnit === 'sec') {
            globalMaxExtensionConfig.queueDelaySeconds = delay;
            logConCgp(`[floating-panel-queue] Queue delay set to ${delay} seconds.`);
        } else {
            globalMaxExtensionConfig.queueDelayMinutes = delay;
            logConCgp(`[floating-panel-queue] Queue delay set to ${delay} minutes.`);
        }
    });

    // --- END DELAY LOGIC ---

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
    this.queueModeToggle.querySelector('label').style.fontSize = '12px';
    this.queueModeToggle.title = 'When enabled, clicking buttons adds them to a queue instead of sending immediately.';
    togglePlaceholder.appendChild(this.queueModeToggle);

    // Set initial visibility of controls based on config
    expandableSection.style.display = isQueueEnabled ? 'contents' : 'none';
    this.queueDisplayArea.style.display = isQueueEnabled ? 'flex' : 'none';

    // Attach event listeners to buttons
    this.playQueueButton.addEventListener('click', () => {
        if (this.isQueueRunning) {
            this.pauseQueue();
        } else {
            this.startQueue();
        }
    });

    this.resetQueueButton.addEventListener('click', () => {
        this.resetQueue();
    });

    // Initial state update for controls
    this.updateQueueControlsState();
};

/**
 * Renders the queue display area with the current items in the queue.
 */
window.MaxExtensionFloatingPanel.renderQueueDisplay = function () {
    if (!this.queueDisplayArea) return;

    this.queueDisplayArea.innerHTML = ''; // Clear previous items
    this.promptQueue.forEach((item, index) => {
        const queuedItemElement = document.createElement('button');
        queuedItemElement.className = 'max-extension-queued-item';
        queuedItemElement.innerHTML = item.icon;
        queuedItemElement.title = `Click to remove: ${item.text}`;
        queuedItemElement.addEventListener('click', () => {
            this.removeFromQueue(index);
        });
        this.queueDisplayArea.appendChild(queuedItemElement);
    });
};

/**
 * Updates the state (icon, disabled status) of the queue control buttons.
 */
window.MaxExtensionFloatingPanel.updateQueueControlsState = function () {
    if (!this.playQueueButton || !this.resetQueueButton) return;

    const hasItems = this.promptQueue.length > 0;

    // Play/Pause Button
    if (this.isQueueRunning) {
        this.playQueueButton.innerHTML = '⏸️'; // Pause icon
        this.playQueueButton.title = 'Pause the queue.';
        this.playQueueButton.disabled = false;
    } else {
        this.playQueueButton.innerHTML = '▶️'; // Play icon
        this.playQueueButton.title = 'Start sending the queued prompts.';
        this.playQueueButton.disabled = !hasItems; // Disabled if no items
    }

    // Reset Button
    this.resetQueueButton.disabled = !hasItems && !this.isQueueRunning;

    // Hide progress bar if queue is empty and not running
    if (this.queueProgressContainer && !this.isQueueRunning && !hasItems) {
        this.queueProgressContainer.style.display = 'none';
    }
};