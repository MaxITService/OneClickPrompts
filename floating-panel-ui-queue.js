// /floating-panel-ui-queue.js
// Version: 2.0
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

window.MaxExtensionFloatingPanel.syncQueueDelayUiFromConfig = function (options = {}) {
    const { preserveActiveInput = false } = options;
    const config = window.globalMaxExtensionConfig || {};
    const unit = config.queueDelayUnit === 'sec' ? 'sec' : 'min';
    const { min, max } = this.getQueueDelayBounds?.(unit) || (unit === 'sec'
        ? { min: 10, max: 64000 }
        : { min: 1, max: 64000 });
    const configuredValue = Number(unit === 'sec' ? config.queueDelaySeconds : config.queueDelayMinutes);
    const value = Math.min(max, Math.max(min, Number.isFinite(configuredValue) ? configuredValue : min));

    const preserveMainInput = preserveActiveInput
        && document.activeElement === this.delayInputElement;
    if (this.delayInputElement && this.delayUnitToggle) {
        this.delayUnitToggle.textContent = unit;
        if (!preserveMainInput) {
            this.delayInputElement.value = String(value);
        }
        this.delayInputElement.min = String(min);
        this.delayInputElement.max = String(max);
        this.delayInputElement.title = `Delay in ${unit === 'sec' ? 'seconds' : 'minutes'} between queued prompts. Min: ${min}, Max: ${max}.`;
    }

    if (this.delaySliderElement && this.delayInputElement && this.delayUnitToggle) {
        const sliderPosition = this.queueDelayValueToSliderPosition?.(value, min, max) || 0;
        this.delaySliderElement.value = String(sliderPosition);
        this.delaySliderElement.title = `Logarithmic delay slider: ${min}–${max} ${unit}. Current: ${value} ${unit}.`;
        this.delaySliderElement.setAttribute('aria-label', `Queue delay in ${unit === 'sec' ? 'seconds' : 'minutes'}`);
        this.delaySliderElement.setAttribute('aria-valuetext', `${value} ${unit}`);
    }

    const inlineInput = this.inlineQueueControls?.delayInputElement;
    const inlineSlider = this.inlineQueueControls?.delaySliderElement;
    if (!inlineInput && !inlineSlider) return;

    const configuredDelayMs = typeof this.getQueueBaseDelayMs === 'function'
        ? this.getQueueBaseDelayMs()
        : value * (unit === 'sec' ? 1000 : 60000);
    const seconds = Math.min(64000, Math.max(10, Math.round(configuredDelayMs / 1000)));

    const preserveInlineInput = preserveActiveInput
        && document.activeElement === inlineInput;
    if (inlineInput) {
        if (!preserveInlineInput) {
            inlineInput.value = String(seconds);
        }
        inlineInput.title = `Exact queue delay in seconds. Min: 10, Max: 64000. Current: ${seconds}s.`;
    }
    if (inlineSlider) {
        const sliderPosition = this.queueDelayValueToSliderPosition?.(seconds, 10, 64000) || 0;
        inlineSlider.value = String(sliderPosition);
        inlineSlider.title = `Logarithmic queue delay: 10–64000 seconds. Current: ${seconds}s.`;
        inlineSlider.setAttribute('aria-valuetext', `${seconds} seconds`);
    }
};

/**
 * Re-renders every queue surface from the single runtime queue state.
 * This is intentionally idempotent so DOM replacement, panel toggling, and
 * repeated recovery calls cannot create a second timer or a second queue.
 */
window.MaxExtensionFloatingPanel.syncQueueUiFromState = function (options = {}) {
    const { renderItems = true } = options;
    if (this.__queueUiSyncInProgress) {
        this.__queueUiSyncRequested = true;
        return;
    }

    this.__queueUiSyncInProgress = true;
    try {
        do {
            this.__queueUiSyncRequested = false;

            const queueEnabled = Boolean(window.globalMaxExtensionConfig?.enableQueueMode);
            const queueModeInput = this.queueModeToggle?.querySelector('input');
            if (queueModeInput) queueModeInput.checked = queueEnabled;
            document.body?.classList.toggle('ocp-queue-ticking', queueEnabled && this.isQueueRunning);

            if (renderItems) this.renderQueueDisplay?.();
            this.syncQueueDelayUiFromConfig?.();
            this.updateQueueControlsState?.();
            this.updateInlineQueueControlsVisibility?.();
            this.syncQueueProgressFromState?.();
            this.renderQueueStatusFromState?.();
            this.updateManualQueueAvailability?.(queueEnabled);
        } while (this.__queueUiSyncRequested);
    } finally {
        this.__queueUiSyncInProgress = false;
    }
};

window.MaxExtensionFloatingPanel.attachQueueRuntimeSubscriber = function () {
    if (!this.queueRuntime || this.__queueRuntimeUiSource === this.queueRuntime) return;
    this.__queueRuntimeUiUnsubscribe?.();
    this.__queueRuntimeUiSource = this.queueRuntime;
    this.__queueRuntimeUiUnsubscribe = this.queueRuntime.subscribe((_snapshot, options) => {
        this.syncQueueUiFromState(options);
    });
};

window.MaxExtensionFloatingPanel.attachQueueRuntimeSubscriber();

