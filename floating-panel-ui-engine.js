// floating-panel-ui-engine.js
// Version: 1.4
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
    // Prevent adding if queue mode is disabled
    if (!window.globalMaxExtensionConfig?.enableQueueMode) {
        logConCgp('[queue-engine] Queue mode is disabled. Ignoring addToQueue.');
        return;
    }

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

    if (!Number.isFinite(this.nextQueueItemId)) {
        this.nextQueueItemId = 1;
    }

    const queueEntry = {
        ...buttonConfig,
        queueId: `queue-item-${this.nextQueueItemId++}`
    };

    this.promptQueue.push(queueEntry);
    logConCgp('[queue-engine] Added to queue:', queueEntry.text);
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
 * Calculates the base queue delay in milliseconds, without randomization.
 * @returns {number}
 */
window.MaxExtensionFloatingPanel.getQueueBaseDelayMs = function () {
    const config = window.globalMaxExtensionConfig || {};
    const unit = (config.queueDelayUnit === 'sec') ? 'sec' : 'min';
    if (unit === 'sec') {
        const secondsValue = Number(config.queueDelaySeconds);
        const seconds = Number.isFinite(secondsValue) ? secondsValue : 300;
        return Math.max(10, seconds) * 1000;
    }
    const minutesValue = Number(config.queueDelayMinutes);
    const minutes = Number.isFinite(minutesValue) ? minutesValue : 5;
    return Math.max(1, minutes) * 60 * 1000;
};

/**
 * Calculates the effective queue delay in milliseconds, applying randomization when enabled.
 * @param {Object} [options]
 * @param {boolean} [options.log=true] - Whether to log when a random offset is applied.
 * @returns {number}
 */
window.MaxExtensionFloatingPanel.getQueueDelayWithRandomMs = function (options = {}) {
    const { log = true } = options;
    const config = window.globalMaxExtensionConfig || {};
    const baseMs = this.getQueueBaseDelayMs();

    let totalMs = baseMs;
    let offsetMs = 0;
    const percentValue = Number(config.queueRandomizePercent);
    let percent = Number.isFinite(percentValue) ? percentValue : 5;

    if (config.queueRandomizeEnabled) {
        percent = Math.max(0, percent);
        const maxOffsetMs = Math.round(baseMs * (percent / 100));
        if (maxOffsetMs > 0) {
            offsetMs = Math.floor(Math.random() * (maxOffsetMs + 1));
            totalMs = baseMs + offsetMs;
            if (log) {
                logConCgp(`[queue-engine] Randomized delay applied. Base: ${baseMs}ms, Offset: ${offsetMs}ms (max ${maxOffsetMs}ms).`);
            }
        }
    }

    this.lastQueueDelaySample = {
        baseMs,
        offsetMs,
        totalMs,
        percent,
        timestamp: Date.now()
    };

    if (typeof this.updateRandomDelayBadge === 'function') {
        try {
            this.updateRandomDelayBadge();
        } catch (_) {
            // Ignore badge update errors to avoid breaking queue processing.
        }
    }

    return totalMs;
};

/**
 * Formats a delay (in milliseconds) into a human-readable string based on unit.
 * @param {number} ms
 * @param {'sec'|'min'} unit
 * @returns {string}
 */
window.MaxExtensionFloatingPanel.formatQueueDelayForUnit = function (ms, unit) {
    if (!Number.isFinite(ms) || ms <= 0) {
        return unit === 'sec' ? '0s' : '0min';
    }
    if (unit === 'sec') {
        const seconds = ms / 1000;
        return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
    }
    const minutes = ms / 60000;
    return `${Number.isInteger(minutes) ? minutes.toFixed(0) : minutes.toFixed(2)}min`;
};

/**
 * Immediately advances to the next item in the queue, bypassing the remaining delay.
 */
window.MaxExtensionFloatingPanel.skipToNextQueueItem = function () {
    if (!window.globalMaxExtensionConfig?.enableQueueMode) {
        logConCgp('[queue-engine] Skip ignored because queue mode is disabled.');
        return;
    }

    if (!Array.isArray(this.promptQueue) || this.promptQueue.length === 0) {
        logConCgp('[queue-engine] Skip ignored because the queue is empty.');
        return;
    }

    const wasRunning = this.isQueueRunning;
    const wasPaused = !this.isQueueRunning && (this.remainingTimeOnPause > 0);

    if (this.queueTimerId) {
        clearTimeout(this.queueTimerId);
        this.queueTimerId = null;
    }

    this.remainingTimeOnPause = 0;
    if (!this.isQueueRunning) {
        this.isQueueRunning = true;
    }

    if (this.queueProgressBar) {
        this.queueProgressBar.style.transition = 'none';
        this.queueProgressBar.style.width = '100%';
    }

    logConCgp('[queue-engine] Skip requested. Sending next queued prompt immediately.');
    this.processNextQueueItem();

    if (wasPaused && this.isQueueRunning) {
        // Restore paused state after dispatching the item.
        this.pauseQueue();
    } else if (!wasRunning && !this.isQueueRunning) {
        // Queue finished while we were idle; ensure UI reflects the stopped state.
        this.updateQueueControlsState();
    }
};

