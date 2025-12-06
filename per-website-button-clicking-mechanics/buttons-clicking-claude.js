// per-website-button-clicking-mechanics/buttons-clicking-claude.js
// This file is a dependency for buttons.js. It provides functions to handle the send button clicking process for Claude.

'use strict';

/**
 * Handles text insertion and sending for Claude site
 * @param {Event} event - The triggering event
 * @param {string} customText - The text to insert
 * @param {boolean} autoSend - Whether to auto-send the message
 */
async function processClaudeCustomSendButtonClick(event, customText, autoSend) {
    logConCgp('[Claude] Starting Claude-specific handling');

    // First try to insert the text
    const insertionSuccessful = await ClaudeEditorUtils.insertTextIntoClaudeEditor(customText);

    if (!insertionSuccessful) {
        logConCgp('[Claude] Text insertion failed');
        return;
    }

    // If auto-send is enabled, handle the send process
    if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
        logConCgp('[Claude] Auto-send enabled, attempting to send message');
        return handleClaudeSend();
    }
    return Promise.resolve({ status: 'sent', reason: 'manual' });
}

/**
 * Handles the send button clicking process for Claude
 */
async function handleClaudeSend() {
    return ButtonsClickingShared.performAutoSend({
        clickAction: (btn) => setTimeout(() => MaxExtensionUtils.simulateClick(btn), 200),
        isBusy: (btn) => ButtonsClickingShared.isBusyStopButton(btn)
    }).then((result) => {
        if (result.status !== 'sent' && result.status !== 'blocked_by_stop') {
            logConCgp('[Claude] Auto-send exhausted without finding enabled send button.');
            showToast('Could not find the send button.', 'error');
        }
        return result;
    });
}


/**
 * Utility functions for handling text insertion in Claude's editor
 * Handles different editor states and element structures
 */
