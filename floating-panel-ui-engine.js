// floating-panel-ui-engine.js
// Version: 2.0
// Documentation:
// This file contains the queue use-cases and send orchestration.
// Queue state transitions and timer ownership live in QueueRuntimeController;
// the UI observes runtime changes without owning queue state.
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
// - floating-panel-queue-runtime.js: Owns queue state, timer, and notifications.

'use strict';

const queueSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const QUEUE_SCROLL_REPETITIONS = 3;
const QUEUE_SCROLL_DELAY_MS = 250;
const QUEUE_SCROLL_FINAL_SETTLE_MS = 400;
const QUEUE_DELAY_SLIDER_STEPS = 1000;

const getQueueRuntime = (queue) => {
    if (!queue.queueRuntime && window.MaxExtensionQueueRuntimeController) {
        queue.queueRuntime = new window.MaxExtensionQueueRuntimeController(queue);
        queue.attachQueueRuntimeSubscriber?.();
    }
    if (!queue.queueRuntime) {
        throw new Error('Queue runtime is unavailable. Check the extension script load order.');
    }
    return queue.queueRuntime;
};

window.MaxExtensionFloatingPanel.getQueueDelayBounds = function (unit = window.globalMaxExtensionConfig?.queueDelayUnit) {
    return unit === 'sec'
        ? { min: 10, max: 64000 }
        : { min: 1, max: 64000 };
};

window.MaxExtensionFloatingPanel.queueDelayValueToSliderPosition = function (value, min, max) {
    const safeMin = Math.max(1, Number(min) || 1);
    const safeMax = Math.max(safeMin + 1, Number(max) || 64000);
    const clamped = Math.min(safeMax, Math.max(safeMin, Number(value) || safeMin));
    const ratio = Math.log(clamped / safeMin) / Math.log(safeMax / safeMin);
    return Math.round(ratio * QUEUE_DELAY_SLIDER_STEPS);
};

window.MaxExtensionFloatingPanel.queueDelaySliderPositionToValue = function (position, min, max) {
    const safeMin = Math.max(1, Number(min) || 1);
    const safeMax = Math.max(safeMin + 1, Number(max) || 64000);
    const clampedPosition = Math.min(QUEUE_DELAY_SLIDER_STEPS, Math.max(0, Number(position) || 0));
    if (clampedPosition === 0) return safeMin;
    if (clampedPosition === QUEUE_DELAY_SLIDER_STEPS) return safeMax;

    const ratio = clampedPosition / QUEUE_DELAY_SLIDER_STEPS;
    const rawValue = safeMin * Math.pow(safeMax / safeMin, ratio);
    const roundingStep = rawValue < 60
        ? 1
        : rawValue < 300
            ? 5
            : rawValue < 1800
                ? 15
                : rawValue < 7200
                    ? 60
                    : 300;
    return Math.min(safeMax, Math.max(safeMin, Math.round(rawValue / roundingStep) * roundingStep));
};

window.MaxExtensionFloatingPanel.setQueueDelayValue = function (value, unit, options = {}) {
    const {
        persist = true,
        recalculate = true,
        preserveActiveInput = false
    } = options;
    const normalizedUnit = unit === 'sec' ? 'sec' : 'min';
    const { min, max } = this.getQueueDelayBounds(normalizedUnit);
    const numericValue = Number(value);
    const clampedValue = Math.min(max, Math.max(min, Number.isFinite(numericValue) ? Math.round(numericValue) : min));

    if (!window.globalMaxExtensionConfig) {
        window.globalMaxExtensionConfig = {};
    }
    window.globalMaxExtensionConfig.queueDelayUnit = normalizedUnit;
    window.globalMaxExtensionConfig[normalizedUnit === 'sec' ? 'queueDelaySeconds' : 'queueDelayMinutes'] = clampedValue;

    this.syncQueueDelayUiFromConfig?.({ preserveActiveInput });
    this.updateInlineQueueControlsVisibility?.({ preserveActiveInput });
    if (recalculate) this.recalculateRunningTimer?.();
    if (persist) {
        this.saveCurrentProfileConfig?.({ suppressSenderRefresh: true });
    }
    return clampedValue;
};

/**
 * Adds a prompt configuration to the queue.
 * @param {object} buttonConfig - The configuration of the button clicked.
 */