const QUEUE_AUTOMATION_BUTTONS = [
    {
        flagProp: 'queueAutoScrollEnabled',
        storageKey: 'queueAutoScrollBeforeSend',
        label: 'Auto-scroll',
        emoji: '🔚',
        ariaLabel: 'Auto-scroll to the bottom before sending the queued prompt',
        tooltip: 'Scrolls every detected scrollable area to the bottom (like pressing the End key three times) before dispatching the queued prompt.'
    },
    {
        flagProp: 'queueBeepEnabled',
        storageKey: 'queueBeepBeforeSend',
        label: 'Beep',
        emoji: '🔔',
        ariaLabel: 'Play a confirmation beep before sending the queued prompt',
        tooltip: 'Plays a short confirmation tone right before the queued prompt is sent so you can hear that the automation is about to run.'
    },
    {
        flagProp: 'queueSpeakEnabled',
        storageKey: 'queueSpeakBeforeSend',
        label: 'Say "Next item"',
        emoji: '🗣️',
        ariaLabel: 'Announce “Next item” before sending the queued prompt',
        tooltip: 'Uses the browser’s speech synthesis to say “Next item” just before the queued prompt is sent.'
    },
    {
        flagProp: 'queueFinishBeepEnabled',
        storageKey: 'queueBeepOnFinish',
        label: 'Finish beep',
        emoji: '🏁',
        ariaLabel: 'Play a completion beep when the queue finishes sending all prompts',
        tooltip: 'Plays a celebratory tone once all queued prompts have been sent.'
    }
];

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
    this.delaySliderElement = document.getElementById('max-extension-queue-delay-slider');
    this.delayUnitToggle = document.getElementById('max-extension-delay-unit-toggle');
    this.playQueueButton = document.getElementById('max-extension-play-queue-btn');
    this.skipQueueButton = document.getElementById('max-extension-skip-queue-btn');
    this.resetQueueButton = document.getElementById('max-extension-reset-queue-btn');
    this.queueDisplayArea = document.getElementById('max-extension-queue-display');
    this.queueProgressContainer = document.getElementById('max-extension-queue-progress-container');
    this.queueProgressBar = document.getElementById('max-extension-queue-progress-bar');
    this.queueStatusLabel = document.getElementById('max-extension-queue-status-label');
    if (!this.queueStatusLabel && this.queueProgressContainer) {
        // Create it if not in HTML
        this.queueStatusLabel = document.createElement('div');
        this.queueStatusLabel.id = 'max-extension-queue-status-label';
        this.queueStatusLabel.className = 'queue-status-label';
        this.queueStatusLabel.style.cssText = 'font-size: 11px; margin-top: 4px; text-align: center; display: none;';
        this.queueProgressContainer.parentNode.insertBefore(this.queueStatusLabel, this.queueProgressContainer.nextSibling);
    }
    this.randomDelayBadge = document.getElementById('max-extension-random-delay-toggle');
    const tosWarningContainer = document.getElementById('max-extension-queue-tos-warning');
    const tosAcceptButton = document.getElementById('max-extension-tos-accept-btn');
    const tosDeclineButton = document.getElementById('max-extension-tos-decline-btn');

    if (!this.queueSectionElement) {
        logConCgp('[floating-panel-queue] Queue section element not found in the DOM.');
        return;
    }

    if (!window.globalMaxExtensionConfig) {
        window.globalMaxExtensionConfig = {};
    }

    this.queueFinishedState = false;

    this.queueAutoScrollEnabled = Boolean(window.globalMaxExtensionConfig.queueAutoScrollBeforeSend);
    this.queueBeepEnabled = Boolean(window.globalMaxExtensionConfig.queueBeepBeforeSend);
    this.queueSpeakEnabled = Boolean(window.globalMaxExtensionConfig.queueSpeakBeforeSend);
    this.queueFinishBeepEnabled = Boolean(window.globalMaxExtensionConfig.queueBeepOnFinish);

    const delayContainer = this.randomDelayBadge?.closest('.delay-container');
    if (delayContainer) {
        delayContainer.classList.add('random-delay-container');
    }

    let randomPercentPopover = document.getElementById('max-extension-random-percent-popover');
    if (!randomPercentPopover && delayContainer) {
        randomPercentPopover = document.createElement('div');
        randomPercentPopover.id = 'max-extension-random-percent-popover';
        randomPercentPopover.className = 'max-extension-popover random-percent-popover';
        randomPercentPopover.style.display = 'none';

        const inner = document.createElement('div');
        inner.className = 'max-extension-popover-inner';

        const label = document.createElement('label');
        label.className = 'max-extension-popover-label';
        label.setAttribute('for', 'max-extension-random-percent-slider');
        label.innerHTML = 'Random offset: <span id="max-extension-random-percent-value">5%</span>';

        const slider = document.createElement('input');
        slider.id = 'max-extension-random-percent-slider';
        slider.type = 'range';
        slider.min = '0';
        slider.max = '100';
        slider.step = '1';

        inner.appendChild(label);
        inner.appendChild(slider);
        randomPercentPopover.appendChild(inner);
        delayContainer.appendChild(randomPercentPopover);
    } else if (randomPercentPopover && delayContainer && !delayContainer.contains(randomPercentPopover)) {
        delayContainer.appendChild(randomPercentPopover);
    }

    this.randomPercentPopover = document.getElementById('max-extension-random-percent-popover');
    this.randomPercentSlider = document.getElementById('max-extension-random-percent-slider');
    this.randomPercentValueElement = document.getElementById('max-extension-random-percent-value');

    // Prevent dragging when interacting with the queue section
    this.queueSectionElement.addEventListener('mousedown', (event) => {
        event.stopPropagation();
    });

    // --- DELAY INPUT AND UNIT TOGGLE LOGIC (Profile-specific) ---
    this.syncQueueDelayUiFromConfig();

    this.delayUnitToggle.addEventListener('click', (event) => {
        event.preventDefault();
        window.globalMaxExtensionConfig.queueDelayUnit = (window.globalMaxExtensionConfig.queueDelayUnit === 'min') ? 'sec' : 'min';
        this.syncQueueDelayUiFromConfig();
        this.saveCurrentProfileConfig({ suppressSenderRefresh: true }); // Save to profile
        this.recalculateRunningTimer(); // Recalculate timer if it's running
    });

    this.delayInputElement.addEventListener('change', (event) => {
        const unit = window.globalMaxExtensionConfig.queueDelayUnit || 'min';
        this.setQueueDelayValue(event.target.value, unit);
    });

    this.delayInputElement.addEventListener('input', (event) => {
        const unit = window.globalMaxExtensionConfig.queueDelayUnit || 'min';
        const { min, max } = this.getQueueDelayBounds(unit);
        const value = Number(event.target.value);
        if (!Number.isFinite(value) || value < min || value > max) return;
        this.setQueueDelayValue(value, unit, {
            persist: false,
            recalculate: false,
            preserveActiveInput: true
        });
    });

    this.delaySliderElement?.addEventListener('input', (event) => {
        const unit = window.globalMaxExtensionConfig.queueDelayUnit || 'min';
        const { min, max } = this.getQueueDelayBounds(unit);
        const value = this.queueDelaySliderPositionToValue(event.target.value, min, max);
        this.setQueueDelayValue(value, unit, { persist: false, recalculate: false });
    });

    this.delaySliderElement?.addEventListener('change', (event) => {
        const unit = window.globalMaxExtensionConfig.queueDelayUnit || 'min';
        const { min, max } = this.getQueueDelayBounds(unit);
        const value = this.queueDelaySliderPositionToValue(event.target.value, min, max);
        this.setQueueDelayValue(value, unit);
    });

    if (this.randomPercentSlider && !this.randomPercentSlider.dataset.randomSliderBound) {
        this.randomPercentSlider.dataset.randomSliderBound = 'true';
        this.randomPercentSlider.addEventListener('input', (event) => {
            const rawValue = Number(event.target.value);
            const clampedValue = Math.min(100, Math.max(0, Math.round(rawValue)));
            event.target.value = String(clampedValue);

            if (!window.globalMaxExtensionConfig) {
                window.globalMaxExtensionConfig = {};
            }
            window.globalMaxExtensionConfig.queueRandomizePercent = clampedValue;
            if (this.lastQueueDelaySample) {
                this.lastQueueDelaySample.percent = clampedValue;
            }
            if (typeof this.syncRandomPercentSlider === 'function') {
                this.syncRandomPercentSlider();
            }
            this.updateRandomDelayBadge();
            if (typeof this.saveCurrentProfileConfig === 'function') {
                this.saveCurrentProfileConfig({ suppressSenderRefresh: true });
            }
            if (typeof this.recalculateRunningTimer === 'function') {
                this.recalculateRunningTimer();
            }
            logConCgp(`[floating-panel-queue] Random delay offset slider set to ${clampedValue}%.`);
        });
    }

    if (typeof this.syncRandomPercentSlider === 'function') {
        this.syncRandomPercentSlider();
    }

    if (this.randomDelayBadge && !this.randomDelayBadge.dataset.randomPopoverBound) {
        this.randomDelayBadge.dataset.randomPopoverBound = 'true';
        this.randomDelayBadge.addEventListener('click', (event) => {
            event.preventDefault();
            if (event.shiftKey) {
                if (typeof this.toggleRandomPercentPopover === 'function') {
                    this.toggleRandomPercentPopover();
                }
                return;
            }
            this.toggleRandomDelayFromBadge();
        });
    }

    if (this.skipQueueButton) {
        this.skipQueueButton.addEventListener('click', (event) => {
            event.preventDefault();
            if (typeof this.skipToNextQueueItem === 'function') {
                this.skipToNextQueueItem();
            }
        });
    }

    this.bindQueueProgressSeeking?.(this.queueProgressContainer);

    // --- TOS Confirmation (Global) and Queue Toggle (Profile-specific) ---
    const hideQueueToggle = Boolean(window.globalMaxExtensionConfig.queueHideActivationToggle);
    let isQueueEnabled = Boolean(window.globalMaxExtensionConfig.enableQueueMode);
    if (!isQueueEnabled) this.setQueueKeepTabActive?.(false);

    if (hideQueueToggle) {
        if (window.globalMaxExtensionConfig.enableQueueMode) {
            window.globalMaxExtensionConfig.enableQueueMode = false;
        }
        this.setQueueKeepTabActive?.(false);
        isQueueEnabled = false;
        if (togglePlaceholder) {
            togglePlaceholder.innerHTML = '';
            const disabledNotice = document.createElement('div');
            disabledNotice.className = 'queue-toggle-disabled-note';
            disabledNotice.textContent = 'Queue disabled in settings';
            togglePlaceholder.appendChild(disabledNotice);
        }
        const queueToggleFooter = document.getElementById('max-extension-queue-toggle-footer');
        if (queueToggleFooter) {
            queueToggleFooter.style.display = 'none';
        }
        if (expandableSection) {
            expandableSection.style.display = 'none';
        }
        if (this.queueDisplayArea) {
            this.queueDisplayArea.style.display = 'none';
        }
        if (this.queueSectionElement) {
            this.queueSectionElement.style.display = 'none';
        }
        this.queueToggleForcedToFooter = false;
        this.queueRuntime?.notifyState({ renderItems: false });
        return;
    } else {
        const toggleCallback = (state) => {
            // Check global TOS setting first
            if (state && !window.MaxExtensionGlobalSettings.acceptedQueueTOS) {
                // Make sure the queue section is visible so the warning isn't hidden by responsive/footer logic.
                if (this.queueSectionElement) {
                    this.queueSectionElement.style.display = 'flex';
                }
                tosWarningContainer.style.display = 'block';
                if (this.queueModeToggle) {
                    this.queueModeToggle.style.display = 'none'; // Hide toggle
                    const inputEl = this.queueModeToggle.querySelector('input');
                    if (inputEl) {
                        inputEl.checked = false; // Uncheck it
                    }
                }
                return;
            }

            // If TOS is accepted, proceed with profile setting
            if (typeof this.clearQueueFinishedState === 'function') {
                this.clearQueueFinishedState();
            }

            window.globalMaxExtensionConfig.enableQueueMode = state;

            if (state) {
                this.showQueueMenu?.();
            }

            // Freeze-on-disable behavior:
            if (!state) {
                this.setQueueKeepTabActive?.(false);
                // If it was running, pause (capture remaining time). Do not clear items.
                if (this.isQueueRunning || this.remainingTimeOnPause > 0) {
                    logConCgp('[floating-panel-queue] Queue Mode disabled. Pausing to freeze state.');
                } else {
                    logConCgp('[floating-panel-queue] Queue Mode disabled. Nothing running; preserving items.');
                }
                this.pauseQueue();
                // Hide progress container while disabled (keeps bar width frozen).
                if (this.queueProgressContainer) this.queueProgressContainer.style.display = 'none';
            }

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
                queueSection.style.display = state ? 'flex' : 'none';
            }

            // Refresh every queue surface after the shared setting changes.
            this.queueRuntime?.notifyState({ renderItems: false });
            if (typeof this.updateQueueTogglePlacement === 'function') {
                this.updateQueueTogglePlacement();
            }
            if (typeof this.updateManualQueueAvailability === 'function') {
                this.updateManualQueueAvailability(state);
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

        // If queue mode is off on init but state exists, freeze (pause) and hide visuals (do not clear).
        if (!isQueueEnabled && (this.isQueueRunning || (this.promptQueue && this.promptQueue.length > 0))) {
            logConCgp('[floating-panel-queue] Queue Mode disabled on init. Freezing any lingering state.');
            this.pauseQueue();
            if (this.queueProgressContainer) this.queueProgressContainer.style.display = 'none';
        }

        // Initialize responsive positioning after toggle is created
        if (this.initializeResponsiveQueueToggle) {
            this.initializeResponsiveQueueToggle();
        }
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
        if (this.queueModeToggle) {
            this.queueModeToggle.style.display = ''; // Show toggle again
            const inputEl = this.queueModeToggle.querySelector('input');
            if (inputEl) {
                inputEl.checked = true;
            }
        }
        if (expandableSection) expandableSection.style.display = 'contents';
        if (this.queueDisplayArea) this.queueDisplayArea.style.display = 'flex';
        // Ensure the queue section is visible after acceptance
        if (this.queueSectionElement) {
            this.queueSectionElement.style.display = 'flex';
        }
        if (typeof this.clearQueueFinishedState === 'function') {
            this.clearQueueFinishedState();
        }

        // Controls become available again
        this.queueRuntime?.notifyState({ renderItems: false });
        if (typeof this.updateQueueTogglePlacement === 'function') {
            this.updateQueueTogglePlacement();
        }
        if (typeof this.updateManualQueueAvailability === 'function') {
            this.updateManualQueueAvailability(true);
        }
    });

    tosDeclineButton.addEventListener('click', () => {
        tosWarningContainer.style.display = 'none';
        if (this.queueModeToggle) {
            this.queueModeToggle.style.display = ''; // Show toggle again
        }
        // Intentionally leave queue disabled; any responsive hiding will be handled by resize logic.
        this.queueRuntime?.notifyState({ renderItems: false });
        if (typeof this.clearQueueFinishedState === 'function') {
            this.clearQueueFinishedState();
        }
        if (typeof this.updateQueueTogglePlacement === 'function') {
            this.updateQueueTogglePlacement();
        }
        if (typeof this.updateManualQueueAvailability === 'function') {
            this.updateManualQueueAvailability(false);
        }
    });

    // Attach event listeners to queue action buttons
    this.playQueueButton.addEventListener('click', (event) => {
        // Shift-click / Ctrl+Shift-click handler: when queue is empty and manual queue mode is on
        // Shift+Click = add all valid cards only (don't start)
        // Ctrl+Shift+Click = add all valid cards AND start
        if (event.shiftKey && !this.isQueueRunning) {
            logConCgp('[floating-panel-queue] Shift-click detected on play button. manualQueueExpanded:', this.manualQueueExpanded, 'ctrlKey:', event.ctrlKey);

            // Only trigger if manual queue mode is on and queue is empty
            if (!this.manualQueueExpanded) {
                logConCgp('[floating-panel-queue] Manual queue mode is not active, ignoring shift-click.');
                return;
            }

            const hasItems = this.promptQueue && this.promptQueue.length > 0;
            if (hasItems) {
                logConCgp('[floating-panel-queue] Queue has items, ignoring shift-click.');
                return; // Only works when queue is empty
            }

            event.preventDefault();

            // Add all valid manual cards to queue
            const addedCount = this.addAllValidManualCardsToQueue();

            if (addedCount > 0) {
                if (event.ctrlKey) {
                    // Ctrl+Shift+Click: add AND start
                    logConCgp(`[floating-panel-queue] Ctrl+Shift-click added ${addedCount} manual cards to queue. Starting...`);
                    setTimeout(() => {
                        this.startQueue();
                    }, 100);
                } else {
                    // Shift+Click only: add but don't start
                    logConCgp(`[floating-panel-queue] Shift-click added ${addedCount} manual cards to queue. Ready to start.`);
                    if (typeof window.showToast === 'function') {
                        window.showToast(`Added ${addedCount} card${addedCount > 1 ? 's' : ''} to queue. Click Play to start.`, 'success', 3000);
                    }
                }
            } else {
                // No valid cards, show toast
                if (typeof window.showToast === 'function') {
                    window.showToast('No valid manual queue cards to add. Enter text in at least one card.', 'warning', 3000);
                }
            }
            return;
        }

        // Normal click: play/pause
        if (this.isQueueRunning) {
            this.pauseQueue();
        } else {
            const waitBeforeFirstSend = !!(
                event.ctrlKey &&
                !event.shiftKey &&
                this.promptQueue?.length > 0 &&
                this.remainingTimeOnPause <= 0
            );
            this.startQueue({ waitBeforeFirstSend });
        }
    });

    this.resetQueueButton.addEventListener('click', () => {
        this.resetQueue();
    });

    if (expandableSection) {
        this.setupQueueAutomationButtons(expandableSection);
    }

    if (typeof this.initializeQueueDragAndDrop === 'function') {
        this.initializeQueueDragAndDrop();
    }

    // ===== MANUAL QUEUE MODE INITIALIZATION =====
    // Must be called BEFORE updateQueueControlsState so manualQueueExpanded is defined
    this.initializeManualQueueMode();

    this.syncQueueUiFromState();
};

