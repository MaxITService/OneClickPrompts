// log.js
// Version: 1.0
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.

/**
 * Logging utility for the ChatGPT Buttons Chrome Extension.
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
function logConCgp(message, ...optionalParams) {
    console.log(`[Chatgpt-Buttons] ${message}`, ...optionalParams);
}

