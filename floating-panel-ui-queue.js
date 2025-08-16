// floating-panel-ui-queue.js
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
    const expandableSection = this.queueSectionElement?.querySelector('.expandable-queue-controls');
    this.delayInputElement = document.getElementById('max-extension-queue-delay-input');
    this.delayUnitToggle = document.getElementById('max-extension-delay-unit-toggle');
    this.playQueueButton = document.getElementById('max-extension-play-queue-btn');
    this.resetQueueButton = document.getElementById('max-extension-reset-queue-btn');
    this.queueDisplayArea = document.getElementById('max-extension-queue-display');
    this.queueProgressContainer = document.getElementById('max-extension-queue-progress-container');
    this.queueProgressBar = document.getElementById('max-extension-queue-progress-bar');
    const tosWarningContainer = document.getElementById('max-extension-queue-tos-warning');
    const tosAcceptButton = document.getElementById('max-extension-tos-accept-btn');
    const tosDeclineButton = document.getElementById('max-extension-tos-decline-btn');

    if (!this.queueSectionElement) {
        logConCgp('[floating-panel-queue] Queue section element not found in the DOM.');
        return;
    }

    // Prevent dragging when interacting with the queue section
    this.queueSectionElement.addEventListener('mousedown', (event) => {
        event.stopPropagation();
    });

    // --- DELAY INPUT AND UNIT TOGGLE LOGIC (Profile-specific) ---
    const updateDelayUI = () => {
        const unit = window.globalMaxExtensionConfig.queueDelayUnit || 'min';
        if (unit === 'sec') {
            this.delayUnitToggle.textContent = 'sec';
            this.delayInputElement.value = window.globalMaxExtensionConfig.queueDelaySeconds;
            this.delayInputElement.min = 10;
            this.delayInputElement.max = 64000;
            this.delayInputElement.title = "Delay in seconds between sending each queued prompt. Min: 10, Max: 64000.";
        } else { // 'min'
            this.delayUnitToggle.textContent = 'min';
            this.delayInputElement.value = window.globalMaxExtensionConfig.queueDelayMinutes;
            this.delayInputElement.min = 1;
            this.delayInputElement.max = 64000;
            this.delayInputElement.title = "Delay in minutes between sending each queued prompt. Min: 1, Max: 64000.";
        }
    };
    updateDelayUI();

    this.delayUnitToggle.addEventListener('click', (event) => {
        event.preventDefault();
        window.globalMaxExtensionConfig.queueDelayUnit = (window.globalMaxExtensionConfig.queueDelayUnit === 'min') ? 'sec' : 'min';
        updateDelayUI();
        this.saveCurrentProfileConfig(); // Save to profile
        this.recalculateRunningTimer(); // Recalculate timer if it's running
    });

    this.delayInputElement.addEventListener('change', (event) => {
        let delay = parseInt(event.target.value, 10);
        const unit = window.globalMaxExtensionConfig.queueDelayUnit || 'min';
        const minDelay = (unit === 'sec') ? 10 : 1;
        const maxDelay = 64000;

        if (isNaN(delay) || delay < minDelay) {
            delay = minDelay;
        } else if (delay > maxDelay) {
            delay = maxDelay;
        }
        event.target.value = delay;

        if (unit === 'sec') {
            window.globalMaxExtensionConfig.queueDelaySeconds = delay;
        } else { // 'min'
            window.globalMaxExtensionConfig.queueDelayMinutes = delay;
        }
        this.saveCurrentProfileConfig(); // Save to profile
        this.recalculateRunningTimer(); // Recalculate timer if it's running
    });

    // --- TOS Confirmation (Global) and Queue Toggle (Profile-specific) ---
    const isQueueEnabled = window.globalMaxExtensionConfig.enableQueueMode || false;

    const toggleCallback = (state) => {
        // Check global TOS setting first
        if (state && !window.MaxExtensionGlobalSettings.acceptedQueueTOS) {
            // Make sure the queue section is visible so the warning isn't hidden by responsive/footer logic.
            if (this.queueSectionElement) {
                this.queueSectionElement.style.display = 'flex';
            }
            tosWarningContainer.style.display = 'block';
            this.queueModeToggle.style.display = 'none'; // Hide toggle
            this.queueModeToggle.querySelector('input').checked = false; // Uncheck it
            return;
        }

        // If TOS is accepted, proceed with profile setting
        window.globalMaxExtensionConfig.enableQueueMode = state;
        if (expandableSection) {
            expandableSection.style.display = state ? 'contents' : 'none';
        }
        if (this.queueDisplayArea) {
            this.queueDisplayArea.style.display = state ? 'flex' : 'none';
        }
        this.saveCurrentProfileConfig(); // Save to profile

        // If the toggle lives in the footer, keep the queue section visible only when enabled.
        const queueToggleFooter = document.getElementById('max-extension-queue-toggle-footer');
        const queueSection = document.getElementById('max-extension-queue-section');
        if (queueToggleFooter && queueToggleFooter.children.length > 0) {
            if (state) {
                queueSection.style.display = 'flex';
            } else {
                queueSection.style.display = 'none';
            }
        }
    };

    this.queueModeToggle = MaxExtensionInterface.createToggle(
        'enableQueueMode',
        'Enable Queue Mode',
        isQueueEnabled,
        toggleCallback
    );
    this.queueModeToggle.style.margin = '0';
    this.queueModeToggle.querySelector('label').style.fontSize = '12px';
    this.queueModeToggle.title = 'When enabled, clicking buttons adds them to a queue instead of sending immediately.';
    togglePlaceholder.appendChild(this.queueModeToggle);

    if (expandableSection) {
        expandableSection.style.display = isQueueEnabled ? 'contents' : 'none';
    }
    if (this.queueDisplayArea) {
        this.queueDisplayArea.style.display = isQueueEnabled ? 'flex' : 'none';
    }

    // Initialize responsive positioning after toggle is created
    if (this.initializeResponsiveQueueToggle) {
        this.initializeResponsiveQueueToggle();
    }

    // TOS Button Listeners
    tosAcceptButton.addEventListener('click', () => {
        // 1. Update global setting
        window.MaxExtensionGlobalSettings.acceptedQueueTOS = true;
        this.saveGlobalSettings(); // Save global setting

        // 2. Update profile setting to enable queue
        window.globalMaxExtensionConfig.enableQueueMode = true;
        this.saveCurrentProfileConfig(); // Save profile setting

        // 3. Update UI
        tosWarningContainer.style.display = 'none';
        this.queueModeToggle.style.display = ''; // Show toggle again
        this.queueModeToggle.querySelector('input').checked = true;
        if (expandableSection) expandableSection.style.display = 'contents';
        if (this.queueDisplayArea) this.queueDisplayArea.style.display = 'flex';
        // Ensure the queue section is visible after acceptance
        if (this.queueSectionElement) {
            this.queueSectionElement.style.display = 'flex';
        }
    });

    tosDeclineButton.addEventListener('click', () => {
        tosWarningContainer.style.display = 'none';
        this.queueModeToggle.style.display = ''; // Show toggle again
        // Intentionally leave queue disabled; any responsive hiding will be handled by resize logic.
    });

    // Attach event listeners to queue action buttons
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
    const isPaused = this.remainingTimeOnPause > 0;

    // Play/Pause Button
    if (this.isQueueRunning) {
        this.playQueueButton.innerHTML = '⏸️'; // Pause icon
        this.playQueueButton.title = 'Pause the queue.';
        this.playQueueButton.disabled = false;
    } else {
        this.playQueueButton.innerHTML = '▶️'; // Play icon
        this.playQueueButton.title = 'Start sending the queued prompts.';
        this.playQueueButton.disabled = !hasItems && !isPaused; // Disabled if no items and not paused
    }

    // Reset Button
    this.resetQueueButton.disabled = !hasItems && !this.isQueueRunning && !isPaused;

    // Hide progress bar if queue is empty and not running
    if (this.queueProgressContainer && !this.isQueueRunning && !hasItems) {
        this.queueProgressContainer.style.display = 'none';
    }
};