// Default emojis for manual queue cards (supports up to 9)
const MANUAL_QUEUE_DEFAULT_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const MANUAL_QUEUE_MIN_CARDS = 1;
const MANUAL_QUEUE_MAX_CARDS = 9;
const MANUAL_QUEUE_DEFAULT_COUNT = 6;

/**
 * Initializes the Manual Queue Mode feature.
 * Creates the manual queue cards and sets up toggle behavior.
 */
window.MaxExtensionFloatingPanel.initializeManualQueueMode = function () {
    this.manualQueueModeButton = document.getElementById('max-extension-manual-queue-mode-btn');
    this.manualQueueSection = document.getElementById('max-extension-manual-queue-section');
    this.manualQueueCardsContainer = document.getElementById('max-extension-manual-queue-cards');
    this.panelContent = document.getElementById('max-extension-floating-panel-content');
    this.buttonsArea = document.getElementById('max-extension-buttons-area');

    if (!this.manualQueueModeButton || !this.manualQueueSection || !this.manualQueueCardsContainer) {
        logConCgp('[floating-panel-queue] Manual queue mode elements not found.');
        return;
    }

    // Store card data locally
    this.manualQueueCards = [];
    this.manualQueueExpanded = false;
    this.manualQueueWasExpandedBeforeDisable = false;

    // Load saved card data from storage
    this.loadManualQueueCards();

    // Toggle button click handler
    this.manualQueueModeButton.addEventListener('click', (event) => {
        event.preventDefault();
        this.toggleManualQueueMode();
    });
};

/**
 * Enables or hides manual queue UI based on queue toggle state.
 * Remembers prior expansion so it can be restored when re-enabled.
 * @param {boolean} queueEnabled
 */
window.MaxExtensionFloatingPanel.updateManualQueueAvailability = function (queueEnabled) {
    if (!this.manualQueueModeButton || !this.manualQueueSection) return;

    this.manualQueueModeButton.disabled = !queueEnabled;

    if (!queueEnabled) {
        this.manualQueueWasExpandedBeforeDisable = Boolean(this.manualQueueExpanded);
        if (this.manualQueueExpanded && typeof this.hideManualQueueSection === 'function') {
            this.hideManualQueueSection();
        } else {
            this.manualQueueSection.style.display = 'none';
            this.manualQueueModeButton.classList.remove('active');
            if (this.panelContent) {
                this.panelContent.classList.remove('manual-queue-expanded');
            }
        }
        return;
    }

    if (this.manualQueueWasExpandedBeforeDisable || this.manualQueueExpanded) {
        this.manualQueueWasExpandedBeforeDisable = false;
        if (typeof this.showManualQueueSection === 'function') {
            this.showManualQueueSection();
        }
    }
};

/**
 * Loads manual queue cards from storage and renders them.
 */
window.MaxExtensionFloatingPanel.loadManualQueueCards = async function () {
    try {
        const response = await new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage({ type: 'getManualQueueCards' }, (response) => {
                    if (chrome.runtime.lastError) {
                        // Extension context invalidated - this happens after extension reload
                        logConCgp('[floating-panel-queue] Extension context error loading cards:', chrome.runtime.lastError.message);
                        resolve(null);
                        return;
                    }
                    resolve(response);
                });
            } catch (e) {
                reject(e);
            }
        });

        if (response && response.data) {
            this.manualQueueCards = response.data.cards || [];
            this.manualQueueExpanded = response.data.expanded || false;
            // Load card count, default to 6 if not set, or infer from cards array length
            this.manualQueueCardCount = response.data.cardCount ||
                (this.manualQueueCards.length > 0 ? this.manualQueueCards.length : MANUAL_QUEUE_DEFAULT_COUNT);
            // Clamp the count to valid range
            this.manualQueueCardCount = Math.max(MANUAL_QUEUE_MIN_CARDS,
                Math.min(MANUAL_QUEUE_MAX_CARDS, this.manualQueueCardCount));
        } else {
            // Initialize with defaults
            this.manualQueueCards = MANUAL_QUEUE_DEFAULT_EMOJIS.slice(0, MANUAL_QUEUE_DEFAULT_COUNT)
                .map(emoji => ({ emoji, text: '' }));
            this.manualQueueExpanded = false;
            this.manualQueueCardCount = MANUAL_QUEUE_DEFAULT_COUNT;
        }

        this.renderManualQueueCards();
        const queueEnabled = Boolean(window.globalMaxExtensionConfig?.enableQueueMode);
        if (typeof this.updateManualQueueAvailability === 'function') {
            this.updateManualQueueAvailability(queueEnabled);
        } else if (this.manualQueueExpanded && queueEnabled) {
            this.showManualQueueSection();
        }
    } catch (error) {
        logConCgp('[floating-panel-queue] Error loading manual queue cards:', error);
        // Initialize with defaults on error
        this.manualQueueCards = MANUAL_QUEUE_DEFAULT_EMOJIS.slice(0, MANUAL_QUEUE_DEFAULT_COUNT)
            .map(emoji => ({ emoji, text: '' }));
        this.manualQueueExpanded = false;
        this.manualQueueCardCount = MANUAL_QUEUE_DEFAULT_COUNT;
        this.renderManualQueueCards();
        const queueEnabled = Boolean(window.globalMaxExtensionConfig?.enableQueueMode);
        if (typeof this.updateManualQueueAvailability === 'function') {
            this.updateManualQueueAvailability(queueEnabled);
        }
    }
};

/**
 * Saves manual queue cards to storage.
 */
window.MaxExtensionFloatingPanel.saveManualQueueCards = function () {
    const data = {
        cards: this.manualQueueCards,
        expanded: this.manualQueueExpanded,
        cardCount: this.manualQueueCardCount,
    };

    try {
        chrome.runtime.sendMessage({ type: 'saveManualQueueCards', data }, (response) => {
            if (chrome.runtime.lastError) {
                // Extension context invalidated - silently ignore
                logConCgp('[floating-panel-queue] Extension context error saving cards:', chrome.runtime.lastError.message);
                return;
            }
            if (response && response.error) {
                logConCgp('[floating-panel-queue] Error saving manual queue cards:', response.error);
            }
        });
    } catch (e) {
        logConCgp('[floating-panel-queue] Failed to save manual queue cards:', e);
    }
};

