// init.js
// Version: 1.4
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.

'use strict';

/**
 * Exposes the main function to initialize ChatGPT buttons to the global window object.
 */
window.initChatgptButtons = executeExtensionInitializationSequence;

/**
 * Initiates the retrieval of configuration data from the service worker and starts the extension.
 */
function executeExtensionInitializationSequence() {
    chrome.runtime.sendMessage({ type: 'getConfig' }, (response) => {
        if (response && response.config) {
            logConCgp('[init] Configuration successfully loaded:', response.config);
            commenceExtensionInitialization(response.config);
        } else {
            logConCgp('[init] Failed to load configuration from service worker. Initialization aborted.');
            // Handle the error appropriately, perhaps by not initializing further.
        }
    });
}

// Automatically start the initialization process upon script load
executeExtensionInitializationSequence();

/**
 * Initializes the extension using the provided configuration.
 * @param {Object} config - The configuration object retrieved from the service worker.
 */
function commenceExtensionInitialization(config) {
    window.MaxExtensionConfig = config;
    logConCgp('[init] Configuration has been applied:', config);

    /**
     * Checks whether the custom buttons modifications already exist in the DOM.
     * @returns {boolean} - True if modifications exist, false otherwise.
     */
    function doCustomModificationsExist() {
        return document.getElementById('custom-buttons-container') !== null;
    }

    /**
     * Determines the active website based on the current hostname.
     * @returns {string} - The name of the active website (e.g., 'ChatGPT', 'Claude', 'Unknown').
     */
    function identifyActiveWebsite() {
        const currentHostname = window.location.hostname;

        if (currentHostname.includes('chat.openai.com') || currentHostname.includes('chatgpt.com')) {
            return 'ChatGPT';
        } else if (currentHostname.includes('claude.ai')) {
            return 'Claude';
        } else {
            return 'Unknown';
        }
    }

    /**
     * Initializes the extension specifically for ChatGPT.
     * @param {boolean} enableResiliency - Flag to enable or disable resiliency checks.
     */
    function initializeChatGPTExtension(enableResiliency = true) {
        logConCgp('[init] Initializing ChatGPT-specific script...');
        initiateFirstInitializationSequence(enableResiliency);
    }

    /**
     * Initializes the extension specifically for Claude.
     * @param {boolean} enableResiliency - Flag to enable or disable resiliency checks.
     */
    function initializeClaudeExtension(enableResiliency = true) {
        logConCgp('[init] Initializing Claude-specific script...');
        // TODO: Implement Claude-specific initialization logic in the future.
    }

    /**
     * Handles the click event on a custom send button.
     * @param {Event} event - The click event object.
     * @param {string} customText - The custom text to be inserted.
     * @param {boolean} autoSend - Flag indicating whether to automatically send the message.
     */
    function processCustomSendButtonClick(event, customText, autoSend) {
        // Prevent default button behavior
        event.preventDefault();
        logConCgp('[init] Custom send button was clicked.');

        // Detect the editor area
        const editorArea = document.querySelector('#prompt-textarea'); // Ensure this ID is consistent
        if (editorArea) {
            logConCgp('[init] Editor area found:', editorArea);
        } else {
            logConCgp('[init] Editor area not found. Unable to proceed.');
            return;
        }

        /**
         * Attempts to locate the send button using primary and fallback selectors.
         * @returns {HTMLElement|null} - The send button element or null if not found.
         */
        function locateSendButton() {
            // Primary Selector: Language-agnostic using data-testid
            const primarySelector = 'button[data-testid="send-button"]';
            let sendButton = document.querySelector(primarySelector);
            if (sendButton) {
                logConCgp('[init] Original send button located using primary selector:', sendButton);
                return sendButton;
            }

            // Fallback Selector: Any button within the parent div that resembles a send button
            logConCgp('[init] Primary send button not found. Attempting fallback selector.');
            const parentDiv = document.querySelector('div.flex.h-[44px].items-center.justify-between');
            if (parentDiv) {
                const fallbackButtons = parentDiv.querySelectorAll('button');
                if (fallbackButtons.length > 0) {
                    // Assuming the last button is the send button; modify as needed
                    sendButton = fallbackButtons[fallbackButtons.length - 1];
                    logConCgp('[init] Fallback send button located:', sendButton);
                    return sendButton;
                } else {
                    logConCgp('[init] No buttons found within the fallback parent div.');
                }
            } else {
                logConCgp('[init] Fallback parent div not found.');
            }

            // If no button is found
            logConCgp('[init] No suitable send button found using fallback selector.');
            return null;
        }

        // Locate the send button
        let originalSendButton = locateSendButton();
        if (!originalSendButton) {
            logConCgp('[init] Send button not found initially. Setting up MutationObserver to detect it.');
        }

        /**
         * Handles the send button click logic.
         * @param {HTMLElement} sendButton - The send button element.
         */
        function handleSendButton(sendButton) {
            if (sendButton) {
                logConCgp('[init] Send button is available. Proceeding with sending message.');

                // Retrieve existing text in the editor
                const existingText = editorArea.innerText;
                logConCgp('[init] Current text in editor:', existingText);

                // Concatenate existing text with custom text exactly as provided
                const newText = `${existingText}${customText}`;
                logConCgp('[init] Combined text to be inserted:', newText);

                // Insert the new text into the editor
                MaxExtensionUtils.insertTextIntoEditor(editorArea, newText);

                // Move cursor to the end after insertion
                MaxExtensionUtils.moveCursorToEnd(editorArea);

                // Auto-send the message if global auto-send is enabled and this button's config allows it
                if (MaxExtensionConfig.globalAutoSendEnabled && autoSend) {
                    logConCgp('[init] Starting auto-send interval to click send button every 100ms until editor is empty.');

                    // Define the interval ID so it can be cleared later
                    const sendInterval = setInterval(() => {
                        const currentText = editorArea.innerText.trim();
                        logConCgp('[auto-send] Current text in editor:', currentText);

                        if (currentText.length === 0) {
                            logConCgp('[auto-send] Editor is empty. Stopping auto-send interval.');
                            clearInterval(sendInterval);
                            return;
                        }

                        // I SPENT FIVE HOURS DETECTING THAT THIS BUTTON CHANGES AND NEEDS TO BE RE-DETECTED. 
                        // do not delete above comment.
                        originalSendButton = locateSendButton();
                        if (originalSendButton) {
                            logConCgp('[init] Original send button located:', originalSendButton);
                            logConCgp('[auto-send] Attempting to click the send button.');
                            MaxExtensionUtils.simulateClick(originalSendButton);
                            logConCgp('[auto-send] Original send button was clicked automatically.');
                        } else {
                            logConCgp('[init] Original send button not found. Unable to proceed.');
                            clearInterval(sendInterval);
                        }
                    }, 100); // Interval set to 100 milliseconds
                } else {
                    logConCgp('[init] Auto-send is disabled. Message will not be sent automatically.');
                }
            } else {
                logConCgp('[init] Send button is not available to handle.');
            }
        }

        // If the send button is not found, set up a MutationObserver to detect when it appears
        if (!originalSendButton) {
            const observer = new MutationObserver((mutations, obs) => {
                originalSendButton = locateSendButton();
                if (originalSendButton) {
                    handleSendButton(originalSendButton);
                    obs.disconnect(); // Stop observing once the button is found
                    logConCgp('[init] Send button detected and observer disconnected.');
                } else {
                    logConCgp('[init] MutationObserver detected changes, but send button still not found.');
                }
            });

            // Start observing the DOM for changes
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        } else {
            // If send button is found, handle it immediately
            handleSendButton(originalSendButton);
        }
    }


    /**
     * Creates and appends toggle switches to the specified container.
     * @param {HTMLElement} container - The DOM element to which toggles will be appended.
     */
    function generateAndAppendToggles(container) {
        const autoSendToggle = MaxExtensionInterface.createToggle(
            'auto-send-toggle',
            'Enable Auto-send',
            MaxExtensionConfig.globalAutoSendEnabled,
            (state) => {
                MaxExtensionConfig.globalAutoSendEnabled = state;
            }
        );
        container.appendChild(autoSendToggle);
        logConCgp('[init] Auto-send toggle has been created and appended.');

        const hotkeysToggle = MaxExtensionInterface.createToggle(
            'hotkeys-toggle',
            'Enable Hotkeys',
            MaxExtensionConfig.enableShortcuts,
            (state) => {
                MaxExtensionConfig.enableShortcuts = state;
            }
        );
        container.appendChild(hotkeysToggle);
        logConCgp('[init] Hotkeys toggle has been created and appended.');
    }

    /**
     * Creates and appends custom send buttons to the specified container.
     * @param {HTMLElement} container - The DOM element to which custom buttons will be appended.
     */
    function generateAndAppendCustomSendButtons(container) {
        MaxExtensionConfig.customButtons.forEach((buttonConfiguration, index) => {
            if (buttonConfiguration.separator) {
                const separatorElement = MaxExtensionUtils.createSeparator();
                container.appendChild(separatorElement);
                logConCgp('[init] Separator element has been created and appended.');
            } else {
                const customSendButton = MaxExtensionButtons.createCustomSendButton(buttonConfiguration, index, processCustomSendButtonClick);
                container.appendChild(customSendButton);
                logConCgp(`[init] Custom send button ${index + 1} has been created:`, customSendButton);
            }
        });
    }

    /**
     * Handles keyboard shortcut events to trigger custom send buttons.
     * @param {KeyboardEvent} event - The keyboard event object.
     */
    function manageKeyboardShortcutEvents(event) {
        if (!MaxExtensionConfig.enableShortcuts) return;

        if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            const pressedKey = event.key === '0' ? '10' : event.key;
            const targetButton = document.querySelector(`button[data-shortcut-key="${pressedKey}"]`);
            if (targetButton) {
                event.preventDefault();
                targetButton.click();
            } else {
                logConCgp('[init] No button found for the pressed shortcut key:', pressedKey);
            }
        }
    }

    /**
     * Initiates enhanced resiliency checks to ensure the extension remains functional.
     */
    function commenceEnhancedResiliencyChecks() {
        let consecutiveClearCheckCount = 0;
        const requiredConsecutiveClearChecks = 3;
        const maximumTotalIterations = 10;
        let totalIterationsPerformed = 0;
        const intervalTimeInMilliseconds = 1000; // 1000 milliseconds

        logConCgp('[init] Beginning enhanced resiliency checks...');
        logConCgp(`[init] Requires ${requiredConsecutiveClearChecks} consecutive clear checks.`);

        const resiliencyCheckInterval = setInterval(() => {
            totalIterationsPerformed++;

            if (doCustomModificationsExist()) {
                consecutiveClearCheckCount = 0; // Reset counter if modifications are detected
                logConCgp(`[init] Existing modifications detected. Resetting consecutive clear check counter. (Iteration ${totalIterationsPerformed}/${maximumTotalIterations})`);
            } else {
                consecutiveClearCheckCount++;
                logConCgp(`[init] No modifications detected. Consecutive clear checks: ${consecutiveClearCheckCount}/${requiredConsecutiveClearChecks}`);
            }

            // Verify if the required number of consecutive clear checks has been met
            if (consecutiveClearCheckCount >= requiredConsecutiveClearChecks) {
                logConCgp('[init] Required consecutive clear checks achieved. Proceeding with initialization.');
                clearInterval(resiliencyCheckInterval);
                enforceResiliencyMeasures();
            }

            // Safety measure to prevent infinite loops
            if (totalIterationsPerformed >= maximumTotalIterations) {
                logConCgp('[init] Maximum iterations reached without achieving consecutive clear checks.');
                clearInterval(resiliencyCheckInterval);

                // Only proceed if no modifications are present at this point
                if (!doCustomModificationsExist()) {
                    logConCgp('[init] No modifications present after maximum iterations. Proceeding cautiously.');
                    enforceResiliencyMeasures();
                } else {
                    logConCgp('[init] Modifications still present after maximum iterations. Aborting initialization.');
                }
            }
        }, intervalTimeInMilliseconds);
    }

    /**
     * Enforces resiliency by re-initializing the extension without further resiliency checks.
     */
    function enforceResiliencyMeasures() {
        logConCgp('[init] Enforcing resiliency measures. Re-initializing without resiliency checks.');
        initiateFirstInitializationSequence(false);
    }

    /**
     * Creates and appends custom buttons and toggles to the target container element.
     * @param {HTMLElement} targetContainer - The DOM element where custom elements will be inserted.
     */
    function createAndInsertCustomElements(targetContainer) {
        // Prevent duplication by checking if the container already exists
        if (doCustomModificationsExist()) {
            logConCgp('[init] Custom buttons container already exists. Skipping creation.');
            return;
        }

        const customElementsContainer = document.createElement('div');
        customElementsContainer.id = 'custom-buttons-container'; // Assign a unique ID
        customElementsContainer.style.cssText = `
            display: flex;
            justify-content: flex-start;
            flex-wrap: wrap;
            gap: 8px;
            padding: 8px;
            width: 100%;
        `;

        generateAndAppendCustomSendButtons(customElementsContainer);
        generateAndAppendToggles(customElementsContainer);

        targetContainer.appendChild(customElementsContainer);
        logConCgp('[init] Custom elements have been inserted into the DOM.');
    }

    /**
     * Initializes the first sequence of the ChatGPT extension.
     * @param {boolean} enableResiliency - Flag to enable or disable resiliency checks.
     */
    function initiateFirstInitializationSequence(enableResiliency = true) {
        logConCgp('[init] Commencing extension initialization sequence...');

        if (doCustomModificationsExist() && !enableResiliency) {
            logConCgp('[init] Modifications already exist and resiliency is disabled. Skipping initialization.');
            return;
        }

        // Load the saved states of toggle switches
        MaxExtensionInterface.loadToggleStates();
        logConCgp('[init] Toggle states have been loaded.');

        // Initialize the shared flag
        let targetFound = false;

        // Define both selectors to wait for
        const selector1 = 'div.flex.w-full.flex-col:has(textarea)';
        // Define a unified callback function
        const handleTargetDiv = (targetDiv) => {
            if (!targetFound) {
                targetFound = true; // Set the flag to prevent other callbacks from executing
                logConCgp('[init] Target div has been found:', targetDiv);
                createAndInsertCustomElements(targetDiv);
                
                // Initiate resiliency checks only after the first successful modification
                if (!MaxExtensionConfig.firstModificationCompleted && enableResiliency) {
                    MaxExtensionConfig.firstModificationCompleted = true;
                    logConCgp('[init] First modification complete. Starting resiliency checks.');
                    commenceEnhancedResiliencyChecks();
                }
            }
        };

        // Issue the first waitForElement call
        MaxExtensionUtils.waitForElement(selector1, handleTargetDiv);
    }

    /**
     * Selects the correct initialization path based on the active website.
     */
    function selectAndInitializeAppropriateExtensionScript() {
        logConCgp('[init] InitScript invoked. Detecting active website...');
        const activeWebsite = identifyActiveWebsite();

        switch (activeWebsite) {
            case 'ChatGPT':
                logConCgp('[init] Active website detected: ChatGPT');
                initializeChatGPTExtension(true);
                break;
            case 'Claude':
                logConCgp('[init] Active website detected: Claude');
                initializeClaudeExtension(true);
                break;
            default:
                logConCgp('[init] Active website is not supported. Initialization aborted.');
        }

        // If the active website is ChatGPT and shortcuts are enabled, add keyboard event listeners
        if (activeWebsite === 'ChatGPT' && MaxExtensionConfig.enableShortcuts) {
            window.addEventListener('keydown', manageKeyboardShortcutEvents);
            logConCgp('[init] Keyboard shortcuts have been enabled and event listener added for ChatGPT.');
        }
    }

    // Expose the main extension function to the global window object
    window.extensionMainFunction = selectAndInitializeAppropriateExtensionScript;

    /**
     * Observes changes to the URL in Single Page Applications and triggers a callback upon changes.
     * @param {Function} callback - The function to execute when a URL change is detected.
     */
    function monitorUrlChangesInSinglePageApplications(callback) {
        let previousUrl = location.href;
        const urlChangeObserver = new MutationObserver(() => {
            const currentUrl = location.href;
            if (currentUrl !== previousUrl) {
                previousUrl = currentUrl;
                callback();
            }
        });

        urlChangeObserver.observe(document, { subtree: true, childList: true });
    }

    /**
     * Debounces a function to limit how often it can be executed.
     * @param {Function} func - The function to debounce.
     * @param {number} delay - The debounce delay in milliseconds.
     * @returns {Function} - The debounced function.
     */
    function debounceFunctionExecution(func, delay) {
        let timeoutIdentifier;
        return function (...argumentsList) {
            clearTimeout(timeoutIdentifier);
            timeoutIdentifier = setTimeout(() => func.apply(this, argumentsList), delay);
        };
    }

    /**
     * Handle navigation changes in Single Page Applications.
     */
    const debouncedEnhancedInitialization = debounceFunctionExecution(() => {
        logConCgp('[init] URL change detected. Attempting to initialize extension...');
        commenceExtensionInitialization(window.MaxExtensionConfig);
    }, 1000); // Adjust the debounce delay as needed

    // Begin monitoring URL changes to handle SPA navigation
    monitorUrlChangesInSinglePageApplications(() => {
        logConCgp('[init] Path change detected. Re-initializing script...');
        debouncedEnhancedInitialization();
    });

    // Initiate the appropriate extension script based on the active website
    selectAndInitializeAppropriateExtensionScript();
}
