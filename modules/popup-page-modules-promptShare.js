'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // --- Module Elements ---
    const crossChatModule = document.getElementById('crossChatModule');
    const enableToggle = document.getElementById('crossChatModuleEnableToggle');
    const settingsContainer = document.getElementById('crossChatModuleSettings');

    // Settings Elements
    const autosendGroup = document.getElementById('crossChatAutosendGroup');
    const autosendCopyToggle = document.getElementById('crossChatAutosendCopy');
    const autosendPasteToggle = document.getElementById('crossChatAutosendPaste');
    const dangerBroadcastToggle = document.getElementById('crossChatDangerAutoSendAll');
    const hideStandardButtonsToggle = document.getElementById('crossChatHideStandardButtons');
    const placementRadios = document.getElementsByName('crossChatButtonPlacement');

    // Stored Prompt Elements
    const storedPromptDisplay = document.getElementById('storedPromptDisplay');
    const refreshPromptBtn = document.getElementById('refreshStoredPrompt');
    const clearPromptBtn = document.getElementById('clearStoredPrompt');

    // Gracefully exit if essential elements for this module are missing.
    // This no longer breaks the parent container's collapsible functionality.
    if (!crossChatModule || !enableToggle || !settingsContainer || !autosendCopyToggle || !dangerBroadcastToggle || !hideStandardButtonsToggle) {
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
        dangerAutoSendAll: false,
        hideStandardButtons: false,
        placement: 'after',
    };

    let currentSettings = { ...defaultSettings };

    async function loadModuleState() {
        try {
            // Load settings
            const response = await chrome.runtime.sendMessage({ type: 'getCrossChatModuleSettings' });
            if (response && response.settings) {
                currentSettings = { ...defaultSettings, ...response.settings };
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
        dangerBroadcastToggle.checked = currentSettings.dangerAutoSendAll;
        hideStandardButtonsToggle.checked = currentSettings.hideStandardButtons;

        for (const radio of placementRadios) {
            if (radio.value === currentSettings.placement) {
                radio.checked = true;
                break;
            }
        }
        // Update visibility based on the new state
        updateSettingsVisibility();
        updateAutosendAvailability();
    }

    // Helper function to manage settings visibility based on both toggle state and collapsible state
    function updateSettingsVisibility() {
        const isModuleExpanded = crossChatModule.classList.contains('expanded');
        // The visibility of settings now ONLY depends on whether the section is expanded.
        // The toggle's state is reflected by the toggle itself, not by hiding the section.
        settingsContainer.style.display = isModuleExpanded ? 'block' : 'none';
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
    enableToggle.addEventListener('change', async () => {
        currentSettings.enabled = enableToggle.checked;
        // The toggle now only changes the setting and saves it; it does not control UI visibility.
        await saveModuleSettings();
        
        // Trigger button cards re-render when enable/disable is toggled
        // This is needed because hotkey numbering depends on whether cross-chat is enabled
        if (typeof updatebuttonCardsList === 'function') {
            try {
                await updatebuttonCardsList();
                console.log('Button cards updated after toggling cross-chat module');
            } catch (error) {
                console.error('Error updating button cards after toggling cross-chat module:', error);
            }
        }
    });

    function updateAutosendAvailability() {
        const hideStandard = hideStandardButtonsToggle.checked;
        const shouldDisableAutosend = hideStandard;

        if (shouldDisableAutosend) {
            if (autosendGroup) {
                autosendGroup.classList.add('is-disabled');
                autosendGroup.setAttribute('aria-disabled', 'true');
            }
            autosendCopyToggle.disabled = true;
            autosendPasteToggle.disabled = true;
        } else {
            if (autosendGroup) {
                autosendGroup.classList.remove('is-disabled');
                autosendGroup.removeAttribute('aria-disabled');
            }
            autosendCopyToggle.disabled = false;
            autosendCopyToggle.removeAttribute('disabled');
            autosendPasteToggle.disabled = false;
            autosendPasteToggle.removeAttribute('disabled');
        }
    }

    async function refreshCrossChatButtonsVisibility() {
        const visibilityUpdater = typeof window.updateCrossChatButtonsVisibility === 'function'
            ? window.updateCrossChatButtonsVisibility
            : null;
        if (visibilityUpdater) {
            try {
                await visibilityUpdater();
                return;
            } catch (error) {
                console.error('Error while updating Cross-Chat buttons visibility:', error);
            }
        }

        const cardListUpdater = typeof window.updatebuttonCardsList === 'function'
            ? window.updatebuttonCardsList
            : null;
        if (cardListUpdater) {
            try {
                await cardListUpdater();
                console.log('Button cards updated after Cross-Chat visibility change');
            } catch (error) {
                console.error('Error updating button cards after Cross-Chat visibility change:', error);
            }
        }
    }

    autosendCopyToggle.addEventListener('change', () => {
        currentSettings.autosendCopy = autosendCopyToggle.checked;
        saveModuleSettings();
    });

    autosendPasteToggle.addEventListener('change', () => {
        currentSettings.autosendPaste = autosendPasteToggle.checked;
        saveModuleSettings();
    });

    dangerBroadcastToggle.addEventListener('change', async () => {
        currentSettings.dangerAutoSendAll = dangerBroadcastToggle.checked;
        updateAutosendAvailability();
        await saveModuleSettings();
        await refreshCrossChatButtonsVisibility();
    });

    hideStandardButtonsToggle.addEventListener('change', async () => {
        currentSettings.hideStandardButtons = hideStandardButtonsToggle.checked;
        updateAutosendAvailability();
        await saveModuleSettings();
        await refreshCrossChatButtonsVisibility();
    });

    for (const radio of placementRadios) {
        radio.addEventListener('change', async () => {
            if (radio.checked) {
                currentSettings.placement = radio.value;
                await saveModuleSettings();
                
                // Trigger button cards re-render to update hotkey numbering
                if (typeof updatebuttonCardsList === 'function') {
                    try {
                        await updatebuttonCardsList();
                        console.log('Button cards updated with new hotkey numbering');
                    } catch (error) {
                        console.error('Error updating button cards after placement change:', error);
                    }
                }
            }
        });
    }

    refreshPromptBtn.addEventListener('click', refreshStoredPrompt);
    clearPromptBtn.addEventListener('click', clearStoredPrompt);

    // --- Initial Load ---
    loadModuleState();
});