/**
 * Adjusts the current queue timer progress based on a ratio between 0 and 1.
 * @param {number} ratio
 */
window.MaxExtensionFloatingPanel.seekQueueTimerToRatio = function (ratio) {
    if (!window.globalMaxExtensionConfig?.enableQueueMode) {
        logConCgp('[queue-engine] Seek ignored because queue mode is disabled.');
        return;
    }

    const total = Number(this.currentTimerDelay);
    if (!Number.isFinite(total) || total <= 0) {
        logConCgp('[queue-engine] Seek ignored because there is no active delay.');
        return;
    }

    const clampedRatio = Math.min(Math.max(Number(ratio), 0), 1);
    const elapsed = clampedRatio * total;
    const remaining = Math.max(total - elapsed, 0);
    const config = window.globalMaxExtensionConfig || {};
    const unit = (config.queueDelayUnit === 'sec') ? 'sec' : 'min';

    if (this.isQueueRunning && this.queueTimerId) {
        clearTimeout(this.queueTimerId);

        if (remaining <= 20) {
            // Treat as an immediate skip when user selects the end of the bar.
            if (this.queueProgressBar) {
                this.queueProgressBar.style.transition = 'none';
                this.queueProgressBar.style.width = '100%';
            }
            logConCgp('[queue-engine] Seek reached the end of the interval. Dispatching next item.');
            this.remainingTimeOnPause = 0;
            this.queueTimerId = null;
            this.timerStartTime = Date.now() - total;
            this.processNextQueueItem();
            return;
        }

        this.timerStartTime = Date.now() - elapsed;
        this.remainingTimeOnPause = 0;
        this.queueTimerId = setTimeout(() => this.processNextQueueItem(), remaining);

        if (this.queueProgressBar) {
            this.queueProgressBar.style.transition = 'none';
            this.queueProgressBar.style.width = `${clampedRatio * 100}%`;
            void this.queueProgressBar.offsetWidth;
            this.queueProgressBar.style.transition = `width ${remaining / 1000}s linear`;
            this.queueProgressBar.style.width = '100%';
        }

        const remainingStr = this.formatQueueDelayForUnit(remaining, unit);
        logConCgp(`[queue-engine] Seeked queue timer to ${(clampedRatio * 100).toFixed(0)}% (${remainingStr} remaining).`);
        if (this.lastQueueDelaySample) {
            this.lastQueueDelaySample.timestamp = Date.now();
        }
    } else if (!this.isQueueRunning && this.remainingTimeOnPause > 0) {
        this.remainingTimeOnPause = remaining;

        if (this.queueProgressBar) {
            this.queueProgressBar.style.transition = 'none';
            this.queueProgressBar.style.width = `${clampedRatio * 100}%`;
        }

        const remainingStr = this.formatQueueDelayForUnit(remaining, unit);
        logConCgp(`[queue-engine] Adjusted paused queue timer to ${(clampedRatio * 100).toFixed(0)}% (${remainingStr} remaining).`);
        if (this.lastQueueDelaySample) {
            this.lastQueueDelaySample.timestamp = Date.now();
        }
    } else {
        logConCgp('[queue-engine] Seek ignored because no timer is active.');
    }
};

/**
 * Starts or resumes the queue processing.
 */
