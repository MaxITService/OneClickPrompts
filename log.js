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
    const queuedConsoleCalls = [];
    const maxQueuedConsoleCalls = 100;
    let storagePreferenceReady = false;
    let storagePreferenceDisablesLogs = false;

    function getConfigPreference() {
        const config = root.globalMaxExtensionConfig;
        if (config && typeof config.disableBrowserConsoleLogs === 'boolean') {
            return config.disableBrowserConsoleLogs;
        }
        return null;
    }

    function browserConsoleLogsAreDisabled() {
        const configPreference = getConfigPreference();
        if (configPreference !== null) {
            return configPreference;
        }
        if (!storagePreferenceReady) {
            return true;
        }
        return storagePreferenceDisablesLogs;
    }

    function storageGet(keys) {
        return new Promise(resolve => {
            try {
                if (!root.chrome?.storage?.local) {
                    resolve({});
                    return;
                }
                root.chrome.storage.local.get(keys, result => {
                    if (root.chrome.runtime?.lastError) {
                        resolve({});
                        return;
                    }
                    resolve(result || {});
                });
            } catch (_) {
                resolve({});
            }
        });
    }

    function flushQueuedConsoleCalls() {
        if (browserConsoleLogsAreDisabled()) {
            queuedConsoleCalls.length = 0;
            return;
        }
        while (queuedConsoleCalls.length > 0) {
            const { methodName, args } = queuedConsoleCalls.shift();
            originalConsole[methodName]?.(...args);
        }
    }

    async function refreshStoragePreference() {
        const current = await storageGet(['currentProfile']);
        const profileName = current.currentProfile || 'Default';
        const profileKey = `profiles.${profileName}`;
        const profileResult = await storageGet([profileKey]);
        storagePreferenceDisablesLogs = !!profileResult[profileKey]?.disableBrowserConsoleLogs;
        storagePreferenceReady = true;
        flushQueuedConsoleCalls();
    }

    gatedMethods.forEach((methodName) => {
        const originalMethod = root.console[methodName];
        if (typeof originalMethod !== 'function') {
            return;
        }

        originalConsole[methodName] = originalMethod.bind(root.console);
        root.console[methodName] = (...args) => {
            if (!storagePreferenceReady && getConfigPreference() === null) {
                if (queuedConsoleCalls.length < maxQueuedConsoleCalls) {
                    queuedConsoleCalls.push({ methodName, args });
                }
                return;
            }
            if (browserConsoleLogsAreDisabled()) {
                return;
            }
            originalConsole[methodName](...args);
        };
    });

    refreshStoragePreference();
    root.chrome?.storage?.onChanged?.addListener((changes, namespace) => {
        if (namespace !== 'local') {
            return;
        }
        if (changes.currentProfile || Object.keys(changes).some(key => key.startsWith('profiles.'))) {
            storagePreferenceReady = false;
            refreshStoragePreference();
        }
    });

    root.__OCPBrowserConsoleLogGateInstalled = true;
    root.OCPBrowserConsoleLogGate = {
        isDisabled: browserConsoleLogsAreDisabled,
        refresh: refreshStoragePreference,
        originalConsole
    };
})();

function logConCgp(message, ...optionalParams) {
    console.log(`[OneClickPrompts] ${message}`, ...optionalParams);
}