window.MaxExtensionFloatingPanel.addToQueue = function (buttonConfig) {
    // Prevent adding if queue mode is disabled
    if (!window.globalMaxExtensionConfig?.enableQueueMode) {
        logConCgp('[queue-engine] Queue mode is disabled. Ignoring addToQueue.');
        return null;
    }

    if (this.promptQueue.length >= this.QUEUE_MAX_SIZE) {
        logConCgp('[queue-engine] Queue is full. Cannot add more prompts.');
        const displayAreas = typeof this.getQueueDisplayAreas === 'function'
            ? this.getQueueDisplayAreas()
            : [this.queueDisplayArea].filter(Boolean);
        displayAreas.forEach((displayArea) => {
            displayArea.style.borderColor = 'red';
            setTimeout(() => {
                displayArea.style.borderColor = '';
            }, 500);
        });
        return null;
    }

    const queueEntry = getQueueRuntime(this).enqueue(buttonConfig, this.QUEUE_MAX_SIZE);
    if (!queueEntry) return null;
    this.clearQueueFinishedState?.();
    this.showQueueMenu?.();
    logConCgp('[queue-engine] Added to queue:', queueEntry.text);
    return queueEntry;
};

window.MaxExtensionFloatingPanel.addManyToQueue = function (buttonConfigs) {
    if (!window.globalMaxExtensionConfig?.enableQueueMode || !Array.isArray(buttonConfigs)) return [];
    const entries = getQueueRuntime(this).enqueueMany(buttonConfigs, this.QUEUE_MAX_SIZE);
    if (entries.length > 0) {
        this.clearQueueFinishedState?.();
        this.showQueueMenu?.();
    }
    if (entries.length < buttonConfigs.length) {
        logConCgp(`[queue-engine] Queue capacity accepted ${entries.length} of ${buttonConfigs.length} prompts.`);
    }
    return entries;
};

/**
 * Removes a prompt from the queue at a specific index.
 * @param {number} index - The index of the item to remove.
 */
window.MaxExtensionFloatingPanel.removeFromQueue = function (index) {
    const removed = getQueueRuntime(this).removeAt(index);
    if (!removed) return null;
    logConCgp('[queue-engine] Removed from queue:', removed.text);
    this.clearQueueFinishedState?.();
    return removed;
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
        const seconds = Number.isFinite(secondsValue) ? secondsValue : 60;
        return Math.max(10, seconds) * 1000;
    }
    const minutesValue = Number(config.queueDelayMinutes);
    const minutes = Number.isFinite(minutesValue) ? minutesValue : 1;
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
 * Starts a queue timer that ends by dispatching the next queued item.
 * Used both for the normal between-item delay and the optional initial delay.
 * @param {number} delayMs
 * @param {Object} [options]
 * @param {string} [options.logContext='next item'] - Human-readable label for logs.
 */
window.MaxExtensionFloatingPanel.scheduleQueueDispatchDelay = function (delayMs, options = {}) {
    const { logContext = 'next item' } = options;
    const config = window.globalMaxExtensionConfig || {};
    const unit = (config.queueDelayUnit === 'sec') ? 'sec' : 'min';
    const sample = this.lastQueueDelaySample || { baseMs: delayMs, offsetMs: 0, totalMs: delayMs };
    const totalStr = this.formatQueueDelayForUnit(delayMs, unit);

    if (config.queueRandomizeEnabled && sample.offsetMs > 0) {
        const baseStr = this.formatQueueDelayForUnit(sample.baseMs, unit);
        const offsetStr = this.formatQueueDelayForUnit(sample.offsetMs, unit);
        logConCgp(`[queue-engine] Waiting for ${totalStr} (base ${baseStr} + offset ${offsetStr}) before ${logContext}.`);
    } else {
        logConCgp(`[queue-engine] Waiting for ${totalStr} before ${logContext}.`);
    }

    return getQueueRuntime(this).schedule(
        delayMs,
        () => this.processNextQueueItem(),
        { renderItems: false }
    );
};

/**
 * Immediately advances to the next item in the queue, bypassing the remaining delay.
 */
