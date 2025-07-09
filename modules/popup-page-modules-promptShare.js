'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // --- Module Elements ---
    const crossChatModule = document.getElementById('crossChatModule');
    const enableToggle = document.getElementById('crossChatModuleEnableToggle');
    const settingsContainer = document.getElementById('crossChatModuleSettings');

    // Settings Elements
    const autosendCopyToggle = document.getElementById('crossChatAutosendCopy');
    const autosendPasteToggle = document.getElementById('crossChatAutosendPaste');
    const placementRadios = document.getElementsByName('crossChatButtonPlacement');

    // Stored Prompt Elements
    const storedPromptDisplay = document.getElementById('storedPromptDisplay');
    const refreshPromptBtn = document.getElementById('refreshStoredPrompt');
    const clearPromptBtn = document.getElementById('clearStoredPrompt');

    // Gracefully exit if essential elements for this module are missing.
    // This no longer breaks the parent container's collapsible functionality.
    if (!crossChatModule || !enableToggle || !settingsContainer || !autosendCopyToggle) {
        console.warn("Cross-Chat module elements not found, skipping feature initialization.");
        // If the module container exists, we hide it to prevent showing a broken UI.
        if (crossChatModule) {
            crossChatModule.style.display = 'none';
        }
        return;
    }

    // --- State Management ---
    const defaultSettings = {
        enabled: false,
        autosendCopy: false,
        autosendPaste: false,
        placement: 'after',
    };

    let currentSettings = { ...defaultSettings };

    async function loadModuleState() {
        try {
            // Load settings
            const response = await chrome.runtime.sendMessage({ type: 'getCrossChatModuleSettings' });
            if (response && response.settings) {
                currentSettings = response.settings;
            } else {
                console.warn('Could not load cross-chat module settings, using defaults.');
                currentSettings = { ...defaultSettings };
            }

            // Load stored prompt
            await refreshStoredPrompt();

            updateUIFromState();
        } catch (error) {
            console.error('Error loading cross-chat module state:', error);
            window.showToast('Error loading module settings.', 'error');
        }
    }

    async function saveModuleSettings() {
        try {
            await chrome.runtime.sendMessage({
                type: 'saveCrossChatModuleSettings',
                settings: currentSettings,
            });
            // Optional: add a success indicator if needed
        } catch (error) {
            console.error('Error saving cross-chat module settings:', error);
            window.showToast('Error saving module settings.', 'error');
        }
    }

    // --- UI Update ---
    function updateUIFromState() {
        // Main toggle
        enableToggle.checked = currentSettings.enabled;

        // Settings
        autosendCopyToggle.checked = currentSettings.autosendCopy;
        autosendPasteToggle.checked = currentSettings.autosendPaste;

        for (const radio of placementRadios) {
            if (radio.value === currentSettings.placement) {
                radio.checked = true;
                break;
            }
        }
        // Update visibility based on the new state
        updateSettingsVisibility();
    }

    // Helper function to manage settings visibility based on both toggle state and collapsible state
    function updateSettingsVisibility() {
        const isModuleExpanded = crossChatModule.classList.contains('expanded');
        const isToggleEnabled = currentSettings.enabled;

        // Only show settings if both the module is expanded AND the toggle is enabled
        settingsContainer.style.display = (isModuleExpanded && isToggleEnabled) ? 'block' : 'none';
    }

    // --- Observer for Section Expansion ---
    // The centralized collapsible script handles the click and toggles the .expanded class.
    // We use a MutationObserver to react to that class change and update our UI accordingly.
    const observer = new MutationObserver(() => {
        // When the section is expanded or collapsed, we need to re-evaluate
        // whether the settings sub-section should be visible.
        updateSettingsVisibility();
    });

    // Start observing the crossChatModule for class attribute changes.
    observer.observe(crossChatModule, { attributes: true, attributeFilter: ['class'] });

    // --- Prompt Actions ---
    async function refreshStoredPrompt() {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'getStoredPrompt' });
            if (response && typeof response.promptText !== 'undefined') {
                storedPromptDisplay.value = response.promptText;
                storedPromptDisplay.placeholder = response.promptText
                    ? ''
                    : 'No prompt has been saved.';
            }
        } catch (error) {
            console.error('Error fetching stored prompt:', error);
            storedPromptDisplay.value = 'Error loading prompt.';
        }
    }

    async function clearStoredPrompt() {
        if (!confirm('Are you sure you want to clear the stored prompt?')) {
            return;
        }
        try {
            await chrome.runtime.sendMessage({ type: 'clearStoredPrompt' });
            await refreshStoredPrompt(); // Refresh display to show it's empty
            window.showToast('Stored prompt cleared.', 'success');
        } catch (error) {
            console.error('Error clearing stored prompt:', error);
            window.showToast('Failed to clear prompt.', 'error');
        }
    }

    // --- Event Listeners ---
    enableToggle.addEventListener('change', () => {
        currentSettings.enabled = enableToggle.checked;
        updateSettingsVisibility();
        saveModuleSettings();
    });

    autosendCopyToggle.addEventListener('change', () => {
        currentSettings.autosendCopy = autosendCopyToggle.checked;
        saveModuleSettings();
    });

    autosendPasteToggle.addEventListener('change', () => {
        currentSettings.autosendPaste = autosendPasteToggle.checked;
        saveModuleSettings();
    });

    for (const radio of placementRadios) {
        radio.addEventListener('change', () => {
            if (radio.checked) {
                currentSettings.placement = radio.value;
                saveModuleSettings();
            }
        });
    }

    refreshPromptBtn.addEventListener('click', refreshStoredPrompt);
    clearPromptBtn.addEventListener('click', clearStoredPrompt);

    // --- Initial Load ---
    loadModuleState();
});