/* buttons.js
   Version: 1.0

   Documentation:

   This file is a dependency. Desinged to host helper functions for init.js. Manages the creation and functionality of custom send buttons within the ChatGPT extension.
   It provides utility functions to create buttons based on configuration and assigns keyboard shortcuts where applicable.

   Functions:
   - createCustomSendButton: Creates a custom send button based on provided configuration.
   - determineShortcutKeyForButtonIndex: Assigns a shortcut key to a button based on its index.

   Usage:
   Ensure that `buttons-init.js` and `init.js` are loaded before this script to utilize button functionalities.
   This script should be included in the `content_scripts` section of the manifest to be injected into the target pages.
   
   Depends on:
   utils.js - object containting all selectors and identifiers
   buttons-init.js - handles only some initializations.

   Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS. This one too! */
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

// #region clickingbuttons - entry

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


    // Invert autoSend if Shift key is pressed during the click
    if (event.shiftKey) {
        autoSend = !autoSend;
        logConCgp('[buttons] Shift key detected. autoSend inverted to:', autoSend);
    }
    // Get the active site from the injection targets
    const activeSite = window.InjectionTargetsOnWebsite.activeSite;
    logConCgp('[buttons] Active site:', activeSite);

    // Handle different sites
    switch (activeSite) {
        case 'Claude':
            handleClaudeSite(customText, autoSend);
            break;
        case 'ChatGPT':
            processChatGPTCustomSendButtonClick(event, customText, autoSend);
            break;
        case 'Copilot':
            processCopilotCustomSendButtonClick(event, customText, autoSend);
            break;
        default:
            logConCgp('[buttons] Unsupported site:', activeSite);
    }
}

// #endregion

