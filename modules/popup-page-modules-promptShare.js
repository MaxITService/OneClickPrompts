'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // --- Module Elements ---
    const modulesSection = document.getElementById('modulesSection');
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

    if (!modulesSection || !crossChatModule || !enableToggle) {
        console.log("Cross-Chat module elements not found, skipping initialization.");
        return;
    }

    // --- Collapsible Logic ---
    function setupCollapsible(section) {
        const header = section.querySelector('.section-header, .subsection-header');
        const toggleIcon = header.querySelector('.toggle-icon');
        header.addEventListener('click', () => {
            const isExpanded = section.classList.toggle('expanded');
            if (toggleIcon) {
                toggleIcon.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
            }
        });
    }

    setupCollapsible(modulesSection);
    setupCollapsible(crossChatModule);

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
        settingsContainer.style.display = currentSettings.enabled ? 'block' : 'none';

        // Settings
        autosendCopyToggle.checked = currentSettings.autosendCopy;
        autosendPasteToggle.checked = currentSettings.autosendPaste;

        for (const radio of placementRadios) {
            if (radio.value === currentSettings.placement) {
                radio.checked = true;
                break;
            }
        }
    }

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
        settingsContainer.style.display = currentSettings.enabled ? 'block' : 'none';
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