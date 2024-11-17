// buttons.js
// Version: 1.0
//
// Documentation:
// This file manages the creation and functionality of custom send buttons within the ChatGPT extension.
// It provides utility functions to create buttons based on configuration and assigns keyboard shortcuts where applicable.
//
// Functions:
// - createCustomSendButton: Creates a custom send button based on provided configuration.
// - determineShortcutKeyForButtonIndex: Assigns a shortcut key to a button based on its index.
//
// Usage:
// Ensure that `buttons-init.js` and `init.js` are loaded before this script to utilize button functionalities.
// This script should be included in the `content_scripts` section of the manifest to be injected into the target pages.
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS. This one too!
'use strict';

/**
 * Namespace object containing functions related to creating and managing custom buttons.
 */
window.MaxExtensionButtons = {
    /**
     * Creates a custom send button based on the provided configuration.
     * @param {Object} buttonConfig - The configuration object for the custom button.
     * @param {number} buttonIndex - The index of the button in the custom buttons array.
     * @param {Function} onClickHandler - The function to handle the button's click event.
     * @returns {HTMLButtonElement} - The newly created custom send button element.
     */
    createCustomSendButton: function (buttonConfig, buttonIndex, onClickHandler) {
        const customButtonElement = document.createElement('button');
        customButtonElement.innerHTML = buttonConfig.icon;
        customButtonElement.setAttribute('data-testid', `custom-send-button-${buttonIndex}`);

        // Assign keyboard shortcuts to the first 10 non-separator buttons if shortcuts are enabled
        let assignedShortcutKey = null;
        if (globalMaxExtensionConfig.enableShortcuts) {
            assignedShortcutKey = this.determineShortcutKeyForButtonIndex(buttonIndex);
            if (assignedShortcutKey !== null) {
                customButtonElement.dataset.shortcutKey = assignedShortcutKey.toString();
            }
        }

        const shortcutDescription = assignedShortcutKey !== null ? ` (Shortcut: Alt+${assignedShortcutKey})` : '';
        customButtonElement.setAttribute('title', `${buttonConfig.text}${shortcutDescription}`);

        customButtonElement.style.cssText = `
            background-color: transparent;
            border: none;
            cursor: pointer;
            padding: 1px;
            font-size: 20px;
            margin-right: 5px;
            margin-bottom: 5px;
        `;

        // Attach the click event listener to handle custom send actions
        customButtonElement.addEventListener('click', (event) => onClickHandler(event, buttonConfig.text, buttonConfig.autoSend));

        return customButtonElement;
    },

    /**
     * Determines the appropriate shortcut key for a button based on its index, skipping separator buttons.
     * @param {number} buttonIndex - The index of the button in the custom buttons array.
     * @returns {number|null} - The assigned shortcut key (1-10) or null if no shortcut is assigned.
     */
    determineShortcutKeyForButtonIndex: function (buttonIndex) {
        let shortcutAssignmentCount = 0;
        for (let i = 0; i < globalMaxExtensionConfig.customButtons.length; i++) {
            if (!globalMaxExtensionConfig.customButtons[i].separator) {
                shortcutAssignmentCount++;
                if (i === buttonIndex && shortcutAssignmentCount <= 10) {
                    return shortcutAssignmentCount % 10; // 0 represents 10
                }
            }
        }
        return null;
    }
};

/**
 * Handles the click event on a custom send button.
 * @param {Event} event - The click event object.
 * @param {string} customText - The custom text to be inserted.
 * @param {boolean} autoSend - Flag indicating whether to automatically send the message.
 */
'use strict';

/**
 * Handles click events on custom send buttons across different supported sites.
 * Orchestrates different text insertion and send strategies based on the active site.
 * @param {Event} event - The click event object
 * @param {string} customText - The custom text to be inserted
 * @param {boolean} autoSend - Flag indicating whether to automatically send the message
 */
function processCustomSendButtonClick(event, customText, autoSend) {
    event.preventDefault();
    logConCgp('[buttons] Custom send button clicked');
    
    // Get the active site from the injection targets
    const activeSite = window.InjectionTargetsOnWebsite.activeSite;
    logConCgp('[buttons] Active site:', activeSite);

    // Handle different sites
    switch (activeSite) {
        case 'Claude':
            handleClaudeSite(customText, autoSend);
            break;
        default:
            handleDefaultSite(customText, autoSend);
    }
}

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
        logConCgp('[Claude] Send button found immediately, clicking');
        MaxExtensionUtils.simulateClick(sendButton);
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
            logConCgp('[Claude] Send button found after observation, clicking');
            MaxExtensionUtils.simulateClick(sendButton);
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
 * Handles text insertion and sending for non-Claude sites (legacy behavior)
 * @param {string} customText - The text to insert
 * @param {boolean} autoSend - Whether to auto-send the message
 */
