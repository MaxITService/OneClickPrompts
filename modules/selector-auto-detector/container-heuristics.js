// modules/selector-auto-detector/container-heuristics.js
/**
 * File: modules/selector-auto-detector/container-heuristics.js
 * Version: 1.0
 *
 * Description:
 * Heuristics for finding a suitable button container when the saved or default selector fails.
 * It attempts to look for "likely alternatives" nearby in the DOM or using standard fallbacks.
 */

'use strict';

window.OneClickPromptsContainerHeuristics = {
    _debugInvalidCount: 0,

    /**
     * Attempts to find an alternative container.
     * @param {string[]} failedSelectors - The list of selectors that failed.
     * @returns {Promise<HTMLElement|null>} - A likely candidate or null.
     */
    findAlternativeContainer: async function (failedSelectors) {
        logConCgp('[ContainerHeuristics] Starting search for alternative container.');
        this._debugInvalidCount = 0;

        const failed = Array.isArray(failedSelectors) ? failedSelectors.filter(Boolean) : [];
        const site = window.InjectionTargetsOnWebsite?.activeSite || 'Unknown';
        const defaults = site !== 'Unknown' && window.InjectionTargetsOnWebsite?.getDefaultSelectors
            ? window.InjectionTargetsOnWebsite.getDefaultSelectors(site)
            : null;
        const defaultContainerSelectors = Array.isArray(defaults?.containers) ? defaults.containers.filter(Boolean) : [];

        const pickFromSelectors = (selectors, reason) => {
            if (!selectors || selectors.length === 0) return null;
            const found = window.MaxExtensionUtils?.pickUsableContainer
                ? window.MaxExtensionUtils.pickUsableContainer(selectors)
                : null;
            if (found) {
                logConCgp(`[ContainerHeuristics] Found container via ${reason}.`, found);
            }
            return found;
        };

        // 1) Try any defaults we haven't already failed on (helps when custom selectors are broken)
        const defaultFallback = pickFromSelectors(
            defaultContainerSelectors.filter(sel => !failed.includes(sel)),
            'default selectors'
        );
        if (defaultFallback) {
            return defaultFallback;
        }

        // 2) Try a combined pool of all known selectors (custom + defaults) just in case earlier lookups raced visibility
        const combinedSelectors = [...new Set([...failed, ...defaultContainerSelectors])].filter(Boolean);
        const combinedFallback = pickFromSelectors(combinedSelectors, 'combined selectors pass');
        if (combinedFallback) {
            return combinedFallback;
        }

        // 3) Collect anchors (editor/send button) to score nearby containers
        const anchors = await this.findAnchors();
        logConCgp('[ContainerHeuristics] Anchor status', {
            editor: !!anchors.editor,
            sendButton: !!anchors.sendButton
        });

        const candidates = [];
        const seen = new Set();
        const addCandidate = (el, reason, bonus = 0) => {
            if (!el || seen.has(el)) return;
            const validity = this.validateContainer(el);
            if (!validity.ok) {
                // Log a few invalid reasons to help debug why we rejected items
                if (this._debugInvalidCount < 8) {
                    this._debugInvalidCount += 1;
                    logConCgp('[ContainerHeuristics] Rejected candidate', { reason: validity.reason, node: el });
                }
                return;
            }
            seen.add(el);
            candidates.push({ el, reason, bonus });
        };

        // 3a) Known composer shells around ChatGPT/modern chat layouts
        const composerSelectors = [
            'form:has(#prompt-textarea)',
            'form:has(textarea[name="prompt-textarea"])',
            'form[data-type="unified-composer"]',
            'div:has(#prompt-textarea)',
            'div:has([data-testid="prompt-textarea"])',
            '[data-testid*="composer"]',
            '[class*="composer"]:has(textarea, [contenteditable="true"])',
            '[class*="footer"]:has(textarea, [contenteditable="true"])'
        ];
        for (const selector of composerSelectors) {
            try {
                const matches = document.querySelectorAll(selector);
                matches.forEach(node => addCandidate(node, `composer selector: ${selector}`, 12));
            } catch (error) {
                logConCgp('[ContainerHeuristics] Selector failed (skipping):', selector, error?.message || error);
            }
        }

        // 3b) Ancestors of anchors (editor/send button) — prefer nearer ones
        const pushAncestors = (node, reason) => {
            let current = node;
            let depth = 0;
            while (current && depth < 8) {
                addCandidate(current, reason, Math.max(0, 8 - depth));
                current = current.parentElement;
                depth += 1;
            }
        };
        if (anchors.editor) {
            pushAncestors(anchors.editor, 'editor ancestry');
        }
        if (anchors.sendButton) {
            pushAncestors(anchors.sendButton, 'send button ancestry');
        }

        // 3c) Common ancestor that contains both anchors (best-case inline toolbar host)
        if (anchors.editor && anchors.sendButton) {
            const editorPath = new Set();
            let walker = anchors.editor;
            while (walker) {
                editorPath.add(walker);
                walker = walker.parentElement;
            }
            let shared = anchors.sendButton;
            while (shared) {
                if (editorPath.has(shared) && this.isValidContainer(shared)) {
                    addCandidate(shared, 'shared anchor ancestor', 16);
                    break;
                }
                shared = shared.parentElement;
            }
        }

        // 3d) Generic visible containers that already wrap interactive inputs
        const containerishSelectors = [
            'form:has(textarea, [contenteditable="true"])',
            'section:has(textarea, [contenteditable="true"])',
            'main:has(textarea, [contenteditable="true"])',
            'div:has(textarea, [contenteditable="true"])',
            'article:has(textarea, [contenteditable="true"])',
            'footer:has(textarea, [contenteditable="true"])',
            '[class*="input"]:has(textarea, [contenteditable="true"])'
        ];
        for (const selector of containerishSelectors) {
            try {
                const matches = document.querySelectorAll(selector);
                matches.forEach(node => addCandidate(node, `containerish selector: ${selector}`, 8));
            } catch (error) {
                logConCgp('[ContainerHeuristics] Containerish selector failed (skipping):', selector, error?.message || error);
            }
        }

        // 3e) Visible blocks near the bottom of the viewport (last-ditch inline placement)
        const structuralCandidates = Array.from(document.querySelectorAll('form, section, main, article, footer, div:has(button)'))
            .filter(el => this.isValidContainer(el))
            .sort((a, b) => {
                const rectA = a.getBoundingClientRect();
                const rectB = b.getBoundingClientRect();
                return rectB.bottom - rectA.bottom;
            })
            .slice(0, 50);
        structuralCandidates.forEach(el => addCandidate(el, 'bottom proximity scan', 4));

        if (candidates.length > 0) {
            logConCgp('[ContainerHeuristics] Candidate container count before scoring:', candidates.length);
            const scored = candidates.map(({ el, reason, bonus }) => {
                const score = this.scoreContainer(el, anchors) + (bonus || 0);
                return { el, reason, score };
            }).sort((a, b) => b.score - a.score);

            const preview = scored.slice(0, 5).map(item => ({
                score: item.score,
                reason: item.reason,
                tag: item.el?.tagName,
                id: item.el?.id || null,
                class: item.el?.className || null
            }));
            logConCgp('[ContainerHeuristics] Top candidate scores', preview);

            const best = scored[0];
            if (best) {
                logConCgp('[ContainerHeuristics] Selected best alternative container.', { reason: best.reason, score: best.score, node: best.el });
                return best.el;
            }
        }

        // 4) Fallback: try a broad but safe element before giving up to floating panel
        const broadFallback = ['main', 'section', 'form', 'article'].map(sel => document.querySelector(sel)).find(el => this.isValidContainer(el));
        if (broadFallback) {
            logConCgp('[ContainerHeuristics] Falling back to broad container (main/section/form/article).', broadFallback);
            return broadFallback;
        }

        // 5) Absolute last resort: body (only if connected and visible-ish)
        if (document.body && document.body.isConnected) {
            logConCgp('[ContainerHeuristics] Using <body> as last-resort container.');
            return document.body;
        }

        logConCgp('[ContainerHeuristics] No alternative container found after exhaustive search.');
        return null;
    },

    /**
     * Validates if an element is suitable as a container.
     * @param {HTMLElement} element
     * @returns {boolean}
     */
    isValidContainer: function (element) {
        return this.validateContainer(element).ok;
    },

    /**
     * Validates a potential container with a reason for debugging.
     * @param {HTMLElement} element
     * @returns {{ok: boolean, reason?: string}}
     */
    validateContainer: function (element) {
        if (!element || !element.tagName) {
            return { ok: false, reason: 'no-element' };
        }

        if (window.MaxExtensionUtils && typeof window.MaxExtensionUtils.isElementUsableForInjection === 'function') {
            if (!window.MaxExtensionUtils.isElementUsableForInjection(element)) {
                return { ok: false, reason: 'hidden-or-inert' };
            }
        }

        const validTags = ['DIV', 'SECTION', 'FOOTER', 'HEADER', 'MAIN', 'FORM', 'ARTICLE', 'BODY'];
        if (!validTags.includes(element.tagName)) {
            return { ok: false, reason: `invalid-tag-${element.tagName}` };
        }

        const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : null;
        if (!rect || rect.width < 60 || rect.height < 20) {
            return { ok: false, reason: 'too-small' };
        }

        if (!element.isConnected) {
            return { ok: false, reason: 'not-connected' };
        }

        const containerId = window?.InjectionTargetsOnWebsite?.selectors?.buttonsContainerId;
        if (containerId) {
            try {
                const escaped = CSS?.escape ? CSS.escape(containerId) : containerId;
                if (element.id === containerId || element.closest?.(`#${escaped}`)) {
                    return { ok: false, reason: 'self-container' };
                }
            } catch (_) {
                // best-effort; ignore escape errors
            }
        }

        return { ok: true };
    },

    /**
     * Scores a candidate container relative to anchors so we can pick the most relevant one.
     * @param {HTMLElement} element
     * @param {{editor?: HTMLElement|null, sendButton?: HTMLElement|null}} anchors
     * @returns {number}
     */
    scoreContainer: function (element, anchors = {}) {
        if (!element) return -Infinity;
        const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : null;
        if (!rect) return -Infinity;

        const { editor, sendButton } = anchors;
        let score = 0;

        if (editor && element.contains(editor)) score += 28;
        if (sendButton && element.contains(sendButton)) score += 18;
        if (editor && sendButton && element.contains(editor) && element.contains(sendButton)) score += 10;

        const area = rect.width * rect.height;
        if (area > 160000) score += 4;
        else if (area > 60000) score += 2;

        const distanceFromBottom = Math.abs(window.innerHeight - rect.bottom);
        score += Math.max(0, 500 - distanceFromBottom) * 0.04; // prefer lower on page

        const textBlob = `${element.id || ''} ${(element.className || '')} ${(element.getAttribute?.('data-testid') || '')}`.toLowerCase();
        const keywords = ['composer', 'prompt', 'footer', 'toolbar', 'chat', 'message', 'input'];
        if (keywords.some(k => textBlob.includes(k))) {
            score += 8;
        }

        if (element.tagName === 'FORM') score += 6;
        if (element.tagName === 'SECTION' || element.tagName === 'MAIN' || element.tagName === 'ARTICLE') score += 4;

        return score;
    },

    /**
     * Attempts to find nearby anchors (editor/send button) to better score candidates.
     * @returns {Promise<{editor: HTMLElement|null, sendButton: HTMLElement|null}>}
     */
    findAnchors: async function () {
        const selectors = window?.InjectionTargetsOnWebsite?.selectors || {};

        const isVisible = (el) => {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            if (!rect || rect.width < 10 || rect.height < 10) return false;
            const style = window.getComputedStyle(el);
            if (!style || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            if (window.MaxExtensionUtils?.isElementUsableForInjection && !window.MaxExtensionUtils.isElementUsableForInjection(el)) {
                return false;
            }
            return true;
        };

        const firstVisible = (list = [], extraFilter = null) => {
            for (const selector of list) {
                if (!selector) continue;
                const nodes = document.querySelectorAll(selector);
                for (const node of nodes) {
                    if (!isVisible(node)) continue;
                    if (extraFilter && !extraFilter(node)) continue;
                    return node;
                }
            }
            return null;
        };

        let editor = firstVisible(selectors.editors, (el) => el.matches?.('textarea, [contenteditable="true"], [role="textbox"]'));
        if (!editor && window.OneClickPromptsSelectorAutoDetectorBase?.detectEditor) {
            try {
                editor = await window.OneClickPromptsSelectorAutoDetectorBase.detectEditor();
            } catch (_) { }
        }

        const buttonFilter = (el) => {
            if (el.getAttribute) {
                const testId = (el.getAttribute('data-testid') || '').toLowerCase();
                if (testId.startsWith('custom-send-button')) return false;
            }
            if (el.closest?.('[id*="custom-buttons-container"]')) return false;
            if (el.disabled || el.getAttribute?.('aria-disabled') === 'true') return false;
            return true;
        };

        let sendButton = firstVisible(selectors.sendButtons, buttonFilter);
        if (!sendButton && window.OneClickPromptsSelectorAutoDetectorBase?.detectSendButton) {
            try {
                sendButton = await window.OneClickPromptsSelectorAutoDetectorBase.detectSendButton();
            } catch (_) { }
        }

        return { editor, sendButton };
    }
};