/**
 * Toggles the manual queue mode section visibility.
 */
window.MaxExtensionFloatingPanel.toggleManualQueueMode = function () {
    if (this.manualQueueExpanded) {
        this.hideManualQueueSection();
    } else {
        this.showManualQueueSection();
    }
    this.saveManualQueueCards();
};

/**
 * Shows the manual queue section with cards.
 */
window.MaxExtensionFloatingPanel.showManualQueueSection = function () {
    this.manualQueueExpanded = true;
    this.manualQueueSection.style.display = 'block';
    this.manualQueueModeButton.classList.add('active');

    // Add scrollbar class to content area
    if (this.panelContent) {
        this.panelContent.classList.add('manual-queue-expanded');
    }

    // Update play button tooltip to reflect manual mode
    this.queueRuntime?.notifyState({ renderItems: false });
};

/**
 * Hides the manual queue section.
 */
window.MaxExtensionFloatingPanel.hideManualQueueSection = function () {
    this.manualQueueExpanded = false;
    this.manualQueueSection.style.display = 'none';
    this.manualQueueModeButton.classList.remove('active');

    // Remove scrollbar class from content area
    if (this.panelContent) {
        this.panelContent.classList.remove('manual-queue-expanded');
    }

    // Update play button tooltip to reflect normal mode
    this.queueRuntime?.notifyState({ renderItems: false });
};

/**
 * Renders manual queue cards based on current cardCount.
 */
window.MaxExtensionFloatingPanel.renderManualQueueCards = function () {
    if (!this.manualQueueCardsContainer) return;

    this.manualQueueCardsContainer.innerHTML = '';

    const count = this.manualQueueCardCount || MANUAL_QUEUE_DEFAULT_COUNT;
    for (let i = 0; i < count; i++) {
        const cardData = this.manualQueueCards[i] || { emoji: MANUAL_QUEUE_DEFAULT_EMOJIS[i], text: '' };
        const cardElement = this.createManualQueueCard(i, cardData);
        this.manualQueueCardsContainer.appendChild(cardElement);
    }

    // Add the control card with +/- buttons
    const controlCard = this.createManualQueueControlCard();
    this.manualQueueCardsContainer.appendChild(controlCard);
};

/**
 * Creates the thin control card with +/- buttons to add/remove manual queue cards.
 * @returns {HTMLElement} The control card element.
 */
window.MaxExtensionFloatingPanel.createManualQueueControlCard = function () {
    const card = document.createElement('div');
    card.className = 'manual-queue-control-card';

    const count = this.manualQueueCardCount || MANUAL_QUEUE_DEFAULT_COUNT;

    // Remove button (-)
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'manual-queue-control-btn manual-queue-control-remove';
    removeBtn.textContent = '−';
    removeBtn.title = 'Remove a card (minimum 1)';
    removeBtn.disabled = count <= MANUAL_QUEUE_MIN_CARDS;
    removeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this.removeManualQueueCard();
    });

    // Add button (+)
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'manual-queue-control-btn manual-queue-control-add';
    addBtn.textContent = '+';
    addBtn.title = 'Add a card (maximum 9)';
    addBtn.disabled = count >= MANUAL_QUEUE_MAX_CARDS;
    addBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this.addManualQueueCard();
    });

    card.appendChild(removeBtn);
    card.appendChild(addBtn);

    return card;
};

/**
 * Adds a new manual queue card (if under max limit).
 */
window.MaxExtensionFloatingPanel.addManualQueueCard = function () {
    if (this.manualQueueCardCount >= MANUAL_QUEUE_MAX_CARDS) {
        logConCgp('[floating-panel-queue] Cannot add more cards, already at maximum.');
        return;
    }

    this.manualQueueCardCount++;

    // Ensure the cards array has an entry for the new card
    if (!this.manualQueueCards[this.manualQueueCardCount - 1]) {
        this.manualQueueCards[this.manualQueueCardCount - 1] = {
            emoji: MANUAL_QUEUE_DEFAULT_EMOJIS[this.manualQueueCardCount - 1],
            text: ''
        };
    }

    this.renderManualQueueCards();
    this.saveManualQueueCards();
    logConCgp(`[floating-panel-queue] Added manual queue card. Count: ${this.manualQueueCardCount}`);
};

/**
 * Removes the last manual queue card (if above min limit).
 */
window.MaxExtensionFloatingPanel.removeManualQueueCard = function () {
    if (this.manualQueueCardCount <= MANUAL_QUEUE_MIN_CARDS) {
        logConCgp('[floating-panel-queue] Cannot remove more cards, already at minimum.');
        return;
    }

    // Clear the text of the card being removed
    const removedIndex = this.manualQueueCardCount - 1;
    if (this.manualQueueCards[removedIndex]) {
        this.manualQueueCards[removedIndex].text = '';
    }

    this.manualQueueCardCount--;

    this.renderManualQueueCards();
    this.saveManualQueueCards();
    logConCgp(`[floating-panel-queue] Removed manual queue card. Count: ${this.manualQueueCardCount}`);
};

/**
 * Creates a single manual queue card element.
 * @param {number} index - The card index (0-5).
 * @param {Object} cardData - The card data { emoji, text }.
 * @returns {HTMLElement} The card element.
 */
window.MaxExtensionFloatingPanel.createManualQueueCard = function (index, cardData) {
    const card = document.createElement('div');
    card.className = 'manual-queue-card';
    card.dataset.cardIndex = String(index);

    // Add button (+)
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'manual-queue-card-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Click: Add to queue | Shift+Click: Save as permanent button';
    addBtn.addEventListener('click', (event) => {
        if (event.shiftKey) {
            // Shift+Click: Save as permanent button
            this.saveManualCardAsPermanentButton(index);
        } else {
            // Normal click: Add to queue with visual feedback
            this.addManualCardToQueue(index);
            // Visual flash feedback
            card.style.transition = 'background-color 0.15s ease';
            card.style.backgroundColor = 'rgba(46, 204, 113, 0.35)';
            setTimeout(() => {
                card.style.backgroundColor = '';
            }, 300);
        }
    });

    // Emoji input
    const emojiInput = document.createElement('input');
    emojiInput.type = 'text';
    emojiInput.className = 'manual-queue-card-emoji';
    emojiInput.value = cardData.emoji || MANUAL_QUEUE_DEFAULT_EMOJIS[index];
    emojiInput.title = 'Emoji for this prompt (shown in queue)';
    emojiInput.addEventListener('input', () => {
        this.updateManualCardEmoji(index, emojiInput.value);
    });
    emojiInput.addEventListener('blur', () => {
        // Restore default emoji if empty
        if (!emojiInput.value.trim()) {
            emojiInput.value = MANUAL_QUEUE_DEFAULT_EMOJIS[index];
            this.updateManualCardEmoji(index, emojiInput.value);
        }
    });

    // Text input - using textarea for multiline support with auto-resize
    const textInput = document.createElement('textarea');
    textInput.className = 'manual-queue-card-text';
    textInput.value = cardData.text || '';
    textInput.placeholder = 'Enter prompt text...';
    textInput.title = 'Prompt text to send';
    textInput.rows = 1;
    textInput.style.resize = 'none';
    textInput.style.overflow = 'hidden';

    // Auto-resize function
    const autoResize = () => {
        textInput.style.height = 'auto';
        const computed = window.getComputedStyle(textInput);
        const lineHeight = parseFloat(computed.lineHeight) || 18;
        const padding = parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom);
        const minHeight = lineHeight + padding;
        const newHeight = Math.max(minHeight, textInput.scrollHeight);
        textInput.style.height = `${newHeight}px`;
    };

    textInput.addEventListener('input', () => {
        this.updateManualCardText(index, textInput.value);
        autoResize();
    });

    // Initial auto-resize after DOM insertion
    setTimeout(autoResize, 0);

    card.appendChild(addBtn);
    card.appendChild(emojiInput);
    card.appendChild(textInput);

    return card;
};

/**
 * Saves a manual queue card as a permanent custom button in the current profile.
 * @param {number} index - Card index.
 */
window.MaxExtensionFloatingPanel.saveManualCardAsPermanentButton = function (index) {
    const cardData = this.manualQueueCards[index];

    if (!cardData) {
        logConCgp('[floating-panel-queue] Manual card data not found for index:', index);
        return;
    }

    const text = (cardData.text || '').trim();

    // Validation: text must not be empty
    if (!text) {
        if (typeof window.showToast === 'function') {
            window.showToast('Cannot save empty prompt as button', 'error', 3000);
        }
        return;
    }

    // Get emoji (use default if empty)
    let emoji = (cardData.emoji || '').trim();
    if (!emoji) {
        emoji = MANUAL_QUEUE_DEFAULT_EMOJIS[index];
    }

    // Add to current profile's customButtons
    if (!window.globalMaxExtensionConfig) {
        logConCgp('[floating-panel-queue] No global config available');
        return;
    }

    if (!Array.isArray(window.globalMaxExtensionConfig.customButtons)) {
        window.globalMaxExtensionConfig.customButtons = [];
    }

    const newButton = {
        icon: emoji,
        text: text,
        autoSend: false
    };

    window.globalMaxExtensionConfig.customButtons.push(newButton);

    // Save the profile
    if (typeof this.saveCurrentProfileConfig === 'function') {
        this.saveCurrentProfileConfig();
    }



    if (typeof window.showToast === 'function') {
        window.showToast(`Saved "${emoji}" as permanent button`, 'success', 3000);
    }

    logConCgp(`[floating-panel-queue] Saved manual card ${index} as permanent button:`, text.substring(0, 30) + '...');
};

