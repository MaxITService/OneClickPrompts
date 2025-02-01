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
 * Initiates enhanced resiliency checks to ensure the extension remains functional on the webpage.
 */
function commenceEnhancedResiliencyChecks() {
    let consecutiveClearCheckCount = 0;
    const requiredConsecutiveClearChecks = 2; // missing for this many times = reinsert
    const maximumTotalIterations = 16;
    let totalIterationsPerformed = 0;
    const intervalTimeInMilliseconds = 50;

    logConCgp('[button-injection] Beginning enhanced resiliency checks...');
    logConCgp(`[button-injection] Requires ${requiredConsecutiveClearChecks} consecutive clear checks.`);

    const resiliencyCheckInterval = setInterval(() => {
        totalIterationsPerformed++;

        if (doCustomModificationsExist()) {
            consecutiveClearCheckCount = 0; // Reset counter if modifications are detected
            logConCgp(`[button-injection] Existing modifications detected. Resetting consecutive clear check counter. (Iteration ${totalIterationsPerformed}/${maximumTotalIterations})`);
        } else {
            consecutiveClearCheckCount++;
            logConCgp(`[button-injection] No modifications detected. Consecutive clear checks: ${consecutiveClearCheckCount}/${requiredConsecutiveClearChecks}`);
        }

        // Verify if the required number of consecutive clear checks has been met
        if (consecutiveClearCheckCount >= requiredConsecutiveClearChecks) {
            logConCgp('[button-injection] Required consecutive clear checks achieved. Proceeding with initialization.');
            clearInterval(resiliencyCheckInterval);
            enforceResiliencyMeasures();
        }

        // Safety measure to prevent infinite loops
        if (totalIterationsPerformed >= maximumTotalIterations) {
            logConCgp('[button-injection] Maximum iterations reached without achieving consecutive clear checks.');
            clearInterval(resiliencyCheckInterval);

            // Only proceed if no modifications are present at this point
            if (!doCustomModificationsExist()) {
                logConCgp('[button-injection] No modifications present after maximum iterations. Proceeding cautiously.');
                enforceResiliencyMeasures();
            } else {
                logConCgp('[button-injection] Modifications still present after maximum iterations. Aborting initialization.');
            }
        }
    }, intervalTimeInMilliseconds);
}

/**
 * Enforces resiliency by re-initializing the extension without further resiliency checks.
 * Inserts custom elements into the webpage to restore functionality.
 */
function enforceResiliencyMeasures() {
    logConCgp('[button-injection] Enforcing resiliency measures. Re-initializing without resiliency checks.');
    buttonBoxCheckingAndInjection(false);
}
