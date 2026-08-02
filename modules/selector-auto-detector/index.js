/**
 * File: modules/selector-auto-detector/index.js
 * Version: 1.0
 *
 * Description:
 * The "Brain" of the selector auto-detection system.
 * Manages failure tracking, coordinates recovery attempts, and handles user notifications.
 */

'use strict';

window.OneClickPromptsSelectorAutoDetector = {
    state: {
        editor: {
            failures: 0,
            lastFailure: 0,
            recovering: false,
            contextKey: null,
            nextRetryAt: 0,
            lastSeenAt: 0
        },
        sendButton: {
            failures: 0,
            lastFailure: 0,
            recovering: false,
            everFound: false,
            lastSeenAt: 0,
            autoSendAwaitingUser: false,
            autoSendPendingElement: null,
            autoSendLastToastAt: 0,
            contextKey: null,
            nextRetryAt: 0
        },
        stopButton: {
            failures: 0,
            lastFailure: 0,
            recovering: false,
            everFound: false,
            lastSeenAt: 0,
            contextKey: null,
            nextRetryAt: 0,
            lastHeuristicCandidate: null,
            lastHeuristicCandidateAt: 0
        },
        container: {
            failures: 0,
            lastFailure: 0,
            recovering: false,
            lastMissingNotifyToastAt: 0,
            contextKey: null,
            nextRetryAt: 0,
            passiveObserver: null,
            passiveRetryTimer: null,
            passiveProbeTimer: null,
            passiveRetryDelayMs: 0,
            lastSeenAt: 0,
            lastHeuristicCandidate: null,
            lastHeuristicCandidateAt: 0
        }
    },

    config: {
        failureThreshold: 1, // Number of failures before triggering recovery (can be >1 to debounce)
        cooldownBaseMs: 2000,
        autoSendCooldownBaseMs: 750,
        cooldownMaxMs: 60000,
        recoveryToastCooldownMs: 15000,
        sendButtonMissGraceMs: 3000,
        recentSurfaceSuccessGraceMs: 45000,
        passiveRetryBaseMs: 5000,
        passiveRetryMaxMs: 120000,
        containerMissingNotifyDebounceMs: 30000
    },
    settings: {
        enableEditorHeuristics: false,
        enableSendButtonHeuristics: false,
        enableStopButtonHeuristics: false,
        enableContainerHeuristics: false,
        notifyContainerMissing: false,
        autoFallbackToFloatingPanel: true,
        loaded: false
    },
    lastOffers: {
        editor: { selector: null, site: null, at: 0 },
        sendButton: { selector: null, site: null, at: 0 },
        stopButton: { selector: null, site: null, at: 0 },
        container: { selector: null, site: null, at: 0 }
    },

    activePickerSession: null,
    pickerQueue: [],
    recoveryToastTimes: Object.create(null),
    settingsLoadRetryTimer: null,

    isAutoSendActive: function () {
        return typeof window.sharedAutoSendCancel === 'function';
    },

    isOcpUiElement: function (element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        try {
            const testId = (element.getAttribute?.('data-testid') || '').toLowerCase();
            if (testId.startsWith('custom-send-button')) return true;
            if (element.closest?.(
                '#max-extension-floating-panel, #toastContainer, #ocp-create-button-flyout, ' +
                '[id*="custom-buttons-container"], [data-ocp-profile-selector]'
            )) return true;
        } catch (_) { /* best effort */ }
        return false;
    },

    isVisibleElement: function (element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || !element.isConnected) return false;
        if (this.isOcpUiElement(element)) return false;
        try {
            const rect = element.getBoundingClientRect();
            if (!rect || rect.width <= 10 || rect.height <= 10) return false;
            const style = window.getComputedStyle(element);
            if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
            const opacity = Number.parseFloat(style.opacity || '1');
            if (Number.isFinite(opacity) && opacity <= 0) return false;
            if (element.closest?.('[inert], [aria-hidden="true"]')) return false;
            return true;
        } catch (_) {
            return false;
        }
    },

    findVisibleNativeEditor: function () {
        const isEligible = (element, requireComposerHint = false) => {
            if (!this.isVisibleElement(element)) return false;
            try {
                if (element.closest?.('dialog[open], [role="dialog"][aria-modal="true"]')) return false;
                if (!requireComposerHint) return true;

                const rect = element.getBoundingClientRect();
                const attributes = [
                    element.id,
                    element.className,
                    element.getAttribute?.('name'),
                    element.getAttribute?.('placeholder'),
                    element.getAttribute?.('aria-label'),
                    element.getAttribute?.('data-testid')
                ].filter(value => typeof value === 'string').join(' ').toLowerCase();
                const hasComposerHint = /(message|prompt|composer|chat|ask|textarea)/.test(attributes);
                const isLowerPageEditor = rect.bottom >= window.innerHeight * 0.45 &&
                    element.matches?.('textarea, [contenteditable="true"], [role="textbox"]');
                return hasComposerHint || isLowerPageEditor;
            } catch (_) {
                return false;
            }
        };

        const site = window.InjectionTargetsOnWebsite?.activeSite;
        const defaults = site && window.InjectionTargetsOnWebsite?.getDefaultSelectors
            ? window.InjectionTargetsOnWebsite.getDefaultSelectors(site)
            : null;
        const defaultEditors = Array.isArray(defaults?.editors) ? defaults.editors : [];
        for (const selector of defaultEditors) {
            try {
                const match = Array.from(document.querySelectorAll(selector)).find(element => isEligible(element, false));
                if (match) return match;
            } catch (_) { /* invalid or temporarily unsupported selector */ }
        }

        try {
            return Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'))
                .find(element => isEligible(element, true)) || null;
        } catch (_) {
            return null;
        }
    },

    hasBlockingNonChatSurface: function () {
        try {
            const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
            return Array.from(document.querySelectorAll('dialog[open], [role="dialog"]'))
                .some(element => {
                    if (!element?.isConnected) return false;
                    const rect = element.getBoundingClientRect();
                    const style = window.getComputedStyle(element);
                    if (rect.width <= 20 || rect.height <= 20 || style.display === 'none' || style.visibility === 'hidden') {
                        return false;
                    }
                    const description = [
                        element.getAttribute?.('aria-label'),
                        element.getAttribute?.('data-testid'),
                        element.innerText
                    ].filter(Boolean).join(' ').slice(0, 800).toLowerCase();
                    const knownNonChatDialog = /(settings|preferences|personalization|data controls|account|billing|preview|image)/.test(description);
                    const coversInteractionArea = (rect.width * rect.height) / viewportArea >= 0.3;
                    return knownNonChatDialog || coversInteractionArea;
                });
        } catch (_) {
            return false;
        }
    },

    shouldDeferPassiveContainerSearch: function () {
        const state = this.state.container;
        const lastHealthyAt = Math.max(
            state.lastSeenAt || 0,
            this.state.editor.lastSeenAt || 0,
            this.state.sendButton.lastSeenAt || 0
        );
        const recentlyHealthy = Date.now() - lastHealthyAt < this.config.recentSurfaceSuccessGraceMs;
        return recentlyHealthy && (this.hasBlockingNonChatSurface() || !this.findVisibleNativeEditor());
    },

    getRecoveryContextKey: function (type) {
        const site = window.InjectionTargetsOnWebsite?.activeSite || 'Unknown';
        const route = `${window.location.pathname || '/'}${window.location.search || ''}`;
        return `${site}:${type}:${route}`;
    },

    getAdaptiveCooldownMs: function (state, context = {}) {
        const base = context.autoSendActive
            ? this.config.autoSendCooldownBaseMs
            : this.config.cooldownBaseMs;
        const exponent = Math.max(0, Math.min(5, (state.failures || 1) - 1));
        return Math.min(this.config.cooldownMaxMs, base * (2 ** exponent));
    },

    clearPassiveContainerRetry: function () {
        const state = this.state.container;
        try { state.passiveObserver?.disconnect(); } catch (_) { /* ignore */ }
        if (state.passiveRetryTimer) clearTimeout(state.passiveRetryTimer);
        if (state.passiveProbeTimer) clearTimeout(state.passiveProbeTimer);
        state.passiveObserver = null;
        state.passiveRetryTimer = null;
        state.passiveProbeTimer = null;
        state.passiveRetryDelayMs = 0;
    },

    schedulePassiveContainerRetry: function (initialDelayMs) {
        const state = this.state.container;
        const retryWhenReady = () => {
            if (this.hasBlockingNonChatSurface() || !this.findVisibleNativeEditor()) return false;
            const inlineIsActuallyHealthy = typeof doCustomModificationsExist === 'function'
                ? doCustomModificationsExist()
                : false;
            if (inlineIsActuallyHealthy || window.MaxExtensionFloatingPanel?.isPanelVisible) {
                this.clearPassiveContainerRetry();
                return true;
            }
            window.__OCP_inlineHealthy = false;

            const reusableCandidate = state.lastHeuristicCandidate;
            const candidateIsRecent = Date.now() - (state.lastHeuristicCandidateAt || 0) <
                this.config.recentSurfaceSuccessGraceMs;
            if (candidateIsRecent && this.isVisibleElement(reusableCandidate) &&
                window.MaxExtensionButtonsInit?.createAndInsertCustomElements) {
                try {
                    window.MaxExtensionButtonsInit.createAndInsertCustomElements(reusableCandidate);
                    window.__OCP_inlineHealthy = true;
                    this.reportRecovery('container');
                    logConCgp('[SelectorAutoDetector] Reused the recent container after leaving a temporary surface.');
                    return true;
                } catch (error) {
                    logConCgp('[SelectorAutoDetector] Recent container reuse failed safely.', error?.message || error);
                    state.lastHeuristicCandidate = null;
                    state.lastHeuristicCandidateAt = 0;
                }
            }

            this.clearPassiveContainerRetry();
            state.failures = 0;
            state.lastFailure = 0;
            state.nextRetryAt = 0;
            state.contextKey = this.getRecoveryContextKey('container');
            if (typeof buttonBoxCheckingAndInjection === 'function') {
                logConCgp('[SelectorAutoDetector] Composer appeared; retrying quiet inline injection.');
                buttonBoxCheckingAndInjection(true, undefined, {
                    maxSearchMs: 300,
                    allowAutoFloatingFallback: true
                });
            }
            return true;
        };

        const armTimer = (delayMs) => {
            if (state.passiveRetryTimer) clearTimeout(state.passiveRetryTimer);
            state.passiveRetryDelayMs = Math.min(
                this.config.passiveRetryMaxMs,
                Math.max(this.config.passiveRetryBaseMs, Number(delayMs) || this.config.passiveRetryBaseMs)
            );
            state.passiveRetryTimer = setTimeout(() => {
                state.passiveRetryTimer = null;
                if (!retryWhenReady()) {
                    armTimer(Math.min(this.config.passiveRetryMaxMs, state.passiveRetryDelayMs * 2));
                }
            }, state.passiveRetryDelayMs);
        };

        if (!state.passiveObserver && document.body && typeof MutationObserver === 'function') {
            state.passiveObserver = new MutationObserver(() => {
                if (state.passiveProbeTimer) return;
                state.passiveProbeTimer = setTimeout(() => {
                    state.passiveProbeTimer = null;
                    retryWhenReady();
                }, 500);
            });
            state.passiveObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['aria-hidden', 'contenteditable', 'class', 'role', 'style']
            });
        }

        if (!state.passiveRetryTimer) armTimer(initialDelayMs);
    },

    /**
     * Reports a failure to find a specific element type.
     * @param {string} type - 'editor', 'sendButton', or 'stopButton'
     * @param {Object} context - Additional context (e.g., selectors tried)
     */
    reportFailure: async function (type, context = {}) {
        const now = Date.now();
        const s = this.state[type];

        if (!s) {
            logConCgp(`[SelectorAutoDetector] Unknown type reported: ${type}`);
            return null;
        }

        const recoveryContext = {
            ...context,
            autoSendActive: context.autoSendActive === true || this.isAutoSendActive()
        };
        const contextKey = this.getRecoveryContextKey(type);
        recoveryContext.contextKey = contextKey;
        if (s.contextKey !== contextKey) {
            s.contextKey = contextKey;
            s.failures = 0;
            s.lastFailure = 0;
            s.nextRetryAt = 0;
            s.recoveryToken = (s.recoveryToken || 0) + 1;
            s.recovering = false;
            if (type === 'container') this.clearPassiveContainerRetry();
        }

        // Passive inline injection should stay quiet on pages that currently have no composer.
        // A low-frequency observer/timer retries automatically if a composer later appears.
        if (type === 'container' && recoveryContext.passive === true &&
            (this.hasBlockingNonChatSurface() || !this.findVisibleNativeEditor())) {
            s.failures++;
            s.lastFailure = now;
            const adaptiveDelayMs = Math.min(
                this.config.passiveRetryMaxMs,
                this.config.passiveRetryBaseMs * (2 ** Math.min(5, s.failures - 1))
            );
            const lastHealthyAt = Math.max(
                s.lastSeenAt || 0,
                this.state.editor.lastSeenAt || 0,
                this.state.sendButton.lastSeenAt || 0
            );
            const recentGraceRemainingMs = Math.max(
                0,
                this.config.recentSurfaceSuccessGraceMs - (now - lastHealthyAt)
            );
            const delayMs = Math.min(
                this.config.passiveRetryMaxMs,
                Math.max(adaptiveDelayMs, recentGraceRemainingMs)
            );
            s.nextRetryAt = now + delayMs;
            logConCgp('[SelectorAutoDetector] Quiet container miss: no visible composer on this surface.', {
                contextKey,
                retryInMs: delayMs,
                reason: recoveryContext.reason
            });
            this.schedulePassiveContainerRetry(delayMs);
            return null;
        }

        // Debounce concurrent work and apply exponential backoff within the same page context.
        if (s.recovering || now < (s.nextRetryAt || 0)) {
            return null;
        }

        s.failures++;
        s.lastFailure = now;
        s.nextRetryAt = now + this.getAdaptiveCooldownMs(s, recoveryContext);

        logConCgp(`[SelectorAutoDetector] ${type} failure reported. Count: ${s.failures}`, context);

        if (s.failures >= this.config.failureThreshold) {
            return await this.triggerRecovery(type, recoveryContext);
        }
        return null;
    },

    /**
     * Reports that an element was successfully found.
     * Resets failure counters.
     * @param {string} type - 'editor', 'sendButton', or 'stopButton'
     * @param {HTMLElement} [element] - Optional found element to update stats
     */
    reportRecovery: function (type) {
        const s = this.state[type];
        if (s) {
            if (s.failures > 0) {
                logConCgp(`[SelectorAutoDetector] ${type} recovered. Resetting state.`);
            }
            s.failures = 0;
            s.recovering = false;
            s.lastFailure = 0;
            s.nextRetryAt = 0;
            s.lastSeenAt = Date.now();
            s.recoveryToken = (s.recoveryToken || 0) + 1;
        }
        if ((type === 'sendButton' || type === 'stopButton') && s) {
            s.everFound = true;
        }
        if (type === 'container') this.clearPassiveContainerRetry();
    },

    maybeNotifyContainerMissing: function () {
        if (this.settings.notifyContainerMissing !== true || typeof window.showToast !== 'function') {
            return;
        }

        const s = this.state.container;
        const now = Date.now();
        if ((now - (s.lastMissingNotifyToastAt || 0)) < this.config.containerMissingNotifyDebounceMs) {
            return;
        }

        s.lastMissingNotifyToastAt = now;
        window.showToast(
            'OneClickPrompts: Extension cannot inject buttons here. This may happen if the page changed, or if you are in settings/preview pages with no injection target.',
            'error',
            10000
        );
    },

    /**
     * Initiates the recovery process.
     * @param {string} type - 'editor', 'sendButton', or 'container'
     * @returns {Promise<HTMLElement|null>}
     */
    triggerRecovery: async function (type, context = {}) {
        const s = this.state[type];
        if (!s) return null;
        const recoveryToken = (s.recoveryToken || 0) + 1;
        s.recoveryToken = recoveryToken;
        s.recovering = true;

        try {
            const heuristicsAllowed = type === 'editor'
                ? this.settings.enableEditorHeuristics === true
                : type === 'sendButton'
                    ? this.settings.enableSendButtonHeuristics === true
                    : type === 'stopButton'
                        ? this.settings.enableStopButtonHeuristics === true
                        : this.settings.enableContainerHeuristics === true;

            // If heuristics are disabled, stop early and silently.
            if (!heuristicsAllowed) {
                logConCgp(`[SelectorAutoDetector] ${type} not found. Heuristics disabled; skipping recovery silently.`);
                return null;
            }

            const typeName = type === 'editor' ? 'Text input area'
                : type === 'sendButton' ? 'send button'
                    : type === 'stopButton' ? 'stop button'
                        : 'button container';

            if (type !== 'container' && !context.candidate) {
                this.showRecoveryToast(
                    type,
                    `OneClickPrompts: ${typeName} not found. Trying to find it...`,
                    'info',
                    {
                        duration: 3000,
                        cooldownKey: `${type}:recovery-status`,
                        cooldownMs: this.config.recoveryToastCooldownMs
                    }
                );
            }

            const site = window.InjectionTargetsOnWebsite?.activeSite || 'Unknown';
            let result = this.isVisibleElement(context.candidate) ? context.candidate : null;
            const recoveryIsStale = () => s.recoveryToken !== recoveryToken ||
                (context.contextKey && context.contextKey !== this.getRecoveryContextKey(type));

            // A supplied candidate already came from a live safety heuristic. Otherwise, give
            // transitional DOM a short chance to settle before scanning broadly.
            if (!result) {
                await new Promise(resolve => setTimeout(resolve, 400));
            }
            if (recoveryIsStale()) {
                logConCgp(`[SelectorAutoDetector] Discarding stale ${type} recovery after a surface change.`);
                return null;
            }
            if (type === 'container' && context.passive === true &&
                (this.hasBlockingNonChatSurface() || !this.findVisibleNativeEditor())) {
                this.schedulePassiveContainerRetry(this.config.passiveRetryBaseMs);
                return null;
            }

            if (type === 'container') {
                const failedSelectors = window.InjectionTargetsOnWebsite?.selectors?.containers || [];
                if (window.OneClickPromptsContainerHeuristics &&
                    typeof window.OneClickPromptsContainerHeuristics.findAlternativeContainer === 'function') {
                    result = await window.OneClickPromptsContainerHeuristics.findAlternativeContainer(failedSelectors);
                }
                if (recoveryIsStale()) return null;

                if (result) {
                    logConCgp('[SelectorAutoDetector] Container heuristics found alternative!', result);
                    s.lastHeuristicCandidate = result;
                    s.lastHeuristicCandidateAt = Date.now();
                    const placed = await this.offerContainerPlacement(result);
                    if (placed) {
                        this.reportRecovery('container');
                        return result;
                    }
                    result = null;
                }

                let didFallback = false;
                if (this.settings.autoFallbackToFloatingPanel !== false && !window.__OCP_userDisabledFallback) {
                    logConCgp('[SelectorAutoDetector] Container heuristics failed. Trying floating panel fallback.');
                    didFallback = await this.triggerFloatingPanelFallback();
                    if (didFallback) this.reportRecovery('container');
                } else {
                    logConCgp('[SelectorAutoDetector] Container recovery ended quietly; floating fallback is disabled.');
                }
                if (!didFallback) this.maybeNotifyContainerMissing();
                return null;
            }

            if (!result) {
                const heuristics = window.OneClickPromptsSiteHeuristics?.resolve
                    ? window.OneClickPromptsSiteHeuristics.resolve(site)
                    : window.OneClickPromptsSelectorAutoDetectorBase;

                if (type === 'editor') {
                    result = await heuristics.detectEditor({ site });
                } else if (type === 'sendButton') {
                    result = await heuristics.detectSendButton({ site });
                } else if (type === 'stopButton') {
                    if (typeof heuristics.detectStopButton === 'function') {
                        result = await heuristics.detectStopButton({ site });
                    } else if (typeof window.OneClickPromptsSelectorAutoDetectorBase.detectStopButton === 'function') {
                        result = await window.OneClickPromptsSelectorAutoDetectorBase.detectStopButton({ site });
                    }
                }
            }

            if (recoveryIsStale()) return null;
            if (!this.isVisibleElement(result)) result = null;
            if (!result) {
                logConCgp(`[SelectorAutoDetector] Heuristics failed to find ${type}.`);
                this.showRecoveryToast(
                    type,
                    `OneClickPrompts: Could not find ${typeName}. Please report this issue.`,
                    'error',
                    {
                        duration: 5000,
                        cooldownKey: `${type}:recovery-status`,
                        cooldownMs: this.config.recoveryToastCooldownMs
                    }
                );
                return null;
            }

            logConCgp(`[SelectorAutoDetector] Heuristics found new ${type}!`, result);
            let offered = false;
            if (type === 'editor' || type === 'sendButton') {
                offered = await this.offerToAdjustAndSaveSelector(type, result);
            }
            if (!offered) {
                offered = await this.offerToSaveSelector(type, result);
            }
            if (!offered) {
                this.showRecoveryToast(type, `OneClickPrompts: Found the ${typeName}.`, 'success', {
                    duration: 3000,
                    cooldownKey: `${type}:found`,
                    cooldownMs: this.config.recoveryToastCooldownMs
                });
            }

            this.reportRecovery(type);
            if (type === 'sendButton' && this.isAutoSendActive() && offered) {
                s.autoSendAwaitingUser = true;
                s.autoSendPendingElement = result;
                s.autoSendLastToastAt = Date.now();
                return null;
            }
            return result;
        } catch (error) {
            logConCgp(`[SelectorAutoDetector] ${type} recovery failed safely.`, error?.message || error);
            this.showRecoveryToast(
                type,
                `OneClickPrompts: Auto-detect could not recover the ${type}.`,
                'error',
                {
                    duration: 5000,
                    cooldownKey: `${type}:recovery-error`,
                    cooldownMs: this.config.recoveryToastCooldownMs
                }
            );
            return null;
        } finally {
            if (s.recoveryToken === recoveryToken) s.recovering = false;
        }
    },

    loadSettings: async function (attempt = 0) {
        if (!chrome?.runtime?.sendMessage) {
            return;
        }
        try {
            const response = await chrome.runtime.sendMessage({ type: 'getSelectorAutoDetectorSettings' });
            if (!response?.settings) {
                throw new Error(response?.error || 'Selector Auto-Detector settings were not returned.');
            }
            this.settings = {
                enableEditorHeuristics: response.settings.enableEditorHeuristics === true,
                enableSendButtonHeuristics: response.settings.enableSendButtonHeuristics === true,
                enableStopButtonHeuristics: response.settings.enableStopButtonHeuristics === true,
                enableContainerHeuristics: response.settings.enableContainerHeuristics === true,
                notifyContainerMissing: response.settings.notifyContainerMissing === true,
                autoFallbackToFloatingPanel: response.settings.autoFallbackToFloatingPanel !== false,
                loaded: true
            };
            if (this.settingsLoadRetryTimer) {
                clearTimeout(this.settingsLoadRetryTimer);
                this.settingsLoadRetryTimer = null;
            }
        } catch (error) {
            logConCgp('[SelectorAutoDetector] Failed to load settings, falling back to defaults.', error);
            if (attempt < 3 && !this.settingsLoadRetryTimer) {
                const delayMs = 1000 * (2 ** attempt);
                this.settingsLoadRetryTimer = setTimeout(() => {
                    this.settingsLoadRetryTimer = null;
                    void this.loadSettings(attempt + 1);
                }, delayMs);
            }
        }
    },

    getSettingsForSave: function (overrides = {}) {
        return {
            enableEditorHeuristics: this.settings.enableEditorHeuristics === true,
            enableSendButtonHeuristics: this.settings.enableSendButtonHeuristics === true,
            enableStopButtonHeuristics: this.settings.enableStopButtonHeuristics === true,
            enableContainerHeuristics: this.settings.enableContainerHeuristics === true,
            notifyContainerMissing: this.settings.notifyContainerMissing === true,
            autoFallbackToFloatingPanel: this.settings.autoFallbackToFloatingPanel !== false,
            ...overrides
        };
    },

    getHeuristicsSettingKey: function (type) {
        if (type === 'editor') return 'enableEditorHeuristics';
        if (type === 'sendButton') return 'enableSendButtonHeuristics';
        if (type === 'stopButton') return 'enableStopButtonHeuristics';
        if (type === 'container') return 'enableContainerHeuristics';
        return null;
    },

    isAutodetectEnabledForType: function (type) {
        const settingKey = this.getHeuristicsSettingKey(type);
        return !!settingKey && this.settings[settingKey] === true;
    },

    disableAutodetectForType: async function (type) {
        const settingKey = this.getHeuristicsSettingKey(type);
        if (!settingKey || !chrome?.runtime?.sendMessage) {
            return false;
        }

        const settings = this.getSettingsForSave({ [settingKey]: false });
        const response = await chrome.runtime.sendMessage({
            type: 'saveSelectorAutoDetectorSettings',
            settings
        });
        if (response?.success !== true) {
            throw new Error(response?.error || 'The service worker rejected the Auto-Detector settings update.');
        }
        this.settings = { ...settings, loaded: true };
        return true;
    },

    getDisableAutodetectToastButton: function (type) {
        const detector = this;
        return {
            text: 'Disable autodetect',
            title: 'Disable autodetect: You can enable it back in settings',
            className: 'toast-action-secondary',
            onClick: async () => {
                try {
                    const disabled = await detector.disableAutodetectForType(type);
                    if (disabled) {
                        detector.__toast('Disable autodetect: You can enable it back in settings', 'info', 3500);
                        return true;
                    }
                } catch (error) {
                    logConCgp('[SelectorAutoDetector] Failed to disable autodetect from recovery toast.', { type, error });
                }
                detector.__toast('Could not disable autodetect here. Try Settings.', 'error', 3000);
                return false;
            }
        };
    },

    showRecoveryToast: function (type, message, toastType = 'info', options = 3000) {
        if (typeof window.showToast !== 'function') {
            logConCgp(`[SelectorAutoDetector] ${message}`);
            return false;
        }

        const suppliedOptions = typeof options === 'number' ? { duration: options } : (options || {});
        const cooldownMs = Number.isFinite(suppliedOptions.cooldownMs)
            ? Math.max(0, suppliedOptions.cooldownMs)
            : 0;
        const cooldownKey = suppliedOptions.cooldownKey || null;
        if (cooldownKey && cooldownMs > 0) {
            const now = Date.now();
            const previous = this.recoveryToastTimes[cooldownKey] || 0;
            if (now - previous < cooldownMs) {
                logConCgp('[SelectorAutoDetector] Recovery toast suppressed by cooldown.', { type, cooldownKey });
                return false;
            }
            this.recoveryToastTimes[cooldownKey] = now;
        }

        const normalized = { ...suppliedOptions };
        delete normalized.cooldownMs;
        delete normalized.cooldownKey;
        const customButtons = Array.isArray(normalized.customButtons)
            ? [...normalized.customButtons]
            : [];

        if (this.isAutodetectEnabledForType(type)) {
            customButtons.push(this.getDisableAutodetectToastButton(type));
        }

        const toastOptions = customButtons.length > 0
            ? { ...normalized, customButtons }
            : normalized;

        window.showToast(message, toastType, toastOptions);
        return true;
    },

    ensureSelectorSaver: async function () {
        if (window.OCPSelectorPersistence) {
            return window.OCPSelectorPersistence;
        }
        const saverUrl = chrome?.runtime?.getURL ? chrome.runtime.getURL('modules/selector-auto-detector/selector-save.js') : null;
        if (!saverUrl) return null;
        try {
            const module = await import(saverUrl);
            return module?.OCPSelectorPersistence || window.OCPSelectorPersistence || null;
        } catch (error) {
            logConCgp('[SelectorAutoDetector] Failed to load selector saver module.', error);
            return null;
        }
    },

    /**
     * Triggers the floating panel as a last-resort fallback.
     * Called when container heuristics fail to find any alternative.
     * @returns {Promise<boolean>}
     */
    triggerFloatingPanelFallback: async function () {
        if (this.settings.autoFallbackToFloatingPanel === false || window.__OCP_userDisabledFallback) {
            logConCgp('[SelectorAutoDetector] Floating fallback skipped by user preference.');
            return false;
        }
        if (window.__OCP_inlineHealthy) {
            logConCgp('[SelectorAutoDetector] Floating fallback skipped because inline UI recovered.');
            return false;
        }
        logConCgp('[SelectorAutoDetector] Creating floating panel as fallback.');

        if (!window.MaxExtensionFloatingPanel || typeof window.MaxExtensionFloatingPanel.createFloatingPanel !== 'function') {
            logConCgp('[SelectorAutoDetector] Floating panel module not available.');
            this.showRecoveryToast('container', 'OneClickPrompts: Could not find suitable container and floating panel is not available.', 'error', {
                duration: 5000,
                cooldownKey: 'container:fallback-unavailable',
                cooldownMs: this.config.recoveryToastCooldownMs
            });
            return false;
        }

        if (window.MaxExtensionFloatingPanel.isPanelVisible) return true;

        try {
            await window.MaxExtensionFloatingPanel.createFloatingPanel();
            const panelElement = window.MaxExtensionFloatingPanel.panelElement;
            const buttonsArea = document.getElementById('max-extension-buttons-area');

            if (panelElement && buttonsArea) {
                // Clear and populate panel's buttons area
                buttonsArea.innerHTML = '';
                if (window.MaxExtensionButtonsInit && typeof window.MaxExtensionButtonsInit.createAndInsertCustomElements === 'function') {
                    window.MaxExtensionButtonsInit.createAndInsertCustomElements(buttonsArea);
                }

                // Position panel
                if (typeof window.MaxExtensionFloatingPanel.positionPanelTopRight === 'function') {
                    window.MaxExtensionFloatingPanel.positionPanelTopRight();
                } else if (typeof window.MaxExtensionFloatingPanel.positionPanelBottomRight === 'function') {
                    window.MaxExtensionFloatingPanel.positionPanelBottomRight();
                }

                // Make visible
                panelElement.style.display = 'flex';
                window.MaxExtensionFloatingPanel.isPanelVisible = true;

                // Save settings
                if (window.MaxExtensionFloatingPanel.currentPanelSettings) {
                    window.MaxExtensionFloatingPanel.currentPanelSettings.isVisible = true;
                    window.MaxExtensionFloatingPanel.debouncedSavePanelSettings?.();
                }

                if (this.settings.notifyContainerMissing === true) {
                    this.showRecoveryToast('container', 'OneClickPrompts: Using floating panel (no container found).', 'info', {
                        duration: 4000,
                        cooldownKey: 'container:fallback-active',
                        cooldownMs: this.config.containerMissingNotifyDebounceMs
                    });
                }

                logConCgp('[SelectorAutoDetector] Floating panel fallback activated successfully.');
                return true;
            } else {
                logConCgp('[SelectorAutoDetector] Failed to create floating panel elements.');
                return false;
            }
        } catch (err) {
            logConCgp('[SelectorAutoDetector] Error creating floating panel fallback:', err);
            this.showRecoveryToast('container', 'OneClickPrompts: Error activating floating panel.', 'error', {
                duration: 5000,
                cooldownKey: 'container:fallback-error',
                cooldownMs: this.config.recoveryToastCooldownMs
            });
            return false;
        }
    },

    /**
     * Offers the user to accept alternative container placement with manual move mode.
     * @param {HTMLElement} alternativeContainer - The alternative container found by heuristics
     * @returns {Promise<boolean>}
     */
    offerContainerPlacement: async function (alternativeContainer) {
        if (!alternativeContainer || !window.MaxExtensionButtonsInit) {
            return false;
        }

        logConCgp('[SelectorAutoDetector] Injecting buttons into alternative container and entering move mode.');

        // Inject buttons into the alternative container
        try {
            window.MaxExtensionButtonsInit.createAndInsertCustomElements(alternativeContainer);
            window.__OCP_inlineHealthy = true; // Mark as healthy since we found a place
        } catch (err) {
            logConCgp('[SelectorAutoDetector] Failed to inject into alternative container:', err);
            return false;
        }

        // Trigger the move mode with floating panel option
        if (window.MaxExtensionContainerMover && typeof window.MaxExtensionContainerMover.enterMoveMode === 'function') {
            // Use the enhanced move mode that includes floating panel button
            window.MaxExtensionContainerMover.enterMoveMode('auto-recovery');
        } else {
            logConCgp('[SelectorAutoDetector] ContainerMover not available for manual placement.');
        }
        return true;
    },

    __toast: function (message, type = 'info', options = 3000) {
        try {
            if (typeof window.showToast === 'function') {
                window.showToast(message, type, options);
                return;
            }
        } catch (_) { /* ignore */ }
        try {
            logConCgp('[SelectorAutoDetector] Toast unavailable:', { type, message });
        } catch (_) { /* ignore */ }
    },

    __getPickerUiRoots: function () {
        const roots = [];

        try {
            const toastContainer = document.getElementById('toastContainer');
            if (toastContainer) roots.push(toastContainer);
        } catch (_) { /* ignore */ }

        try {
            const buttonsContainerId = window?.InjectionTargetsOnWebsite?.selectors?.buttonsContainerId;
            if (typeof buttonsContainerId === 'string' && buttonsContainerId) {
                const buttonsContainer = document.getElementById(buttonsContainerId);
                if (buttonsContainer) roots.push(buttonsContainer);
            }
        } catch (_) { /* ignore */ }

        try {
            const floatingPanel = document.getElementById('max-extension-floating-panel');
            if (floatingPanel) roots.push(floatingPanel);
        } catch (_) { /* ignore */ }

        return roots;
    },

    __isInPickerUiRoots: function (el, roots) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        const list = Array.isArray(roots) ? roots : [];
        for (const root of list) {
            try {
                if (root && root.contains(el)) return true;
            } catch (_) { /* ignore */ }
        }
        return false;
    },

    __isOcpUiElement: function (el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
        return this.isOcpUiElement(el);
    },

    __isVisibleElement: function (el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        let rect;
        try {
            rect = el.getBoundingClientRect();
        } catch (_) {
            return false;
        }
        if (!rect || rect.width <= 10 || rect.height <= 10) return false;

        try {
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const opacity = parseFloat(style.opacity || '1');
            if (!Number.isNaN(opacity) && opacity === 0) return false;
        } catch (_) { /* ignore */ }

        return true;
    },

    __clearPickerHighlight: function (session) {
        if (!session?.highlightedEl) return;
        try {
            session.highlightedEl.style.outline = session.highlightedOriginalOutline || '';
        } catch (_) { /* ignore */ }
        session.highlightedEl = null;
        session.highlightedOriginalOutline = null;
    },

    __highlightPicker: function (session, el, color) {
        if (!session?.active || !el) return;

        if (session.highlightedEl && session.highlightedEl !== el) {
            this.__clearPickerHighlight(session);
        }

        if (!session.highlightedEl) {
            session.highlightedEl = el;
            try {
                session.highlightedOriginalOutline = el.style.outline;
            } catch (_) {
                session.highlightedOriginalOutline = null;
            }
        }

        try {
            el.style.outline = `2px solid ${color}`;
        } catch (_) { /* ignore */ }
    },

    __describeElement: function (el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return 'unknown';

        const tag = (el.tagName || 'unknown').toLowerCase();
        let idPart = '';
        try {
            if (el.id) idPart = `#${el.id}`;
        } catch (_) { /* ignore */ }

        const pickAttr = (name) => {
            try {
                const v = el.getAttribute?.(name);
                return typeof v === 'string' && v.trim() ? v.trim() : null;
            } catch (_) {
                return null;
            }
        };

        const label = pickAttr('aria-label') || pickAttr('title') || pickAttr('data-testid') || pickAttr('name') || null;
        const text = (() => {
            try {
                const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
                return t ? t : '';
            } catch (_) {
                return '';
            }
        })();

        const hint = (label || text || '').slice(0, 60);
        const hintPart = hint ? ` (${hint})` : '';
        return `${tag}${idPart}${hintPart}`;
    },

    __getEventPathElements: function (event) {
        const path = typeof event?.composedPath === 'function' ? event.composedPath() : [];
        if (!Array.isArray(path)) return [];
        return path.filter(node => node && node.nodeType === Node.ELEMENT_NODE);
    },

    __resolvePickedElement: function (type, event, roots) {
        const elements = this.__getEventPathElements(event);
        for (const el of elements) {
            if (this.__isInPickerUiRoots(el, roots)) return null;

            if (type === 'editor') {
                try {
                    if (el.matches('textarea, [contenteditable="true"], [role="textbox"]')) return el;
                } catch (_) { /* ignore */ }
                continue;
            }

            if (type === 'sendButton') {
                try {
                    if (el.matches('button, [role="button"], div[onclick], span[onclick]')) return el;
                } catch (_) { /* ignore */ }
                continue;
            }
        }
        return null;
    },

    __buildPickerCandidates: function (type, seed, roots) {
        if (!seed || seed.nodeType !== Node.ELEMENT_NODE) return [];

        const candidates = [];
        const seen = new Set();
        const maxCandidates = 60;
        const scrollY = typeof window.scrollY === 'number' ? window.scrollY : 0;

        const push = (el) => {
            if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
            if (seen.has(el)) return;
            if (this.__isInPickerUiRoots(el, roots)) return;
            if (this.__isOcpUiElement(el)) return;
            if (!this.__isVisibleElement(el)) return;
            seen.add(el);
            candidates.push(el);
        };

        if (type === 'editor') {
            try {
                document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]').forEach(el => push(el));
            } catch (_) { /* ignore */ }
            push(seed);

            candidates.sort((a, b) => {
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                const ta = ra.top + scrollY;
                const tb = rb.top + scrollY;
                return (ta - tb) || (ra.left - rb.left);
            });
            return candidates.slice(0, maxCandidates);
        }

        if (type === 'sendButton') {
            const anchorRect = (() => {
                try { return seed.getBoundingClientRect(); } catch (_) { return null; }
            })();
            const region = (() => {
                try {
                    return seed.closest('form') ||
                        seed.closest('footer, section, main, article') ||
                        document.body;
                } catch (_) {
                    return document.body;
                }
            })();

            const maxDx = 700;
            const maxDy = 500;
            const isNearAnchor = (el) => {
                if (!anchorRect) return true;
                let r;
                try { r = el.getBoundingClientRect(); } catch (_) { return false; }
                const dx = Math.min(
                    Math.abs(r.left - anchorRect.left),
                    Math.abs(r.right - anchorRect.right),
                    Math.abs((r.left + r.right) / 2 - (anchorRect.left + anchorRect.right) / 2)
                );
                const dy = Math.min(
                    Math.abs(r.top - anchorRect.top),
                    Math.abs(r.bottom - anchorRect.bottom),
                    Math.abs((r.top + r.bottom) / 2 - (anchorRect.top + anchorRect.bottom) / 2)
                );
                return dx <= maxDx && dy <= maxDy;
            };

            try {
                region.querySelectorAll('button, [role="button"], div[onclick], span[onclick]').forEach(el => {
                    if (!isNearAnchor(el)) return;
                    push(el);
                });
            } catch (_) { /* ignore */ }

            push(seed);

            candidates.sort((a, b) => {
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                const ta = ra.top + scrollY;
                const tb = rb.top + scrollY;
                return (ta - tb) || (ra.left - rb.left);
            });
            return candidates.slice(0, maxCandidates);
        }

        return [];
    },

    __stopPickMode: function (session) {
        if (!session?.active || !session.isPicking) return;

        try {
            if (session.pickClickHandler) {
                document.removeEventListener('click', session.pickClickHandler, true);
            }
        } catch (_) { /* ignore */ }
        try {
            if (session.hoverMoveHandler) {
                document.removeEventListener('pointermove', session.hoverMoveHandler, true);
            }
        } catch (_) { /* ignore */ }
        try {
            if (typeof cancelAnimationFrame === 'function' && session.hoverRafId) {
                cancelAnimationFrame(session.hoverRafId);
            }
        } catch (_) { /* ignore */ }

        session.pickClickHandler = null;
        session.hoverMoveHandler = null;
        session.hoverRafId = null;
        session.hoverLastEvent = null;
        session.isPicking = false;
    },

    __selectCandidateIndex: function (session, desiredIndex, announce = true) {
        if (!session?.active) return false;
        this.__stopPickMode(session);

        const list = Array.isArray(session.candidates) ? session.candidates : [];
        if (list.length === 0) {
            this.__toast('No candidates available. Try Pick.', 'warning', 2500);
            return false;
        }

        const len = list.length;
        let index = desiredIndex;
        for (let attempt = 0; attempt < len; attempt++) {
            const normalized = ((index % len) + len) % len;
            const el = list[normalized];
            if (el && el.isConnected && this.__isVisibleElement(el) && !this.__isInPickerUiRoots(el, session.roots)) {
                session.index = normalized;
                session.selectedEl = el;
                this.__highlightPicker(session, el, '#4CAF50');
                try {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                } catch (_) { /* ignore */ }

                if (announce) {
                    const typeName = session.type === 'editor' ? 'Text input' : 'Send button';
                    this.__toast(`${typeName} candidate ${normalized + 1}/${len}: ${this.__describeElement(el)}`, 'info', 1800);
                }
                return true;
            }
            index += 1;
        }

        this.__toast('All candidates look unavailable right now. Try Pick.', 'warning', 2500);
        return false;
    },

    __stepCandidate: function (session, direction) {
        if (!session?.active) return;
        const next = (session.index || 0) + (direction || 0);
        this.__selectCandidateIndex(session, next, true);
    },

    __startPickMode: function (session) {
        if (!session?.active) return;
        if (session.isPicking) {
            this.__toast('Pick mode already active: hover to preview, click to select.', 'info', 2200);
            return;
        }

        session.isPicking = true;
        this.__toast('Pick mode: hover previews purple, click selects (click is blocked so nothing will send).', 'info', 2600);

        const detector = this;
        session.hoverMoveHandler = (event) => {
            if (!session.active || !session.isPicking) return;

            if (detector.__isInPickerUiRoots(event.target, session.roots)) {
                return;
            }

            session.hoverLastEvent = event;
            if (session.hoverRafId) return;

            session.hoverRafId = requestAnimationFrame(() => {
                session.hoverRafId = null;
                if (!session.active || !session.isPicking) return;

                const ev = session.hoverLastEvent;
                session.hoverLastEvent = null;
                if (!ev) return;

                const candidate = detector.__resolvePickedElement(session.type, ev, session.roots);
                if (!candidate) {
                    detector.__clearPickerHighlight(session);
                    return;
                }
                detector.__highlightPicker(session, candidate, '#7a5cc8');
            });
        };

        try {
            document.addEventListener('pointermove', session.hoverMoveHandler, { capture: true, passive: true });
        } catch (_) {
            document.addEventListener('pointermove', session.hoverMoveHandler, true);
        }

        session.pickClickHandler = (event) => {
            if (!session.active || !session.isPicking) return;

            // Allow interacting with our own UI/toasts while pick mode is active.
            if (detector.__isInPickerUiRoots(event.target, session.roots)) {
                return;
            }

            const picked = detector.__resolvePickedElement(session.type, event, session.roots);
            if (!picked) {
                detector.__toast('Could not pick that. Try clicking directly on the control.', 'warning', 2500);
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();

            detector.__stopPickMode(session);

            session.candidates = detector.__buildPickerCandidates(session.type, picked, session.roots);
            const index = session.candidates.indexOf(picked);
            session.index = index >= 0 ? index : 0;
            detector.__selectCandidateIndex(session, session.index, true);
            detector.__toast('Picked. If it looks right, press Save.', 'success', 2200);
        };

        document.addEventListener('click', session.pickClickHandler, true);
    },

    __savePickedSelector: async function (session) {
        if (!session?.active) return false;
        this.__stopPickMode(session);

        const el = session.selectedEl;
        if (!el) {
            this.__toast('Nothing selected yet. Use arrows or Pick first.', 'warning', 2500);
            return false;
        }

        const saver = await this.ensureSelectorSaver();
        if (!saver || typeof saver.saveSelectorFromElement !== 'function' || typeof saver.deriveSelectorFromElement !== 'function') {
            this.__toast('Selector saver not available. Try Advanced selectors.', 'error', 3000);
            return false;
        }

        const site = session.site || (window.InjectionTargetsOnWebsite?.activeSite || 'Unknown');
        const derived = saver.deriveSelectorFromElement(el);
        if (!derived) {
            this.__toast('Could not derive a stable selector here (Shadow DOM / iframe?). Try Advanced selectors.', 'error', 4000);
            return false;
        }

        const result = await saver.saveSelectorFromElement({ site, type: session.type, element: el, selectorOverride: derived });
        if (result?.ok) {
            this.__toast(`Selector saved: ${result.selector}`, 'success', 3000);
            return true;
        }

        this.__toast(`Could not save selector (${result?.reason || 'unknown'}). Try Advanced selectors.`, 'error', 4000);
        return false;
    },

    __tryOpenQueuedPicker: function () {
        if (this.activePickerSession?.active) return false;
        const queue = Array.isArray(this.pickerQueue) ? this.pickerQueue : (this.pickerQueue = []);
        if (queue.length === 0) return false;

        while (queue.length > 0 && !this.activePickerSession?.active) {
            const next = queue.shift();
            if (!next) continue;
            const el = next.element;
            if (!el || el.nodeType !== Node.ELEMENT_NODE) {
                if (next.type === 'sendButton') {
                    const s = this.state?.sendButton;
                    if (s) {
                        s.autoSendAwaitingUser = false;
                        s.autoSendPendingElement = null;
                    }
                }
                continue;
            }
            Promise.resolve()
                .then(() => this.offerToAdjustAndSaveSelector(next.type, el))
                .then((shown) => {
                    if (shown !== false || next.type !== 'sendButton') return;
                    const s = this.state?.sendButton;
                    if (s) {
                        s.autoSendAwaitingUser = false;
                        s.autoSendPendingElement = null;
                    }
                })
                .catch((error) => {
                    logConCgp('[SelectorAutoDetector] Queued selector helper failed safely.', error?.message || error);
                    if (next.type === 'sendButton') {
                        const s = this.state?.sendButton;
                        if (s) {
                            s.autoSendAwaitingUser = false;
                            s.autoSendPendingElement = null;
                        }
                    }
                });
            return true;
        }
        return false;
    },

    /**
     * Offers an interactive picker (arrows + hover pick) to adjust editor/send selectors before saving.
     * Stop button is intentionally out-of-scope for this flow.
     * @param {'editor'|'sendButton'} type
     * @param {HTMLElement} element
     * @returns {Promise<boolean>} whether a picker toast was shown
     */
    offerToAdjustAndSaveSelector: async function (type, element) {
        if (type !== 'editor' && type !== 'sendButton') return false;
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        if (typeof window.showToast !== 'function') return false;

        const autoSendActive = type === 'sendButton' && this.isAutoSendActive();

        if (this.activePickerSession?.active) {
            const queue = Array.isArray(this.pickerQueue) ? this.pickerQueue : (this.pickerQueue = []);
            for (let i = queue.length - 1; i >= 0; i--) {
                if (queue[i]?.type === type) queue.splice(i, 1);
            }
            queue.push({ type, element });

            if (autoSendActive) {
                const s = this.state?.sendButton;
                if (s) {
                    s.autoSendAwaitingUser = true;
                    s.autoSendPendingElement = element;
                    s.autoSendLastToastAt = Date.now();
                }
            }

            this.__toast('OneClickPrompts: Selector helper queued. Close the current one to continue.', 'info', 2800);
            return true;
        }

        const site = window.InjectionTargetsOnWebsite?.activeSite || 'Unknown';
        const roots = this.__getPickerUiRoots();
        const candidates = this.__buildPickerCandidates(type, element, roots);
        if (candidates.length === 0) {
            if (autoSendActive) {
                const s = this.state?.sendButton;
                if (s) s.autoSendAwaitingUser = false;
                this.__toast('OneClickPrompts: Could not open the selector helper here. Auto-Send will continue.', 'warning', 3500);
            }
            return false;
        }

        const session = {
            active: true,
            type,
            site,
            roots,
            candidates,
            index: Math.max(0, candidates.indexOf(element)),
            selectedEl: element,
            highlightedEl: null,
            highlightedOriginalOutline: null,
            isPicking: false,
            hoverMoveHandler: null,
            pickClickHandler: null,
            hoverRafId: null,
            hoverLastEvent: null,
            autoSendActive
        };

        this.activePickerSession = session;

        if (autoSendActive) {
            const s = this.state?.sendButton;
            if (s) {
                s.autoSendAwaitingUser = true;
                s.autoSendPendingElement = element;
                s.autoSendLastToastAt = Date.now();
            }
        }

        const detector = this;
        const typeName = type === 'editor' ? 'Text input area' : 'Send button';
        const tooltip = [
            `${typeName} selector helper:`,
            `- ⬅️ Back / ➡️ Forward: cycles nearby candidates (green outline).`,
            `- 🎯 Pick: hover previews (purple), click selects (click is blocked; nothing sends).`,
            `- 💾 Save: saves selector for this site (Settings → Advanced selectors to edit).`,
            ``,
            `Possible issues:`,
            `- Some sites use iframes / Shadow DOM: selector may be impossible to derive.`,
            `- Saved selectors can break after site updates; reopen Advanced selectors if needed.`
        ].join('\n');

        const tooltipForToast = autoSendActive
            ? `${tooltip}\n\nAuto-Send is paused while this helper is open. Save or close it to continue.`
            : tooltip;

        this.__selectCandidateIndex(session, session.index, false);

        const toastMessage = autoSendActive
            ? `OneClickPrompts: Adjust ${typeName}, then Save (Auto-Send paused).`
            : `OneClickPrompts: Adjust ${typeName}, then Save.`;

        window.showToast(toastMessage, 'info', {
            duration: 0,
            tooltip: tooltipForToast,
            customButtons: [
                {
                    text: '⬅️ Back',
                    title: 'Previous candidate',
                    onClick: () => { detector.__stepCandidate(session, -1); return false; }
                },
                {
                    text: '🎯 Pick',
                    title: 'Hover preview (purple), click to select (blocked)',
                    onClick: () => { detector.__startPickMode(session); return false; }
                },
                {
                    text: '💾 Save',
                    title: 'Save the selected selector',
                    className: 'toast-action-primary',
                    onClick: async () => {
                        const ok = await detector.__savePickedSelector(session);
                        return ok === true;
                    }
                },
                {
                    ...detector.getDisableAutodetectToastButton(type)
                },
                {
                    text: 'Forward ➡️',
                    title: 'Next candidate',
                    onClick: () => { detector.__stepCandidate(session, 1); return false; }
                },
                {
                    text: '✖ Dismiss',
                    title: 'Close this helper',
                    className: 'toast-action-secondary',
                    onClick: () => true
                }
            ],
            onDismiss: () => {
                if (session.autoSendActive && session.type === 'sendButton') {
                    const s = detector.state?.sendButton;
                    if (s) {
                        s.autoSendPendingElement = session.selectedEl || s.autoSendPendingElement || null;
                        s.autoSendAwaitingUser = false;
                    }
                }
                session.active = false;
                detector.__stopPickMode(session);
                detector.__clearPickerHighlight(session);
                if (detector.activePickerSession === session) {
                    detector.activePickerSession = null;
                }
                detector.__tryOpenQueuedPicker();
            }
        });

        return true;
    },

    /**
     * Offers the user to save a newly found selector via toast action.
     * @param {'editor'|'sendButton'|'stopButton'} type
     * @param {HTMLElement} element
     * @returns {Promise<boolean>} whether an actionable toast was shown
     */
    offerToSaveSelector: async function (type, element) {
        const saver = await this.ensureSelectorSaver();
        if (!saver || typeof saver.deriveSelectorFromElement !== 'function' || typeof saver.saveSelectorFromElement !== 'function') {
            return false;
        }
        const site = window.InjectionTargetsOnWebsite?.activeSite || 'Unknown';
        const selector = saver.deriveSelectorFromElement(element);
        if (!selector || !window.showToast) {
            return false;
        }

        const now = Date.now();
        const previous = this.lastOffers[type] || { selector: null, site: null, at: 0 };
        if (previous.selector === selector && previous.site === site && now - previous.at < 15000) {
            logConCgp('[SelectorAutoDetector] Skipping duplicate save toast for selector.', { type, selector, site });
            return false;
        }
        this.lastOffers[type] = { selector, site, at: now };

        const typeName = type === 'editor' ? 'text input selector'
            : type === 'sendButton' ? 'send button selector'
                : 'stop button selector';
        const autoSendActive = type === 'sendButton' && this.isAutoSendActive();
        logConCgp('[SelectorAutoDetector] Offering to save selector.', { type, selector, site });
        const tooltip = `Will save selector: ${selector}\nUsed automatically next time (skips auto-detect).\nYou can edit selectors in Settings → Advanced selectors (bottom).` +
            (autoSendActive ? '\nAuto-Send is paused until this message is closed.' : '');
        window.showToast(`OneClickPrompts: Found a ${typeName}. Save it to Custom selectors?`, 'success', {
            duration: 15000,
            tooltip,
            customButtons: [
                {
                    text: 'Save selector',
                    title: tooltip,
                    className: 'toast-action-primary',
                    onClick: async () => {
                        const result = await saver.saveSelectorFromElement({
                            site,
                            type,
                            element,
                            selectorOverride: selector
                        });
                        if (result?.ok) {
                            logConCgp('[SelectorAutoDetector] Selector saved via toast action.', { type, selector: result.selector, site: result.site });
                            window.showToast('Selector saved to Custom selectors.', 'success', 2500);
                        } else {
                            logConCgp('[SelectorAutoDetector] Selector save failed.', { type, selector, site, reason: result?.reason });
                            window.showToast('Could not save selector. Try Advanced settings.', 'error', 2500);
                        }
                    }
                },
                {
                    ...this.getDisableAutodetectToastButton(type)
                }
            ],
            onDismiss: () => {
                if (!autoSendActive) return;
                const state = this.state.sendButton;
                state.autoSendPendingElement = element?.isConnected ? element : null;
                state.autoSendAwaitingUser = false;
            }
        });
        return true;
    }
};

// Initial settings sync and live updates
window.OneClickPromptsSelectorAutoDetector.loadSettings();

if (chrome?.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'selectorAutoDetectorSettingsChanged' && message.settings) {
            window.OneClickPromptsSelectorAutoDetector.settings = {
                enableEditorHeuristics: message.settings.enableEditorHeuristics === true,
                enableSendButtonHeuristics: message.settings.enableSendButtonHeuristics === true,
                enableStopButtonHeuristics: message.settings.enableStopButtonHeuristics === true,
                enableContainerHeuristics: message.settings.enableContainerHeuristics === true,
                notifyContainerMissing: message.settings.notifyContainerMissing === true,
                autoFallbackToFloatingPanel: message.settings.autoFallbackToFloatingPanel !== false,
                loaded: true
            };
        }
    });
}
