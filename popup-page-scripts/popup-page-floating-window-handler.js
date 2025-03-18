// popup-page-floating-window-handler.js
// Version: 1.0
// Handler script for floating window settings reset functionality

'use strict';

/**
 * Resets all floating panel settings across all websites.
 * Uses the config.js service worker to clear all floating panel settings
 * stored in Chrome's extension storage with the 'floating_panel_' prefix.
 */
async function resetFloatingWindowSettings() {
    try {
        // Send message to config service worker to reset all floating panel settings
        chrome.runtime.sendMessage({
            type: 'resetFloatingPanelSettings'
        }, (response) => {
            if (response && response.success) {
                // Log success and show confirmation to user
                const count = response.count || 0;
                
                if (count > 0) {
                    window.logToGUIConsole(`Successfully reset ${count} floating panel settings`);
                    window.showToast('Floating window settings have been reset. Changes will take effect on your next page visit.', 'success');
                } else {
                    window.logToGUIConsole('No floating panel settings found to reset');
                    window.showToast('No floating panel settings found to reset.', 'info');
                }
            } else {
                // Log error and show error message
                const errorMsg = response && response.error ? response.error : 'Unknown error';
                window.logToGUIConsole(`Error resetting floating window settings: ${errorMsg}`);
                window.showToast(`Failed to reset floating window settings: ${errorMsg}`, 'error');
            }
        });
    } catch (error) {
        // Log error and show error message
        window.logToGUIConsole(`Error resetting floating window settings: ${error.message}`);
        window.showToast(`Failed to reset floating window settings: ${error.message}`, 'error');
    }
}

// Export the function to be used by the popup script
window.resetFloatingWindowSettings = resetFloatingWindowSettings;
