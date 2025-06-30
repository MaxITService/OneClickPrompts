// Version: 1.0
//
// Documentation:
// This file contains the core engine logic for the prompt queue feature.
// It manages the queue's state, adding/removing items, and the sequential
// sending process with delays. It is designed to be UI-agnostic.
// All functions extend the window.MaxExtensionFloatingPanel namespace.
//
// Methods included:
// - addToQueue(buttonConfig): Adds a prompt to the queue.
// - removeFromQueue(index): Removes a prompt from the queue by its index.
// - startQueue(): Begins the sequential sending process.
// - pauseQueue(): Pauses the sending process.
// - resetQueue(): Stops and clears the entire queue.
// - processNextQueueItem(): The core function that sends one item and sets a timer for the next.
// - getSiteSpecificSendFunction(): A helper to determine which site-specific send function to use.
//
// Dependencies:
// - floating-panel.js: Provides the namespace and shared properties.
// - floating-panel-ui-queue.js: Provides UI update functions like renderQueueDisplay.

'use strict';

/**
 * Adds a prompt configuration to the queue.
 * @param {object} buttonConfig - The configuration of the button clicked.
 */
window.MaxExtensionFloatingPanel.addToQueue = function (buttonConfig) {
    if (this.promptQueue.length >= this.QUEUE_MAX_SIZE) {
        logConCgp('[queue-engine] Queue is full. Cannot add more prompts.');
        // Optional: Add visual feedback for the user
        if (this.queueDisplayArea) {
            this.queueDisplayArea.style.borderColor = 'red';
            setTimeout(() => {
                this.queueDisplayArea.style.borderColor = '';
            }, 500);
        }
        return;
    }

    this.promptQueue.push(buttonConfig);
    logConCgp('[queue-engine] Added to queue:', buttonConfig.text);
    this.renderQueueDisplay();
    this.updateQueueControlsState();
};

/**
 * Removes a prompt from the queue at a specific index.
 * @param {number} index - The index of the item to remove.
 */
window.MaxExtensionFloatingPanel.removeFromQueue = function (index) {
    if (index > -1 && index < this.promptQueue.length) {
        const removed = this.promptQueue.splice(index, 1);
        logConCgp('[queue-engine] Removed from queue:', removed[0].text);
        this.renderQueueDisplay();
        this.updateQueueControlsState();
    }
};

/**
 * Starts the queue processing.
 */
window.MaxExtensionFloatingPanel.startQueue = function () {
    if (this.isQueueRunning || this.promptQueue.length === 0) {
        return;
    }
    this.isQueueRunning = true;
    logConCgp('[queue-engine] Queue started.');

    // Show progress bar container when queue starts
    if (this.queueProgressContainer) {
        this.queueProgressContainer.style.display = 'block';
    }

    this.updateQueueControlsState();
    this.processNextQueueItem();
};

/**
 * Pauses the queue processing.
 */
window.MaxExtensionFloatingPanel.pauseQueue = function () {
    this.isQueueRunning = false;
    if (this.queueTimerId) {
        clearTimeout(this.queueTimerId);
        this.queueTimerId = null;
    }
    logConCgp('[queue-engine] Queue paused.');

    // Freeze the progress bar
    if (this.queueProgressBar) {
        const computedWidth = window.getComputedStyle(this.queueProgressBar).width;
        this.queueProgressBar.style.transition = 'none';
        this.queueProgressBar.style.width = computedWidth;
    }

    this.updateQueueControlsState();
};

/**
 * Resets the queue, clearing all items and stopping the process.
 */
window.MaxExtensionFloatingPanel.resetQueue = function () {
    this.pauseQueue(); // Stop any running timers and set isQueueRunning to false
    this.promptQueue = [];
    logConCgp('[queue-engine] Queue reset.');

    // Hide and reset progress bar
    if (this.queueProgressBar) {
        this.queueProgressBar.style.transition = 'none';
        this.queueProgressBar.style.width = '100%';
    }
    if (this.queueProgressContainer) {
        this.queueProgressContainer.style.display = 'none';
    }

    this.renderQueueDisplay();
    this.updateQueueControlsState(); // This will disable buttons as needed
};