window.MaxExtensionFloatingPanel.startQueue = function () {
    // Do not start if queue mode is disabled
    if (!window.globalMaxExtensionConfig?.enableQueueMode) {
        logConCgp('[queue-engine] Queue mode is disabled. startQueue aborted.');
        return;
    }

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

        // Restore conceptual start time
        this.timerStartTime = Date.now() - elapsedTimeBeforePause;

        // Resume progress bar animation from paused state.
        if (this.queueProgressBar) {
            this.queueProgressBar.style.transition = 'none';
            this.queueProgressBar.style.width = `${progressPercentage}%`;
            void this.queueProgressBar.offsetWidth; // Force reflow
            this.queueProgressBar.style.transition = `width ${this.remainingTimeOnPause / 1000}s linear`;
            this.queueProgressBar.style.width = '100%';
        }

        this.queueTimerId = setTimeout(() => {
            this.remainingTimeOnPause = 0; // Clear remainder
            this.processNextQueueItem();
        }, this.remainingTimeOnPause);

    } else {
        // Fresh start: send first item immediately.
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
    // Reset timer-related state.
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
 * Adjusts the progress bar and timer to reflect the new total delay.
 */
window.MaxExtensionFloatingPanel.recalculateRunningTimer = function () {
    // Do nothing if queue mode is disabled
    if (!window.globalMaxExtensionConfig?.enableQueueMode) {
        logConCgp('[queue-engine] Queue mode is disabled. Recalculate timer skipped.');
        return;
    }

    // Only act if a timer is currently running.
    if (!this.isQueueRunning || !this.queueTimerId) {
        return;
    }

    logConCgp('[queue-engine] Recalculating timer due to delay change.');

    clearTimeout(this.queueTimerId);

    // Elapsed time on current timer.
    const elapsedTime = Date.now() - this.timerStartTime;

    // New total delay from config (includes random offset if enabled).
    const newTotalDelayMs = this.getQueueDelayWithRandomMs({ log: false });

    if (elapsedTime >= newTotalDelayMs) {
        logConCgp('[queue-engine] New delay < elapsed time. Processing next item.');
        this.remainingTimeOnPause = 0;
        this.processNextQueueItem();
    } else {
        const newRemainingTime = newTotalDelayMs - elapsedTime;
        logConCgp(`[queue-engine] New remaining time is ${newRemainingTime}ms.`);

        this.currentTimerDelay = newTotalDelayMs;
        this.queueTimerId = setTimeout(() => this.processNextQueueItem(), newRemainingTime);

        // Update progress bar instantly to new percentage.
        if (this.queueProgressBar) {
            const newProgressPercentage = (elapsedTime / newTotalDelayMs) * 100;
            this.queueProgressBar.style.transition = 'none';
            this.queueProgressBar.style.width = `${newProgressPercentage}%`;
            void this.queueProgressBar.offsetWidth;
            this.queueProgressBar.style.transition = `width ${newRemainingTime / 1000}s linear`;
            this.queueProgressBar.style.width = '100%';
        }
    }
};

/**
 * Processes the next item in the queue.
 * Calls the same entry-point used by manual clicks, so site code paths remain identical.
 */
window.MaxExtensionFloatingPanel.processNextQueueItem = function () {
    // If queue mode was turned off mid-cycle, freeze (pause).
    if (!window.globalMaxExtensionConfig?.enableQueueMode) {
        logConCgp('[queue-engine] Queue mode disabled mid-cycle. Pausing to freeze state.');
        this.pauseQueue();
        return;
    }

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
    logConCgp('[queue-engine] Sending item:', item.text);

    // Clear any stale autosend interval from a previous run to avoid collisions on "first send".
    if (window.autoSendInterval) {
        try { clearInterval(window.autoSendInterval); } catch (_) {}
        window.autoSendInterval = null;
        logConCgp('[queue-engine] Cleared stale autoSendInterval before dispatching queued click.');
    }

    // Synthesize a "user-like" click by calling the same entry function that real buttons use.
    // We tag the event so processCustomSendButtonClick won't re-enqueue and won't apply Shift inversion.
    const mockEvent = { preventDefault: () => {}, shiftKey: false, __fromQueue: true };

    try {
        // Use the canonical entry point so per-site behavior is identical to manual clicks.
        processCustomSendButtonClick(
            mockEvent,
            item.text,
            true // Queue dispatch must always auto-send regardless of button toggle.
        );
    } catch (err) {
        logConCgp('[queue-engine] Error while dispatching queued click:', err?.message || err);
        this.pauseQueue();
        return;
    }

    // If there are more items, schedule the next one.
    if (this.promptQueue.length > 0) {
        const config = window.globalMaxExtensionConfig || {};
        const unit = (config.queueDelayUnit === 'sec') ? 'sec' : 'min';
        const delayMs = this.getQueueDelayWithRandomMs();
        const sample = this.lastQueueDelaySample || { baseMs: delayMs, offsetMs: 0, totalMs: delayMs };

        const totalStr = this.formatQueueDelayForUnit(delayMs, unit);
        if (config.queueRandomizeEnabled && sample.offsetMs > 0) {
            const baseStr = this.formatQueueDelayForUnit(sample.baseMs, unit);
            const offsetStr = this.formatQueueDelayForUnit(sample.offsetMs, unit);
            logConCgp(`[queue-engine] Waiting for ${totalStr} (base ${baseStr} + offset ${offsetStr}) before next item.`);
        } else {
            logConCgp(`[queue-engine] Waiting for ${totalStr} before next item.`);
        }

        // Animate progress bar
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
        this.remainingTimeOnPause = 0;
        this.queueTimerId = setTimeout(() => this.processNextQueueItem(), delayMs);
    } else {
        logConCgp('[queue-engine] All items have been sent.');
        if (this.queueProgressBar) {
            this.queueProgressBar.style.transition = 'none';
            this.queueProgressBar.style.width = '100%';
        }
        this.pauseQueue();
        setTimeout(() => {
            if (this.queueProgressContainer && !this.isQueueRunning) {
                this.queueProgressContainer.style.display = 'none';
                if (this.queueProgressBar) {
                    this.queueProgressBar.style.width = '0%';
                }
            }
        }, 1000);
    }
};