/**
 * Updates the emoji value for a manual card.
 * @param {number} index - Card index.
 * @param {string} emoji - New emoji value.
 */
window.MaxExtensionFloatingPanel.updateManualCardEmoji = function (index, emoji) {
    if (!this.manualQueueCards[index]) {
        this.manualQueueCards[index] = { emoji: '', text: '' };
    }
    this.manualQueueCards[index].emoji = emoji;
    this.saveManualQueueCards();
};

/**
 * Updates the text value for a manual card.
 * @param {number} index - Card index.
 * @param {string} text - New text value.
 */
window.MaxExtensionFloatingPanel.updateManualCardText = function (index, text) {
    if (!this.manualQueueCards[index]) {
        this.manualQueueCards[index] = { emoji: '', text: '' };
    }
    this.manualQueueCards[index].text = text;
    this.saveManualQueueCards();
};

/**
 * Adds a manual card's prompt to the queue.
 * @param {number} index - Card index.
 */
window.MaxExtensionFloatingPanel.addManualCardToQueue = function (index) {
    const cardData = this.manualQueueCards[index];

    if (!cardData) {
        logConCgp('[floating-panel-queue] Manual card data not found for index:', index);
        return;
    }

    const text = (cardData.text || '').trim();

    // Validation: text must not be empty
    if (!text) {
        // Show toast error
        if (typeof window.showToast === 'function') {
            window.showToast('Cannot add empty prompt to queue', 'error', 3000);
        } else if (typeof showToast === 'function') {
            showToast('Cannot add empty prompt to queue', 'error', 3000);
        } else {
            logConCgp('[floating-panel-queue] Cannot add empty prompt to queue');
        }
        return;
    }

    // Get emoji (use default if empty)
    let emoji = (cardData.emoji || '').trim();
    if (!emoji) {
        emoji = MANUAL_QUEUE_DEFAULT_EMOJIS[index];
        // Update the card data and UI
        this.manualQueueCards[index].emoji = emoji;
        const emojiInput = this.manualQueueCardsContainer?.querySelector(
            `.manual-queue-card[data-card-index="${index}"] .manual-queue-card-emoji`
        );
        if (emojiInput) {
            emojiInput.value = emoji;
        }
        this.saveManualQueueCards();
    }

    // Add to queue using the existing queue infrastructure
    const queueItem = {
        icon: emoji,
        text: text,
        buttonId: `manual-queue-card-${index}`,
        buttonIndex: index,
        autosend: true, // Manual queue items always auto-send
        queueId: `manual-${index}-${Date.now()}`,
        isManualCard: true,
    };

    if (typeof this.addToQueue === 'function') {
        this.addToQueue(queueItem);
        logConCgp(`[floating-panel-queue] Added manual card ${index} to queue:`, text.substring(0, 50) + '...');
    } else {
        logConCgp('[floating-panel-queue] addToQueue function not available');
    }
};

/**
 * Adds all valid (non-empty text) manual queue cards to the queue.
 * Called when double-clicking the play button with manual queue mode active.
 * @returns {number} The number of cards successfully added.
 */
window.MaxExtensionFloatingPanel.addAllValidManualCardsToQueue = function () {
    if (!this.manualQueueCards || !Array.isArray(this.manualQueueCards)) {
        logConCgp('[floating-panel-queue] No manual queue cards available.');
        return 0;
    }

    const queueItems = [];

    const cardCount = Math.min(
        MANUAL_QUEUE_MAX_CARDS,
        Math.max(this.manualQueueCardCount || 0, this.manualQueueCards.length)
    );

    // Iterate through all configured cards in order.
    for (let i = 0; i < cardCount; i++) {
        const cardData = this.manualQueueCards[i];
        if (!cardData) continue;

        const text = (cardData.text || '').trim();
        if (!text) continue; // Skip empty cards

        // Get emoji (use default if empty)
        let emoji = (cardData.emoji || '').trim();
        if (!emoji) {
            emoji = MANUAL_QUEUE_DEFAULT_EMOJIS[i];
        }

        // Add to queue using the existing queue infrastructure
        const queueItem = {
            icon: emoji,
            text: text,
            buttonId: `manual-queue-card-${i}`,
            buttonIndex: i,
            autosend: true,
            queueId: `manual-${i}-${Date.now()}-${queueItems.length}`,
            isManualCard: true,
        };
        queueItems.push(queueItem);
    }

    const addedEntries = this.addManyToQueue?.(queueItems) || [];
    addedEntries.forEach((entry) => {
        logConCgp(`[floating-panel-queue] Auto-added manual card ${entry.buttonIndex + 1} to queue:`, entry.text.substring(0, 30) + '...');
    });
    return addedEntries.length;
};

window.MaxExtensionFloatingPanel.setupQueueAutomationButtons = function (parentElement) {
    if (!parentElement) return;

    if (!this.queuePreSendControlsWrapper) {
        const wrapper = document.createElement('div');
        wrapper.className = 'max-extension-queue-automation-buttons';
        parentElement.appendChild(wrapper);
        this.queuePreSendControlsWrapper = wrapper;
    }

    if (!this.queueAutomationButtons) {
        this.queueAutomationButtons = {};
    }

    QUEUE_AUTOMATION_BUTTONS.forEach((definition) => {
        if (this.queueAutomationButtons[definition.flagProp]) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'max-extension-queue-option-button';
        button.textContent = definition.emoji || definition.label;
        button.title = definition.tooltip || definition.label;
        button.setAttribute('aria-label', definition.ariaLabel || definition.label);

        button.addEventListener('click', () => {
            const newState = !Boolean(this[definition.flagProp]);
            this[definition.flagProp] = newState;
            if (!window.globalMaxExtensionConfig) {
                window.globalMaxExtensionConfig = {};
            }
            window.globalMaxExtensionConfig[definition.storageKey] = newState;
            this.applyQueueAutomationButtonState(definition.flagProp);
            if (typeof this.saveCurrentProfileConfig === 'function') {
                this.saveCurrentProfileConfig();
            }
            logConCgp(`[floating-panel-queue] ${definition.label} ${newState ? 'enabled' : 'disabled'} for pre-send actions.`);
        });

        this.queueAutomationButtons[definition.flagProp] = button;
        this.queuePreSendControlsWrapper.appendChild(button);
        this.applyQueueAutomationButtonState(definition.flagProp);
    });

    if (!this.queueAutomationButtons.queueKeepTabActiveEnabled) {
        const keepAwakeButton = document.createElement('button');
        keepAwakeButton.type = 'button';
        keepAwakeButton.className = 'max-extension-queue-option-button';
        keepAwakeButton.textContent = '☀️';
        keepAwakeButton.title = 'Keeps your computer awake while this switch is ON. It stays ON until you turn it OFF (even if the queue finishes). Your screen stays on and your PC won\'t go to sleep, even if you switch to another tab/window. This is useful for long queues (the computer falling asleep would stop them). Turn this OFF when you\'re done to save power. Note: browsers can still slow down background tabs, so some websites may still pause or run slower in the background.';
        keepAwakeButton.setAttribute('aria-label', 'Keep your computer awake (prevent sleep)');

        keepAwakeButton.addEventListener('click', () => {
            const newState = !Boolean(this.queueKeepTabActiveEnabled);
            this.setQueueKeepTabActive(newState);
            logConCgp(`[floating-panel-queue] Keep tab active ${newState ? 'enabled' : 'disabled'}.`);
        });

        this.queueAutomationButtons.queueKeepTabActiveEnabled = keepAwakeButton;
        this.queuePreSendControlsWrapper.appendChild(keepAwakeButton);
        this.applyQueueAutomationButtonState('queueKeepTabActiveEnabled');
    }

    if (!this.queueFinishedIndicatorButton) {
        const finishedButton = document.createElement('button');
        finishedButton.type = 'button';
        finishedButton.className = 'max-extension-queue-finished-indicator';
        finishedButton.textContent = 'Queue is finished';
        finishedButton.disabled = true;
        finishedButton.setAttribute('aria-hidden', 'true');
        this.queueFinishedIndicatorButton = finishedButton;
        this.queuePreSendControlsWrapper.appendChild(finishedButton);
    }

    if (typeof this.updateQueueFinishedIndicator === 'function') {
        this.updateQueueFinishedIndicator();
    }
};

window.MaxExtensionFloatingPanel.applyQueueAutomationButtonState = function (flagProp) {
    if (!this.queueAutomationButtons || !this.queueAutomationButtons[flagProp]) return;
    const button = this.queueAutomationButtons[flagProp];
    const isActive = Boolean(this[flagProp]);
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
};

window.MaxExtensionFloatingPanel.updateQueueAutomationButtons = function () {
    if (!this.queueAutomationButtons) return;
    Object.keys(this.queueAutomationButtons).forEach((flagProp) => {
        this.applyQueueAutomationButtonState(flagProp);
    });
};

window.MaxExtensionFloatingPanel.setQueueKeepTabActive = function (enabled) {
    this.queueKeepTabActiveEnabled = Boolean(enabled);
    this.applyQueueAutomationButtonState?.('queueKeepTabActiveEnabled');
    void this.syncQueueKeepTabActive?.({ force: true });
};

window.MaxExtensionFloatingPanel.updateQueueFinishedIndicator = function () {
    const indicator = this.queueFinishedIndicatorButton;
    if (!indicator) return;
    const shouldShow = Boolean(this.queueFinishedState);
    indicator.style.display = shouldShow ? 'inline-flex' : 'none';
    indicator.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
};

window.MaxExtensionFloatingPanel.clearQueueFinishedState = function () {
    this.queueFinishedState = false;
    this.updateQueueFinishedIndicator?.();
};

window.MaxExtensionFloatingPanel.markQueueFinished = function () {
    this.queueFinishedState = true;
    if (this.queueFinishBeepEnabled && typeof this.playQueueCompletionBeep === 'function') {
        void this.playQueueCompletionBeep();
    }
    this.updateQueueFinishedIndicator?.();
};