// #region ChatGPT
// endregion
function processChatGPTCustomSendButtonClick(event, customText, autoSend) {
    // Prevent default button behavior
    event.preventDefault();
    logConCgp('[buttons] Custom send button was clicked.');

    const editorSelectors = window.InjectionTargetsOnWebsite.selectors.editors;
    let editorArea = null;

    // Iterate through editor selectors to find the editor area
    editorSelectors.forEach((selector) => {
        const foundEditor = document.querySelector(selector);
        if (foundEditor && !editorArea) {
            editorArea = foundEditor;
            logConCgp('[buttons] Editor area found:', editorArea);
        }
    });

    // If editor area is not found, log and exit the function
    if (!editorArea) {
        logConCgp('[buttons] Editor area not found. Unable to proceed.');
        return;
    }

    /**
     * Locates all send buttons based on the provided selectors.
     * @returns {HTMLElement[]} Array of found send button elements.
     */
    function locateSendButtons() {
        const sendButtonSelectors = window.InjectionTargetsOnWebsite.selectors.sendButtons;
        const sendButtons = [];

        // Iterate through send button selectors to find all matching buttons
        sendButtonSelectors.forEach((selector) => {
            const button = document.querySelector(selector);
            if (button) {
                logConCgp('[buttons] Send button located using selector:', selector);
                sendButtons.push(button);
            }
        });

        if (sendButtons.length === 0) {
            logConCgp('[buttons] Send buttons not found using dynamic selectors.');
        }

        return sendButtons;
    }

    // Locate send buttons initially
    let originalSendButtons = locateSendButtons();

    // If no send buttons are found, set up a MutationObserver to detect them
    if (originalSendButtons.length === 0) {
        logConCgp('[buttons] Send buttons not found initially. Setting up MutationObserver to detect them.');

        const observer = new MutationObserver((mutations, obs) => {
            originalSendButtons = locateSendButtons();
            if (originalSendButtons.length > 0) {
                handleSendButtons(originalSendButtons);
                obs.disconnect();
                logConCgp('[buttons] Send buttons detected and observer disconnected.');
            } else {
                logConCgp('[buttons] MutationObserver detected changes, but send buttons still not found.');
            }
        });

        // Start observing the DOM for changes to detect send buttons
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    } else {
        // If send buttons are found, handle them immediately
        handleSendButtons(originalSendButtons);
    }

    /**
     * Handles the send buttons by inserting text and initiating auto-send if enabled.
     * @param {HTMLElement[]} sendButtons - Array of send button elements.
     */
    function handleSendButtons(sendButtons) {
        if (sendButtons.length > 0) {
            logConCgp('[buttons] Send buttons are available. Proceeding with sending message.');

            // Retrieve existing text in the editor
            const existingText = editorArea.innerText;
            logConCgp('[buttons] Current text in editor:', existingText);

            // Concatenate existing text with custom text exactly as provided
            const newText = `${existingText}${customText}`;
            logConCgp('[buttons] Combined text to be inserted:', newText);

            // Insert the new text into the editor
            MaxExtensionUtils.insertTextIntoEditor(editorArea, newText);

            // Move cursor to the end after insertion
            MaxExtensionUtils.moveCursorToEnd(editorArea);

            // Check if auto-send is enabled both globally and for this button
            if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
                logConCgp('[buttons] Auto-send is enabled. Starting auto-send process.');

                // Start the auto-send process
                startAutoSend(sendButtons, editorArea);
            } else {
                logConCgp('[buttons] Auto-send is disabled. Message will not be sent automatically.');
            }
        } else {
            logConCgp('[buttons] Send buttons are not available to handle.');
        }
    }

    /**
     * Starts the auto-send interval to automatically click send buttons until the editor is empty.
     * @param {HTMLElement[]} sendButtons - Array of send button elements.
     * @param {HTMLElement} editor - The editor area element.
     */
    function startAutoSend(sendButtons, editor) {
        // Prevent multiple auto-send intervals from running simultaneously
        if (window.autoSendInterval) {
            logConCgp('[auto-send] Auto-send is already running. Skipping initiation.');
            return;
        }

        logConCgp('[auto-send] Starting auto-send interval to click send buttons every 100ms.');

        window.autoSendInterval = setInterval(() => {
            const currentText = editor.innerText.trim();
            logConCgp('[auto-send] Current text in editor:', currentText);

            // If editor is empty, stop the auto-send interval
            if (currentText.length === 0) {
                logConCgp('[auto-send] Editor is empty. Stopping auto-send interval.');
                clearInterval(window.autoSendInterval);
                window.autoSendInterval = null;
                return;
            }

            // Attempt to locate send buttons again in case they have changed
            const updatedSendButtons = locateSendButtons();

            if (updatedSendButtons.length === 0) {
                logConCgp('[auto-send] Send buttons not found during auto-send. Stopping auto-send interval.');
                clearInterval(window.autoSendInterval);
                window.autoSendInterval = null;
                return;
            }

            // Click each send button found
            updatedSendButtons.forEach((sendButton, index) => {
                if (sendButton) {
                    logConCgp(`[auto-send] Clicking send button ${index + 1}:`, sendButton);
                    MaxExtensionUtils.simulateClick(sendButton);
                    logConCgp('[auto-send] Send button clicked successfully.');

                    // After a successful click, assume the message is sent and stop auto-send
                    clearInterval(window.autoSendInterval);
                    window.autoSendInterval = null;
                    logConCgp('[auto-send] Auto-send interval stopped after successful send.');
                } else {
                    logConCgp('[auto-send] Send button not found during auto-send.');
                }
            });
        }, 100); // Interval set to 100 milliseconds
    }
}

// #endregion
// #region Copilot-Only-Fucntions