const ClaudeEditorUtils = {
    /**
     * Attempts to insert text into Claude's editor using multiple strategies
     * @param {string} textToInsert - The text to insert into the editor
     * @returns {boolean} - Whether the insertion was successful
     */
    insertTextIntoClaudeEditor: async function (textToInsert) {
        logConCgp('[ClaudeEditor] Starting text insertion process');

        // Only proceed if we're on Claude
        if (window.InjectionTargetsOnWebsite.activeSite !== 'Claude') {
            logConCgp('[ClaudeEditor] Not on Claude site, aborting');
            return false;
        }

        // Find the editor element using SelectorGuard
        const editorElement = await this.findEditorElement();
        if (!editorElement) {
            logConCgp('[ClaudeEditor] Editor element not found');
            // Toast handled by SelectorGuard
            return false;
        }

        // Get the current state of the editor
        const editorState = this.analyzeEditorState(editorElement);
        logConCgp('[ClaudeEditor] Editor state:', editorState);

        // Try to insert text based on editor state
        return this.performTextInsertion(editorElement, textToInsert, editorState);
    },

    /**
     * Finds the editor element in the DOM
     * @returns {Element|null} - The found editor element or null
     */
    findEditorElement: async function () {
        logConCgp('[ClaudeEditor] Searching for editor element using SelectorGuard');
        return await window.OneClickPromptsSelectorGuard.findEditor();
    },

    /**
     * Analyzes the current state of the editor
     * @param {Element} editorElement - The editor element to analyze
     * @returns {Object} - Object containing editor state information
     */
    analyzeEditorState: function (editorElement) {
        const state = {
            hasPlaceholder: false,
            isEmpty: true,
            hasExistingText: false,
            isEditable: false,
            elementType: ''
        };

        try {
            // Check if element is actually editable
            state.isEditable = editorElement.getAttribute('contenteditable') === 'true';

            // Determine element type
            state.elementType = editorElement.classList.contains('ProseMirror') ? 'prosemirror' : 'standard';

            // Check for placeholder
            const paragraphElement = editorElement.querySelector('p');
            if (paragraphElement) {
                state.hasPlaceholder = paragraphElement.classList.contains('is-empty') ||
                    paragraphElement.classList.contains('is-editor-empty');

                // Check content
                const textContent = paragraphElement.textContent.trim();
                state.isEmpty = !textContent;
                state.hasExistingText = !!textContent;
            }

            logConCgp('[ClaudeEditor] Editor state analysis:', state);
        } catch (error) {
            logConCgp('[ClaudeEditor] Error analyzing editor state:', error);
            showToast('Error preparing editor for text.', 'error');
        }

        return state;
    },

    /**
     * Performs the actual text insertion based on editor state
     * @param {Element} editorElement - The editor element
     * @param {string} textToInsert - The text to insert
     * @param {Object} editorState - The current editor state
     * @returns {boolean} - Whether the insertion was successful
     */
    performTextInsertion: function (editorElement, textToInsert, editorState) {
        logConCgp('[ClaudeEditor] Attempting text insertion');

        try {
            if (editorState.elementType === 'prosemirror') {
                return this.handleProseMirrorInsertion(editorElement, textToInsert, editorState);
            } else {
                return this.handleStandardInsertion(editorElement, textToInsert, editorState);
            }
        } catch (error) {
            logConCgp('[ClaudeEditor] Error during text insertion:', error);
            showToast('Failed to insert text.', 'error');
            return false;
        }
    },

    /**
     * Handles text insertion for ProseMirror editor
     * @param {Element} editorElement - The ProseMirror editor element
     * @param {string} textToInsert - The text to insert
     * @param {Object} editorState - The current editor state
     * @returns {boolean} - Whether the insertion was successful
     */
    handleProseMirrorInsertion: function (editorElement, textToInsert, editorState) {
        logConCgp('[ClaudeEditor] Handling ProseMirror insertion');

        try {
            // Focus the editor
            editorElement.focus();

            // If editor has placeholder, clear it
            if (editorState.hasPlaceholder || editorState.isEmpty) {
                logConCgp('[ClaudeEditor] Editor is empty or has placeholder, initializing content');
                editorElement.innerHTML = '<p><br></p>';
            }

            // Insert text into the editor
            return this.insertTextIntoParagraph(editorElement, textToInsert);
        } catch (error) {
            logConCgp('[ClaudeEditor] Error in ProseMirror insertion:', error);
            showToast('Failed to insert text.', 'error');
            return false;
        }
    },

    /**
     * Handles text insertion for standard contenteditable elements
     * @param {Element} editorElement - The editor element
     * @param {string} textToInsert - The text to insert
     * @param {Object} editorState - The current editor state
     * @returns {boolean} - Whether the insertion was successful
     */
    handleStandardInsertion: function (editorElement, textToInsert, editorState) {
        logConCgp('[ClaudeEditor] Handling standard insertion');

        try {
            const paragraph = editorElement.querySelector('p') || editorElement;

            // Clear placeholder if present
            if (editorState.hasPlaceholder) {
                logConCgp('[ClaudeEditor] Clearing placeholder');
                paragraph.innerHTML = '';
            }

            // Insert the text
            const textNode = document.createTextNode(textToInsert);
            paragraph.appendChild(textNode);

            logConCgp('[ClaudeEditor] Text inserted successfully');
            return true;
        } catch (error) {
            logConCgp('[ClaudeEditor] Error in standard insertion:', error);
            showToast('Failed to insert text.', 'error');
            return false;
        }
    },

    /**
     * Inserts text into the editor, handling both empty and non-empty cases
     * @param {Element} editorElement - The editor element
     * @param {string} textToInsert - The text to insert
     * @returns {boolean} - Whether the insertion was successful
     */
    insertTextIntoParagraph: function (editorElement, textToInsert) {
        try {
            // Focus the editor
            editorElement.focus();

            const selection = window.getSelection();
            selection.removeAllRanges();
            const range = document.createRange();

            // Check if the editor is empty
            if (editorElement.textContent.trim() === '') {
                // Editor is empty, create a new paragraph
                const newParagraph = document.createElement('p');
                editorElement.appendChild(newParagraph);
                range.setStart(newParagraph, 0);
            } else {
                // Editor has content, append text to last paragraph

                // Find the last paragraph element
                const paragraphs = editorElement.querySelectorAll('p');
                let lastParagraph;
                if (paragraphs.length > 0) {
                    lastParagraph = paragraphs[paragraphs.length - 1];
                } else {
                    // If no paragraphs, create one
                    lastParagraph = document.createElement('p');
                    editorElement.appendChild(lastParagraph);
                }

                // Set the selection to the end of the last paragraph
                range.selectNodeContents(lastParagraph);
                range.collapse(false);
            }

            selection.addRange(range);

            // Use execCommand to insert text at the cursor position
            document.execCommand('insertText', false, textToInsert);

            // Dispatch input event to notify editor of changes
            editorElement.dispatchEvent(new Event('input', { bubbles: true }));

            logConCgp('[ClaudeEditor] Text inserted successfully');
            return true;
        } catch (error) {
            logConCgp('[ClaudeEditor] Error inserting text:', error);
            showToast('Failed to insert text.', 'error');
            return false;
        }
    }
};
