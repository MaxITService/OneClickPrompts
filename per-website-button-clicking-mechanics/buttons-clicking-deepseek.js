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

    // 3. Robust auto-send system
    function startAutoSend() {
        return ButtonsClickingShared.performAutoSend({
            maxAttempts: 15,
            interval: 300,
            isEnabled: (sendButton) => {
                if (!sendButton) return false;
                return !sendButton.disabled &&
                    sendButton.getAttribute('aria-disabled') !== 'true' &&
                    !sendButton.classList.contains('disabled');
            },
            clickAction: (btn) => window.MaxExtensionUtils.simulateClick(btn)
        }).then((result) => {
            if (result.status !== 'sent' && result.status !== 'blocked_by_stop') {
                if (result.status === 'not_found' && result.reason !== 'post-stop-missing-send') {
                    showToast('Could not find the send button.', 'error');
                }
            }
            return result;
        });
    }

    // Execute input on the found editor
    handleEditorInput(editor, customText);

    // Initiate auto-send if enabled
    if (autoSend && globalMaxExtensionConfig.globalAutoSendEnabled) {
        logConCgp('[DeepSeek] Starting auto-send sequence');
        return startAutoSend();
    }
    return Promise.resolve({ status: 'sent', reason: 'manual' });
}

window.processDeepSeekCustomSendButtonClick = processDeepSeekCustomSendButtonClick;
