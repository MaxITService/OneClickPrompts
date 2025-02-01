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
 * Inserts custom buttons, separators and settings toggles into the webpage and starts resiliency checks if enabled.
 * @param {boolean} enableResiliency - Flag to enable or disable resiliency checks.
 * @param {string} activeWebsite - The identifier of the active website.
 */
function buttonBoxCheckingAndInjection(enableResiliency = true, activeWebsite) {
    logConCgp('[button-injection] Checking if mods already exist...');
    if (doCustomModificationsExist() && !enableResiliency) {
        logConCgp('[button-injection] Modifications already exist and resiliency is disabled. Skipping initialization.');
        return;
    }

    // Load the saved states of toggle switches
    MaxExtensionInterface.loadToggleStates();
    logConCgp('[button-injection] Toggle states have been loaded.');

    // Initialize the shared flag
    let targetFound = false;

    // Define the selector to wait for using InjectionTargetsOnWebsite
    const selectors = window.InjectionTargetsOnWebsite.selectors.containers;
    // A unified callback function will search for div where we will insert stuff
    const handleTargetDiv = (targetDiv) => {
        if (!targetFound) {
            targetFound = true; // Set the flag to prevent other callbacks from executing
            logConCgp('[button-injection] Target div has been found:', targetDiv);
            // Insert custom elements into the target container on the webpage
            window.MaxExtensionButtonsInit.createAndInsertCustomElements(targetDiv);

            // Initiate resiliency checks only after the first successful modification
            if (!window.globalMaxExtensionConfig.firstModificationCompleted && enableResiliency) {
                window.globalMaxExtensionConfig.firstModificationCompleted = true;
                logConCgp('[button-injection] First modification complete. Starting resiliency checks.');
                commenceEnhancedResiliencyChecks();
            }
        }
    };

    // Wait for the target element to appear in the DOM and then handle it
    MaxExtensionUtils.waitForElements(selectors, handleTargetDiv);
}

/**
 * The resiliency mechanism continuously monitors the DOM to verify that custom modifications remain intact.
 * It performs periodic checks and counts consecutive iterations where the modifications are absent.
 * Once a predefined threshold is reached, or after a maximum number of iterations, it triggers a reinjection of the elements.
 * This approach ensures the extension maintains functionality even when the webpage dynamically resets or modifies its content.
 */
function commenceEnhancedResiliencyChecks() {
    let consecutiveClearCheckCount = 0;
    const requiredConsecutiveClearChecks = 2; // Missing for this many consecutive checks triggers reinjection
    const maximumTotalIterations = 160;
    let totalIterationsPerformed = 0;

    logConCgp('[button-injection] Beginning enhanced resiliency checks with dynamic interval...');
    logConCgp(`[button-injection] Requires ${requiredConsecutiveClearChecks} consecutive clear checks.`);

    // The adaptive check function uses a dynamic delay based on current state.
    function adaptiveCheck() {
        totalIterationsPerformed++;
        const modificationsExist = doCustomModificationsExist();
        let delay;

        if (modificationsExist) {
            // When modifications are present, reset the missing counter.
            consecutiveClearCheckCount = 0;
            // Log only every 10 iterations to avoid excessive logs.
            if (totalIterationsPerformed % 10 === 0) {
                logConCgp(`[button-injection] Modifications detected. Total iterations: ${totalIterationsPerformed}/${maximumTotalIterations}.`);
            }
            // Slow down checks when everything is okay.
            delay = 500;
        } else {
            consecutiveClearCheckCount++;
            logConCgp(`[button-injection] No modifications detected. Consecutive missing: ${consecutiveClearCheckCount}/${requiredConsecutiveClearChecks}`);
            // Rapid checks when modifications are missing.
            delay = 50;
        }

        // If we have reached the required consecutive clear checks, reinject.
        if (consecutiveClearCheckCount >= requiredConsecutiveClearChecks) {
            logConCgp('[button-injection] Required consecutive clear checks achieved. Proceeding with initialization.');
            enforceResiliencyMeasures();
            return;
        }

        // Safety: if maximum iterations have been reached, decide based on current state.
        if (totalIterationsPerformed >= maximumTotalIterations) {
            logConCgp('[button-injection] Maximum iterations reached.');
            if (!doCustomModificationsExist()) {
                logConCgp('[button-injection] No modifications present after maximum iterations. Proceeding cautiously.');
                enforceResiliencyMeasures();
            } else {
                logConCgp('[button-injection] Modifications still present after maximum iterations. Aborting initialization.');
            }
            return;
        }

        // Schedule the next check with the dynamic delay.
        setTimeout(adaptiveCheck, delay);
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
