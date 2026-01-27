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
            recovering: false
        },
        sendButton: {
            failures: 0,
            lastFailure: 0,
            recovering: false,
            everFound: false,
            lastSeenAt: 0,
            autoSendAwaitingUser: false,
            autoSendPendingElement: null,
            autoSendLastToastAt: 0
        },
        stopButton: {
            failures: 0,
            lastFailure: 0,
            recovering: false,
            everFound: false,
            lastSeenAt: 0
        },
        container: {
            failures: 0,
            lastFailure: 0,
            recovering: false,
            containerNotFoundToastEverShown: false,
            containerNotFoundToastDismissed: false
        }
    },

    config: {
        failureThreshold: 1, // Number of failures before triggering recovery (can be >1 to debounce)
        cooldownMs: 2000     // Time to wait before re-alerting or re-trying
    },
    settings: {
        enableEditorHeuristics: false,
        enableSendButtonHeuristics: false,
        enableStopButtonHeuristics: false,
        enableContainerHeuristics: false,
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

        // Debounce/Cooldown check
        if (s.recovering || (now - s.lastFailure < this.config.cooldownMs)) {
            return null;
        }

        s.failures++;
        s.lastFailure = now;

        logConCgp(`[SelectorAutoDetector] ${type} failure reported. Count: ${s.failures}`, context);

        if (s.failures >= this.config.failureThreshold) {
            return await this.triggerRecovery(type);
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
        if (s && s.failures > 0) {
            logConCgp(`[SelectorAutoDetector] ${type} recovered. Resetting state.`);
            s.failures = 0;
            s.recovering = false;
        }
        if ((type === 'sendButton' || type === 'stopButton') && s) {
            s.everFound = true;
            s.lastSeenAt = Date.now();
        }
    },

    /**
     * Initiates the recovery process.
     * @param {string} type - 'editor', 'sendButton', or 'container'
     * @returns {Promise<HTMLElement|null>}
     */
    triggerRecovery: async function (type) {
        const s = this.state[type];
        s.recovering = true;

        const heuristicsAllowed = type === 'editor'
            ? this.settings.enableEditorHeuristics === true
            : type === 'sendButton'
                ? this.settings.enableSendButtonHeuristics === true
                : type === 'stopButton'
                    ? this.settings.enableStopButtonHeuristics === true
                    : this.settings.enableContainerHeuristics === true;

        // Readable name for the type
        const typeName = type === 'editor' ? 'Text input area'
            : type === 'sendButton' ? 'send button'
                : type === 'stopButton' ? 'stop button'
                    : 'button container';

        // Unified message logic
        const statusSuffix = heuristicsAllowed ? "Trying to find it..." : "Auto-detect is off.";
        const toastType = heuristicsAllowed ? 'info' : 'error';

        if (window.showToast) {
            if (type === 'container' && heuristicsAllowed) {
                if (!s.containerNotFoundToastEverShown && !s.containerNotFoundToastDismissed) {
                    s.containerNotFoundToastEverShown = true;
                    window.showToast('OneClickPrompts: Container where I can insert buttons is not found. Trying to find it automatically, results may disappoint you…', toastType, {
                        duration: 10000,
                        onDismiss: () => { s.containerNotFoundToastDismissed = true; }
                    });
                }
            } else {
                window.showToast(`OneClickPrompts: ${typeName} not found. ${statusSuffix}`, toastType);
            }
        } else {
            logConCgp(`[SelectorAutoDetector] ${typeName} not found. ${statusSuffix}`);
        }

        // If heuristics are disabled, stop here.
        if (!heuristicsAllowed) {
            logConCgp(`[SelectorAutoDetector] Heuristics disabled for ${type}; skipping recovery.`);
            s.recovering = false;
            return null;
        }

        const site = window.InjectionTargetsOnWebsite?.activeSite || 'Unknown';

        // Wait a moment for the UI to stabilize (e.g. if the button is just about to appear)
        await new Promise(resolve => setTimeout(resolve, 400));

        // Run Heuristics
        let result = null;

        if (type === 'container') {
            // Special handling for container type
            const failedSelectors = window.InjectionTargetsOnWebsite?.selectors?.containers || [];
            if (window.OneClickPromptsContainerHeuristics && typeof window.OneClickPromptsContainerHeuristics.findAlternativeContainer === 'function') {
                result = await window.OneClickPromptsContainerHeuristics.findAlternativeContainer(failedSelectors);
            }

            if (result) {
                logConCgp(`[SelectorAutoDetector] Container heuristics found alternative!`, result);
                // For containers, trigger manual move mode instead of auto-save
                await this.offerContainerPlacement(result);
                s.failures = 0;
            } else {
                logConCgp(`[SelectorAutoDetector] Container heuristics failed. Triggering floating panel fallback.`);
                // Trigger floating panel as last resort
                await this.triggerFloatingPanelFallback();
            }
        } else {
            // Existing logic for editor and sendButton
            const heuristics = window.OneClickPromptsSiteHeuristics?.resolve
                ? window.OneClickPromptsSiteHeuristics.resolve(site)
                : window.OneClickPromptsSelectorAutoDetectorBase;

            if (type === 'editor') {
                result = await heuristics.detectEditor({ site });
            } else if (type === 'sendButton') {
                result = await heuristics.detectSendButton({ site });
            } else if (type === 'stopButton') {
                // Ensure the method exists in case of partial rollout or custom overrides
                if (typeof heuristics.detectStopButton === 'function') {
                    result = await heuristics.detectStopButton({ site });
                } else if (typeof window.OneClickPromptsSelectorAutoDetectorBase.detectStopButton === 'function') {
                    // Fallback to base if site heuristics don't implement it yet
                    result = await window.OneClickPromptsSelectorAutoDetectorBase.detectStopButton({ site });
                }
            }

            if (result) {
                logConCgp(`[SelectorAutoDetector] Heuristics found new ${type}!`, result);
                let offered = false;
                if (type === 'editor' || type === 'sendButton') {
                    offered = await this.offerToAdjustAndSaveSelector(type, result);
                }
                if (!offered) {
                    offered = await this.offerToSaveSelector(type, result);
                }
                if (!offered && window.showToast) {
                    window.showToast(`OneClickPrompts: Found the ${typeName}.`, 'success');
                }
                s.failures = 0;
                if (type === 'stopButton') {
                    s.everFound = true;
                    s.lastSeenAt = Date.now();
                }
                if (type === 'sendButton') {
                    const autoSendActive = !!window.sharedAutoSendInterval;
                    if (autoSendActive && offered) {
                        s.autoSendAwaitingUser = true;
                        s.autoSendPendingElement = result;
                        s.autoSendLastToastAt = Date.now();
                        result = null;
                    }
                }
            } else {
                logConCgp(`[SelectorAutoDetector] Heuristics failed to find ${type}.`);
                if (window.showToast) window.showToast(`OneClickPrompts: Could not find ${typeName}. Please report this issue.`, 'error');
            }
        }

        s.recovering = false;
        return result;
    },

    loadSettings: async function () {
        if (!chrome?.runtime?.sendMessage) {
            return;
        }
        try {
            const response = await chrome.runtime.sendMessage({ type: 'getSelectorAutoDetectorSettings' });
            if (response && response.settings) {
                this.settings = {
                    enableEditorHeuristics: response.settings.enableEditorHeuristics === true,
                    enableSendButtonHeuristics: response.settings.enableSendButtonHeuristics === true,
                    enableStopButtonHeuristics: response.settings.enableStopButtonHeuristics === true,
                    enableContainerHeuristics: response.settings.enableContainerHeuristics === true,
                    loaded: true
                };
            }
        } catch (error) {
            logConCgp('[SelectorAutoDetector] Failed to load settings, falling back to defaults.', error);
        }
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
     * @returns {Promise<void>}
     */
    triggerFloatingPanelFallback: async function () {
        logConCgp('[SelectorAutoDetector] Creating floating panel as fallback.');

        if (!window.MaxExtensionFloatingPanel || typeof window.MaxExtensionFloatingPanel.createFloatingPanel !== 'function') {
            logConCgp('[SelectorAutoDetector] Floating panel module not available.');
            if (window.showToast) {
                window.showToast('OneClickPrompts: Could not find suitable container and floating panel is not available.', 'error', 5000);
            }
            return;
        }

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

                if (window.showToast) {
                    window.showToast('OneClickPrompts: Using floating panel (no container found).', 'info', 4000);
                }

                logConCgp('[SelectorAutoDetector] Floating panel fallback activated successfully.');
            } else {
                logConCgp('[SelectorAutoDetector] Failed to create floating panel elements.');
            }
        } catch (err) {
            logConCgp('[SelectorAutoDetector] Error creating floating panel fallback:', err);
            if (window.showToast) {
                window.showToast('OneClickPrompts: Error activating floating panel.', 'error');
            }
        }
    },

    /**
     * Offers the user to accept alternative container placement with manual move mode.
     * @param {HTMLElement} alternativeContainer - The alternative container found by heuristics
     * @returns {Promise<void>}
     */
    offerContainerPlacement: async function (alternativeContainer) {
        if (!alternativeContainer || !window.MaxExtensionButtonsInit) {
            return;
        }

        logConCgp('[SelectorAutoDetector] Injecting buttons into alternative container and entering move mode.');

        // Inject buttons into the alternative container
        try {
            window.MaxExtensionButtonsInit.createAndInsertCustomElements(alternativeContainer);
            window.__OCP_inlineHealthy = true; // Mark as healthy since we found a place
        } catch (err) {
            logConCgp('[SelectorAutoDetector] Failed to inject into alternative container:', err);
            return;
        }

        // Trigger the move mode with floating panel option
        if (window.MaxExtensionContainerMover && typeof window.MaxExtensionContainerMover.enterMoveMode === 'function') {
            // Use the enhanced move mode that includes floating panel button
            window.MaxExtensionContainerMover.enterMoveMode('auto-recovery');
        } else {
            logConCgp('[SelectorAutoDetector] ContainerMover not available for manual placement.');
        }
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
        try {
            const testId = (el.getAttribute?.('data-testid') || '').toLowerCase();
            if (testId.startsWith('custom-send-button')) return true;
        } catch (_) { /* ignore */ }
        try {
            if (el.closest?.('[id*="custom-buttons-container"]')) return true;
        } catch (_) { /* ignore */ }
        return false;
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
                    if (s) s.autoSendAwaitingUser = false;
                }
                continue;
            }
            Promise.resolve()
                .then(() => this.offerToAdjustAndSaveSelector(next.type, el))
                .catch(() => { /* ignore */ });
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

        const autoSendActive = type === 'sendButton' && !!window.sharedAutoSendInterval;

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
        logConCgp('[SelectorAutoDetector] Offering to save selector.', { type, selector, site });
        const tooltip = `Will save selector: ${selector}\nUsed automatically next time (skips auto-detect).\nYou can edit selectors in Settings → Advanced selectors (bottom).`;
        window.showToast(`OneClickPrompts: Found a ${typeName}. Save it to Custom selectors?`, 'success', {
            duration: 15000,
            tooltip,
            actionTooltip: tooltip,
            actionLabel: 'Save selector',
            onAction: async () => {
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
                loaded: true
            };
        }
    });
}
