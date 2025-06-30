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
// - startQueue(): Begins or resumes the sequential sending process.
// - pauseQueue(): Pauses the sending process, remembering the elapsed time.
// - resetQueue(): Stops and clears the entire queue and resets timer state.
// - recalculateRunningTimer(): Adjusts the current timer and progress bar when the delay is changed.
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
 * Starts or resumes the queue processing.
 */
window.MaxExtensionFloatingPanel.startQueue = function () {
    // Prevent starting if already running, or if there's nothing to do.
    if (this.isQueueRunning || (this.promptQueue.length === 0 && this.remainingTimeOnPause <= 0)) {
        return;
    }
    this.isQueueRunning = true;
    this.updateQueueControlsState();

    if (this.queueProgressContainer) {
        this.queueProgressContainer.style.display = 'block';
    }

    // If we have remaining time, we are resuming a paused timer.
    if (this.remainingTimeOnPause > 0) {
        logConCgp(`[queue-engine] Resuming queue with ${this.remainingTimeOnPause}ms remaining.`);

        const elapsedTimeBeforePause = this.currentTimerDelay - this.remainingTimeOnPause;
        const progressPercentage = (elapsedTimeBeforePause / this.currentTimerDelay) * 100;

        // Restore the conceptual start time for accurate future calculations.
        this.timerStartTime = Date.now() - elapsedTimeBeforePause;

        // Resume progress bar animation from its paused state.
        if (this.queueProgressBar) {
            this.queueProgressBar.style.transition = 'none';
            this.queueProgressBar.style.width = `${progressPercentage}%`;
            void this.queueProgressBar.offsetWidth; // Force reflow
            this.queueProgressBar.style.transition = `width ${this.remainingTimeOnPause / 1000}s linear`;
            this.queueProgressBar.style.width = '100%';
        }

        this.queueTimerId = setTimeout(() => {
            this.remainingTimeOnPause = 0; // Clear the remainder state
            this.processNextQueueItem();
        }, this.remainingTimeOnPause);

    } else {
        // This is a fresh start, so process the first item immediately.
        logConCgp('[queue-engine] Queue started.');
        this.processNextQueueItem();
    }
};

/**
 * Pauses the queue processing and saves the remaining time.
 */
window.MaxExtensionFloatingPanel.pauseQueue = function () {
    this.isQueueRunning = false;

    if (this.queueTimerId) {
        clearTimeout(this.queueTimerId);
        this.queueTimerId = null;

        const elapsedTime = Date.now() - this.timerStartTime;
        // Ensure remaining time doesn't go negative if the timer fires slightly late.
        this.remainingTimeOnPause = (elapsedTime < this.currentTimerDelay)
            ? this.currentTimerDelay - elapsedTime
            : 0;

        logConCgp(`[queue-engine] Queue paused. Remaining time: ${this.remainingTimeOnPause}ms`);
    } else {
        logConCgp('[queue-engine] Queue paused.');
    }

    // Freeze the progress bar at its current position.
    if (this.queueProgressBar) {
        const computedWidth = window.getComputedStyle(this.queueProgressBar).width;
        this.queueProgressBar.style.transition = 'none'; // Stop animation
        this.queueProgressBar.style.width = computedWidth; // Freeze at current width
    }

    this.updateQueueControlsState();
};

/**
 * Resets the queue, clearing all items and stopping the process.
 */
window.MaxExtensionFloatingPanel.resetQueue = function () {
    this.pauseQueue(); // Stop any running timers and set isQueueRunning to false
    this.promptQueue = [];
    // Reset all timer-related state.
    this.remainingTimeOnPause = 0;
    this.timerStartTime = 0;
    this.currentTimerDelay = 0;
    logConCgp('[queue-engine] Queue reset.');

    // Hide and reset progress bar to 0%.
    if (this.queueProgressBar) {
        this.queueProgressBar.style.transition = 'none';
        this.queueProgressBar.style.width = '0%';
    }
    if (this.queueProgressContainer) {
        this.queueProgressContainer.style.display = 'none';
    }

    this.renderQueueDisplay();
    this.updateQueueControlsState();
};