/**
 * Processes the next item in the queue.
 */
window.MaxExtensionFloatingPanel.processNextQueueItem = function () {
    if (!this.isQueueRunning) {
        return;
    }

    if (this.promptQueue.length === 0) {
        logConCgp('[queue-engine] Queue is empty. Stopping.');
        this.pauseQueue(); // Effectively stops and resets the UI
        return;
    }

    const item = this.promptQueue.shift(); // Get the first item and remove it
    this.renderQueueDisplay(); // Update UI to show the item is gone
    logConCgp(`[queue-engine] Sending item:`, item.text);

    const sendFunction = this.getSiteSpecificSendFunction();
    if (sendFunction) {
        // A mock event object is sufficient for the send functions
        const mockEvent = { preventDefault: () => { } };
        // Always force auto-send for queued items by passing `true`, overriding the button's individual setting.
        sendFunction(mockEvent, item.text, true);
    } else {
        logConCgp('[queue-engine] No send function found for this site. Stopping queue.');
        this.resetQueue();
        return;
    }

    // If there are more items, set a timeout for the next one
    if (this.promptQueue.length > 0) {
        const unit = globalMaxExtensionConfig.queueDelayUnit || 'min';
        let delayMs;

        if (unit === 'sec') {
            const delaySec = globalMaxExtensionConfig.queueDelaySeconds || 300;
            delayMs = delaySec * 1000;
            logConCgp(`[queue-engine] Waiting for ${delaySec} seconds before next item.`);
        } else { // 'min'
            const delayMin = globalMaxExtensionConfig.queueDelayMinutes || 5;
            delayMs = delayMin * 60 * 1000;
            logConCgp(`[queue-engine] Waiting for ${delayMin} minutes before next item.`);
        }

        // Start the progress bar animation
        if (this.queueProgressBar) {
            // Reset to full width instantly, then start the transition
            this.queueProgressBar.style.transition = 'none';
            this.queueProgressBar.style.width = '100%';

            // Force reflow to apply the reset before starting transition
            setTimeout(() => {
                this.queueProgressBar.style.transition = `width ${delayMs / 1000}s linear`;
                this.queueProgressBar.style.width = '0%';
            }, 20);
        }

        this.queueTimerId = setTimeout(() => this.processNextQueueItem(), delayMs);
    } else {
        logConCgp('[queue-engine] All items have been sent.');
        this.pauseQueue(); // Queue finished, so pause/stop

        // Hide progress bar after a short delay to let animation finish
        setTimeout(() => {
            if (this.queueProgressContainer && !this.isQueueRunning) {
                this.queueProgressContainer.style.display = 'none';
                if (this.queueProgressBar) {
                    this.queueProgressBar.style.transition = 'none';
                    this.queueProgressBar.style.width = '100%';
                }
            }
        }, 1000); // Wait 1 second after finish to hide
    }
};

/**
 * Helper to get the site-specific send function.
 * @returns {Function|null} The send function for the current site or null.
 */
window.MaxExtensionFloatingPanel.getSiteSpecificSendFunction = function () {
    const activeSite = window.InjectionTargetsOnWebsite.activeSite;
    switch (activeSite) {
        case 'ChatGPT': return window.processChatGPTCustomSendButtonClick;
        case 'Claude': return window.processClaudeCustomSendButtonClick;
        case 'Copilot': return window.processCopilotCustomSendButtonClick;
        case 'DeepSeek': return window.processDeepSeekCustomSendButtonClick;
        case 'AIStudio': return window.processAIStudioCustomSendButtonClick;
        case 'Grok': return window.processGrokCustomSendButtonClick;
        case 'Gemini': return window.processGeminiCustomSendButtonClick;
        default:
            logConCgp(`[queue-engine] Unsupported site for queue: ${activeSite}`);
            return null;
    }
};