window.MaxExtensionFloatingPanel.syncQueueModeUiFromConfig = function () {
    const queueEnabled = Boolean(window.globalMaxExtensionConfig?.enableQueueMode);
    if (!queueEnabled && this.isQueueRunning) {
        this.pauseQueue?.();
    }
    this.syncQueueUiFromState?.();
    if (typeof this.updateQueueTogglePlacement === 'function') {
        this.updateQueueTogglePlacement();
    }
    if (typeof this.updateManualQueueAvailability === 'function') {
        this.updateManualQueueAvailability(queueEnabled);
    }
};

window.MaxExtensionFloatingPanel.getInlineQueueControlWrappers = function () {
    const wrappers = Array.isArray(this.inlineQueueControlWrappers)
        ? this.inlineQueueControlWrappers
        : [];
    if (this.inlineQueueControls?.wrapper) {
        wrappers.push(this.inlineQueueControls.wrapper);
    }

    const liveWrappers = wrappers.filter((wrapper, index, list) => (
        wrapper
        && wrapper.isConnected
        && list.indexOf(wrapper) === index
    ));
    this.inlineQueueControlWrappers = liveWrappers;
    return liveWrappers;
};

window.MaxExtensionFloatingPanel.syncInlineQueuePanelLayout = function (wrappers = null) {
    const queueSection = document.getElementById('max-extension-queue-section');
    if (!queueSection) return;

    const inlineWrappers = Array.isArray(wrappers)
        ? wrappers
        : (this.getInlineQueueControlWrappers?.() || []);
    const hasPanelInlineQueue = inlineWrappers.some((wrapper) => (
        wrapper?.closest?.('#max-extension-floating-panel')
    ));

    if (hasPanelInlineQueue) {
        this.queueSectionHiddenByInlineControls = true;
        queueSection.style.display = 'none';
        return;
    }

    if (this.queueSectionHiddenByInlineControls) {
        this.queueSectionHiddenByInlineControls = false;
        // Responsive placement decides whether the section should be visible
        // again after an inline menu leaves the floating panel.
        this.updateQueueTogglePlacement?.();
    }
};

window.MaxExtensionFloatingPanel.showQueueMenu = function () {
    this.queueMenuHidden = false;
    this.updateInlineQueueControlsVisibility?.();
};

window.MaxExtensionFloatingPanel.hideQueueMenu = function () {
    // Closing the menu is also an explicit queue cancellation: stop any timer,
    // discard queued/in-flight prompts, and clear the recovery snapshot.
    this.queueMenuHidden = true;
    this.resetQueue?.();
    this.updateInlineQueueControlsVisibility?.();
};

window.MaxExtensionFloatingPanel.ensureInlineQueueControls = function (container) {
    if (!container) return null;
    this.initializeQueueDragAndDrop?.();

    const existing = container.querySelector(':scope > .max-extension-inline-queue-controls');
    if (existing) {
        this.bindInlineQueueControls(existing);
        this.updateInlineQueueControlsVisibility?.();
        return existing;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'max-extension-inline-queue-controls';
    wrapper.innerHTML = `
        <div class="max-extension-inline-queue-header">
            <div class="max-extension-inline-queue-tab">
                <span class="max-extension-inline-queue-title">Queue</span>
                <span class="max-extension-inline-queue-count">0</span>
            </div>
            <label class="max-extension-inline-queue-delay-editor">
                <span class="max-extension-inline-queue-delay-label">Delay</span>
                <input type="number" class="max-extension-inline-queue-delay-input" min="10" max="64000" step="1" inputmode="numeric" aria-label="Exact queue delay in seconds">
                <span class="max-extension-inline-queue-delay-unit">s</span>
                <input type="range" class="max-extension-inline-queue-delay-slider" min="0" max="1000" step="1" aria-label="Logarithmic queue delay in seconds">
            </label>
            <button type="button" class="max-extension-inline-queue-close" aria-label="Cancel queue and hide queue menu" title="Cancel the queue and hide this menu until the next queued prompt">×</button>
        </div>
        <div class="max-extension-inline-queue-body">
            <div class="max-extension-inline-queue-items" title="Queued prompts. Drag to reorder; click an item to remove it."></div>
            <div class="max-extension-inline-queue-actions">
                <button type="button" class="max-extension-inline-queue-play" title="Start or pause queue">▶️</button>
                <button type="button" class="max-extension-inline-queue-skip" title="Send next queued prompt now">⏭️</button>
                <button type="button" class="max-extension-inline-queue-reset" title="Clear queue">🔄</button>
            </div>
            <div class="max-extension-inline-queue-status"></div>
            <div class="max-extension-inline-queue-progress-container">
                <div class="max-extension-inline-queue-progress-bar"></div>
            </div>
        </div>
    `;

    container.appendChild(wrapper);
    this.bindInlineQueueControls(wrapper);
    this.updateInlineQueueControlsVisibility?.();
    return wrapper;
};

window.MaxExtensionFloatingPanel.bindInlineQueueControls = function (wrapper) {
    if (!wrapper) return;

    this.inlineQueueControls = {
        wrapper,
        queueDisplayArea: wrapper.querySelector('.max-extension-inline-queue-items'),
        playQueueButton: wrapper.querySelector('.max-extension-inline-queue-play'),
        skipQueueButton: wrapper.querySelector('.max-extension-inline-queue-skip'),
        resetQueueButton: wrapper.querySelector('.max-extension-inline-queue-reset'),
        queueStatusLabel: wrapper.querySelector('.max-extension-inline-queue-status'),
        queueProgressContainer: wrapper.querySelector('.max-extension-inline-queue-progress-container'),
        queueProgressBar: wrapper.querySelector('.max-extension-inline-queue-progress-bar'),
        queueCountElement: wrapper.querySelector('.max-extension-inline-queue-count'),
        delayInputElement: wrapper.querySelector('.max-extension-inline-queue-delay-input'),
        delaySliderElement: wrapper.querySelector('.max-extension-inline-queue-delay-slider'),
        closeQueueButton: wrapper.querySelector('.max-extension-inline-queue-close')
    };

    if (!Array.isArray(this.inlineQueueControlWrappers)) {
        this.inlineQueueControlWrappers = [];
    }
    if (!this.inlineQueueControlWrappers.includes(wrapper)) {
        this.inlineQueueControlWrappers.push(wrapper);
    }

    this.bindQueueProgressSeeking?.(this.inlineQueueControls.queueProgressContainer);

    if (wrapper.__ocpInlineQueueBound) {
        this.syncQueueUiFromState?.();
        return;
    }
    wrapper.__ocpInlineQueueBound = true;

    this.inlineQueueControls.playQueueButton.addEventListener('click', (event) => {
        event.preventDefault();
        if (this.isQueueRunning) {
            this.pauseQueue();
            return;
        }
        const waitBeforeFirstSend = event.ctrlKey || this.remainingTimeOnPause > 0;
        this.startQueue({ waitBeforeFirstSend });
    });

    this.inlineQueueControls.skipQueueButton.addEventListener('click', (event) => {
        event.preventDefault();
        this.skipToNextQueueItem();
    });

    this.inlineQueueControls.resetQueueButton.addEventListener('click', (event) => {
        event.preventDefault();
        this.resetQueue();
    });

    this.inlineQueueControls.closeQueueButton?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.hideQueueMenu?.();
    });

    const updateInlineDelay = (value, options = {}) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue < 10 || numericValue > 64000) return;
        this.setQueueDelayValue?.(numericValue, 'sec', options);
    };

    this.inlineQueueControls.delayInputElement?.addEventListener('input', (event) => {
        updateInlineDelay(event.target.value, {
            persist: false,
            recalculate: false,
            preserveActiveInput: true
        });
    });
    this.inlineQueueControls.delayInputElement?.addEventListener('change', (event) => {
        const numericValue = Number(event.target.value);
        const clampedValue = Number.isFinite(numericValue)
            ? Math.min(64000, Math.max(10, Math.round(numericValue)))
            : 10;
        this.setQueueDelayValue?.(clampedValue, 'sec');
    });
    this.inlineQueueControls.delaySliderElement?.addEventListener('input', (event) => {
        const seconds = this.queueDelaySliderPositionToValue?.(event.target.value, 10, 64000);
        updateInlineDelay(seconds, { persist: false, recalculate: false });
    });
    this.inlineQueueControls.delaySliderElement?.addEventListener('change', (event) => {
        const seconds = this.queueDelaySliderPositionToValue?.(event.target.value, 10, 64000);
        updateInlineDelay(seconds);
    });

    this.syncQueueUiFromState?.();
};

window.MaxExtensionFloatingPanel.bindQueueProgressSeeking = function (container) {
    if (!container || container.__ocpQueueProgressSeekingBound) return;
    container.__ocpQueueProgressSeekingBound = true;

    container.addEventListener('mousedown', (event) => {
        // Keep progress interaction from starting a floating-panel drag.
        event.stopPropagation();
    });

    container.addEventListener('click', (event) => {
        event.preventDefault();
        if (!window.globalMaxExtensionConfig?.enableQueueMode) return;

        const hasTimer = (
            (this.isQueueRunning && this.queueTimerId != null)
            || Number(this.remainingTimeOnPause) > 0
        );
        if (!hasTimer || !container.firstElementChild) return;

        const rect = container.getBoundingClientRect();
        if (rect.width <= 0) return;

        const ratio = (event.clientX - rect.left) / rect.width;
        this.seekQueueTimerToRatio?.(ratio);
    });
};

window.MaxExtensionFloatingPanel.getQueueDisplayAreas = function () {
    return [
        this.queueDisplayArea,
        this.inlineQueueControls?.queueDisplayArea
    ].filter((element, index, list) => element && list.indexOf(element) === index);
};