function handleDefaultSite(customText, autoSend) {
    logConCgp('[Default] Using legacy handling for non-Claude site');

    const editorSelectors = window.InjectionTargetsOnWebsite.selectors.editors;
    let editorArea = null;

    // Find editor using provided selectors
    editorSelectors.forEach((selector) => {
        const foundEditor = document.querySelector(selector);
        if (foundEditor && !editorArea) {
            editorArea = foundEditor;
            logConCgp('[Default] Editor area found:', editorArea);
        }
    });

    if (!editorArea) {
        logConCgp('[Default] Editor area not found. Unable to proceed.');
        return;
    }

    // Legacy send button handling
    function locateSendButtons() {
        const sendButtonSelectors = window.InjectionTargetsOnWebsite.selectors.sendButtons;
        const sendButtons = [];

        sendButtonSelectors.forEach((selector) => {
            const button = document.querySelector(selector);
            if (button) {
                logConCgp('[Default] Send button located using selector:', selector);
                sendButtons.push(button);
            }
        });

        if (sendButtons.length === 0) {
            logConCgp('[Default] Send buttons not found using dynamic selectors.');
        }

        return sendButtons;
    }

    // Handle text insertion and optional auto-send
    const existingText = editorArea.innerText;
    const newText = `${existingText}${customText}`;
    
    MaxExtensionUtils.insertTextIntoEditor(editorArea, newText);
    MaxExtensionUtils.moveCursorToEnd(editorArea);

    if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
        const sendButtons = locateSendButtons();
        if (sendButtons.length > 0) {
            logConCgp('[Default] Send buttons found, starting auto-send');
            startLegacyAutoSend(sendButtons, editorArea);
        }
    }
}

/**
 * Legacy auto-send function for non-Claude sites
 * @param {Element[]} sendButtons - Array of send button elements
 * @param {Element} editor - The editor element
 */
function startLegacyAutoSend(sendButtons, editor) {
    if (window.autoSendInterval) {
        logConCgp('[Default] Auto-send is already running. Skipping.');
        return;
    }

    let autoSendAttempts = 0;
    const MAX_AUTO_SEND_ATTEMPTS = 50;

    window.autoSendInterval = setInterval(() => {
        autoSendAttempts++;
        const currentText = editor.innerText.trim();

        if (currentText.length === 0 || autoSendAttempts >= MAX_AUTO_SEND_ATTEMPTS) {
            logConCgp('[Default] Stopping auto-send: ' + 
                (currentText.length === 0 ? 'Editor is empty.' : 'Maximum attempts reached.'));
            clearInterval(window.autoSendInterval);
            window.autoSendInterval = null;
            return;
        }

        sendButtons.forEach((sendButton, index) => {
            if (sendButton) {
                logConCgp(`[Default] Clicking send button ${index + 1}`);
                MaxExtensionUtils.simulateClick(sendButton);
                clearInterval(window.autoSendInterval);
                window.autoSendInterval = null;
            }
        });
    }, 100);
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
    insertTextIntoClaudeEditor: function(textToInsert) {
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
    findEditorElement: function() {
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
    analyzeEditorState: function(editorElement) {
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
    performTextInsertion: function(editorElement, textToInsert, editorState) {
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
    handleProseMirrorInsertion: function(editorElement, textToInsert, editorState) {
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
    handleStandardInsertion: function(editorElement, textToInsert, editorState) {
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
    insertTextIntoParagraph: function(editorElement, textToInsert) {
        try {
            // Find or create paragraph
            let paragraph = editorElement.querySelector('p');
            if (!paragraph) {
                paragraph = document.createElement('p');
                editorElement.appendChild(paragraph);
            }

            // Handle placeholder paragraph
            if (paragraph.classList.contains('is-empty') || paragraph.classList.contains('is-editor-empty')) {
                paragraph.classList.remove('is-empty', 'is-editor-empty');
                paragraph.innerHTML = '';
            }

            // Insert text
            const textNode = document.createTextNode(textToInsert);
            paragraph.appendChild(textNode);
            
            // Trigger input event to notify editor of changes
            editorElement.dispatchEvent(new Event('input', { bubbles: true }));
            
            logConCgp('[ClaudeEditor] Text inserted into paragraph successfully');
            return true;
        } catch (error) {
            logConCgp('[ClaudeEditor] Error inserting text into paragraph:', error);
            return false;
        }
    }
};
/**
 * Creates and appends custom send buttons to the specified container.
 * This function has been moved to `buttons-init.js` to enhance modularity.
 * @param {HTMLElement} container - The DOM element to which custom buttons will be appended.
 */
// Function moved to buttons-init.js
