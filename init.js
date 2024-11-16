// init.js
// Version: 1.4
//
// Documentation:
/**
 * This file serves as the main initializer for the ChatGPT extension. 
 * It retrieves configuration data from the service worker and identifies 
 * the active website, such as ChatGPT or Claude. Based on the site, it 
 * loads the appropriate extension scripts and applies necessary settings. 
 * The script also manages keyboard shortcuts to enhance user interaction.
 * 
 * It monitors URL changes, especially in single-page applications, to 
 * dynamically adapt to navigation events. Resiliency checks ensure that 
 * custom modifications in the DOM are validated and reinitialized as needed. 
 * Debouncing utilities are included to limit excessive function executions 
 * and optimize performance. The initialization sequence starts automatically, 
 * ensuring the extension runs smoothly across supported platforms.
 *
 * Usage:
 * Ensure `buttons.js` and `buttons-init.js` are loaded before this script to 
 * enable button functionalities. The script starts the initialization process 
 * automatically upon loading. 
 */
//Instructions for AI: do not remove comments!  MUST NOT REMOVE COMMENTS. This one too!

'use strict';


/**
 * This funcition is called first.
 */
function publicStaticVoidMain() {
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
     * @description Helper function that checks if the custom buttons container exists in the DOM to prevent duplication.
     */
    function doCustomModificationsExist() {
        return document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId) !== null;
    }

    /**
     * Initializes the extension specifically for ChatGPT by injecting custom elements into the webpage.
     * @param {boolean} enableResiliency - Flag to enable or disable resiliency checks.
     */
    function initializeChatGPTExtension(enableResiliency = true) {
        logConCgp('[init] Initializing ChatGPT-specific script...');
        initiateFirstInitializationSequence(enableResiliency);
    }

    /**
     * Initializes the extension specifically for Claude by injecting custom elements into the webpage.
     * Currently redirects to ChatGPT initialization as functionality is shared.
     * @param {boolean} enableResiliency - Flag to enable or disable resiliency checks.
     */
    function initializeClaudeExtension(enableResiliency = true) {
        logConCgp('[init] Initializing Claude-specific script...');
        // This is to implement compatibility with Claude in the future. currently no functionality.
        initializeChatGPTExtension(enableResiliency=true);
    }

    /**
     * Selects the correct initialization path based on the active website and sets up keyboard shortcuts if enabled.
     * Injects custom elements into the webpage accordingly.
     */
    function selectAndInitializeAppropriateExtensionScript() {
        logConCgp('[init] InitScript invoked. Detecting active website...');
        const activeWebsite = window.InjectionTargetsOnWebsite.activeSite;

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

    /**
     * Manages keyboard shortcut events to trigger custom send buttons on the webpage.
     * Listens for Alt+[1-10] key presses and simulates button clicks.
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
     * Initiates the first sequence of the extension's initialization.
     * Inserts custom buttons and toggles into the webpage and starts resiliency checks if enabled.
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

        // Define the selector to wait for using InjectionTargetsOnWebsite
        const selector1 = window.InjectionTargetsOnWebsite.selectors.container;
        // Define a unified callback function
        const handleTargetDiv = (targetDiv) => {
            if (!targetFound) {
                targetFound = true; // Set the flag to prevent other callbacks from executing
                logConCgp('[init] Target div has been found:', targetDiv);
                // Insert custom elements into the target container on the webpage
                window.MaxExtensionButtonsInit.createAndInsertCustomElements(targetDiv);

                // Initiate resiliency checks only after the first successful modification
                if (!MaxExtensionConfig.firstModificationCompleted && enableResiliency) {
                    MaxExtensionConfig.firstModificationCompleted = true;
                    logConCgp('[init] First modification complete. Starting resiliency checks.');
                    commenceEnhancedResiliencyChecks();
                }
            }
        };

        // Wait for the target element to appear in the DOM and then handle it
        MaxExtensionUtils.waitForElement(selector1, handleTargetDiv);
    }

    /**
     * Initiates enhanced resiliency checks to ensure the extension remains functional on the webpage.
     * Periodically checks if custom modifications exist and re-initializes if necessary.
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
     * Inserts custom elements into the webpage to restore functionality.
     */
    function enforceResiliencyMeasures() {
        logConCgp('[init] Enforcing resiliency measures. Re-initializing without resiliency checks.');
        initiateFirstInitializationSequence(false);
    }

    /**
     * Debounces a function to limit how often it can be executed.
     * @param {Function} func - The function to debounce.
     * @param {number} delay - The debounce delay in milliseconds.
     * @returns {Function} - The debounced function.
     * @description Helper function that limits the rate at which a function can fire.
     */
    function debounceFunctionExecution(func, delay) {
        let timeoutIdentifier;
        return function (...argumentsList) {
            clearTimeout(timeoutIdentifier);
            timeoutIdentifier = setTimeout(() => func.apply(this, argumentsList), delay);
        };
    }

    /**
     * Handle navigation changes in Single Page Applications by re-initializing the extension.
     * Ensures custom elements are present on the webpage after URL changes.
     */
    const debouncedEnhancedInitialization = debounceFunctionExecution(() => {
        logConCgp('[init] URL change detected. Attempting to initialize extension...');
        commenceExtensionInitialization(window.MaxExtensionConfig);
    }, 1000); // Adjust the debounce delay as needed

    /**
     * Observes changes to the URL in Single Page Applications and triggers a callback upon changes.
     * @param {Function} callback - The function to execute when a URL change is detected.
     * @description Helper function that monitors URL changes using MutationObserver.
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

    // Begin monitoring URL changes to handle SPA navigation
    monitorUrlChangesInSinglePageApplications(() => {
        logConCgp('[init] Path change detected. Re-initializing script...');
        debouncedEnhancedInitialization();
    });

    // Initiate the appropriate extension script based on the active website
    selectAndInitializeAppropriateExtensionScript();
}


// Automatically start the initialization process upon script load
publicStaticVoidMain();
