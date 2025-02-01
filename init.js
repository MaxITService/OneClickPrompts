// init.js

// Version: 1.4

//
// Documentation:
/**
 * This file serves as the main initializer for the ChatGPT Chrome extension. 
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
 * 
 * Dependencies:
 * This file is main script, it therefore depends on all other helper files that are content scripts. Popup page scripts are separate.
 * 
 */
//Instructions for AI: do not remove comments!  MUST NOT REMOVE COMMENTS. This one too!
// ALL CODE IN ALL FILES MUST USE logConCgp FOR LOGGING. NO CONSOLE LOGGING.

'use strict';

/**
 * This function is called first.
 */
function publicStaticVoidMain() {
    // The message intended for the service worker config.js, the function will be run after response will be received.
    chrome.runtime.sendMessage({ type: 'getConfig' }, (response) => {
        if (response && response.config) {
            logConCgp('[init] Configuration successfully loaded:', response.config);

            // let all files in project access config.
            window.globalMaxExtensionConfig = response.config;
            commenceExtensionInitialization(window.globalMaxExtensionConfig);
        } else {
            logConCgp('[init] Failed to load configuration from service worker. Initialization aborted.');
            // STOP
        }
    });
}

/**
 * Initializes the extension using the provided configuration.
 * @param {Object} configurationObject - The configuration object retrieved from the service worker.
 */
function commenceExtensionInitialization(configurationObject) {

    logConCgp('[init] Configuration has been received:', configurationObject);

    /**
     * Selects the correct initialization path based on the active website and sets up keyboard shortcuts if enabled.
     * Injects custom elements into the webpage accordingly.
     */
    function selectAndInitializeAppropriateExtensionScript() {
        logConCgp('[init] InitScript invoked. Detecting active website...');

        const activeWebsite = window.InjectionTargetsOnWebsite.activeSite;
        logConCgp('[init] Active website detected:', activeWebsite);

        // Initialize button injection logic (moved to separate file "button-injection.js")
        buttonBoxCheckingAndInjection(true, activeWebsite);

        // Enable keyboard shortcuts if configured and on ChatGPT
        if (activeWebsite === 'ChatGPT' && window.globalMaxExtensionConfig.enableShortcuts) {
            window.addEventListener('keydown', manageKeyboardShortcutEvents);
            logConCgp('[init] Keyboard shortcuts have been enabled and event listener added for ChatGPT.');
        }
    }

    /**
     * Manages keyboard shortcut events to trigger custom send buttons on the webpage.
     * Listens for Alt+[1-10] key presses and simulates button clicks.
     * If Shift is also pressed, it inverts the autoSend flag for this press only.
     * @param {KeyboardEvent} event - The keyboard event object.
     */
    function manageKeyboardShortcutEvents(event) {
        if (!globalMaxExtensionConfig.enableShortcuts) return;

        // Only handle events where Alt is pressed and the key is a digit [1-10]
        if (
            event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            event.code.startsWith('Digit')
        ) {
            let pressedKey = event.code.replace('Digit', '');
            if (pressedKey === '0') pressedKey = '10';

            const targetButton = document.querySelector(`button[data-shortcut-key="${pressedKey}"]`);
            if (targetButton) {
                event.preventDefault();
                // Create a new MouseEvent with shiftKey set based on the current event
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    shiftKey: event.shiftKey
                });
                targetButton.dispatchEvent(clickEvent);
            } else {
                logConCgp('[init] No button found for the pressed shortcut key:', pressedKey);
            }
        }
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
     * Function will be called once after last trigger with 1000 ms delay
     */
    const debouncedEnhancedInitialization = debounceFunctionExecution(() => {
        logConCgp('[init] URL change detected. Attempting to initialize extension...');
        commenceExtensionInitialization(window.globalMaxExtensionConfig);
    }, 1000);

    /**
     * Observes changes to the URL in Single Page Applications and triggers a callback upon changes.
     * @param {Function} callback - The function to execute when a URL change is detected.
     * @description Helper function that monitors URL changes using MutationObserver.
     */
    function resilientStartAndRetryOnSPANavigation(callback) {
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

    /*
    Initialization starts here!
    */
    // Initiate the appropriate extension script based on the active website
    selectAndInitializeAppropriateExtensionScript();

    // Begin monitoring URL changes to handle SPA navigation
    resilientStartAndRetryOnSPANavigation(() => {
        logConCgp('[init] Path change detected. Re-initializing script...');
        debouncedEnhancedInitialization();
    });
}

// Automatically start the initialization process upon script load
publicStaticVoidMain();
