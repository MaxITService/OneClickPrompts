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

const queueSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const QUEUE_SCROLL_REPETITIONS = 3;
const QUEUE_SCROLL_DELAY_MS = 250;
const QUEUE_SCROLL_FINAL_SETTLE_MS = 400;

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

    if (typeof this.clearQueueFinishedState === 'function') {
        this.clearQueueFinishedState();
    }

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
        if (typeof this.clearQueueFinishedState === 'function') {
            this.clearQueueFinishedState();
        }
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
    void this.processNextQueueItem();

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
            void this.processNextQueueItem();
            return;
        }

        this.timerStartTime = Date.now() - elapsed;
        this.remainingTimeOnPause = 0;
        this.queueTimerId = setTimeout(() => {
            void this.processNextQueueItem();
        }, remaining);

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

    if (typeof this.clearQueueFinishedState === 'function') {
        this.clearQueueFinishedState();
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
            void this.processNextQueueItem();
        }, this.remainingTimeOnPause);

    } else {
        // Fresh start: send first item immediately.
        logConCgp('[queue-engine] Queue started.');
        void this.processNextQueueItem();
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
    if (typeof this.clearQueueFinishedState === 'function') {
        this.clearQueueFinishedState();
    }
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
        void this.processNextQueueItem();
    } else {
        const newRemainingTime = newTotalDelayMs - elapsedTime;
        logConCgp(`[queue-engine] New remaining time is ${newRemainingTime}ms.`);

        this.currentTimerDelay = newTotalDelayMs;
        this.queueTimerId = setTimeout(() => {
            void this.processNextQueueItem();
        }, newRemainingTime);

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

window.MaxExtensionFloatingPanel.isElementVerticallyScrollable = function (element) {
    if (!element) return false;
    const computed = window.getComputedStyle(element);
    const scrollableValues = ['auto', 'scroll', 'overlay'];
    const overflowY = computed.overflowY;
    const overflow = computed.overflow;
    const canScroll = scrollableValues.includes(overflowY) || scrollableValues.includes(overflow);
    return canScroll && (element.scrollHeight - element.clientHeight > 1);
};

window.MaxExtensionFloatingPanel.collectQueueScrollTargets = function () {
    const targets = new Set();
    const scrollingElement = document.scrollingElement;
    if (scrollingElement) targets.add(scrollingElement);
    targets.add(document.documentElement);
    targets.add(document.body);

    try {
        document.querySelectorAll('*').forEach((element) => {
            if (this.isElementVerticallyScrollable(element)) {
                targets.add(element);
            }
        });
    } catch (err) {
        logConCgp('[queue-engine] Unable to enumerate all elements for scrolling:', err?.message || err);
    }

    const active = document.activeElement;
    if (active &&
        active !== document.body &&
        active !== document.documentElement &&
        this.isElementVerticallyScrollable(active)) {
        targets.add(active);
    }

    return [...targets].filter(Boolean);
};

window.MaxExtensionFloatingPanel.scrollElementToBottom = function (element) {
    if (!element) return;
    if (element === document.body ||
        element === document.documentElement ||
        element === document.scrollingElement) {
        const top = Math.max(
            document.scrollingElement?.scrollHeight || 0,
            document.documentElement?.scrollHeight || 0,
            document.body?.scrollHeight || 0
        );
        window.scrollTo({ top, behavior: 'auto' });
        return;
    }
    element.scrollTop = element.scrollHeight;
};

window.MaxExtensionFloatingPanel.performQueueAutoScrollSequence = async function () {
    for (let i = 0; i < QUEUE_SCROLL_REPETITIONS; i++) {
        const targets = this.collectQueueScrollTargets();
        targets.forEach((target) => this.scrollElementToBottom(target));
        logConCgp(`[queue-engine] Auto-scroll pass ${i + 1}/${QUEUE_SCROLL_REPETITIONS} executed on ${targets.length} targets.`);
        await queueSleep(QUEUE_SCROLL_DELAY_MS);
    }
    await queueSleep(QUEUE_SCROLL_FINAL_SETTLE_MS);
};

window.MaxExtensionFloatingPanel.playQueueNotificationBeep = async function () {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
            logConCgp('[queue-engine] AudioContext not available. Skipping beep.');
            return;
        }

        if (!this.queueAudioContext) {
            this.queueAudioContext = new AudioCtx();
        }

        const ctx = this.queueAudioContext;
        if (ctx.state === 'suspended') {
            await ctx.resume().catch(() => { });
        }

        const now = ctx.currentTime;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

        oscillator.connect(gain).connect(ctx.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.3);
        logConCgp('[queue-engine] Queue notification beep played.');
    } catch (err) {
        logConCgp('[queue-engine] Failed to play queue notification beep:', err?.message || err);
    }
};

