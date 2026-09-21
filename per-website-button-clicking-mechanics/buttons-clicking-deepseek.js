// per-website-button-clicking-mechanics/buttons-clicking-deepseek.js

// Version: 2.0 - Robust implementation

// Handles DeepSeek input and sending with multiple fallbacks

'use strict';

/**
 * Processes DeepSeek custom button clicks with robust input handling
 * @param {Event} event - Click event object
 * @param {string} customText - Text to insert
 * @param {boolean} autoSend - Auto-send enabled
 */
async function processDeepSeekCustomSendButtonClick(event, customText, autoSend) {
    event.preventDefault();
    logConCgp('[DeepSeek] Starting processing with text:', customText);

    // 1. Find editor using SelectorGuard
    const editor = await window.OneClickPromptsSelectorGuard.findEditor();

    if (!editor) {
        logConCgp('[DeepSeek] No active editor found');
        // Toast handled by SelectorGuard
        return;
    }

    // 2. Input handling system
    function handleEditorInput(editorElement, text) {
        try {
            logConCgp('[DeepSeek] Handling editor:', editorElement.tagName);

            // For textareas
            if (editorElement.tagName === 'TEXTAREA') {
                editorElement.value += text;
                editorElement.dispatchEvent(new Event('input', { bubbles: true }));
                editorElement.dispatchEvent(new Event('change', { bubbles: true }));
                return;
            }

            // For contenteditable divs
            if (editorElement.hasAttribute('contenteditable')) {
                // Modern alternative to deprecated document.execCommand:
                const selection = window.getSelection();
                let range;
                if (selection && selection.rangeCount > 0) {
                    // Use current selection range if available
                    range = selection.getRangeAt(0);
                } else {
                    // Create a new range at the end of the editor if no selection exists
                    range = document.createRange();
                    range.selectNodeContents(editorElement);
                    range.collapse(false);
                    if (selection) {
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                }
                // Insert text node at the current caret position
                const textNode = document.createTextNode(text);
                range.insertNode(textNode);
                // Move caret immediately after inserted text
                range.setStartAfter(textNode);
                range.collapse(true);
                if (selection) {
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
                editorElement.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }

            // Fallback for React-controlled divs
            editorElement.textContent += text;
            const reactEvent = new Event('input', { bubbles: true });
            Object.defineProperty(reactEvent, 'target', { value: editorElement });
            editorElement.dispatchEvent(reactEvent);
        } catch (error) {
            logConCgp('[DeepSeek] Input error:', error);
            showToast('Failed to insert text.', 'error');
        }
    }

    // All DeepSeek selectors live in utils.js (getDefaultSelectors) or the user's custom selectors.
    const getSiteSelectors = (key) => window.InjectionTargetsOnWebsite?.selectors?.[key] || [];

    const queryAll = (selectors) => selectors.flatMap((selector) => {
        try {
            return Array.from(document.querySelectorAll(selector));
        } catch (_) {
            return [];
        }
    });

    // DeepSeek reuses the same action-cluster control for Send and Stop, so the configured
    // send-button selectors also describe the cluster a Stop control must belong to.
    const isInActionCluster = (el) => {
        const selectors = getSiteSelectors('sendButtons');
        if (selectors.length === 0) return false;
        try {
            return el.matches(selectors.join(', '));
        } catch (_) {
            return selectors.some((selector) => { try { return el.matches(selector); } catch (_) { return false; } });
        }
    };

    // 2.1 Stop button detection tuned for DeepSeek (class churn-safe)
    const isStopButtonLike = (el) => {
        if (!el) return false;
        if (window.ButtonsClickingShared.hasStopLabel(el, ['cancel', 'abort', 'pause'])) return true;

        // Require a square-ish icon in the main action cluster; avoids false positives on toggles
        if (!isInActionCluster(el)) return false;

        const hasSquareIcon = !!el.querySelector('svg rect, svg use[href*="stop"], svg use[*|href*="stop"]');
        if (hasSquareIcon) return true;

        const stopLikePath = Array.from(el.querySelectorAll('svg path')).some(p => {
            const d = (p.getAttribute('d') || '').toLowerCase().replace(/\s+/g, '');
            // Square used by DeepSeek stop: starts near M2 4.88 ... ends near 11.12
            return /m2\.?0?4\.?8/.test(d) && d.includes('11.12');
        });
        return stopLikePath;
    };

    const findDeepSeekStopButton = () => {
        // Stop selectors first; then the shared Send/Stop cluster, filtered by icon shape.
        const candidates = queryAll([...getSiteSelectors('stopButtons'), ...getSiteSelectors('sendButtons')]);
        return candidates.find((el) => isVisible(el) && isStopButtonLike(el)) || null;
    };

    const isVisible = (el) => {
        if (!el) return false;
        if (el.offsetParent === null) return false;
        const style = window.getComputedStyle(el);
        if (!style) return false;
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        return true;
    };

    const findDeepSeekSendButton = async () => {
        // Prefer the rightmost visible action button matched by the configured selectors, excluding stops
        const clusterButtons = queryAll(getSiteSelectors('sendButtons'))
            .filter(isVisible)
            .filter(el => el.getAttribute('aria-disabled') !== 'true' && !el.classList.contains('ds-button--disabled'))
            .filter(el => !isStopButtonLike(el));

        if (clusterButtons.length > 0) {
            clusterButtons.sort((a, b) => {
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                // Rightmost wins; if tie, lower wins
                if (rb.left !== ra.left) return rb.left - ra.left;
                return rb.top - ra.top;
            });
            return clusterButtons[0];
        }

        // Nothing matched: let the Guard report the failure and run heuristics.
        const guardBtn = await window.OneClickPromptsSelectorGuard.findSendButton();
        return isStopButtonLike(guardBtn) ? null : guardBtn;
    };

    // 3. Robust auto-send system
    function startAutoSend() {
        return ButtonsClickingShared.performAutoSend({
            queueContext: event?.__queueContext,
            findButton: findDeepSeekSendButton,
            findStopButton: findDeepSeekStopButton,
            maxAttempts: 15,
            interval: 300,
            isEnabled: (sendButton) => {
                if (!sendButton) return false;
                return !sendButton.disabled &&
                    sendButton.getAttribute('aria-disabled') !== 'true' &&
                    !sendButton.classList.contains('disabled') &&
                    !sendButton.classList.contains('ds-button--disabled');
            },
            isBusy: (btn) => isStopButtonLike(btn) || ButtonsClickingShared.isBusyStopButton(btn),
            preClickValidation: () => !findDeepSeekStopButton(),
            clickAction: (btn) => window.MaxExtensionUtils.simulateClick(btn)
        }).then((result) => {
            if (!['sent', 'blocked_by_stop', 'cancelled', 'unconfirmed'].includes(result.status)) {
                if (result.status === 'not_found' && result.reason !== 'post-stop-missing-send') {
                    showToast('Could not find the send button.', 'error');
                }
            }
            return result;
        });
    }

    // Execute input on the found editor
    await ButtonsClickingShared.insertPrompt(event, editor, () => handleEditorInput(editor, customText));

    // Initiate auto-send if enabled
    if (autoSend && (event?.__fromDangerBroadcast || event?.__fromQueue || globalMaxExtensionConfig.globalAutoSendEnabled)) {
        logConCgp('[DeepSeek] Starting auto-send sequence');
        return startAutoSend();
    }
    return Promise.resolve({ status: 'sent', reason: 'manual' });
}

window.processDeepSeekCustomSendButtonClick = processDeepSeekCustomSendButtonClick;
