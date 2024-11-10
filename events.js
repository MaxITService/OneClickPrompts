// events.js
// Version: 1.0
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.

'use strict';

// Log that the Events script has been loaded
logConCgp('Events script loaded.');

/**
 * Handles changes in the URL path by re-initializing ChatGPT buttons.
 */
function handlePathChangeEvent() {
    logConCgp('Path change detected. Re-initializing script...');
    if (typeof window.initChatgptButtons === 'function') {
        window.initChatgptButtons();
    } else {
        console.error('[Chatgpt-Buttons] initChatgptButtons function is not available.');
    }
}

/**
 * Sets up a MutationObserver to detect changes in the DOM that may indicate a URL path change.
 */
function establishMutationObserverForPathChanges() {
    let previousPath = window.location.pathname;

    /**
     * Callback function executed when DOM mutations are observed.
     */
    const onDomMutationDetected = () => {
        const currentPath = window.location.pathname;
        if (currentPath !== previousPath) {
            previousPath = currentPath;
            handlePathChangeEvent();
        }
    };

    // Create a MutationObserver instance with the callback
    const domMutationObserver = new MutationObserver(onDomMutationDetected);

    // Begin observing the document body for changes in child elements and the subtree
    domMutationObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    logConCgp('MutationObserver for path changes has been established.');
}

/**
 * Overrides the default history.pushState and history.replaceState methods to detect URL changes.
 */
function overrideBrowserHistoryMethodsForPathDetection() {
    const originalPushStateMethod = history.pushState;
    const originalReplaceStateMethod = history.replaceState;

    history.pushState = function(...argumentsList) {
        originalPushStateMethod.apply(history, argumentsList);
        handlePathChangeEvent();
    };

    history.replaceState = function(...argumentsList) {
        originalReplaceStateMethod.apply(history, argumentsList);
        handlePathChangeEvent();
    };

    logConCgp('Browser history methods overridden to enable path change detection.');
}

/**
 * Initializes the detection of URL path changes by setting up observers and event listeners.
 */
function initializePathChangeDetectionMechanisms() {
    establishMutationObserverForPathChanges();
    overrideBrowserHistoryMethodsForPathDetection();

    // Add an event listener for the popstate event to handle back/forward navigation
    window.addEventListener('popstate', handlePathChangeEvent);
    logConCgp('popstate event listener has been added for path change detection.');
}

// Commence the initialization of path change detection mechanisms
initializePathChangeDetectionMechanisms();