window.MaxExtensionFloatingPanel.playQueueCompletionBeep = async function () {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
            logConCgp('[queue-engine] AudioContext not available. Skipping completion chime.');
            return;
        }

        if (!this.queueAudioContext) {
            this.queueAudioContext = new AudioCtx();
        }

        const ctx = this.queueAudioContext;
        if (ctx.state === 'suspended') {
            await ctx.resume().catch(() => { });
        }

        const scheduleTone = (startTime, frequency, options = {}) => {
            const {
                type = 'sine',
                attack = 0.02,
                peak = 0.28,
                sustainDuration = 0.25,
                sustainLevel = 0.35,
                release = 0.45,
                detune = 0
            } = options;

            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();

            oscillator.type = type;
            oscillator.frequency.setValueAtTime(frequency, startTime);
            if (detune !== 0 && oscillator.detune && typeof oscillator.detune.setValueAtTime === 'function') {
                oscillator.detune.setValueAtTime(detune, startTime);
            }

            const attackEnd = startTime + attack;
            const sustainEnd = attackEnd + sustainDuration;
            const releaseEnd = sustainEnd + release;

            gain.gain.setValueAtTime(0.0001, startTime);
            gain.gain.exponentialRampToValueAtTime(peak, attackEnd);
            gain.gain.linearRampToValueAtTime(peak * sustainLevel, sustainEnd);
            gain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

            oscillator.connect(gain).connect(ctx.destination);
            oscillator.start(startTime);
            oscillator.stop(releaseEnd + 0.05);
        };

        const now = ctx.currentTime;
        const motifs = [
            {
                time: now,
                freqs: [523.25, 659.25, 783.99],
                type: 'triangle',
                peak: 0.32,
                sustainDuration: 0.3,
                sustainLevel: 0.4,
                release: 0.5
            },
            {
                time: now + 0.32,
                freqs: [587.33, 739.99, 880],
                type: 'sine',
                peak: 0.26,
                sustainDuration: 0.28,
                sustainLevel: 0.35,
                release: 0.55
            },
            {
                time: now + 0.64,
                freqs: [659.25, 830.61, 987.77],
                type: 'sine',
                peak: 0.22,
                sustainDuration: 0.35,
                sustainLevel: 0.3,
                release: 0.65
            }
        ];

        motifs.forEach((motif) => {
            motif.freqs.forEach((freq, index) => {
                scheduleTone(motif.time, freq, {
                    type: index === 0 ? motif.type : 'sine',
                    peak: motif.peak * (index === 0 ? 1 : 0.7),
                    sustainDuration: motif.sustainDuration,
                    sustainLevel: motif.sustainLevel,
                    release: motif.release,
                    detune: index === 2 ? 6 : (index === 1 ? -6 : 0)
                });
            });
        });

        scheduleTone(now + 0.96, 1174.66, {
            type: 'sine',
            peak: 0.2,
            sustainDuration: 0.18,
            sustainLevel: 0.25,
            release: 0.7
        });

        scheduleTone(now + 1.05, 1567.98, {
            type: 'sine',
            peak: 0.14,
            sustainDuration: 0.18,
            sustainLevel: 0.2,
            release: 0.8,
            detune: 8
        });

        logConCgp('[queue-engine] Queue completion chime played.');
    } catch (err) {
        logConCgp('[queue-engine] Failed to play queue completion chime:', err?.message || err);
    }
};

