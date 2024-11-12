// init.js
// Version: 1.4
//
// Documentation:
// This file serves as the main initializer for the ChatGPT extension. It handles configuration retrieval,
// determines the active website (e.g., ChatGPT or Claude), and initiates the appropriate extension scripts.
// Additionally, it monitors URL changes in to ensure the extension remains functional.
//
// Functions:
// - executeExtensionInitializationSequence: Starts the initialization process by fetching configuration data.
// - commenceExtensionInitialization: Applies the configuration and sets up the extension based on the active website.
// - doCustomModificationsExist: Checks if custom modifications are already present in the DOM.
// - identifyActiveWebsite: Determines which supported website is currently active.
// - initializeChatGPTExtension: Initializes ChatGPT-specific extension logic.
// - initializeClaudeExtension: Initializes Claude-specific extension logic (to be implemented in the future).
// - manageKeyboardShortcutEvents: Handles keyboard shortcuts for triggering custom send buttons.
// - commenceEnhancedResiliencyChecks: Starts periodic checks to maintain extension functionality.
// - enforceResiliencyMeasures: Re-initializes the extension without resiliency checks if conditions are met.
// - initiateFirstInitializationSequence: Begins the first initialization sequence with optional resiliency.
// - selectAndInitializeAppropriateExtensionScript: Chooses and initializes the script based on the active website.
// - monitorUrlChangesInSinglePageApplications: Observes URL changes in SPAs to re-initialize the extension as needed.
// - debounceFunctionExecution: Debounces function execution to limit how often a function can run.
//
// Usage:
// Ensure that `buttons.js` and `buttons-init.js` are loaded before this script to provide necessary button functionalities.
// This script will automatically start the initialization process upon loading.
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS. This one too!
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
     * Creates and inserts custom buttons and toggles into the target container element.
     * This function has been moved to `buttons-init.js` to enhance modularity.
     * @param {HTMLElement} targetContainer - The DOM element where custom elements will be inserted.
     */
    // Function moved to buttons-init.js

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
                window.MaxExtensionButtonsInit.createAndInsertCustomElements(targetDiv);

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