function processCopilotCustomSendButtonClick(event, customText, autoSend) {
    // Prevent default button behavior
    event.preventDefault();
    logConCgp('[buttons] Custom send button was clicked.');

    const injectionTargets = new InjectionTargetsOnWebsite();
    const editorSelectors = injectionTargets.selectors.editors;
    let editorArea = null;

    // Iterate through editor selectors to find the editor area
    for (const selector of editorSelectors) {
        const foundEditor = document.querySelector(selector);
        if (foundEditor) {
            editorArea = foundEditor;
            logConCgp('[buttons] Editor area found:', editorArea);
            break;
        }
    }

    // If editor area is not found, log and exit the function
    if (!editorArea) {
        logConCgp('[buttons] Editor area not found. Unable to proceed.');
        return;
    }

    /**
     * Determines if the editor is in its initial state (only placeholder text).
     * @param {HTMLElement} element - The editor element.
     * @returns {boolean} - True if in initial state, false otherwise.
     */
    function isEditorInInitialState(element) {
        const placeholder = element.getAttribute('placeholder') || '';
        const currentValue = element.value || '';
        const isInitial = currentValue.trim() === '';
        logConCgp('[buttons] Editor initial state check:', isInitial);
        return isInitial;
    }

    /**
     * Sets the value of the editor directly without simulating user events.
     * @param {HTMLElement} element - The editor element.
     * @param {string} text - The text to insert.
     */
    function setEditorValueDirectly(element, text) {
        // Focus the editor to mimic user interaction
        element.focus();
        logConCgp('[buttons] Editor focused for setting value directly.');

        // Use the native value setter to update the value property
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(element),
            'value'
        ).set;
        nativeInputValueSetter.call(element, text);
        logConCgp('[buttons] Native setter called with text:', text);

        // Dispatch input event for React (or similar) to recognize the change
        const inputEvent = new Event('input', { bubbles: true });
        element.dispatchEvent(inputEvent);
        logConCgp('[buttons] Input event dispatched after setting value directly.');

        // Additionally, dispatch change event to cover more frameworks
        const changeEvent = new Event('change', { bubbles: true });
        element.dispatchEvent(changeEvent);
        logConCgp('[buttons] Change event dispatched after setting value directly.');
    }

    /**
     * Locates all send buttons based on the provided selectors.
     * @returns {HTMLElement[]} Array of found send button elements.
     */
    function locateSendButtons() {
        const sendButtonSelectors = injectionTargets.selectors.sendButtons;
        const sendButtons = [];

        // Iterate through send button selectors to find all matching buttons
        sendButtonSelectors.forEach((selector) => {
            const button = document.querySelector(selector);
            if (button) {
                logConCgp('[buttons] Send button located using selector:', selector);
                sendButtons.push(button);
            }
        });

        if (sendButtons.length === 0) {
            logConCgp('[buttons] Send buttons not found using dynamic selectors.');
        }

        return sendButtons;
    }

    // Locate send buttons initially
    let originalSendButtons = locateSendButtons();

    /**
     * Handles the send buttons by inserting text and initiating auto-send if enabled.
     * @param {HTMLElement[]} sendButtons - Array of send button elements.
     */
    function handleSendButtons(sendButtons) {
        if (sendButtons.length > 0) {
            logConCgp('[buttons] Send buttons are available. Proceeding with sending message.');

            // Retrieve existing text in the editor
            const existingText = editorArea.value || ''; // Use 'value' instead of 'innerText'
            logConCgp('[buttons] Current text in editor:', existingText);

            // Concatenate existing text with custom text exactly as provided
            const newText = `${existingText}${customText}`;
            logConCgp('[buttons] Combined text to be inserted:', newText);

            // Insert the new text into the editor
            setEditorValueDirectly(editorArea, newText);

            // Move cursor to the end after insertion
            if (typeof editorArea.setSelectionRange === 'function') {
                editorArea.setSelectionRange(newText.length, newText.length);
                logConCgp('[buttons] Cursor moved to the end of the editor.');
            } else {
                logConCgp('[buttons] setSelectionRange is not supported on this editor.');
            }

            // Check if auto-send is enabled both globally and for this button
            if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
                logConCgp('[buttons] Auto-send is enabled. Starting auto-send process.');

                // Start the auto-send process
                startAutoSend(sendButtons, editorArea);
            } else {
                logConCgp('[buttons] Auto-send is disabled. Message will not be sent automatically.');
            }
        } else {
            logConCgp('[buttons] Send buttons are not available to handle.');
        }
    }

    /**
     * Starts the auto-send interval to automatically click send buttons until the editor is empty.
     * @param {HTMLElement[]} sendButtons - Array of send button elements.
     * @param {HTMLElement} editor - The editor area element.
     */
    function startAutoSend(sendButtons, editor) {
        // Prevent multiple auto-send intervals from running simultaneously
        if (window.autoSendInterval) {
            logConCgp('[auto-send] Auto-send is already running. Skipping initiation.');
            return;
        }

        logConCgp('[auto-send] Starting auto-send interval to click send buttons every 100ms.');

        window.autoSendInterval = setInterval(() => {
            const currentText = editor.value.trim(); // Use 'value' instead of 'innerText'
            logConCgp('[auto-send] Current text in editor:', currentText);

            // If editor is empty, stop the auto-send interval
            if (currentText.length === 0) {
                logConCgp('[auto-send] Editor is empty. Stopping auto-send interval.');
                clearInterval(window.autoSendInterval);
                window.autoSendInterval = null;
                return;
            }

            // Attempt to locate send buttons again in case they have changed
            const updatedSendButtons = locateSendButtons();

            if (updatedSendButtons.length === 0) {
                logConCgp('[auto-send] Send buttons not found during auto-send. Stopping auto-send interval.');
                clearInterval(window.autoSendInterval);
                window.autoSendInterval = null;
                return;
            }

            // Click each send button found
            updatedSendButtons.forEach((sendButton, index) => {
                if (sendButton) {
                    logConCgp(`[auto-send] Clicking send button ${index + 1}:`, sendButton);
                    sendButton.click(); // Trigger the click event
                    logConCgp('[auto-send] Send button clicked successfully.');

                    // After a successful click, assume the message is sent and stop auto-send
                    clearInterval(window.autoSendInterval);
                    window.autoSendInterval = null;
                    logConCgp('[auto-send] Auto-send interval stopped after successful send.');
                } else {
                    logConCgp('[auto-send] Send button not found during auto-send.');
                }
            });
        }, 100); // Interval set to 100 milliseconds
    }

    /**
     * Sets the value of the editor in a way that React recognizes.
     * @param {HTMLElement} element - The editor element.
     * @param {string} text - The text to insert.
     */
    function setEditorValue(element, text) {
        // Focus the editor to mimic user interaction
        element.focus();
        logConCgp('[buttons] Editor focused for setting value.');
    
        // Use the native value setter to update the value property
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(element),
            'value'
        ).set;
        nativeInputValueSetter.call(element, text);
        logConCgp('[buttons] Native setter called with text:', text);
    
        // Dispatch input event for React (or similar) to recognize the change
        const inputEvent = new Event('input', { bubbles: true });
        element.dispatchEvent(inputEvent);
        logConCgp('[buttons] Input event dispatched after setting value.');
    
        // Additionally, dispatch change event to cover more frameworks
        const changeEvent = new Event('change', { bubbles: true });
        element.dispatchEvent(changeEvent);
        logConCgp('[buttons] Change event dispatched after setting value.');
    }

    /**
     * Handles the entire process of inserting text and sending the message.
     * This includes state detection, direct text insertion, and send button handling.
     */
    function handleMessageInsertion() {
        const initialState = isEditorInInitialState(editorArea);

        if (initialState) {
            logConCgp('[buttons] Editor is in initial state. Inserting custom text directly.');

            // Insert custom text directly to transition the editor to active state
            setEditorValueDirectly(editorArea, customText);

            // Move cursor to the end after insertion
            if (typeof editorArea.setSelectionRange === 'function') {
                editorArea.setSelectionRange(customText.length, customText.length);
                logConCgp('[buttons] Cursor moved to the end of the editor after direct insertion.');
            } else {
                logConCgp('[buttons] setSelectionRange is not supported on this editor after direct insertion.');
            }

            // Locate send buttons after insertion
            originalSendButtons = locateSendButtons();

            if (originalSendButtons.length === 0) {
                // If send buttons are still not found, set up a MutationObserver
                logConCgp('[buttons] Send buttons not found after direct insertion. Setting up MutationObserver.');
                const observer = new MutationObserver((mutations, obs) => {
                    originalSendButtons = locateSendButtons();
                    if (originalSendButtons.length > 0) {
                        handleSendButtons(originalSendButtons);
                        obs.disconnect();
                        logConCgp('[buttons] Send buttons detected and observer disconnected.');
                    } else {
                        logConCgp('[buttons] MutationObserver detected changes, but send buttons still not found.');
                    }
                });

                // Start observing the DOM for changes to detect send buttons
                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            } else {
                // If send buttons are found after insertion, handle them
                handleSendButtons(originalSendButtons);
            }
        } else {
            logConCgp('[buttons] Editor is already in active state. Proceeding with existing logic.');
            handleSendButtons(originalSendButtons);
        }
    }

    // Start the message insertion and sending process
    handleMessageInsertion();
}


// #endregion

// #region Claude-Only-Fucntions



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
// #endregion