window.MaxExtensionFloatingPanel.speakQueueNextItem = async function () {
    try {
        if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') {
            logConCgp('[queue-engine] Speech synthesis unavailable. Skipping spoken prompt.');
            return;
        }

        const utterance = new SpeechSynthesisUtterance('Next item');
        utterance.rate = 1;
        utterance.pitch = 1;

        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
        }

        const waitForVoices = () => new Promise((resolve) => {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length) {
                resolve();
                return;
            }
            const handleVoicesChanged = () => {
                window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
                resolve();
            };
            window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged, { once: true });
            setTimeout(() => {
                window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
                resolve();
            }, 500);
        });

        await waitForVoices();
        window.speechSynthesis.speak(utterance);
        logConCgp('[queue-engine] Spoken "Next item" notification issued.');
    } catch (err) {
        logConCgp('[queue-engine] Speech synthesis attempt failed:', err?.message || err);
    }
};

window.MaxExtensionFloatingPanel.performQueuePreSendActions = async function () {
    const shouldAutoScroll = Boolean(this.queueAutoScrollEnabled);
    const shouldBeep = Boolean(this.queueBeepEnabled);
    const shouldSpeak = Boolean(this.queueSpeakEnabled);

    if (!shouldAutoScroll && !shouldBeep && !shouldSpeak) {
        return;
    }

    if (shouldBeep) {
        await this.playQueueNotificationBeep();
    }

    if (shouldSpeak) {
        await this.speakQueueNextItem();
    }

    if (shouldAutoScroll) {
        await this.performQueueAutoScrollSequence();
    }
};

/**
 * Processes the next item in the queue.
 * Calls the same entry-point used by manual clicks, so site code paths remain identical.
 */
