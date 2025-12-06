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

    const isEditorInInitialState = (element) => {
        const currentValue = element.value ?? '';
        const isInitial = currentValue.trim() === '';
        logConCgp('[buttons] Editor initial state check:', isInitial);
        return isInitial;
    };

    const setEditorValueDirectly = (element, text) => {
        element.focus();
        logConCgp('[buttons] Editor focused for setting value directly.');

        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(element),
            'value'
        )?.set;

        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(element, text);
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            logConCgp('[buttons] Events dispatched after setting value directly.');
        }
    };

    const startAutoSend = (_, editor) => {
        logConCgp('[auto-send] Auto-send is enabled. Starting auto-send process.');
        return ButtonsClickingShared.performAutoSend({
            preClickValidation: () => {
                const currentText = editor.value?.trim() ?? '';
                return currentText.length > 0;
            },
            clickAction: (btn) => btn && btn.click()
        }).then((result) => {
            if (result.status !== 'sent' && result.status !== 'blocked_by_stop') {
                showToast('Send button not found. Auto-send stopped.', 'error');
            }
            return result;
        });
    };

    const handleMessageInsertion = async () => {
        const initialState = isEditorInInitialState(editorArea);

        // Step 1: Consolidate text insertion logic to prevent duplication.
        if (initialState) {
            // If editor is empty, just set the text.
            setEditorValueDirectly(editorArea, customText);
        } else {
            // If editor has content, append the new text.
            const existingText = editorArea.value ?? '';
            const newText = `${existingText}${customText}`;
            setEditorValueDirectly(editorArea, newText);
        }

        // Step 2: Move cursor to the end after text is set.
        const finalLength = editorArea.value.length;
        if (editorArea.setSelectionRange) {
            editorArea.setSelectionRange(finalLength, finalLength);
            logConCgp('[buttons] Cursor moved to the end of the editor.');
        }

        // Step 3: Handle auto-sending.
        if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
            return startAutoSend(null, editorArea);
        }
        return Promise.resolve({ status: 'sent', reason: 'manual' });
    };

    return await handleMessageInsertion();
}
