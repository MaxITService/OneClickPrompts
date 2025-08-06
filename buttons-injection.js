'use strict';
// button-injection.js version 1.1
/**
 * Button Injection Logic for the ChatGPT Chrome extension.
 * This file contains functions to handle custom button injection into the webpage,
 * including resiliency checks and re-initialization measures.
 */
//Instructions for AI: do not remove comments!  MUST NOT REMOVE COMMENTS. This one too!
// ALL CODE IN ALL FILES MUST USE logConCgp FOR LOGGING. NO CONSOLE LOGGING.

// Constants for extended resiliency monitoring
const EXTENDED_CHECK_INTERVAL = 15000; // 15 seconds
const EXTENDED_CHECK_DURATION = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

// Flag to coordinate with the floating panel toggle logic.
window.OneClickPrompts_isTogglingPanel = false;

/**
 * Checks whether the custom buttons modifications already exist in the DOM.
 * This is strengthened to check for child elements, not just the container.
 * @returns {boolean} - True if modifications exist, false otherwise.
 */
function doCustomModificationsExist() {
    const el = document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId);
    // The container must exist AND have child elements (buttons/toggles) inside it.
    return !!(el && el.children.length > 0);
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

            // Ensure the inline selector inside does not close due to bubbling site handlers
            try {
                const selector = targetDiv.querySelector('select');
                if (selector) {
                    const stop = (e) => { e.stopPropagation(); };
                    ['pointerdown','mousedown','mouseup','click','touchstart','touchend','keydown'].forEach(evt => {
                        selector.addEventListener(evt, stop, { capture: true });
                    });
                }
            } catch (e) {}

            // Always start resiliency checks when enableResiliency is true.
            if (enableResiliency) {
                logConCgp('[button-injection] Starting resiliency checks.');
                commenceEnhancedResiliencyChecks();
            }
        }
    };

    // Use a utility function to wait for the target container(s) to appear in the DOM.
    MaxExtensionUtils.waitForElements(selectors, handleTargetDiv);
}

// Global variable to store the current resiliency check timer
window.OneClickPropmts_currentResiliencyTimeout = null;

// Global variable to store the extended monitoring observer
window.OneClickPropmts_extendedMonitoringObserver = null;

/**
 * The resiliency mechanism continuously monitors the DOM to verify that custom modifications remain intact.
 * It performs periodic checks and counts consecutive iterations where the modifications are absent.
 * Once a predefined threshold is reached, or after a maximum number of iterations, it triggers a reinjection of the elements.
 * This approach ensures the extension maintains functionality even when the webpage dynamically resets or modifies its content.
 */
function commenceEnhancedResiliencyChecks() {
    // Cancel any previous resiliency check and observer
    if (window.OneClickPropmts_currentResiliencyTimeout) {
        clearTimeout(window.OneClickPropmts_currentResiliencyTimeout);
        window.OneClickPropmts_currentResiliencyTimeout = null;
    }

    if (window.OneClickPropmts_extendedMonitoringObserver) {
        window.OneClickPropmts_extendedMonitoringObserver.disconnect();
        window.OneClickPropmts_extendedMonitoringObserver = null;
    }

    logConCgp('[button-injection] Previous monitoring canceled due to new initialization.');

    let consecutiveClearCheckCount = 0;
    const requiredConsecutiveClearChecks = 2;
    const maximumTotalIterations = 30;
    let totalIterationsPerformed = 0;

    logConCgp('[button-injection] Beginning enhanced resiliency checks with dynamic interval...');

    function adaptiveCheck() {
        // If the panel is being toggled, pause the watchdog to prevent race conditions.
        if (window.OneClickPrompts_isTogglingPanel) {
            logConCgp('[button-injection] Panel toggling in progress. Resiliency check paused.');
            window.OneClickPropmts_currentResiliencyTimeout = setTimeout(adaptiveCheck, 150);
            return;
        }

        totalIterationsPerformed++;
        const modificationsExist = doCustomModificationsExist();
        let delay;

        if (modificationsExist) {
            consecutiveClearCheckCount = 0;
            if (totalIterationsPerformed % 10 === 0) {
                logConCgp(`[button-injection] Modifications detected. Total iterations: ${totalIterationsPerformed}/${maximumTotalIterations}.`);
            }
            delay = 100;
        } else {
            consecutiveClearCheckCount++;
            logConCgp(`[button-injection] No modifications detected. Consecutive missing: ${consecutiveClearCheckCount}/${requiredConsecutiveClearChecks}`);
            delay = 50;
        }

        if (consecutiveClearCheckCount >= requiredConsecutiveClearChecks) {
            logConCgp('[button-injection] Required consecutive clear checks achieved. Proceeding with initialization.');
            enforceResiliencyMeasures();
            startExtendedMonitoringWithObserver();
            return;
        }

        if (totalIterationsPerformed >= maximumTotalIterations) {
            logConCgp('[button-injection] Maximum iterations reached.');
            if (!doCustomModificationsExist()) {
                logConCgp('[button-injection] No modifications present after maximum iterations. Proceeding cautiously.');
                enforceResiliencyMeasures();
                startExtendedMonitoringWithObserver();
            } else {
                logConCgp('[button-injection] Modifications still present after maximum iterations. Starting extended monitoring.');
                startExtendedMonitoringWithObserver();
            }
            return;
        }

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

/**
 * Starts extended monitoring using MutationObserver for more efficient DOM change detection.
 * Monitors for 2 hours and then automatically disconnects.
 */
function startExtendedMonitoringWithObserver() {
    logConCgp('[button-injection] Starting extended monitoring with MutationObserver for 2 hours');

    // Clean up any existing observer
    if (window.OneClickPropmts_extendedMonitoringObserver) {
        window.OneClickPropmts_extendedMonitoringObserver.disconnect();
    }

    // Create new observer
    window.OneClickPropmts_extendedMonitoringObserver = new MutationObserver((mutations) => {
        // Also check the toggle flag here to avoid reacting to our own changes.
        if (!window.OneClickPrompts_isTogglingPanel && !doCustomModificationsExist()) {
            logConCgp('[button-injection] Modifications missing during extended monitoring - reinserting');
            enforceResiliencyMeasures();
        }
    });

    // Start observing
    window.OneClickPropmts_extendedMonitoringObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Set up automatic cleanup after 2 hours
    setTimeout(() => {
        if (window.OneClickPropmts_extendedMonitoringObserver) {
            window.OneClickPropmts_extendedMonitoringObserver.disconnect();
            window.OneClickPropmts_extendedMonitoringObserver = null;
            logConCgp('[button-injection] Extended monitoring period complete');
        }
    }, EXTENDED_CHECK_DURATION);
}