window.MaxExtensionFloatingPanel.skipToNextQueueItem = async function () {
    if (!window.globalMaxExtensionConfig?.enableQueueMode) {
        logConCgp('[queue-engine] Skip ignored because queue mode is disabled.');
        return;
    }

    if (!Array.isArray(this.promptQueue) || this.promptQueue.length === 0) {
        logConCgp('[queue-engine] Skip ignored because the queue is empty.');
        return;
    }

    if (this.__queueSkipInProgress) {
        logConCgp('[queue-engine] Skip ignored because another skip is still being dispatched.');
        return;
    }

    const wasRunning = this.isQueueRunning;
    const wasPaused = !this.isQueueRunning && (this.remainingTimeOnPause > 0);
    this.__queueSkipInProgress = true;
    getQueueRuntime(this).beginImmediateDispatch();

    logConCgp('[queue-engine] Skip requested. Sending next queued prompt immediately.');
    try {
        await this.processNextQueueItem();
    } finally {
        this.__queueSkipInProgress = false;

        if (wasPaused && this.isQueueRunning) {
            // Restore paused state only after the skipped item has finished dispatching.
            this.pauseQueue();
        } else if (!wasRunning && !this.isQueueRunning) {
            // Queue finished while we were idle; ensure UI reflects the stopped state.
            getQueueRuntime(this).notifyState({ renderItems: false });
        }
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
        if (remaining <= 20) {
            // Treat as an immediate skip when user selects the end of the bar.
            logConCgp('[queue-engine] Seek reached the end of the interval. Dispatching next item.');
            getQueueRuntime(this).beginImmediateDispatch();
            void this.processNextQueueItem();
            return;
        }

        getQueueRuntime(this).scheduleRemaining(
            total,
            remaining,
            () => this.processNextQueueItem(),
            { renderItems: false }
        );

        const remainingStr = this.formatQueueDelayForUnit(remaining, unit);
        logConCgp(`[queue-engine] Seeked queue timer to ${(clampedRatio * 100).toFixed(0)}% (${remainingStr} remaining).`);
        if (this.lastQueueDelaySample) {
            this.lastQueueDelaySample.timestamp = Date.now();
        }
    } else if (!this.isQueueRunning && this.remainingTimeOnPause > 0) {
        getQueueRuntime(this).setPausedProgress(total, remaining);

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
 * @param {Object} [options]
 * @param {boolean} [options.waitBeforeFirstSend=false] - When true, a fresh start waits one full queue delay before the first dispatch.
 */
window.MaxExtensionFloatingPanel.startQueue = function (options = {}) {
    const { waitBeforeFirstSend = false } = options;
    const runtime = getQueueRuntime(this);

    // Do not start if queue mode is disabled
    if (!window.globalMaxExtensionConfig?.enableQueueMode) {
        logConCgp('[queue-engine] Queue mode is disabled. startQueue aborted.');
        return { status: 'disabled' };
    }

    const state = runtime.snapshot;
    if (state.isRunning) return { status: 'already_running' };
    if (state.items.length === 0) return { status: 'empty' };

    this.clearQueueFinishedState?.();

    // If we have remaining time, we are resuming a paused timer.
    if (state.remainingPausedMs > 0) {
        logConCgp(`[queue-engine] Resuming queue with ${state.remainingPausedMs}ms remaining.`);
        runtime.resume(() => this.processNextQueueItem());
        return { status: 'resumed' };
    }

    // Fresh start: either send immediately or wait once before the first send.
    if (waitBeforeFirstSend) {
        const delayMs = this.getQueueDelayWithRandomMs();
        logConCgp('[queue-engine] Queue started with initial delay before the first item.');
        this.scheduleQueueDispatchDelay(delayMs, { logContext: 'the first item' });
        return { status: 'waiting' };
    }

    logConCgp('[queue-engine] Queue started.');
    runtime.beginImmediateDispatch();
    void this.processNextQueueItem();
    return { status: 'sending' };
};

/**
 * Pauses the queue processing and saves the remaining time.
 */
window.MaxExtensionFloatingPanel.pauseQueue = function () {
    const remainingMs = getQueueRuntime(this).pause();
    logConCgp(remainingMs > 0
        ? `[queue-engine] Queue paused. Remaining time: ${remainingMs}ms`
        : '[queue-engine] Queue paused.');
    return { status: remainingMs > 0 ? 'paused' : 'stopped', remainingMs };
};

/**
 * Resets the queue, clearing all items and stopping the process.
 */
window.MaxExtensionFloatingPanel.resetQueue = function () {
    getQueueRuntime(this).reset();
    this.clearQueueFinishedState?.();
    logConCgp('[queue-engine] Queue reset.');
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

    const hasRunningTimer = this.isQueueRunning && this.queueTimerId !== null;
    const hasPausedTimer = !this.isQueueRunning && this.remainingTimeOnPause > 0;
    if (!hasRunningTimer && !hasPausedTimer) return;

    logConCgp('[queue-engine] Recalculating timer due to delay change.');

    const elapsedTime = hasRunningTimer
        ? Math.max(0, Date.now() - this.timerStartTime)
        : Math.max(0, this.currentTimerDelay - this.remainingTimeOnPause);

    // New total delay from config (includes random offset if enabled).
    const newTotalDelayMs = this.getQueueDelayWithRandomMs({ log: false });

    if (hasPausedTimer) {
        const newRemainingTime = Math.max(0, newTotalDelayMs - elapsedTime);
        logConCgp(`[queue-engine] Paused timer adjusted to ${newRemainingTime}ms remaining.`);
        getQueueRuntime(this).setPausedProgress(newTotalDelayMs, newRemainingTime);
    } else if (elapsedTime >= newTotalDelayMs) {
        logConCgp('[queue-engine] New delay < elapsed time. Processing next item.');
        getQueueRuntime(this).beginImmediateDispatch();
        void this.processNextQueueItem();
    } else {
        const newRemainingTime = newTotalDelayMs - elapsedTime;
        logConCgp(`[queue-engine] New remaining time is ${newRemainingTime}ms.`);
        getQueueRuntime(this).scheduleRemaining(
            newTotalDelayMs,
            newRemainingTime,
            () => this.processNextQueueItem(),
            { renderItems: false }
        );
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
 * Serializes queue dispatch so timer, Skip, and UI actions cannot send two items concurrently.
 */
window.MaxExtensionFloatingPanel.processNextQueueItem = function () {
    if (this.__queueDispatchPromise) {
        this.__queueDispatchRequested = true;
        return this.__queueDispatchPromise;
    }

    const dispatchPromise = this.dispatchNextQueueItem();
    this.__queueDispatchPromise = dispatchPromise;
    return dispatchPromise.finally(() => {
        if (this.__queueDispatchPromise === dispatchPromise) {
            this.__queueDispatchPromise = null;
        }
        const shouldDispatchRequestedItem = this.__queueDispatchRequested === true;
        this.__queueDispatchRequested = false;
        const state = getQueueRuntime(this).snapshot;
        if (
            shouldDispatchRequestedItem
            && window.globalMaxExtensionConfig?.enableQueueMode
            && state.phase === 'sending'
            && state.timerId === null
            && state.items.length > 0
        ) {
            queueMicrotask(() => { void this.processNextQueueItem(); });
        }
    });
};

/**
 * Processes one queue item through the canonical button-click entry point.
 */
window.MaxExtensionFloatingPanel.dispatchNextQueueItem = async function () {
    const runtime = getQueueRuntime(this);
    const initialState = runtime.snapshot;
    const dispatchGeneration = initialState.generation;

    // If queue mode was turned off mid-cycle, freeze (pause).
    if (!window.globalMaxExtensionConfig?.enableQueueMode) {
        logConCgp('[queue-engine] Queue mode disabled mid-cycle. Pausing to freeze state.');
        this.pauseQueue();
        return;
    }

    if (!this.isQueueRunning) {
        return;
    }

    if (initialState.phase !== 'sending') {
        logConCgp(`[queue-engine] Dispatch ignored while queue phase is ${initialState.phase}.`);
        return;
    }

    if (!Array.isArray(this.promptQueue) || this.promptQueue.length === 0) {
        logConCgp('[queue-engine] Queue is empty. Stopping.');
        getQueueRuntime(this).finish();
        return;
    }

    try {
        await this.performQueuePreSendActions();
    } catch (err) {
        logConCgp('[queue-engine] Pre-send actions failed:', err?.message || err);
    }

    if (!runtime.isCurrentGeneration(dispatchGeneration)) {
        logConCgp('[queue-engine] Ignoring stale dispatch after queue reset.');
        return;
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

    const item = runtime.takeNext();
    if (!item) {
        logConCgp('[queue-engine] No queued item available to dispatch after pre-send actions.');
        this.pauseQueue();
        return;
    }

    logConCgp('[queue-engine] Sending item:', item.text);

    const restoreUnsentItem = () => {
        if (!runtime.isCurrentGeneration(dispatchGeneration)) return false;
        return runtime.restoreFront(item);
    };

    // Journal the in-flight item before any click can reach the website.
    // A reload after this point recovers it at the front, paused, as an uncertain send.
    if (!await runtime.flushPersistence()) {
        logConCgp('[queue-engine] Queue paused: could not persist the in-flight item.');
        restoreUnsentItem();
        if (typeof this.setQueueStatus === 'function') {
            this.setQueueStatus(
                'Queue save failed',
                'error',
                'The item was not sent because its recovery journal could not be saved. The queue is paused; refresh the page and try again.'
            );
        }
        this.pauseQueue();
        return;
    }

    if (
        !runtime.isCurrentGeneration(dispatchGeneration)
        || !this.isQueueRunning
        || !window.globalMaxExtensionConfig?.enableQueueMode
    ) {
        restoreUnsentItem();
        if (runtime.isCurrentGeneration(dispatchGeneration)) this.pauseQueue();
        return;
    }

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

        if (!runtime.isCurrentGeneration(dispatchGeneration)) {
            logConCgp('[queue-engine] Discarding stale send result after queue reset.');
            return;
        }

        // Only an explicit "sent" result may consume a queued item.
        const sendStatus = sendResult?.status;
        if (sendStatus !== 'sent') {
            if (sendStatus === 'blocked_by_stop') {
                logConCgp('[queue-engine] Queue paused: blocked by stop button/AI typing.');
                restoreUnsentItem();
                if (typeof this.setQueueStatus === 'function') {
                    this.setQueueStatus(
                        'Waiting for AI...',
                        'info',
                        'Queue paused while the AI is typing. Click Play to retry after the Stop button disappears.'
                    );
                }
                // Pause the queue effectively stopping the timer loop.
                this.pauseQueue();
                return;
            }

            if (sendStatus === 'cancelled') {
                logConCgp('[queue-engine] Queue paused: queued prompt action was cancelled.');
                restoreUnsentItem();
                if (typeof this.setQueueStatus === 'function') {
                    this.setQueueStatus(
                        'Send Cancelled',
                        'info',
                        'The queued prompt was kept. Click Play when you are ready to try again.'
                    );
                }
                this.pauseQueue();
                return;
            }

            logConCgp('[queue-engine] Queue paused: Send failed or button not found.');
            restoreUnsentItem();
            if (typeof this.setQueueStatus === 'function') {
                let failMsg = 'Send Failed';
                let failTooltip = 'The queue did not receive confirmation that the prompt was sent. Please check the editor and send-button state.';

                if (sendResult?.reason === 'send_button_timeout') {
                    failMsg = 'Send Timeout';
                    failTooltip = 'Timed out waiting for the send button. The AI might be generating a long response, or the button selector is broken.';
                } else if (sendResult?.reason === 'post-stop-missing-send') {
                    failMsg = 'Send Button Missing';
                    failTooltip = 'The Stop button disappeared, but the Send button did not reappear. The page state might be inconsistent.';
                } else if (sendResult?.reason) {
                    failTooltip = `Reason: ${sendResult.reason}. ` + failTooltip;
                } else if (sendStatus) {
                    failTooltip = `Unexpected send status: ${sendStatus}. ` + failTooltip;
                }

                this.setQueueStatus(failMsg, 'error', failTooltip);
            }
            this.pauseQueue();
            return;
        }

        runtime.confirmInFlightSent(item.queueId);
        if (!await runtime.flushPersistence()) {
            logConCgp('[queue-engine] Sent item, but could not persist its completion. Pausing.');
            if (typeof this.setQueueStatus === 'function') {
                this.setQueueStatus(
                    'Queue save failed',
                    'error',
                    'The item was sent, but its recovery journal could not be updated. The queue is paused to prevent unsafe follow-up sends.'
                );
            }
            this.pauseQueue();
            return;
        }

        if (typeof this.setQueueStatus === 'function') {
            this.setQueueStatus(null); // Clear status on success
        }

    } catch (err) {
        logConCgp('[queue-engine] Error while dispatching queued click:', err?.message || err);
        if (!runtime.isCurrentGeneration(dispatchGeneration)) {
            logConCgp('[queue-engine] Discarding stale send error after queue reset.');
            return;
        }
        restoreUnsentItem();
        if (typeof this.setQueueStatus === 'function') {
            this.setQueueStatus('Error: ' + (err?.message || 'Dispatch failed'), 'error');
        }
        this.pauseQueue();
        return;
    }


    if (!this.isQueueRunning || !window.globalMaxExtensionConfig?.enableQueueMode) {
        logConCgp('[queue-engine] Dispatch completed while queue was paused or disabled; not scheduling another item.');
        runtime.notifyState({ renderItems: false });
        return;
    }

    // If there are more items, schedule the next one.
    if (this.promptQueue.length > 0) {
        const delayMs = this.getQueueDelayWithRandomMs();
        this.scheduleQueueDispatchDelay(delayMs, { logContext: 'the next item' });
    } else {
        logConCgp('[queue-engine] All items have been sent.');
        getQueueRuntime(this).finish();
        if (typeof this.markQueueFinished === 'function') {
            this.markQueueFinished();
        }
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
