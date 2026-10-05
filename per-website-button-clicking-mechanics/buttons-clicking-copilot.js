'use strict';

/**
 * Processes the custom send button click for Copilot.
 * @param {Event} event - The click event triggered by the send button.
 * @param {string} customText - The custom text to be sent.
 * @param {boolean} autoSend - Flag indicating whether autosend is enabled.
 */
async function processCopilotCustomSendButtonClick(event, customText, autoSend) {
    event.preventDefault();
    logConCgp('[buttons] Custom send button was clicked.');

    // Find editor using SelectorGuard
    const editorArea = await window.OneClickPromptsSelectorGuard.findEditor();

    if (!editorArea) {
        logConCgp('[buttons] Editor area not found. Unable to proceed.');
        // Toast handled by SelectorGuard
        return;
    }

    // Lexical adds invisible caret markers; they are not a non-empty prompt.
    const readEditorText = () => String(
        editorArea instanceof HTMLTextAreaElement ? editorArea.value : editorArea.innerText ?? editorArea.textContent ?? ''
    ).replace(/[\u200B\u200C\u200D\uFEFF]/g, '');

    const appendPrompt = async () => {
        const previousText = readEditorText();
        editorArea.focus();
        if (editorArea instanceof HTMLTextAreaElement) {
            // Preserve the controlled textarea's native setter and append semantics.
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(editorArea, (previousText.trim() ? editorArea.value : '') + customText);
            editorArea.dispatchEvent(new Event('input', { bubbles: true }));
            editorArea.dispatchEvent(new Event('change', { bubbles: true }));
            const end = editorArea.value.length;
            editorArea.setSelectionRange(end, end);
        } else if (editorArea.isContentEditable) {
            MaxExtensionUtils.moveCursorToEnd(editorArea);
            // Let Lexical insert into its own document model, preserving existing formatting.
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/plain', customText);
            const paste = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true, composed: true });
            editorArea.dispatchEvent(paste);
            if (!paste.defaultPrevented) {
                // Older contenteditable variants use the browser's editing operation.
                if (!document.execCommand('insertText', false, customText)) return false;
            }
            // Framework updates can finish after the paste handler returns.
            await new Promise(resolve => setTimeout(resolve, 0));
            MaxExtensionUtils.moveCursorToEnd(editorArea);
        } else {
            return false;
        }
        return readEditorText() !== previousText;
    };

    const startAutoSend = (_, editor) => {
        logConCgp('[auto-send] Auto-send is enabled. Starting auto-send process.');
        return ButtonsClickingShared.performAutoSend({
            queueContext: event?.__queueContext,
            preClickValidation: () => {
                return editor.isConnected && readEditorText().trim().length > 0;
            },
            clickAction: (btn) => btn && btn.click()
        }).then((result) => {
            if (!['sent', 'blocked_by_stop', 'cancelled', 'unconfirmed'].includes(result.status)) {
                showToast('Send button not found. Auto-send stopped.', 'error');
            }
            return result;
        });
    };

    const handleMessageInsertion = async () => {
        const inserted = await ButtonsClickingShared.insertPrompt(event, editorArea, appendPrompt);
        if (inserted === false) {
            showToast('Could not insert text into Copilot. Nothing was sent.', 'error');
            return { status: 'failed', reason: 'insertion_failed' };
        }
        // Step 3: Handle auto-sending.
        if (autoSend && (event?.__fromDangerBroadcast || event?.__fromQueue || globalMaxExtensionConfig.globalAutoSendEnabled)) {
            return startAutoSend(null, editorArea);
        }
        return Promise.resolve({ status: 'sent', reason: 'manual' });
    };

    return await handleMessageInsertion();
}
