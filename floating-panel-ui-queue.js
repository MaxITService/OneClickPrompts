// /floating-panel-ui-queue.js
// Version: 1.3
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
                this.saveCurrentProfileConfig();
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

    if (this.queueProgressContainer) {
        this.queueProgressContainer.addEventListener('mousedown', (event) => {
            // Prevent dragging the panel while interacting with the progress bar.
            event.stopPropagation();
        });
        this.queueProgressContainer.addEventListener('click', (event) => {
            event.preventDefault();
            if (!window.globalMaxExtensionConfig?.enableQueueMode) {
                return;
            }
            const hasTimer = (this.isQueueRunning && this.queueTimerId) || this.remainingTimeOnPause > 0;
            if (!hasTimer || !this.queueProgressBar) {
                return;
            }
            const rect = this.queueProgressContainer.getBoundingClientRect();
            if (!rect || rect.width <= 0) {
                return;
            }
            const ratio = (event.clientX - rect.left) / rect.width;
            if (typeof this.seekQueueTimerToRatio === 'function') {
                this.seekQueueTimerToRatio(ratio);
            }
        });
    }

    // --- TOS Confirmation (Global) and Queue Toggle (Profile-specific) ---
    const hideQueueToggle = Boolean(window.globalMaxExtensionConfig.queueHideActivationToggle);
    let isQueueEnabled = Boolean(window.globalMaxExtensionConfig.enableQueueMode);

    if (hideQueueToggle) {
        if (window.globalMaxExtensionConfig.enableQueueMode) {
            window.globalMaxExtensionConfig.enableQueueMode = false;
        }
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
        if (typeof this.updateQueueControlsState === 'function') {
            this.updateQueueControlsState();
        }
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

            // Freeze-on-disable behavior:
            if (!state) {
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

            // Controls refresh after toggle
            this.updateQueueControlsState();
            if (typeof this.updateQueueTogglePlacement === 'function') {
                this.updateQueueTogglePlacement();
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
        this.updateQueueControlsState();
        if (typeof this.updateQueueTogglePlacement === 'function') {
            this.updateQueueTogglePlacement();
        }
    });

    tosDeclineButton.addEventListener('click', () => {
        tosWarningContainer.style.display = 'none';
        if (this.queueModeToggle) {
            this.queueModeToggle.style.display = ''; // Show toggle again
        }
        // Intentionally leave queue disabled; any responsive hiding will be handled by resize logic.
        this.updateQueueControlsState();
        if (typeof this.clearQueueFinishedState === 'function') {
            this.clearQueueFinishedState();
        }
        if (typeof this.updateQueueTogglePlacement === 'function') {
            this.updateQueueTogglePlacement();
        }
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

    if (expandableSection) {
        this.setupQueueAutomationButtons(expandableSection);
    }

    if (typeof this.initializeQueueDragAndDrop === 'function') {
        this.initializeQueueDragAndDrop();
    }

    this.updateQueueControlsState();
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

/**
 * Renders the queue display area with the current items in the queue.
 */
window.MaxExtensionFloatingPanel.renderQueueDisplay = function () {
    if (!this.queueDisplayArea) return;

    if (typeof this.captureQueuePreRender === 'function') {
        this.captureQueuePreRender();
    }

    this.queueDisplayArea.innerHTML = ''; // Clear previous items
    const fragment = document.createDocumentFragment();

    this.promptQueue.forEach((item, index) => {
        const queuedItemElement = document.createElement('button');
        queuedItemElement.className = 'max-extension-queued-item';
        queuedItemElement.innerHTML = item.icon;
        queuedItemElement.title = `Click to remove, hold to drag: ${item.text}`;
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
            this.decorateQueueItemForDrag(queuedItemElement, item, index);
        }

        fragment.appendChild(queuedItemElement);
    });

    this.queueDisplayArea.appendChild(fragment);
    if (this.promptQueue.length > 0) {
        this.queueDisplayArea.style.display = 'flex';
    } else if (window.globalMaxExtensionConfig?.enableQueueMode) {
        this.queueDisplayArea.style.display = 'none';
    }

    if (typeof this.applyQueuePostRenderEffects === 'function') {
        this.applyQueuePostRenderEffects();
    }
};

/**
 * Updates the state (icon, disabled status) of the queue control buttons.
 */
window.MaxExtensionFloatingPanel.updateQueueControlsState = function () {
    if (!this.playQueueButton || !this.resetQueueButton) return;

    const hasItems = this.promptQueue.length > 0;
    const isPaused = this.remainingTimeOnPause > 0;
    const queueEnabled = !!(window.globalMaxExtensionConfig && window.globalMaxExtensionConfig.enableQueueMode);

    // If queue mode is OFF, disable controls regardless of items, and hide progress bar.
    if (!queueEnabled) {
        this.playQueueButton.innerHTML = '▶️';
        this.playQueueButton.title = 'Enable Queue Mode to start.';
        this.playQueueButton.disabled = true;

        if (this.skipQueueButton) {
            this.skipQueueButton.disabled = true;
            this.skipQueueButton.title = 'Enable Queue Mode to skip.';
        }

        this.resetQueueButton.disabled = true;

        if (this.queueProgressContainer) {
            this.queueProgressContainer.style.display = 'none';
        }
        return;
    }

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

    if (this.skipQueueButton) {
        if (!hasItems) {
            this.skipQueueButton.disabled = true;
            this.skipQueueButton.title = 'No queued prompts to skip.';
        } else {
            this.skipQueueButton.disabled = false;
            this.skipQueueButton.title = this.isQueueRunning
                ? 'Skip to the next queued prompt immediately.'
                : 'Send the next queued prompt immediately.';
        }
    }

    // Reset Button
    this.resetQueueButton.disabled = !hasItems && !this.isQueueRunning && !isPaused;

    // Hide progress bar if queue is empty and not running
    if (this.queueProgressContainer && !this.isQueueRunning && !hasItems) {
        this.queueProgressContainer.style.display = 'none';
    }

    if (typeof this.updateRandomDelayBadge === 'function') {
        this.updateRandomDelayBadge();
    }

    if (typeof this.updateQueueAutomationButtons === 'function') {
        this.updateQueueAutomationButtons();
    }
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
 * Sets the text and visibility of the queue status label.
 * @param {string|null} text - The text to show, or null to hide.
 * @param {'info'|'error'|'success'} [type='info'] - The visual style type.
 */
window.MaxExtensionFloatingPanel.setQueueStatus = function (text, type = 'info') {
    if (!this.queueStatusLabel) return;

    if (!text) {
        this.queueStatusLabel.textContent = '';
        this.queueStatusLabel.style.display = 'none';
        return;
    }

    this.queueStatusLabel.textContent = text;
    this.queueStatusLabel.style.display = 'block';

    // Simple styling reset
    this.queueStatusLabel.style.color = '';

    if (type === 'error') {
        this.queueStatusLabel.style.color = '#ef4444'; // Red
    } else if (type === 'success') {
        this.queueStatusLabel.style.color = '#22c55e'; // Green
    } else {
        this.queueStatusLabel.style.color = 'var(--text-secondary, #888)'; // Muted
    }
};
