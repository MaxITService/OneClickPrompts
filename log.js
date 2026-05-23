// log.js
// Version: 1.0
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.

/**
 * Logging utility for the OneClickPrompts Chrome Extension.
 * 
 * All logging should now use the logConCgp function defined in this file.
 * This ensures consistent logging format and centralized control over logging behavior.
 * 
 * ## How to Use:
 * 
 * To log messages, simply call the logConCgp function with your message and any additional data.
 * 
 * ```javascript
 * // Basic log message
 * logConCgp('This is a log message.');
 * 
 * // Log message with additional data
 * logConCgp('User data:', userData);
 * ```
 */

/**
 * Logs messages to the console with a consistent prefix.
 * 
 * @param {string} message - The message to log.
 * @param  {...any} optionalParams - Additional parameters to log.
 */
(function installBrowserConsoleLogGate() {
    const root = globalThis;
    if (!root || root.__OCPBrowserConsoleLogGateInstalled || !root.console) {
        return;
    }

    const gatedMethods = ['log', 'info', 'debug', 'warn', 'error'];
    const originalConsole = {};

    function browserConsoleLogsAreDisabled() {
        const config = root.globalMaxExtensionConfig;
        return !!(config && config.disableBrowserConsoleLogs);
    }

    gatedMethods.forEach((methodName) => {
        const originalMethod = root.console[methodName];
        if (typeof originalMethod !== 'function') {
            return;
        }

        originalConsole[methodName] = originalMethod.bind(root.console);
        root.console[methodName] = (...args) => {
            if (browserConsoleLogsAreDisabled()) {
                return;
            }
            originalConsole[methodName](...args);
        };
    });

    root.__OCPBrowserConsoleLogGateInstalled = true;
    root.OCPBrowserConsoleLogGate = {
        isDisabled: browserConsoleLogsAreDisabled,
        originalConsole
    };
})();

function logConCgp(message, ...optionalParams) {
    console.log(`[OneClickPrompts] ${message}`, ...optionalParams);
}
