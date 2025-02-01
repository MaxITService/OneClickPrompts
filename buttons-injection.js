'use strict';
// button-injection.js version 1.0
/**
 * Button Injection Logic for the ChatGPT Chrome extension.
 * This file contains functions to handle custom button injection into the webpage,
 * including resiliency checks and re-initialization measures.
 */
//Instructions for AI: do not remove comments!  MUST NOT REMOVE COMMENTS. This one too!
// ALL CODE IN ALL FILES MUST USE logConCgp FOR LOGGING. NO CONSOLE LOGGING.


/**
 * Checks whether the custom buttons modifications already exist in the DOM.
 * @returns {boolean} - True if modifications exist, false otherwise.
 */
function doCustomModificationsExist() {
    return document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId) !== null;
}

/**
 * Checks for the existence of the custom modifications and injects the custom buttons,
 * separators, and toggle switches into the webpage. It also starts resiliency checks
 * to ensure that the modifications are re‑injected if they disappear (for example, after SPA navigation).
 *
 * @param {boolean} enableResiliency - Flag indicating whether resiliency checks should be enabled.
 * @param {string} activeWebsite - The identifier of the active website (not used directly in this function).
 */
function buttonBoxCheckingAndInjection(enableResiliency = true, activeWebsite) {
    logConCgp('[button-injection] Checking if mods already exist...');
    
    // If modifications already exist and resiliency is disabled, skip the injection.
    if (doCustomModificationsExist() && !enableResiliency) {
        logConCgp('[button-injection] Modifications already exist and resiliency is disabled. Skipping initialization.');
        return;
    }

    // Load the saved states of toggle switches (e.g., Auto-send, Hotkeys) from localStorage.
    MaxExtensionInterface.loadToggleStates();
    logConCgp('[button-injection] Toggle states have been loaded.');

    // Flag to ensure we only process one target container (if multiple callbacks are fired).
    let targetFound = false;

    // Get the list of selectors for the containers into which the buttons should be injected.
    const selectors = window.InjectionTargetsOnWebsite.selectors.containers;

    /**
     * Unified callback function that is called when a target container is detected in the DOM.
     * This function injects the custom elements and starts the resiliency mechanism.
     *
     * @param {HTMLElement} targetDiv - The container element in which to inject the custom buttons.
     */
    const handleTargetDiv = (targetDiv) => {
        if (!targetFound) {
            targetFound = true; // Prevent further executions for this injection cycle.
            logConCgp('[button-injection] Target div has been found:', targetDiv);

            // Insert custom elements (custom send buttons and toggles) into the target container.
            window.MaxExtensionButtonsInit.createAndInsertCustomElements(targetDiv);

            // Always start resiliency checks when enableResiliency is true.
            // This change removes the one-time flag (firstModificationCompleted) dependency.
            if (enableResiliency) {
                logConCgp('[button-injection] Starting resiliency checks.');
                commenceEnhancedResiliencyChecks();
            }
        }
    };

    // Use a utility function to wait for the target container(s) to appear in the DOM.
    MaxExtensionUtils.waitForElements(selectors, handleTargetDiv);
}





/**
 * The resiliency mechanism continuously monitors the DOM to verify that custom modifications remain intact.
 * It performs periodic checks and counts consecutive iterations where the modifications are absent.
 * Once a predefined threshold is reached, or after a maximum number of iterations, it triggers a reinjection of the elements.
 * This approach ensures the extension maintains functionality even when the webpage dynamically resets or modifies its content.
 */

// Global variable to store the current resiliency check timer
window.OneClickPropmts_currentResiliencyTimeout = null;
// fucntion that uses it:
function commenceEnhancedResiliencyChecks() {
    // Cancel any previous resiliency check
    if (window.OneClickPropmts_currentResiliencyTimeout) {
        clearTimeout(window.OneClickPropmts_currentResiliencyTimeout);
        window.OneClickPropmts_currentResiliencyTimeout = null;
        logConCgp('[button-injection] Previous resiliency check canceled due to new initialization.');
    }

    let consecutiveClearCheckCount = 0;
    const requiredConsecutiveClearChecks = 2; // Missing for this many consecutive checks triggers reinjection
    const maximumTotalIterations = 30;
    let totalIterationsPerformed = 0;

    logConCgp('[button-injection] Beginning enhanced resiliency checks with dynamic interval...');
    logConCgp(`[button-injection] Requires ${requiredConsecutiveClearChecks} consecutive clear checks.`);

    // Adaptive check function that adjusts the delay based on the state
    function adaptiveCheck() {
        totalIterationsPerformed++;
        const modificationsExist = doCustomModificationsExist();
        let delay;

        if (modificationsExist) {
            consecutiveClearCheckCount = 0; // Reset counter if modifications are present
            // Log "everything is okay" only every 10 iterations to avoid log spam.
            if (totalIterationsPerformed % 10 === 0) {
                logConCgp(`[button-injection] Modifications detected. Total iterations: ${totalIterationsPerformed}/${maximumTotalIterations}.`);
            }
            // Slow down the checks when modifications are present
            delay = 100;
        } else {
            consecutiveClearCheckCount++;
            logConCgp(`[button-injection] No modifications detected. Consecutive missing: ${consecutiveClearCheckCount}/${requiredConsecutiveClearChecks}`);
            // Use a faster check interval when modifications are missing
            delay = 50;
        }

        // If the required consecutive missing checks have been reached, trigger reinjection.
        if (consecutiveClearCheckCount >= requiredConsecutiveClearChecks) {
            logConCgp('[button-injection] Required consecutive clear checks achieved. Proceeding with initialization.');
            enforceResiliencyMeasures();
            return;
        }

        // Safety: If maximum iterations have been reached, decide based on current state.
        if (totalIterationsPerformed >= maximumTotalIterations) {
            logConCgp('[button-injection] Maximum iterations reached.');
            if (!doCustomModificationsExist()) {
                logConCgp('[button-injection] No modifications present after maximum iterations. Proceeding cautiously.');
                enforceResiliencyMeasures();
            } else {
                logConCgp('[button-injection] Modifications still present after maximum iterations. We had succesfully injected buttons and they stayed there. Resiliency checks will be disabled.');
            }
            return;
        }

        // Schedule the next check with the determined delay and store its timer.
        window.OneClickPropmts_currentResiliencyTimeout = setTimeout(adaptiveCheck, delay);
    }

    adaptiveCheck();
}


/**
 * Enforces resiliency by re-initializing the extension without further resiliency checks.
 * Inserts custom elements into the webpage to restore functionality.
 */
function enforceResiliencyMeasures() {
    logConCgp('[button-injection] Enforcing resiliency measures. Re-initializing without resiliency checks.');
    buttonBoxCheckingAndInjection(false);
}
