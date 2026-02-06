"use strict";
// buttons-injection.js version 1.1
/**
 * Button Injection:
 * Detects target containers, injects the buttons UI once, and maintains it across SPA navigation
 * via adaptive resiliency checks and long-running DOM observation.
 */

// ALL CODE IN ALL FILES MUST USE logConCgp FOR LOGGING. NO CONSOLE LOGGING.

// Constants for extended resiliency monitoring
const EXTENDED_CHECK_INTERVAL = 15000; // 15 seconds
const EXTENDED_CHECK_DURATION = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

// Flag to coordinate with the floating panel toggle logic.
window.OneClickPrompts_isTogglingPanel = false;
window.__OCP_inlineSearchController = null;
window.__OCP_inlineSearchAttemptId = 0;

/**
 * Creates floating panel fallback when inline container search is exhausted.
 * Toast is shown at panel spawn time (if user enabled notifications in Advanced settings).
 * @param {string} reason - Machine-readable reason for logging/debugging.
 * @returns {Promise<boolean>} true when fallback panel was shown, false otherwise.
 */
async function triggerAutomaticFloatingPanelFallback(reason = 'container_not_found') {
    const panelApi = window.MaxExtensionFloatingPanel;
    if (!panelApi || typeof panelApi.createFloatingPanel !== 'function') {
        logConCgp('[button-injection] Floating fallback unavailable: panel module missing.', { reason });
        return false;
    }
    if (panelApi.isPanelVisible) {
        logConCgp('[button-injection] Floating fallback skipped: panel is already visible.', { reason });
        return false;
    }
    if (window.__OCP_userDisabledFallback) {
        logConCgp('[button-injection] Floating fallback skipped: user disabled fallback.', { reason });
        return false;
    }
    if (window.__OCP_inlineHealthy) {
        logConCgp('[button-injection] Floating fallback skipped: inline already healthy in this tab.', { reason });
        return false;
    }

    await panelApi.createFloatingPanel();
    const panelElement = panelApi.panelElement;
    const buttonsArea = document.getElementById('max-extension-buttons-area');
    if (!panelElement || !buttonsArea) {
        logConCgp('[button-injection] Floating fallback failed: panel or buttons area missing after create.', { reason });
        return false;
    }

    buttonsArea.innerHTML = '';
    if (window.MaxExtensionButtonsInit &&
        typeof window.MaxExtensionButtonsInit.createAndInsertCustomElements === 'function') {
        window.MaxExtensionButtonsInit.createAndInsertCustomElements(buttonsArea);
    }

    if (typeof panelApi.positionPanelTopRight === 'function') {
        panelApi.positionPanelTopRight();
    } else if (typeof panelApi.positionPanelBottomRight === 'function') {
        panelApi.positionPanelBottomRight();
    }

    panelElement.style.display = 'flex';
    panelApi.isPanelVisible = true;
    if (panelApi.currentPanelSettings) {
        panelApi.currentPanelSettings.isVisible = true;
        panelApi.debouncedSavePanelSettings?.();
    }

    const notifyEnabled = window.OneClickPromptsSelectorAutoDetector?.settings?.notifyContainerMissing === true;
    if (notifyEnabled && typeof window.showToast === 'function') {
        window.showToast(
            'OneClickPrompts: I cannot inject buttons here, so I opened Floating Panel.',
            'error',
            10000
        );
    }

    logConCgp('[button-injection] Floating fallback panel activated after inline search timeout.', { reason });
    return true;
}

/**
 * Summary of behavior:
 * - Loads persisted toggle states before any DOM work (MaxExtensionInterface.loadToggleStates()).
 * - Waits for any of the configured target containers (InjectionTargetsOnWebsite.selectors.containers).
 * - On first hit, calls MaxExtensionButtonsInit.createAndInsertCustomElements(targetDiv).
 * - Starts an adaptive watchdog loop that re-injects when the UI disappears (e.g., SPA route changes).
 * - Starts a MutationObserver for extended monitoring (up to 2 hours) to cheaply detect DOM wipes.
 * - Coordinates with floating panel toggling via window.OneClickPrompts_isTogglingPanel to avoid races.
 * - Stops event propagation on the inline profile <select> to prevent site handlers from closing it.
 */

/**
 * Checks whether the custom buttons modifications already exist in the DOM.
 * This is strengthened to check for child elements, not just the container.
 * @returns {boolean} - True if modifications exist, false otherwise.
 */
function doCustomModificationsExist() {
    const containerId = window?.InjectionTargetsOnWebsite?.selectors?.buttonsContainerId;
    if (!containerId) {
        return false;
    }
    const el = document.getElementById(containerId);
    // The container must exist AND have child elements (buttons/toggles) inside it.
    if (!el || el.children.length === 0) {
        return false;
    }
    if (window.MaxExtensionUtils && typeof window.MaxExtensionUtils.isElementUsableForInjection === 'function') {
        if (!window.MaxExtensionUtils.isElementUsableForInjection(el)) {
            logConCgp('[button-injection] Container exists but is hidden/inert; will reinject.');
            return false;
        }
    }
    return true;
}

/**
 * Checks for the existence of the custom modifications and injects the custom buttons,
 * separators, and toggle switches into the webpage. It also starts resiliency checks
 * to ensure that the modifications are re‑injected if they disappear (for example, after SPA navigation).
 *
 * @param {boolean} enableResiliency - Flag indicating whether resiliency checks should be enabled.
 * @param {string} activeWebsite - The identifier of the active website (not used directly in this function).
 * @param {Object} options - Optional behavior overrides.
 * @param {number} options.maxSearchMs - Max search window in ms for inline container search.
 * @param {number} options.maxAttempts - Explicit max polling attempts for inline container search.
 * @param {boolean} options.allowAutoFloatingFallback - If true and container heuristics are off, spawn floating panel when search times out.
 */