window.MaxExtensionFloatingPanel.processNextQueueItem = async function () {
    // If queue mode was turned off mid-cycle, freeze (pause).
    if (!window.globalMaxExtensionConfig?.enableQueueMode) {
        logConCgp('[queue-engine] Queue mode disabled mid-cycle. Pausing to freeze state.');
        this.pauseQueue();
        return;
    }

    if (!this.isQueueRunning) {
        return;
    }

    if (!Array.isArray(this.promptQueue) || this.promptQueue.length === 0) {
        logConCgp('[queue-engine] Queue is empty. Stopping.');
        this.pauseQueue();
        return;
    }

    try {
        await this.performQueuePreSendActions();
    } catch (err) {
        logConCgp('[queue-engine] Pre-send actions failed:', err?.message || err);
    }

    if (!window.globalMaxExtensionConfig?.enableQueueMode) {
        logConCgp('[queue-engine] Queue mode disabled after pre-send actions. Pausing.');
        this.pauseQueue();
        return;
    }

    if (!this.isQueueRunning) {
        return;
    }

    if (!Array.isArray(this.promptQueue) || this.promptQueue.length === 0) {
        logConCgp('[queue-engine] Queue became empty before dispatch.');
        this.pauseQueue();
        return;
    }

    const item = this.promptQueue.shift();
    if (!item) {
        logConCgp('[queue-engine] No queued item available to dispatch after pre-send actions.');
        this.pauseQueue();
        return;
    }

    this.renderQueueDisplay();
    logConCgp('[queue-engine] Sending item:', item.text);

    // Clear any stale autosend interval from a previous run to avoid collisions on "first send".
    if (window.autoSendInterval) {
        try { clearInterval(window.autoSendInterval); } catch (_) { }
        window.autoSendInterval = null;
        logConCgp('[queue-engine] Cleared stale autoSendInterval before dispatching queued click.');
    }

    // Synthesize a "user-like" click by calling the same entry function that real buttons use.
    // We tag the event so processCustomSendButtonClick won't re-enqueue and won't apply Shift inversion.
    const mockEvent = { preventDefault: () => { }, shiftKey: false, __fromQueue: true };

    try {
        if (typeof this.setQueueStatus === 'function') {
            this.setQueueStatus(null);
        }

        // Use the canonical entry point so per-site behavior is identical to manual clicks.
        const sendResult = await processCustomSendButtonClick(
            mockEvent,
            item.text,
            true // Queue dispatch must always auto-send regardless of button toggle.
        );

        // Handle result statuses
        if (sendResult) {
            if (sendResult.status === 'blocked_by_stop') {
                logConCgp('[queue-engine] Queue paused: blocked by stop button/AI typing.');
                if (typeof this.setQueueStatus === 'function') {
                    this.setQueueStatus(
                        'Waiting for AI...',
                        'info',
                        'Paused while the AI is typing. Queue will resume once the Stop button disappears.'
                    );
                }
                // Pause the queue effectively stopping the timer loop.
                this.pauseQueue();
                return;
            } else if (sendResult.status === 'not_found' || sendResult.status === 'failed') {
                logConCgp('[queue-engine] Queue paused: Send failed or button not found.');
                if (typeof this.setQueueStatus === 'function') {
                    let failMsg = 'Send Failed';
                    let failTooltip = 'Unable to find the send button. Please check if the AI is still generating or if the page layout has changed.';

                    if (sendResult.reason === 'send_button_timeout') {
                        failMsg = 'Send Timeout';
                        failTooltip = 'Timed out waiting for the send button. The AI might be generating a long response, or the button selector is broken.';
                    } else if (sendResult.reason === 'post-stop-missing-send') {
                        failMsg = 'Send Button Missing';
                        failTooltip = 'The Stop button disappeared, but the Send button did not reappear. The page state might be inconsistent.';
                    } else if (sendResult.reason) {
                        failTooltip = `Reason: ${sendResult.reason}. ` + failTooltip;
                    }

                    this.setQueueStatus(failMsg, 'error', failTooltip);
                }
                this.pauseQueue();
                return;
            }
            // If status === 'sent', we proceed to schedule the next item.
        }

        if (typeof this.setQueueStatus === 'function') {
            this.setQueueStatus(null); // Clear status on success
        }

    } catch (err) {
        logConCgp('[queue-engine] Error while dispatching queued click:', err?.message || err);
        if (typeof this.setQueueStatus === 'function') {
            this.setQueueStatus('Error: ' + (err?.message || 'Dispatch failed'), 'error');
        }
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
        this.queueTimerId = setTimeout(() => {
            void this.processNextQueueItem();
        }, delayMs);
    } else {
        logConCgp('[queue-engine] All items have been sent.');
        if (this.queueProgressBar) {
            this.queueProgressBar.style.transition = 'none';
            this.queueProgressBar.style.width = '100%';
        }
        this.pauseQueue();
        if (typeof this.markQueueFinished === 'function') {
            this.markQueueFinished();
        }
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

window.MaxExtensionFloatingPanel.syncQueueKeepTabActive = async function (options = {}) {
    const { force = false } = options;
    const shouldKeepAwake = Boolean(this.queueKeepTabActiveEnabled);

    if (!force && this.__queueKeepAwakeApplied === shouldKeepAwake) {
        return;
    }
    this.__queueKeepAwakeApplied = shouldKeepAwake;

    if (!chrome?.runtime?.sendMessage) {
        logConCgp('[queue-engine] chrome.runtime.sendMessage unavailable; cannot set keep-awake state.');
        return;
    }

    if (!this.__queueKeepAwakePagehideHooked) {
        this.__queueKeepAwakePagehideHooked = true;
        window.addEventListener('pagehide', () => {
            try {
                chrome.runtime.sendMessage({ type: 'queueKeepAwake', enabled: false, level: 'display' });
            } catch (_) { }
        });
    }

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'queueKeepAwake',
            enabled: shouldKeepAwake,
            level: 'display'
        });

        if (!response || response.success !== true) {
            logConCgp('[queue-engine] Keep-awake update failed:', response?.error || response);
        }
    } catch (err) {
        logConCgp('[queue-engine] Keep-awake update failed:', err?.message || err);
    }
};
