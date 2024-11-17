// buttons-clicking-copilot.js
// This file is a dependency for buttons.js. It provides functions to handle the send button clicking process for Copilot.
'use strict';

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

