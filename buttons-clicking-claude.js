// buttons-clicking-claude.js
// This file is a dependency for buttons.js. It provides functions to handle the send button clicking process for Claude.

/**
 * Handles text insertion and sending for Claude site
 * @param {string} customText - The text to insert
 * @param {boolean} autoSend - Whether to auto-send the message
 */
function handleClaudeSite(customText, autoSend) {
    logConCgp('[Claude] Starting Claude-specific handling');

    // First try to insert the text
    const insertionSuccessful = ClaudeEditorUtils.insertTextIntoClaudeEditor(customText);

    if (!insertionSuccessful) {
        logConCgp('[Claude] Text insertion failed');
        return;
    }

    // If auto-send is enabled, handle the send process
    if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
        logConCgp('[Claude] Auto-send enabled, attempting to send message');
        handleClaudeSend();
    }
}

/**
 * Handles the send button clicking process for Claude
 */
function handleClaudeSend() {
    // Add timeout and attempt counter for finding send button
    let attempts = 0;
    const MAX_ATTEMPTS = 50;
    const TIMEOUT_DURATION = 5000;
    let timeoutId;

    function findClaudeSendButton() {
        // Common selectors for Claude send buttons
        const sendButtonSelectors = window.InjectionTargetsOnWebsite.selectors.sendButtons;

        for (const selector of sendButtonSelectors) {
            const button = document.querySelector(selector);
            if (button) {
                logConCgp('[Claude] Found send button using selector:', selector);
                return button;
            }
        }
        return null;
    }

    // First immediate attempt
    const sendButton = findClaudeSendButton();
    if (sendButton) {
        logConCgp('[Claude] Send button found immediately, delaying click by 200ms');
        setTimeout(() => {
            MaxExtensionUtils.simulateClick(sendButton);
            logConCgp('[Claude] Send button clicked after 200ms delay');
        }, 200);
        return;
    }

    // If not found, set up observer
    logConCgp('[Claude] Send button not found immediately, setting up observer');

    const observer = new MutationObserver((mutations, obs) => {
        attempts++;
        const sendButton = findClaudeSendButton();

        if (sendButton) {
            clearTimeout(timeoutId);
            obs.disconnect();
            logConCgp('[Claude] Send button found after observation, delaying click by 200ms');
            setTimeout(() => {
                MaxExtensionUtils.simulateClick(sendButton);
                logConCgp('[Claude] Send button clicked after 200ms delay');
            }, 200);
        } else if (attempts >= MAX_ATTEMPTS) {
            clearTimeout(timeoutId);
            obs.disconnect();
            logConCgp('[Claude] Maximum attempts reached without finding send button');
        } else {
            logConCgp(`[Claude] Attempt ${attempts}/${MAX_ATTEMPTS}: Send button not found yet`);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    timeoutId = setTimeout(() => {
        observer.disconnect();
        logConCgp('[Claude] Timeout reached without finding send button');
    }, TIMEOUT_DURATION);
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
    insertTextIntoClaudeEditor: function (textToInsert) {
        logConCgp('[ClaudeEditor] Starting text insertion process');

        // Only proceed if we're on Claude
        if (window.InjectionTargetsOnWebsite.activeSite !== 'Claude') {
            logConCgp('[ClaudeEditor] Not on Claude site, aborting');
            return false;
        }

        // Find the editor element
        const editorElement = this.findEditorElement();
        if (!editorElement) {
            logConCgp('[ClaudeEditor] Editor element not found');
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
    findEditorElement: function () {
        logConCgp('[ClaudeEditor] Searching for editor element');

        // First try to find the ProseMirror editor
        const proseMirrorEditor = document.querySelector('div.ProseMirror[contenteditable="true"]');
        if (proseMirrorEditor) {
            logConCgp('[ClaudeEditor] Found ProseMirror editor');
            return proseMirrorEditor;
        }

        // Fallback to other possible editor selectors
        const fallbackSelectors = [
            'div[aria-label="Write your prompt to Claude"] div[contenteditable="true"]',
            'div[aria-label="Chat input"] div[contenteditable="true"]',
            // Add more selectors if needed
        ];

        for (const selector of fallbackSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                logConCgp('[ClaudeEditor] Found editor using fallback selector:', selector);
                return element;
            }
        }

        logConCgp('[ClaudeEditor] No editor element found');
        return null;
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
            // If editor has placeholder, we need to focus it first
            if (editorState.hasPlaceholder) {
                logConCgp('[ClaudeEditor] Editor has placeholder, focusing first');
                editorElement.focus();

                // Small delay to allow focus to take effect
                setTimeout(() => {
                    this.insertTextIntoParagraph(editorElement, textToInsert);
                }, 50);
                return true;
            }

            // If editor has existing text, append to it
            if (editorState.hasExistingText) {
                logConCgp('[ClaudeEditor] Appending to existing text');
                return this.insertTextIntoParagraph(editorElement, textToInsert);
            }

            // Empty editor without placeholder
            logConCgp('[ClaudeEditor] Inserting into empty editor');
            return this.insertTextIntoParagraph(editorElement, textToInsert);
        } catch (error) {
            logConCgp('[ClaudeEditor] Error in ProseMirror insertion:', error);
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
            return false;
        }
    },

    /**
     * Inserts text into a paragraph element
     * @param {Element} editorElement - The editor element containing the paragraph
     * @param {string} textToInsert - The text to insert
     * @returns {boolean} - Whether the insertion was successful
     */
    insertTextIntoParagraph: function (editorElement, textToInsert) {
        try {
            // Focus the editor
            editorElement.focus();

            // Create a range and set it to the end of the editor content
            const selection = window.getSelection();
            selection.removeAllRanges();
            const range = document.createRange();
            range.selectNodeContents(editorElement);
            range.collapse(false);
            selection.addRange(range);

            // Create a text node with the text to insert
            const textNode = document.createTextNode(textToInsert);

            // Insert the text node at the cursor position
            range.insertNode(textNode);

            // Move the cursor after the inserted text
            range.setStartAfter(textNode);
            selection.removeAllRanges();
            selection.addRange(range);

            // Dispatch input event to notify editor of changes
            editorElement.dispatchEvent(new Event('input', { bubbles: true }));

            logConCgp('[ClaudeEditor] Text inserted at cursor position successfully');
            return true;
        } catch (error) {
            logConCgp('[ClaudeEditor] Error inserting text at cursor position:', error);
            return false;
        }
    }
};