/**
 * Recalculates the running timer when the delay value is changed.
 * This function adjusts the progress bar and timer to reflect the new total delay.
 */
window.MaxExtensionFloatingPanel.recalculateRunningTimer = function () {
    // Only act if a timer is currently running.
    if (!this.isQueueRunning || !this.queueTimerId) {
        return;
    }

    logConCgp('[queue-engine] Recalculating timer due to delay change.');

    clearTimeout(this.queueTimerId);

    // Calculate how much time has passed on the current timer.
    const elapsedTime = Date.now() - this.timerStartTime;

    // Get the new total delay from the configuration.
    const unit = globalMaxExtensionConfig.queueDelayUnit || 'min';
    let newTotalDelayMs;
    if (unit === 'sec') {
        newTotalDelayMs = (globalMaxExtensionConfig.queueDelaySeconds || 300) * 1000;
    } else { // 'min'
        newTotalDelayMs = (globalMaxExtensionConfig.queueDelayMinutes || 5) * 60 * 1000;
    }

    // If time is up with the new delay, process next item.
    if (elapsedTime >= newTotalDelayMs) {
        logConCgp('[queue-engine] New delay is less than elapsed time. Processing next item.');
        this.remainingTimeOnPause = 0;
        this.processNextQueueItem();
    } else {
        // Otherwise, set a new timer for the adjusted remaining time.
        const newRemainingTime = newTotalDelayMs - elapsedTime;
        logConCgp(`[queue-engine] New remaining time is ${newRemainingTime}ms.`);

        // Update the total delay for this timer, critical for subsequent actions.
        this.currentTimerDelay = newTotalDelayMs;

        this.queueTimerId = setTimeout(() => this.processNextQueueItem(), newRemainingTime);

        // Instantly update the progress bar to reflect the new reality.
        if (this.queueProgressBar) {
            const newProgressPercentage = (elapsedTime / newTotalDelayMs) * 100;

            // Set the new progress instantly.
            this.queueProgressBar.style.transition = 'none';
            this.queueProgressBar.style.width = `${newProgressPercentage}%`;
            void this.queueProgressBar.offsetWidth; // Force reflow to apply the new width.

            // Animate to 100% over the new remaining time.
            this.queueProgressBar.style.transition = `width ${newRemainingTime / 1000}s linear`;
            this.queueProgressBar.style.width = '100%';
        }
    }
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
        this.pauseQueue();
        return;
    }

    const item = this.promptQueue.shift();
    this.renderQueueDisplay();
    logConCgp(`[queue-engine] Sending item:`, item.text);

    const sendFunction = this.getSiteSpecificSendFunction();
    if (sendFunction) {
        const mockEvent = { preventDefault: () => { } };
        sendFunction(mockEvent, item.text, true);
    } else {
        logConCgp('[queue-engine] No send function found for this site. Stopping queue.');
        this.resetQueue();
        return;
    }

    // If there are more items, set a timeout for the next one.
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

        // Start the progress bar animation from 0% to 100%.
        if (this.queueProgressBar) {
            this.queueProgressBar.style.transition = 'none';
            this.queueProgressBar.style.width = '0%';

            setTimeout(() => {
                this.queueProgressBar.style.transition = `width ${delayMs / 1000}s linear`;
                this.queueProgressBar.style.width = '100%';
            }, 20);
        }

        this.timerStartTime = Date.now();
        this.currentTimerDelay = delayMs;
        this.remainingTimeOnPause = 0; // Ensure reset for a new timer.
        this.queueTimerId = setTimeout(() => this.processNextQueueItem(), delayMs);
    } else {
        logConCgp('[queue-engine] All items have been sent.');
        // Visually complete the progress bar.
        if (this.queueProgressBar) {
            this.queueProgressBar.style.transition = 'none';
            this.queueProgressBar.style.width = '100%';
        }
        this.pauseQueue(); // Queue finished, so pause/stop.

        // Hide progress bar after a short delay.
        setTimeout(() => {
            if (this.queueProgressContainer && !this.isQueueRunning) {
                this.queueProgressContainer.style.display = 'none';
                if (this.queueProgressBar) {
                    this.queueProgressBar.style.width = '0%'; // Reset for next time.
                }
            }
        }, 1000);
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