function buttonBoxCheckingAndInjection(enableResiliency = true, activeWebsite, options = {}) {
    logConCgp('[button-injection] Checking if mods already exist...');

    const opts = (options && typeof options === 'object') ? options : {};
    const allowAutoFloatingFallback = opts.allowAutoFloatingFallback === true;
    const maxSearchMs = Number.isFinite(opts.maxSearchMs) && opts.maxSearchMs > 0
        ? Number(opts.maxSearchMs)
        : null;
    const explicitMaxAttempts = Number.isFinite(opts.maxAttempts) && opts.maxAttempts > 0
        ? Math.floor(opts.maxAttempts)
        : null;
    const searchMaxAttempts = explicitMaxAttempts || (maxSearchMs ? Math.max(1, Math.ceil(maxSearchMs / 150)) : 50);

    // Cancel stale search watchers from previous invocations in this tab.
    if (window.__OCP_inlineSearchController && typeof window.__OCP_inlineSearchController.cancel === 'function') {
        window.__OCP_inlineSearchController.cancel();
        window.__OCP_inlineSearchController = null;
    }
    const attemptId = (window.__OCP_inlineSearchAttemptId || 0) + 1;
    window.__OCP_inlineSearchAttemptId = attemptId;

    // If modifications already exist and resiliency is disabled, skip the injection.
    if (doCustomModificationsExist() && !enableResiliency) {
        logConCgp('[button-injection] Modifications already exist and resiliency is disabled. Skipping initialization.');
        return;
    }

    // Load tab-local toggle hints from localStorage (best-effort UI state for this tab/runtime).
    // By design, profile config is still the source of truth after full re-initialization.
    MaxExtensionInterface.loadToggleStates();
    logConCgp('[button-injection] Toggle states have been loaded.');

    // Flag to ensure we only process one target container (if multiple callbacks are fired).
    let targetFound = false;

    const reportFailureToAutoDetector = (failedSelectors, reason = 'container_not_found') => {
        logConCgp('[button-injection] Reporting container failure to auto-detector.', { reason });
        if (window.OneClickPromptsSelectorAutoDetector && typeof window.OneClickPromptsSelectorAutoDetector.reportFailure === 'function') {
            window.OneClickPromptsSelectorAutoDetector.reportFailure('container', {
                selectors: Array.isArray(failedSelectors) ? failedSelectors : [],
                reason
            });
        }
    };

    const handleContainerSearchFailure = (failedSelectors, reason = 'container_not_found') => {
        if (attemptId !== window.__OCP_inlineSearchAttemptId) {
            logConCgp('[button-injection] Ignoring stale container search failure callback.', { attemptId, latest: window.__OCP_inlineSearchAttemptId });
            return;
        }
        window.__OCP_inlineSearchController = null;
        const containerHeuristicsEnabled = window.OneClickPromptsSelectorAutoDetector?.settings?.enableContainerHeuristics === true;

        if (containerHeuristicsEnabled || !allowAutoFloatingFallback) {
            reportFailureToAutoDetector(failedSelectors, reason);
            return;
        }

        triggerAutomaticFloatingPanelFallback(reason)
            .then((didFallback) => {
                if (!didFallback) {
                    reportFailureToAutoDetector(failedSelectors, `${reason}_fallback_unavailable`);
                }
            })
            .catch((err) => {
                logConCgp('[button-injection] Error during automatic floating fallback:', err?.message || err);
                reportFailureToAutoDetector(failedSelectors, `${reason}_fallback_error`);
            });
    };

    // Get the list of selectors for the containers into which the buttons should be injected.
    const selectors = window?.InjectionTargetsOnWebsite?.selectors?.containers;
    if (!Array.isArray(selectors) || selectors.length === 0) {
        logConCgp('[button-injection] No container selectors configured.');
        handleContainerSearchFailure(Array.isArray(selectors) ? selectors : [], 'no_container_selectors');
        return;
    }

    /**
     * Unified callback function that is called when a target container is detected in the DOM.
     * This function injects the custom elements and starts the resiliency mechanism.
     *
     * @param {HTMLElement} targetDiv - The container element in which to inject the custom buttons.
     */
    const handleTargetDiv = (targetDiv) => {
        if (attemptId !== window.__OCP_inlineSearchAttemptId) {
            logConCgp('[button-injection] Ignoring stale container search success callback.', { attemptId, latest: window.__OCP_inlineSearchAttemptId });
            return;
        }
        if (!targetFound) {
            targetFound = true; // Prevent further executions for this injection cycle.
            window.__OCP_inlineSearchController = null;
            logConCgp('[button-injection] Target div has been found:', targetDiv);

            // Insert custom elements (custom send buttons and toggles) into the target container.
            window.MaxExtensionButtonsInit.createAndInsertCustomElements(targetDiv);

            // Mark this tab as "inline healthy" — once we have ever injected successfully,
            // we never auto-summon the fallback panel again in this tab.
            try {
                window.__OCP_inlineHealthy = true;
            } catch (_) { }

            // Always start resiliency checks when enableResiliency is true.
            if (enableResiliency) {
                logConCgp('[button-injection] Starting resiliency checks.');
                commenceEnhancedResiliencyChecks();
            }
        }
    };

    // Use a utility function to wait for the target container(s) to appear in the DOM.
    window.__OCP_inlineSearchController = MaxExtensionUtils.waitForElements(
        selectors,
        handleTargetDiv,
        // onFailure callback - triggered when container not found
        (failedSelectors) => {
            handleContainerSearchFailure(failedSelectors, 'max_attempts_reached');
        },
        searchMaxAttempts
    );
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
