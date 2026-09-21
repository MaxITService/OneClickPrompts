// per-website-button-clicking-mechanics/buttons-clicking-shared.js
'use strict';

window.ButtonsClickingShared = {
    // Site adapters retain their insertion mechanics; queue retries reuse an unchanged draft.
    insertPrompt: async (event, editor, insertText) => {
        const context = event?.__queueContext;
        if (!context) return await insertText();
        const result = await context.insert(editor, insertText);
        context.assertActive();
        return result;
    },
    isVisibleInteractiveElement: (el) => {
        if (!el) return false;
        if (!el.isConnected) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = window.getComputedStyle(el);
        if (!style) return false;
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    },

    /**
     * Word-level Stop-label check. A substring test matched sidebar chat titles
     * ("Pin Stop Here") and any role="button" wrapper whose content mentioned the word.
     * Labels and captions must start with the keyword; data-testid must carry it as a token.
     * @param {HTMLElement} el
     * @param {string[]} extraKeywords - Site-specific synonyms such as 'cancel'
     * @returns {boolean}
     */
    hasStopLabel: (el, extraKeywords = []) => {
        if (!el?.getAttribute) return false;
        const keywords = ['stop', ...extraKeywords].join('|');
        const leading = new RegExp(`^\\s*(?:${keywords})\\b`, 'i');
        const token = new RegExp(`(?:^|[-_:.\\s])(?:${keywords})(?:[-_:.\\s]|$)`, 'i');
        // Icon-font glyph names (Material Symbols: "progress_activity", "stop_circle") render as
        // text; drop leading snake_case tokens so the visible caption ("Stop") is what gets tested.
        const caption = (el.innerText || '').trim().replace(/^(?:[a-z0-9]+(?:_[a-z0-9]+)+\s*)+/i, '');
        // A real Stop control carries a short caption; long text means a wrapper around content.
        const shortCaption = caption.length <= 40 ? caption : '';
        return leading.test(el.getAttribute('aria-label') || '')
            || leading.test(el.getAttribute('title') || '')
            || token.test(el.getAttribute('data-testid') || '')
            || leading.test(shortCaption);
    },

    /**
     * Sidebars, menus and links never host the generation Stop control.
     * @param {HTMLElement} el
     * @returns {boolean}
     */
    isInsidePageChrome: (el) => !!el?.closest?.(
        'nav, aside, a[href], [role="navigation"], [role="menu"], [role="menuitem"], [role="listbox"], [role="tablist"]'
    ),

    /**
     * The composer region: the visible editor's form, or the editor itself when there is none.
     * @returns {HTMLElement|null}
     */
    getComposerScope: () => {
        const editorSelectors = window.InjectionTargetsOnWebsite?.selectors?.editors || [];
        for (const selector of editorSelectors) {
            let editor = null;
            try {
                editor = Array.from(document.querySelectorAll(selector))
                    .find(window.ButtonsClickingShared.isVisibleInteractiveElement);
            } catch (_) { /* invalid selector */ }
            if (editor) return editor.closest('form') || editor;
        }
        return null;
    },

    /**
     * True when the element sits inside the composer scope or within a small margin of it.
     * An unknown scope cannot veto anything.
     * @param {HTMLElement} el
     * @param {HTMLElement|null} scope
     * @returns {boolean}
     */
    isNearComposer: (el, scope, margin = 200) => {
        if (!scope || !el) return true;
        if (scope.contains(el)) return true;
        const a = el.getBoundingClientRect();
        const b = scope.getBoundingClientRect();
        const edges = [a.left, a.right, a.top, a.bottom, b.left, b.right, b.top, b.bottom];
        if (!edges.every(Number.isFinite)) return true;
        return a.right >= b.left - margin && a.left <= b.right + margin
            && a.bottom >= b.top - margin && a.top <= b.bottom + margin;
    },

    /**
     * Checks if a button is in a "Stop" or "Busy" state.
     * @param {HTMLElement} btn
     * @returns {boolean}
     */
    isBusyStopButton: (btn) => window.ButtonsClickingShared.hasStopLabel(btn),

    /**
     * Tries to find a stop button using site-specific selectors or heuristics.
     * @param {Function|null} customFinder - Optional site-specific finder
     * @returns {HTMLElement|null}
     */
    findStopButton: (customFinder = null) => {
        const detector = window.OneClickPromptsSelectorAutoDetector;
        const isVisibleStopCandidate = (element) => {
            if (typeof detector?.isVisibleElement === 'function') {
                return detector.isVisibleElement(element);
            }
            if (!element?.isConnected) return false;
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 4 && rect.height > 4 &&
                style.display !== 'none' && style.visibility !== 'hidden' &&
                Number.parseFloat(style.opacity || '1') > 0;
        };

        // 1. Try custom finder if provided
        if (customFinder) {
            const btn = customFinder();
            if (isVisibleStopCandidate(btn)) {
                window.OneClickPromptsSelectorAutoDetector?.reportRecovery?.('stopButton');
                return btn;
            }
        }

        // 2. Try site-specific selectors from InjectionTargetsOnWebsite
        const siteSelectors = window.InjectionTargetsOnWebsite?.selectors?.stopButtons || [];
        if (siteSelectors.length > 0) {
            const candidates = siteSelectors.flatMap(selector => {
                try {
                    return Array.from(document.querySelectorAll(selector));
                } catch (error) {
                    logConCgp('[auto-send] Skipping invalid stop-button selector.', {
                        selector,
                        error: error?.message || error
                    });
                    return [];
                }
            });

            const visible = candidates.find(el => {
                return isVisibleStopCandidate(el) && !window.ButtonsClickingShared.isInsidePageChrome(el);
            });
            if (visible) {
                window.OneClickPromptsSelectorAutoDetector?.reportRecovery?.('stopButton');
                return visible;
            }
        }

        // 3. Heuristic fallback: a visible Stop-labelled control near the composer.
        // Exclude OCP UI, page chrome (sidebars, menus) and anything far from the editor.
        const shared = window.ButtonsClickingShared;
        const composerScope = shared.getComposerScope();
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"], div.ds-icon-button'));
        const heuristicStop = allButtons.find(btn => {
            if (!isVisibleStopCandidate(btn)) return false;

            const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
            if (testId.startsWith('custom-send-button') || btn.closest('[id*="custom-buttons-container"], #max-extension-floating-panel')) {
                return false;
            }

            if (!shared.hasStopLabel(btn)) return false;
            if (shared.isInsidePageChrome(btn)) return false;
            return shared.isNearComposer(btn, composerScope);
        }) || null;

        if (heuristicStop) {
            const stopState = detector?.state?.stopButton;
            if (detector?.settings?.enableStopButtonHeuristics === true && stopState) {
                const now = Date.now();
                const isInsideCandidateCooldown = now - (stopState.lastHeuristicCandidateAt || 0) < 30000;
                if (!isInsideCandidateCooldown) {
                    stopState.lastHeuristicCandidate = heuristicStop;
                    stopState.lastHeuristicCandidateAt = now;
                    void detector.reportFailure('stopButton', {
                        expected: true,
                        candidate: heuristicStop,
                        reason: 'configured_stop_selector_missed'
                    });
                }
            } else {
                detector?.reportRecovery?.('stopButton');
            }
        }

        return heuristicStop;
    },

    /**
     * Configurable Auto-Send Engine with Stop-Button Awareness.
     * Returns a contract: { status: 'sent' | 'blocked_by_stop' | 'not_found' | 'failed' | 'cancelled' | 'unconfirmed', reason?, button? }
     * @returns {Promise<{status: string, reason?: string, button?: HTMLElement}>}
     */
    performAutoSend: (config = {}) => {
        return new Promise((resolve) => {
            const queueContext = config.queueContext;
            const initialUrl = location.href;
            const signal = queueContext?.signal;
            if (signal?.aborted) {
                resolve({ status: 'cancelled', reason: 'queue_paused' });
                return;
            }
            // 1. Safety Cleanup
            if (typeof window.sharedAutoSendCancel === 'function') {
                const cancelPreviousRun = window.sharedAutoSendCancel;
                window.sharedAutoSendCancel = null;
                cancelPreviousRun();
            } else if (window.sharedAutoSendInterval) {
                clearInterval(window.sharedAutoSendInterval);
                window.sharedAutoSendInterval = null;
            }

            const {
                findButton = async () => await window.OneClickPromptsSelectorGuard.findSendButton(),
                findStopButton = null, // Optional override
                isBusy = window.ButtonsClickingShared.isBusyStopButton,
                isEnabled = (btn) => !btn.disabled && btn.getAttribute('aria-disabled') !== 'true',
                preClickValidation = () => true,
                clickAction = (btn) => window.MaxExtensionUtils.simulateClick(btn),
                stopConfirmationDelay = 0,
                readyConfirmationDelay = 0,
                postStopAbsenceDelay = 0,
                postStopReadinessCheck = () => true,
                interval = 100,
                maxAttempts = 50
            } = config;

            let attempts = 0;
            let stopHandlingStarted = false;
            let finished = false;
            let mainTickInProgress = false;
            let searchIntervalId = null;
            let cancelCurrentRun = null;
            let mainReadySince = 0;
            let clickIssued = false;
            let abortListener = null;
            const activeIntervalIds = new Set();
            const activeDelays = new Map();
            const waitForConfirmation = delay => new Promise(resolveDelay => {
                const id = setTimeout(() => {
                    activeDelays.delete(id);
                    resolveDelay();
                }, delay);
                activeDelays.set(id, resolveDelay);
            });

            const startTrackedInterval = (callback, delay) => {
                const intervalId = setInterval(callback, delay);
                activeIntervalIds.add(intervalId);
                return intervalId;
            };

            const clearTrackedInterval = (intervalId) => {
                if (intervalId === null) return;
                clearInterval(intervalId);
                activeIntervalIds.delete(intervalId);
            };

            // Helper to finalize and clean up
            const finish = (result) => {
                if (finished) return;
                finished = true;
                activeIntervalIds.forEach((intervalId) => clearInterval(intervalId));
                activeIntervalIds.clear();
                activeDelays.forEach((resolveDelay, id) => {
                    clearTimeout(id);
                    resolveDelay();
                });
                activeDelays.clear();
                if (abortListener) signal?.removeEventListener('abort', abortListener);
                document.removeEventListener('ocp-page-navigated', cancelForNavigation);
                if (window.sharedAutoSendInterval === searchIntervalId) {
                    window.sharedAutoSendInterval = null;
                }
                if (window.sharedAutoSendCancel === cancelCurrentRun) {
                    window.sharedAutoSendCancel = null;
                }
                try {
                    const sendState = window.OneClickPromptsSelectorAutoDetector?.state?.sendButton;
                    if (sendState) {
                        sendState.autoSendAwaitingUser = false;
                        sendState.autoSendPendingElement = null;
                    }
                } catch (_) { /* ignore */ }
                resolve(result);
            };

            cancelCurrentRun = () => finish({
                status: queueContext && clickIssued ? 'unconfirmed' : 'failed', reason: 'superseded'
            });
            window.sharedAutoSendCancel = cancelCurrentRun;
            const cancelForNavigation = () => finish({
                status: clickIssued ? 'unconfirmed' : 'cancelled', reason: 'page_navigated'
            });
            document.addEventListener('ocp-page-navigated', cancelForNavigation);

            abortListener = () => {
                // A delivered click cannot be undone. Observe its outcome, but never issue another.
                if (!clickIssued) finish({ status: 'cancelled', reason: 'queue_paused' });
            };
            signal?.addEventListener('abort', abortListener, { once: true });

            const clickAndConfirm = async (button) => {
                if (finished) return true;
                if (location.href !== initialUrl) { cancelForNavigation(); return true; }
                if (queueContext) {
                    await queueContext.checkpointDraft();
                    if (finished) return true;
                    if (!queueContext.isDraftIntact()) {
                        finish({ status: 'failed', reason: 'editor_changed' });
                        return true;
                    }
                }
                if (finished || signal?.aborted) return true;
                if (location.href !== initialUrl) { cancelForNavigation(); return true; }
                // Any awaited validation can outlive a Send-to-Stop transition or DOM replacement.
                const stop = window.ButtonsClickingShared.findStopButton(findStopButton);
                if (!button.isConnected || !isEnabled(button) || isBusy(button) || (stop && isBusy(stop))) {
                    return false;
                }
                clickIssued = true;
                let clicked;
                try {
                    clicked = await clickAction(button);
                } catch (error) {
                    finish({ status: queueContext ? 'unconfirmed' : 'failed', reason: error?.message || 'click_error' });
                    return true;
                }
                if (finished) return true;
                if (clicked === false) {
                    clickIssued = false;
                    if (signal?.aborted) abortListener();
                    return false;
                }
                if (!queueContext) {
                    finish({ status: 'sent', button });
                    return true;
                }

                activeIntervalIds.forEach((id) => clearInterval(id));
                activeIntervalIds.clear();
                const deadline = Date.now() + 5000;
                const confirmAcceptance = () => {
                    if (finished) return;
                    try {
                        const stop = window.ButtonsClickingShared.findStopButton(findStopButton);
                        if (queueContext.isEditorCleared() || (stop && isBusy(stop))) {
                            finish({ status: 'sent', button });
                        } else if (Date.now() >= deadline) {
                            finish({ status: 'unconfirmed', reason: 'send_confirmation_timeout' });
                        }
                    } catch (error) {
                        finish({ status: 'unconfirmed', reason: error?.message || 'confirmation_error' });
                    }
                };
                startTrackedInterval(confirmAcceptance, 100);
                confirmAcceptance();
                return true;
            };

            searchIntervalId = startTrackedInterval(async () => {
                if (finished || stopHandlingStarted || mainTickInProgress) {
                    return;
                }
                mainTickInProgress = true;

                try {
                    // A. Check for Stop Button FIRST (immediate "AI is still typing" detection)
                    const stopBtn = window.ButtonsClickingShared.findStopButton(findStopButton);
                    if (stopBtn) {
                        mainReadySince = 0;
                        stopHandlingStarted = true;

                        if (stopConfirmationDelay > 0) {
                            await waitForConfirmation(stopConfirmationDelay);
                            if (finished) return;
                            const confirmedStopBtn = window.ButtonsClickingShared.findStopButton(findStopButton);
                            if (!confirmedStopBtn || !isBusy(confirmedStopBtn)) {
                                stopHandlingStarted = false;
                                return;
                            }
                            handleStopButtonFound(confirmedStopBtn);
                            return;
                        }
                        // AI is mid-generation - enter watcher immediately
                        handleStopButtonFound(stopBtn);
                        return;
                    }

                    // If selector recovery is waiting on the user, pause without consuming attempts.
                    const awaitingUser = !!window.OneClickPromptsSelectorAutoDetector?.state?.sendButton?.autoSendAwaitingUser;
                    if (awaitingUser) {
                        return;
                    }

                    attempts++;

                    // B. No stop button visible - now look for Send Button
                    const btn = await findButton();
                    if (finished || stopHandlingStarted) {
                        return;
                    }

                    if (btn) {
                        const awaitingUserAfterFind = !!window.OneClickPromptsSelectorAutoDetector?.state?.sendButton?.autoSendAwaitingUser;
                        if (awaitingUserAfterFind) {
                            return;
                        }

                        // Double-check: the found button might be in busy/stop state
                        // (some sites reuse the same element for send/stop)
                        if (isBusy(btn)) {
                            mainReadySince = 0;
                            stopHandlingStarted = true;
                            handleStopButtonFound(btn);
                            return;
                        }

                        // Not busy, check enabled & validation
                        const buttonReady = isEnabled(btn);

                        if (buttonReady) {
                            if (await preClickValidation(btn)) {
                                if (finished) return;
                                if (!mainReadySince) {
                                    mainReadySince = Date.now();
                                }
                                if (Date.now() - mainReadySince < readyConfirmationDelay) {
                                    return;
                                }

                                // A Stop control can replace Send between polling ticks. Check again
                                // immediately before the one and only automatic click.
                                const stopBeforeClick = window.ButtonsClickingShared.findStopButton(findStopButton);
                                if (stopBeforeClick && isBusy(stopBeforeClick)) {
                                    mainReadySince = 0;
                                    stopHandlingStarted = true;
                                    handleStopButtonFound(stopBeforeClick);
                                    return;
                                }

                                const handled = await clickAndConfirm(btn);
                                if (!handled) {
                                    mainReadySince = 0;
                                    if (attempts >= maxAttempts) {
                                        finish({ status: 'failed', reason: 'click_rejected' });
                                    }
                                    return;
                                }
                            } else if (attempts >= maxAttempts) {
                                finish({ status: 'failed', reason: 'validation_failed' });
                            } else {
                                mainReadySince = 0;
                            }
                        } else if (attempts >= maxAttempts) {
                            finish({ status: 'failed', reason: 'disabled' });
                        } else {
                            mainReadySince = 0;
                        }
                        return;
                    }

                    mainReadySince = 0;

                    // Recovery may have opened the selector helper during findButton(); keep waiting
                    // for the user instead of timing out (the picked element is clicked after Dismiss).
                    if (window.OneClickPromptsSelectorAutoDetector?.state?.sendButton?.autoSendAwaitingUser) {
                        return;
                    }

                    // C. Neither stop nor send button found - Timeout check
                    if (attempts >= maxAttempts) {
                        finish({ status: 'not_found' });
                    }
                } catch (error) {
                    finish({
                        status: error?.name === 'AbortError' ? 'cancelled' : 'failed',
                        reason: error?.message || 'auto_send_error'
                    });
                } finally {
                    mainTickInProgress = false;
                }
            }, interval);
            window.sharedAutoSendInterval = searchIntervalId;

            // Shared Stop Button Watcher Logic
            const handleStopButtonFound = (stopElement) => {
                const isStopButtonActive = (btn) => {
                    if (!btn) return false;
                    if (!document.body.contains(btn)) return false;
                    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
                    const style = window.getComputedStyle(btn);
                    if (!style) return false;
                    if (style.display === 'none' || style.visibility === 'hidden') return false;
                    const opacity = parseFloat(style.opacity || '1');
                    if (!Number.isNaN(opacity) && opacity === 0) return false;
                    return isBusy(btn);
                };

                // Clear the search interval
                clearTrackedInterval(searchIntervalId);
                if (window.sharedAutoSendInterval === searchIntervalId) {
                    window.sharedAutoSendInterval = null;
                }

                // Notify user
                if (window.showToast) {
                    window.showToast('AI is still typing…', 'info', 3000);
                }

                // Start 5-minute watcher
                const stopTimeout = 5 * 60 * 1000; // 5 minutes
                const watchStartTime = Date.now();
                let stopAbsentSince = 0;
                let stopWatcherTickInProgress = false;

                const stopWatcher = startTrackedInterval(async () => {
                    if (finished || stopWatcherTickInProgress) return;
                    stopWatcherTickInProgress = true;
                    try {
                        // Check if the original stop element is still an active stop control
                        const originalActive = isStopButtonActive(stopElement);

                        // Re-check using the finder in case the DOM node was replaced but a stop button still exists
                        const currentStopBtn = window.ButtonsClickingShared.findStopButton(findStopButton);
                        const currentActive = isStopButtonActive(currentStopBtn);

                        if (!originalActive && !currentActive) {
                            if (!stopAbsentSince) {
                                stopAbsentSince = Date.now();
                            }

                            // A single missing poll is not enough: ChatGPT can replace the shared
                            // Send/Stop control while the response is still settling.
                            if (Date.now() - stopAbsentSince < postStopAbsenceDelay) {
                                return;
                            }

                            // Stop has remained absent for the configured stability window.
                            clearTrackedInterval(stopWatcher);

                            // Retry send search with a slightly longer polling loop to handle transitional DOM delays
                            let postStopAttempts = 0;
                            const postStopMaxAttempts = 25; // ~3.8 seconds at 150ms cadence
                            let postStopTickInProgress = false;
                            let postStopReadySince = 0;
                            let lastPostStopFailure = 'post-stop-missing-send';

                            const postStopPoller = startTrackedInterval(async () => {
                                if (finished || postStopTickInProgress) return;
                                const awaitingUserBeforeFind = !!window.OneClickPromptsSelectorAutoDetector
                                    ?.state?.sendButton?.autoSendAwaitingUser;
                                if (awaitingUserBeforeFind) return;
                                postStopTickInProgress = true;
                                try {
                                    const renewedStopButton = window.ButtonsClickingShared.findStopButton(findStopButton);
                                    if (renewedStopButton && isBusy(renewedStopButton)) {
                                        clearTrackedInterval(postStopPoller);
                                        handleStopButtonFound(renewedStopButton);
                                        return;
                                    }

                                    const retryButton = await findButton();
                                    if (finished) return;
                                    const awaitingUserAfterFind = !!window.OneClickPromptsSelectorAutoDetector
                                        ?.state?.sendButton?.autoSendAwaitingUser;
                                    if (awaitingUserAfterFind) return;

                                    postStopAttempts++;

                                    const buttonEnabled = !!retryButton && isEnabled(retryButton);
                                    const validationPassed = buttonEnabled && await preClickValidation(retryButton);
                                    const readinessPassed = validationPassed && await postStopReadinessCheck({
                                        button: retryButton,
                                        stopAbsentForMs: Date.now() - stopAbsentSince,
                                        attempts: postStopAttempts
                                    });
                                    if (finished) return;

                                    if (retryButton && buttonEnabled && validationPassed && readinessPassed) {
                                        if (isBusy(retryButton)) {
                                            postStopReadySince = 0;
                                            lastPostStopFailure = 'still_busy_after_transition';
                                            // Should not happen if selectors are correct, but safety net
                                            if (postStopAttempts >= postStopMaxAttempts) {
                                                clearTrackedInterval(postStopPoller);
                                                finish({ status: 'blocked_by_stop', reason: 'still_busy_after_transition' });
                                            }
                                        } else {
                                            if (!postStopReadySince) {
                                                postStopReadySince = Date.now();
                                            }
                                            if (Date.now() - postStopReadySince < readyConfirmationDelay) {
                                                return;
                                            }

                                            const stopBeforeClick = window.ButtonsClickingShared.findStopButton(findStopButton);
                                            if (stopBeforeClick && isBusy(stopBeforeClick)) {
                                                clearTrackedInterval(postStopPoller);
                                                handleStopButtonFound(stopBeforeClick);
                                                return;
                                            }

                                            const handled = await clickAndConfirm(retryButton);
                                            if (handled) {
                                                clearTrackedInterval(postStopPoller);
                                                return;
                                            } else {
                                                postStopReadySince = 0;
                                                lastPostStopFailure = 'click_rejected';
                                            }
                                        }
                                    } else {
                                        postStopReadySince = 0;
                                        if (!retryButton) {
                                            lastPostStopFailure = 'post-stop-missing-send';
                                        } else if (!buttonEnabled) {
                                            lastPostStopFailure = 'disabled';
                                        } else if (!validationPassed) {
                                            lastPostStopFailure = 'validation_failed';
                                        } else {
                                            lastPostStopFailure = 'post-stop-not-settled';
                                        }
                                    }

                                    if (postStopAttempts >= postStopMaxAttempts) {
                                        clearTrackedInterval(postStopPoller);
                                        if (window.showToast) {
                                            window.showToast('Unable to safely send after waiting.', 'error');
                                        }
                                        if (lastPostStopFailure === 'still_busy_after_transition') {
                                            finish({ status: 'blocked_by_stop', reason: lastPostStopFailure });
                                        } else if (lastPostStopFailure === 'post-stop-missing-send') {
                                            finish({ status: 'not_found', reason: lastPostStopFailure });
                                        } else {
                                            finish({ status: 'failed', reason: lastPostStopFailure });
                                        }
                                    }
                                } catch (error) {
                                    clearTrackedInterval(postStopPoller);
                                    finish({
                                        status: error?.name === 'AbortError' ? 'cancelled' : 'failed',
                                        reason: error?.message || 'post_stop_auto_send_error'
                                    });
                                } finally {
                                    postStopTickInProgress = false;
                                }
                            }, 150);
                        } else {
                            stopAbsentSince = 0;
                        }

                        if (Date.now() - watchStartTime > stopTimeout) {
                            // Timeout
                            clearTrackedInterval(stopWatcher);
                            finish({ status: 'blocked_by_stop', reason: 'timeout' });
                        }
                    } catch (error) {
                        clearTrackedInterval(stopWatcher);
                        finish({ status: 'failed', reason: error?.message || 'stop_watcher_error' });
                    } finally {
                        stopWatcherTickInProgress = false;
                    }
                }, 300);
            };
        });
    }
};