window.MaxExtensionFloatingPanel.getQueueProgressBars = function () {
    return [
        this.queueProgressBar,
        ...(this.getInlineQueueControlWrappers?.() || []).map((wrapper) => (
            wrapper.querySelector('.max-extension-inline-queue-progress-bar')
        ))
    ].filter((element, index, list) => element && list.indexOf(element) === index);
};

window.MaxExtensionFloatingPanel.getQueueProgressContainers = function () {
    return [
        this.queueProgressContainer,
        ...(this.getInlineQueueControlWrappers?.() || []).map((wrapper) => (
            wrapper.querySelector('.max-extension-inline-queue-progress-container')
        ))
    ].filter((element, index, list) => element && list.indexOf(element) === index);
};

window.MaxExtensionFloatingPanel.getQueueControlButtons = function () {
    return {
        play: [this.playQueueButton, this.inlineQueueControls?.playQueueButton].filter((element, index, list) => element && list.indexOf(element) === index),
        skip: [this.skipQueueButton, this.inlineQueueControls?.skipQueueButton].filter((element, index, list) => element && list.indexOf(element) === index),
        reset: [this.resetQueueButton, this.inlineQueueControls?.resetQueueButton].filter((element, index, list) => element && list.indexOf(element) === index)
    };
};

window.MaxExtensionFloatingPanel.updateInlineQueueControlsVisibility = function (options = {}) {
    const wrappers = this.getInlineQueueControlWrappers?.() || [];
    this.syncInlineQueuePanelLayout?.(wrappers);
    if (wrappers.length === 0) return;

    const hasItems = Array.isArray(this.promptQueue) && this.promptQueue.length > 0;
    const isPaused = Number(this.remainingTimeOnPause) > 0;
    const queueEnabled = Boolean(window.globalMaxExtensionConfig?.enableQueueMode);
    const shouldShow = queueEnabled || hasItems || this.isQueueRunning || isPaused;
    const menuVisible = shouldShow && !this.queueMenuHidden;

    wrappers.forEach((wrapper) => {
        wrapper.classList.toggle('is-active', menuVisible);
        wrapper.classList.toggle('is-dismissed', this.queueMenuHidden === true);
        wrapper.setAttribute('aria-hidden', String(!menuVisible));
        const countElement = wrapper.querySelector('.max-extension-inline-queue-count');
        if (countElement) countElement.textContent = String(this.promptQueue?.length || 0);
    });

    this.syncQueueDelayUiFromConfig?.(options);
};

window.MaxExtensionFloatingPanel.syncQueueProgressFromState = function () {
    const containers = typeof this.getQueueProgressContainers === 'function'
        ? this.getQueueProgressContainers()
        : [this.queueProgressContainer].filter(Boolean);
    const progressBars = typeof this.getQueueProgressBars === 'function'
        ? this.getQueueProgressBars()
        : [this.queueProgressBar].filter(Boolean);
    if (containers.length === 0 && progressBars.length === 0) return;

    const totalMs = Number(this.currentTimerDelay);
    const remainingPausedMs = Number(this.remainingTimeOnPause);
    const queueEnabled = Boolean(window.globalMaxExtensionConfig?.enableQueueMode);
    const hasRunningTimer = queueEnabled && this.isQueueRunning && this.queueTimerId !== null && totalMs > 0;
    const hasPausedTimer = !this.isQueueRunning && remainingPausedMs > 0 && totalMs > 0;

    if (!hasRunningTimer && !hasPausedTimer) {
        containers.forEach((container) => { container.style.display = 'none'; });
        progressBars.forEach((progressBar) => {
            progressBar.style.transition = 'none';
            progressBar.style.width = '0%';
        });
        return;
    }

    containers.forEach((container) => { container.style.display = queueEnabled ? 'block' : 'none'; });
    const remainingMs = hasRunningTimer
        ? Math.max(0, totalMs - Math.max(0, Date.now() - Number(this.timerStartTime || Date.now())))
        : Math.min(totalMs, remainingPausedMs);
    const elapsedRatio = Math.min(1, Math.max(0, (totalMs - remainingMs) / totalMs));

    progressBars.forEach((progressBar) => {
        progressBar.style.transition = 'none';
        progressBar.style.width = `${elapsedRatio * 100}%`;
        void progressBar.offsetWidth;

        if (hasRunningTimer) {
            progressBar.style.transition = `width ${remainingMs / 1000}s linear`;
            progressBar.style.width = '100%';
        }
    });
};

// Compatibility alias for callers outside the queue UI module.
window.MaxExtensionFloatingPanel.syncInlineQueueProgress = function () {
    this.syncQueueProgressFromState?.();
};

window.MaxExtensionFloatingPanel.renderQueueDisplayInto = function (displayArea) {
    if (!displayArea) return;
    displayArea.innerHTML = '';
    const fragment = document.createDocumentFragment();

    this.promptQueue.forEach((item, index) => {
        const queuedItemElement = document.createElement('button');
        queuedItemElement.className = 'max-extension-queued-item';
        queuedItemElement.innerHTML = item.icon;
        queuedItemElement.title = `Drag to reorder; click to remove: ${item.text}`;
        if (item.queueId) {
            queuedItemElement.dataset.queueId = item.queueId;
        }
        queuedItemElement.dataset.queueIndex = String(index);
        queuedItemElement.addEventListener('click', (event) => {
            if (typeof this.handleQueueItemClick === 'function') {
                this.handleQueueItemClick(event, index);
            } else {
                this.removeFromQueue(index);
            }
        });

        if (typeof this.decorateQueueItemForDrag === 'function') {
            this.decorateQueueItemForDrag(queuedItemElement, item, index, displayArea);
        }

        fragment.appendChild(queuedItemElement);
    });

    displayArea.appendChild(fragment);
    if (this.promptQueue.length > 0) {
        displayArea.style.display = 'flex';
    } else if (window.globalMaxExtensionConfig?.enableQueueMode) {
        displayArea.style.display = 'none';
    }
};

/**
 * Renders the queue display area with the current items in the queue.
 */
window.MaxExtensionFloatingPanel.renderQueueDisplay = function () {
    const displayAreas = typeof this.getQueueDisplayAreas === 'function'
        ? this.getQueueDisplayAreas()
        : [this.queueDisplayArea].filter(Boolean);

    if (displayAreas.length === 0) {
        this.updateInlineQueueControlsVisibility?.();
        return;
    }

    if (typeof this.captureQueuePreRender === 'function') {
        this.captureQueuePreRender();
    }

    displayAreas.forEach((displayArea) => this.renderQueueDisplayInto(displayArea));

    if (typeof this.applyQueuePostRenderEffects === 'function') {
        this.applyQueuePostRenderEffects();
    }

    this.updateInlineQueueControlsVisibility?.();
};

/**
 * Updates the state (icon, disabled status) of the queue control buttons.
 */
window.MaxExtensionFloatingPanel.updateQueueControlsState = function () {
    const buttons = typeof this.getQueueControlButtons === 'function'
        ? this.getQueueControlButtons()
        : {
            play: [this.playQueueButton].filter(Boolean),
            skip: [this.skipQueueButton].filter(Boolean),
            reset: [this.resetQueueButton].filter(Boolean)
        };

    if (buttons.play.length === 0 || buttons.reset.length === 0) {
        this.updateInlineQueueControlsVisibility?.();
        return;
    }

    const hasItems = this.promptQueue.length > 0;
    const isPaused = this.remainingTimeOnPause > 0;
    const queueEnabled = !!(window.globalMaxExtensionConfig && window.globalMaxExtensionConfig.enableQueueMode);

    // If queue mode is OFF, disable controls regardless of items, and hide progress bar.
    if (!queueEnabled) {
        logConCgp('[floating-panel-queue] updateQueueControlsState: Queue mode is OFF, skipping tooltip update.');
        buttons.play.forEach((playButton) => { playButton.innerHTML = '▶️'; });
        const disabledTooltip = 'Enable Queue Mode to start.';
        buttons.play.forEach((playButton) => {
            playButton.title = disabledTooltip;
            playButton.disabled = true;
        });

        // Force tooltip update if OCPTooltip is available
        if (window.OCPTooltip) {
            buttons.play.forEach((playButton) => window.OCPTooltip.updateText(playButton, disabledTooltip));
        }

        buttons.skip.forEach((skipButton) => {
            skipButton.disabled = true;
            skipButton.title = 'Enable Queue Mode to skip.';
        });

        buttons.reset.forEach((resetButton) => {
            resetButton.disabled = true;
        });

        this.getQueueProgressContainers?.().forEach((container) => {
            container.style.display = 'none';
        });
        return;
    }

    // Play/Pause Button
    let tooltipText = '';
    if (this.isQueueRunning) {
        buttons.play.forEach((playButton) => { playButton.innerHTML = '⏸️'; }); // Pause icon
        tooltipText = 'Pause the queue.';
        buttons.play.forEach((playButton) => { playButton.disabled = false; });
    } else {
        buttons.play.forEach((playButton) => { playButton.innerHTML = '▶️'; }); // Play icon

        // Dynamic tooltip based on queue state and manual mode
        logConCgp('[floating-panel-queue] updateQueueControlsState: hasItems=', hasItems, 'isPaused=', isPaused, 'manualQueueExpanded=', this.manualQueueExpanded);
        if (!hasItems && !isPaused) {
            // Queue is empty - show appropriate message
            if (this.manualQueueExpanded) {
                logConCgp('[floating-panel-queue] Setting MANUAL MODE tooltip');
                tooltipText = 'Queue is empty. Shift+Click: add all manual cards to queue. Ctrl+Shift+Click: add all and start immediately. Ctrl+Click on Play after adding items waits before the first send.';
            } else {
                logConCgp('[floating-panel-queue] Setting NORMAL tooltip');
                tooltipText = 'Queue is empty. Click on buttons to add them to queue, then click Play. Ctrl+Click on Play waits before the first send.';
            }
        } else {
            tooltipText = 'Start sending the queued prompts. Ctrl+Click waits the configured delay before the first send.';
        }

        buttons.play.forEach((playButton) => {
            playButton.disabled = !hasItems && !isPaused && !this.manualQueueExpanded; // Keep enabled if manual mode is on for shift-click
        });
    }

    // Set title attribute and force tooltip update
    buttons.play.forEach((playButton) => {
        playButton.title = tooltipText;
    });
    if (window.OCPTooltip) {
        buttons.play.forEach((playButton) => window.OCPTooltip.updateText(playButton, tooltipText));
    }

    buttons.skip.forEach((skipButton) => {
        if (!hasItems) {
            skipButton.disabled = true;
            skipButton.title = 'No queued prompts to skip.';
        } else {
            skipButton.disabled = false;
            skipButton.title = this.isQueueRunning
                ? 'Skip to the next queued prompt immediately.'
                : 'Send the next queued prompt immediately.';
        }
    });

    // Reset Button
    buttons.reset.forEach((resetButton) => {
        resetButton.disabled = !hasItems && !this.isQueueRunning && !isPaused;
    });

    // Hide progress bar if queue is empty and not running
    if (!this.isQueueRunning && !hasItems) {
        this.getQueueProgressContainers?.().forEach((container) => {
            container.style.display = 'none';
        });
    }

    if (typeof this.updateRandomDelayBadge === 'function') {
        this.updateRandomDelayBadge();
    }

    if (typeof this.updateQueueAutomationButtons === 'function') {
        this.updateQueueAutomationButtons();
    }

    this.updateInlineQueueControlsVisibility?.();
};

