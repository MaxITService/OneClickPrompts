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
        this.updateQueueControlsState();
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
        this.updateQueueControlsState();
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

    // ===== MANUAL QUEUE MODE INITIALIZATION =====
    // Must be called BEFORE updateQueueControlsState so manualQueueExpanded is defined
    this.initializeManualQueueMode();

    this.updateQueueControlsState();
    if (typeof this.updateManualQueueAvailability === 'function') {
        this.updateManualQueueAvailability(isQueueEnabled);
    }
};

// Default emojis for manual queue cards (supports up to 9)
const MANUAL_QUEUE_DEFAULT_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const MANUAL_QUEUE_MIN_CARDS = 1;
const MANUAL_QUEUE_MAX_CARDS = 9;
const MANUAL_QUEUE_DEFAULT_COUNT = 6;

/**
 * Initializes the Manual Queue Mode feature.
 * Creates the 6 button cards and sets up toggle behavior.
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
    if (typeof this.updateQueueControlsState === 'function') {
        this.updateQueueControlsState();
    }
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
    if (typeof this.updateQueueControlsState === 'function') {
        this.updateQueueControlsState();
    }
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
        autoSend: true // Default to autosend for convenience
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

    let addedCount = 0;

    // Iterate through all 6 cards in order (1 to 6)
    for (let i = 0; i < 6; i++) {
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
            queueId: `manual-${i}-${Date.now()}-${addedCount}`,
            isManualCard: true,
        };

        if (typeof this.addToQueue === 'function') {
            this.addToQueue(queueItem);
            addedCount++;
            logConCgp(`[floating-panel-queue] Auto-added manual card ${i + 1} to queue:`, text.substring(0, 30) + '...');
        }
    }

    return addedCount;
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
        logConCgp('[floating-panel-queue] updateQueueControlsState: Queue mode is OFF, skipping tooltip update.');
        this.playQueueButton.innerHTML = '▶️';
        const disabledTooltip = 'Enable Queue Mode to start.';
        this.playQueueButton.title = disabledTooltip;
        this.playQueueButton.disabled = true;

        // Force tooltip update if OCPTooltip is available
        if (window.OCPTooltip) {
            window.OCPTooltip.updateText(this.playQueueButton, disabledTooltip);
        }

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
    let tooltipText = '';
    if (this.isQueueRunning) {
        this.playQueueButton.innerHTML = '⏸️'; // Pause icon
        tooltipText = 'Pause the queue.';
        this.playQueueButton.disabled = false;
    } else {
        this.playQueueButton.innerHTML = '▶️'; // Play icon

        // Dynamic tooltip based on queue state and manual mode
        logConCgp('[floating-panel-queue] updateQueueControlsState: hasItems=', hasItems, 'isPaused=', isPaused, 'manualQueueExpanded=', this.manualQueueExpanded);
        if (!hasItems && !isPaused) {
            // Queue is empty - show appropriate message
            if (this.manualQueueExpanded) {
                logConCgp('[floating-panel-queue] Setting MANUAL MODE tooltip');
                tooltipText = 'Queue is empty. Shift+Click: add all manual cards to queue. Ctrl+Shift+Click: add all and start immediately.';
            } else {
                logConCgp('[floating-panel-queue] Setting NORMAL tooltip');
                tooltipText = 'Queue is empty. Click on buttons to add them to queue, then click me to start queue.';
            }
        } else {
            tooltipText = 'Start sending the queued prompts.';
        }

        this.playQueueButton.disabled = !hasItems && !isPaused && !this.manualQueueExpanded; // Keep enabled if manual mode is on for shift-click
    }

    // Set title attribute and force tooltip update
    this.playQueueButton.title = tooltipText;
    if (window.OCPTooltip) {
        window.OCPTooltip.updateText(this.playQueueButton, tooltipText);
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
 * @param {string} [tooltip=''] - Optional tooltip text for hover explanation.
 */
window.MaxExtensionFloatingPanel.setQueueStatus = function (text, type = 'info', tooltip = '') {
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

    // Update tooltip using the shared system if available
    const finalTooltip = tooltip || text;
    if (window.OCPTooltip) {
        // Use attach to forcefully update the text and ensure listeners are bound
        window.OCPTooltip.attach(this.queueStatusLabel, finalTooltip);
    } else {
        this.queueStatusLabel.title = finalTooltip;
    }
};