/**
 * Toggles random delay when the badge is clicked.
 */
window.MaxExtensionFloatingPanel.toggleRandomDelayFromBadge = function () {
    if (typeof this.closeRandomPercentPopover === 'function') {
        this.closeRandomPercentPopover();
    }
    if (!window.globalMaxExtensionConfig) return;
    const newState = !window.globalMaxExtensionConfig.queueRandomizeEnabled;
    window.globalMaxExtensionConfig.queueRandomizeEnabled = newState;
    if (newState && !Number.isFinite(window.globalMaxExtensionConfig.queueRandomizePercent)) {
        window.globalMaxExtensionConfig.queueRandomizePercent = 5;
    }

    const baseMs = (typeof this.getQueueBaseDelayMs === 'function')
        ? this.getQueueBaseDelayMs()
        : 0;
    const percent = Number.isFinite(window.globalMaxExtensionConfig.queueRandomizePercent)
        ? window.globalMaxExtensionConfig.queueRandomizePercent
        : 5;
    this.lastQueueDelaySample = {
        baseMs,
        offsetMs: 0,
        totalMs: baseMs,
        percent,
        timestamp: Date.now()
    };

    this.updateRandomDelayBadge();
    this.recalculateRunningTimer();
    this.saveCurrentProfileConfig();
    logConCgp(`[floating-panel-queue] Random delay offset ${newState ? 'enabled' : 'disabled'} via floating panel.`);
};

window.MaxExtensionFloatingPanel.toggleRandomPercentPopover = function () {
    if (!this.randomPercentPopover) return;
    const isVisible = this.randomPercentPopover.style.display !== 'none';
    if (isVisible) {
        this.closeRandomPercentPopover();
    } else {
        this.openRandomPercentPopover();
    }
};

window.MaxExtensionFloatingPanel.openRandomPercentPopover = function () {
    if (!this.randomPercentPopover) return;
    if (typeof this.syncRandomPercentSlider === 'function') {
        this.syncRandomPercentSlider();
    }
    if (this.randomPercentPopover.style.display === 'block') {
        return;
    }
    this.randomPercentPopover.style.display = 'block';
    this.randomPercentPopover.setAttribute('data-visible', 'true');
    if (typeof this.positionFloatingPopover === 'function' && this.randomDelayBadge) {
        this.positionFloatingPopover(this.randomPercentPopover, this.randomDelayBadge, {
            offsetY: 6,
            align: 'center'
        });
    }
    if (!this.handleRandomPercentOutsideClick) {
        this.handleRandomPercentOutsideClick = (event) => {
            if (!this.randomPercentPopover) {
                return;
            }
            if (this.randomPercentPopover.contains(event.target)) {
                return;
            }
            if (this.randomDelayBadge && this.randomDelayBadge.contains(event.target)) {
                return;
            }
            this.closeRandomPercentPopover();
        };
    }
    document.addEventListener('mousedown', this.handleRandomPercentOutsideClick, true);
};

window.MaxExtensionFloatingPanel.closeRandomPercentPopover = function () {
    if (!this.randomPercentPopover) return;
    if (this.randomPercentPopover.style.display === 'none') {
        return;
    }
    this.randomPercentPopover.style.display = 'none';
    this.randomPercentPopover.removeAttribute('data-visible');
    if (typeof this.restorePopoverToOriginalParent === 'function') {
        this.restorePopoverToOriginalParent(this.randomPercentPopover);
    }
    if (this.handleRandomPercentOutsideClick) {
        document.removeEventListener('mousedown', this.handleRandomPercentOutsideClick, true);
        this.handleRandomPercentOutsideClick = null;
    }
};

window.MaxExtensionFloatingPanel.syncRandomPercentSlider = function () {
    if (!this.randomPercentSlider || !this.randomPercentValueElement) {
        return;
    }
    const config = window.globalMaxExtensionConfig || {};
    const percentValue = Number(config.queueRandomizePercent);
    const clamped = Number.isFinite(percentValue) ? Math.min(100, Math.max(0, Math.round(percentValue))) : 5;
    this.randomPercentSlider.value = String(clamped);
    this.randomPercentValueElement.textContent = `${clamped}%`;
};

/**
 * Updates the random delay badge icon and tooltip.
 */
window.MaxExtensionFloatingPanel.updateRandomDelayBadge = function () {
    if (!this.randomDelayBadge || !window.globalMaxExtensionConfig) return;

    const config = window.globalMaxExtensionConfig;
    const randomEnabled = Boolean(config.queueRandomizeEnabled);
    const percent = Number.isFinite(config.queueRandomizePercent)
        ? Math.min(100, Math.max(0, Math.round(config.queueRandomizePercent)))
        : 5;
    const unit = (config.queueDelayUnit === 'sec') ? 'sec' : 'min';
    const formatDelay = (ms) => {
        if (typeof this.formatQueueDelayForUnit === 'function') {
            return this.formatQueueDelayForUnit(ms, unit);
        }
        if (!Number.isFinite(ms) || ms <= 0) {
            return unit === 'sec' ? '0s' : '0min';
        }
        if (unit === 'sec') {
            return `${(ms / 1000).toFixed(1)}s`;
        }
        return `${(ms / 60000).toFixed(2)}min`;
    };

    let tooltip;
    if (randomEnabled) {
        tooltip = `Random delay offset enabled (up to ${percent}% of base delay). Shift-click to adjust percentage. Click to disable.`;
        if (this.lastQueueDelaySample) {
            const offsetMs = this.lastQueueDelaySample.offsetMs || 0;
            const totalMs = this.lastQueueDelaySample.totalMs || this.lastQueueDelaySample.baseMs;
            const offsetStr = formatDelay(offsetMs);
            const totalStr = formatDelay(totalMs);
            tooltip += ` Last sample: ${totalStr} (${offsetStr} offset).`;
        }
    } else {
        tooltip = `Random delay offset disabled. Click to enable (uses up to ${percent}% of base delay). Shift-click to adjust percentage.`;
    }

    this.randomDelayBadge.textContent = randomEnabled ? '🎲' : '🚫🎲';
    this.randomDelayBadge.title = tooltip;
    this.randomDelayBadge.classList.toggle('random-enabled', randomEnabled);
    this.randomDelayBadge.classList.toggle('random-disabled', !randomEnabled);

    if (typeof this.syncRandomPercentSlider === 'function') {
        this.syncRandomPercentSlider();
    }
};

/**
 * Renders the shared queue status into every mounted queue view.
 */
window.MaxExtensionFloatingPanel.renderQueueStatusFromState = function () {
    const statusLabels = [
        this.queueStatusLabel,
        this.inlineQueueControls?.queueStatusLabel
    ].filter((element, index, list) => element && list.indexOf(element) === index);
    if (statusLabels.length === 0) return;

    const status = this.queueStatus;
    if (!status?.text) {
        statusLabels.forEach((statusLabel) => {
            statusLabel.textContent = '';
            statusLabel.style.display = 'none';
        });
        return;
    }

    const { text, type = 'info' } = status;
    const finalTooltip = status.tooltip || text;
    statusLabels.forEach((statusLabel) => {
        statusLabel.textContent = text;
        statusLabel.style.display = 'block';

        // Simple styling reset
        statusLabel.style.color = '';

        if (type === 'error') {
            statusLabel.style.color = '#ef4444'; // Red
        } else if (type === 'success') {
            statusLabel.style.color = '#22c55e'; // Green
        } else {
            statusLabel.style.color = 'var(--text-secondary, #888)'; // Muted
        }

        // Update tooltip using the shared system if available
        if (window.OCPTooltip) {
            // Use attach to forcefully update the text and ensure listeners are bound
            window.OCPTooltip.attach(statusLabel, finalTooltip);
        } else {
            statusLabel.title = finalTooltip;
        }
    });
};

/**
 * Updates queue status through the runtime so newly mounted views rehydrate it.
 */
window.MaxExtensionFloatingPanel.setQueueStatus = function (text, type = 'info', tooltip = '') {
    if (this.queueRuntime?.setStatus) {
        this.queueRuntime.setStatus(text, type, tooltip);
        return;
    }
    this.queueStatus = text ? { text, type, tooltip: tooltip || text } : null;
    this.renderQueueStatusFromState?.();
};
