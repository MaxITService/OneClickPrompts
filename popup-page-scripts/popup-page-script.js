// popup-page-script.js
// Version: 1.6.4
// Main script for Max Extension configuration interface

'use strict';

// -------------------------
// Global Variables and State
// -------------------------

// State management
let currentProfile = null;

// Global variable for debounced save timeout
let saveTimeoutId = null;

// DOM Elements
const profileSelect = document.getElementById('profileSelect');
const currentProfileLabel = document.getElementById('currentProfileLabel');
const buttonCardsList = document.getElementById('buttonCardsList');
const consoleOutput = document.getElementById('console');

// New DOM Elements for Profile Actions
const addProfileButton = document.getElementById('addProfile');
const copyProfileButton = document.getElementById('copyProfile');
const deleteProfileButton = document.getElementById('deleteProfile');

const addProfileContainer = document.getElementById('addProfileContainer');
const copyProfileContainer = document.getElementById('copyProfileContainer');

const saveAddProfileButton = document.getElementById('saveAddProfile');
const saveCopyProfileButton = document.getElementById('saveCopyProfile');

const addProfileInput = document.getElementById('addProfileInput');
const copyProfileInput = document.getElementById('copyProfileInput');

// New DOM Elements for Cancel Actions
const cancelAddProfileButton = document.getElementById('cancelAddProfile');
const cancelCopyProfileButton = document.getElementById('cancelCopyProfile');



// Advanced queue settings elements
const queueHideActivationToggleEl = document.getElementById('queueHideActivationToggle');
const queueRandomizeEnabledEl = document.getElementById('queueRandomizeEnabled');
const queueRandomizePercentInput = document.getElementById('queueRandomizePercent');
const queueRandomizePercentRow = document.getElementById('queueRandomizePercentRow');

// -------------------------
// Debounced Save Function
// -------------------------

/**
 * Debounced save function.
 * Clears any pending save and schedules a new one 500ms in the future.
 * This function is used on rapid-fire events (e.g., textarea input) so that
 * saving happens only after 500ms of inactivity.
 */
function debouncedSaveCurrentProfile() {
    if (saveTimeoutId !== null) {
        clearTimeout(saveTimeoutId);
    }
    saveTimeoutId = setTimeout(async () => {
        try {
            await saveCurrentProfile(); // Calls the existing save function
        } catch (error) {
            logToGUIConsole(`Error saving profile: ${error.message}`);
        }
        saveTimeoutId = null;
    }, 150);
}


// -------------------------
// 7. Settings Management
// -------------------------

/**
 * Updates global settings based on user input.
 */
async function updateGlobalSettings() {
    currentProfile.globalAutoSendEnabled = document.getElementById('autoSendToggle').checked;
    currentProfile.enableShortcuts = document.getElementById('shortcutsToggle').checked;
    await saveCurrentProfile();
    logToGUIConsole('Updated global settings');
    showToast('Global settings updated', 'success');
}

/**
 * Ensures advanced queue controls reflect the current profile.
 */
function updateQueueSettingsUIFromProfile() {
    if (!currentProfile) {
        return;
    }

    const hideToggle = Boolean(currentProfile.queueHideActivationToggle);
    const randomizeEnabled = Boolean(currentProfile.queueRandomizeEnabled);
    const randomizePercent = Number.isFinite(currentProfile.queueRandomizePercent)
        ? currentProfile.queueRandomizePercent
        : 5;

    if (queueHideActivationToggleEl) {
        queueHideActivationToggleEl.checked = hideToggle;
    }
    const queueDisabledByHide = enforceQueueDisabledWhenHidden();
    if (queueDisabledByHide) {
        debouncedSaveCurrentProfile();
        logToGUIConsole('Queue disabled because activation toggle is hidden.');
    }
    if (queueRandomizeEnabledEl) {
        queueRandomizeEnabledEl.checked = randomizeEnabled;
    }
    if (queueRandomizePercentInput) {
        queueRandomizePercentInput.value = randomizePercent;
    }
    toggleQueueRandomizePercentRow(randomizeEnabled);
}

/**
 * Shows or hides the randomization percent row based on the toggle state.
 * @param {boolean} isVisible
 */
function toggleQueueRandomizePercentRow(isVisible) {
    if (!queueRandomizePercentRow) return;
    queueRandomizePercentRow.classList.toggle('is-hidden', !isVisible);
}

/**
 * Parses and clamps the randomization percentage between 1 and 100.
 * @param {number} value
 * @returns {number}
 */
function sanitizeQueueRandomizePercent(value) {
    if (!Number.isFinite(value)) {
        return 5;
    }
    const clamped = Math.round(value);
    return Math.min(100, Math.max(1, clamped));
}

/**
 * Disables queue mode whenever the activation toggle is hidden.
 * @returns {boolean} True when the queue state changed.
 */
function enforceQueueDisabledWhenHidden() {
    if (!currentProfile) {
        return false;
    }
    const hideToggleActive = Boolean(currentProfile.queueHideActivationToggle);
    const queueCurrentlyEnabled = Boolean(currentProfile.enableQueueMode);
    if (!hideToggleActive || !queueCurrentlyEnabled) {
        return false;
    }
    currentProfile.enableQueueMode = false;
    return true;
}

/**
 * Handles the hide queue activation toggle.
 */
function handleQueueHideActivationChange(event) {
    if (!currentProfile) return;
    const shouldHide = event.target.checked;
    currentProfile.queueHideActivationToggle = shouldHide;

    const queueDisabled = shouldHide ? enforceQueueDisabledWhenHidden() : false;

    debouncedSaveCurrentProfile();
    const consoleMessage = shouldHide
        ? queueDisabled
            ? 'Queue activation toggle hidden; queue disabled for new tabs.'
            : 'Queue activation toggle hidden.'
        : 'Queue activation toggle visible.';
    logToGUIConsole(consoleMessage);
    const toastMessage = shouldHide
        ? 'Queue activation toggle hidden; queue disabled for new tabs.'
        : 'Queue activation toggle restored.';
    showToast(toastMessage, 'info');
}

/**
 * Handles the randomization toggle.
 */
function handleQueueRandomizeToggleChange(event) {
    if (!currentProfile) return;
    const enabled = event.target.checked;
    currentProfile.queueRandomizeEnabled = enabled;

    if (enabled && !Number.isFinite(currentProfile.queueRandomizePercent)) {
        currentProfile.queueRandomizePercent = 5;
    }

    toggleQueueRandomizePercentRow(enabled);
    debouncedSaveCurrentProfile();
    logToGUIConsole(`Queue delay randomization ${enabled ? 'enabled' : 'disabled'}.`);
    showToast(enabled ? 'Random delay offset enabled.' : 'Random delay offset disabled.', 'success');
}

/**
 * Handles changes to the randomization percent input.
 */
function handleQueueRandomizePercentChange(event) {
    if (!currentProfile) return;
    const parsedValue = sanitizeQueueRandomizePercent(parseInt(event.target.value, 10));
    currentProfile.queueRandomizePercent = parsedValue;
    queueRandomizePercentInput.value = parsedValue;
    debouncedSaveCurrentProfile();
    logToGUIConsole(`Random delay offset set to ${parsedValue}% of base delay.`);
}

/**
 * Reverts the current profile to default settings.
 */
async function revertToDefault() {
    const confirmed = await window.OCPModal.confirm(
        'Are you sure you want to revert the current profile to default settings? This cannot be undone.',
        'Revert to Defaults',
        'error'
    );

    if (!confirmed) return;

    try {
        const response = await chrome.runtime.sendMessage({ type: 'createDefaultProfile' });
        currentProfile = response.config;
        await saveCurrentProfile();
        await updateInterface(); // Now awaiting the async function
        showToast('Reverted to default settings successfully.', 'success');
        logToGUIConsole('Reverted to default settings');
    } catch (error) {
        showToast(`Error reverting to default: ${error.message}`, 'error');
        logToGUIConsole(`Error reverting to default: ${error.message}`);
    }
}

// -------------------------
// 8. Save and Update Functions
// -------------------------

/**
 * Saves the current profile configuration.
 * @returns {Promise<boolean>} - Returns true if save is successful, else false.
 */
async function saveCurrentProfile() {
    try {
        await chrome.runtime.sendMessage({
            type: 'saveConfig',
            profileName: currentProfile.PROFILE_NAME,
            config: currentProfile
        });
        return true;
    } catch (error) {
        logToGUIConsole(`Error saving profile: ${error.message}`);
        return false;
    }
}

/**
 * Updates the entire interface based on the current profile.
 */
/**
 * Updates the entire interface based on the current profile.
 * @param {HTMLElement|null} anchorElement - Optional element to keep visually stable (prevent jumping).
 */
async function updateInterface(anchorElement = null) {
    // --- Added guard to check if currentProfile is valid ---
    if (!currentProfile || !currentProfile.customButtons) {
        logToGUIConsole('No valid current profile found. Attempting to retrieve default profile...');
        try {
            const response = await chrome.runtime.sendMessage({ type: 'getConfig' });
            if (response && response.config) {
                currentProfile = response.config;
                await updateInterface(anchorElement); // Call updateInterface again after retrieving default
            } else {
                logToGUIConsole('Failed to retrieve default profile in updateInterface.');
            }
        } catch (error) {
            logToGUIConsole(`Error retrieving default profile: ${error.message}`);
        }
        return;
    }

    // Capture anchor position relative to viewport BEFORE update
    let anchorOffset = 0;
    if (anchorElement) {
        anchorOffset = anchorElement.getBoundingClientRect().top;
    }

    // Update buttons, settings, etc. based on currentProfile
    // Pass !anchorElement as restoreScroll: if we are anchoring, don't restore old scroll.
    await updatebuttonCardsList(!anchorElement);

    document.getElementById('autoSendToggle').checked = currentProfile.globalAutoSendEnabled;
    document.getElementById('shortcutsToggle').checked = currentProfile.enableShortcuts;

    // Clear input fields
    document.getElementById('buttonIcon').value = '';
    document.getElementById('buttonText').value = '';
    document.getElementById('buttonAutoSendToggle').checked = true; // Reset to default checked

    // Set the profileSelect dropdown to the current profile
    const profileSelect = document.getElementById('profileSelect');
    if (profileSelect) {
        profileSelect.value = currentProfile.PROFILE_NAME;
    }

    updateQueueSettingsUIFromProfile();

    // Restore anchor position relative to viewport AFTER update
    if (anchorElement) {
        const newAnchorTop = anchorElement.getBoundingClientRect().top + window.scrollY;
        // Target: newAnchorTop - window.scrollY = anchorOffset
        // window.scrollY = newAnchorTop - anchorOffset
        window.scrollTo(0, newAnchorTop - anchorOffset);
    }
}

/**
 * Resets and hides the profile action UIs (add/copy) and restores the default view.
 */
function resetProfileActionsUI() {
    // Hide input containers and clear values/errors
    addProfileInput.value = '';
    addProfileInput.style.borderColor = '';
    addProfileInput.classList.remove('input-error');
    addProfileContainer.classList.add('is-hidden');

    copyProfileInput.value = '';
    copyProfileInput.style.borderColor = '';
    copyProfileInput.classList.remove('input-error');
    copyProfileContainer.classList.add('is-hidden');

    // Show the main action buttons
    addProfileButton.classList.remove('is-hidden');
    copyProfileButton.classList.remove('is-hidden');
    deleteProfileButton.classList.remove('is-hidden');

    // Unlock the profile selector
    profileSelect.disabled = false;
    currentProfileLabel.classList.add('is-hidden');
}
// -------------------------
// 9. Event Listeners
// -------------------------

document.addEventListener('DOMContentLoaded', () => {
    loadProfiles();

    // Profile management
    profileSelect.addEventListener('change', (e) => switchProfile(e.target.value));

    // Add Profile Button Click
    addProfileButton.addEventListener('click', () => {
        addProfileContainer.classList.remove('is-hidden');
        addProfileButton.classList.add('is-hidden');
        copyProfileButton.classList.add('is-hidden');
        copyProfileContainer.classList.add('is-hidden');
        deleteProfileButton.classList.add('is-hidden'); // Hide delete button during add
        profileSelect.disabled = true; // Lock profile selector
        currentProfileLabel.classList.remove('is-hidden');
    });

    // Copy Profile Button Click
    copyProfileButton.addEventListener('click', () => {
        copyProfileContainer.classList.remove('is-hidden');
        copyProfileButton.classList.add('is-hidden');
        addProfileButton.classList.add('is-hidden');
        addProfileContainer.classList.add('is-hidden');
        deleteProfileButton.classList.add('is-hidden'); // Hide delete button during copy
        profileSelect.disabled = true; // Lock profile selector
        currentProfileLabel.classList.remove('is-hidden');
    });

    // Save Add Profile Button Click
    saveAddProfileButton.addEventListener('click', async () => {
        const profileName = addProfileInput.value;
        if (profileName.trim() === "") {
            addProfileInput.classList.add('input-error');
            addProfileInput.placeholder = "Enter profile name here";
            addProfileInput.style.borderColor = 'var(--danger-color)';
            showToast('Profile name cannot be empty.', 'error');
            logToGUIConsole('Save Add Profile failed: Empty input.');
            return;
        }
        addProfileInput.classList.remove('input-error');
        const success = await addNewEmptyProfile(profileName);

        if (success) {
            resetProfileActionsUI();
        } else {
            // On failure (e.g., duplicate name), keep UI open for correction
            addProfileInput.classList.add('input-error');
            addProfileInput.style.borderColor = 'var(--danger-color)';
        }
    });

    // Save Copy Profile Button Click
    saveCopyProfileButton.addEventListener('click', async () => {
        const newProfileName = copyProfileInput.value;
        if (newProfileName.trim() === "") {
            copyProfileInput.classList.add('input-error');
            copyProfileInput.placeholder = "Enter new profile name here";
            copyProfileInput.style.borderColor = 'var(--danger-color)';
            showToast('Profile name cannot be empty.', 'error');
            logToGUIConsole('Save Copy Profile failed: Empty input.');
            return;
        }
        copyProfileInput.classList.remove('input-error');
        const success = await copyCurrentProfile(newProfileName);

        if (success) {
            resetProfileActionsUI();
        } else {
            // On failure (e.g., duplicate name), keep UI open for correction
            copyProfileInput.classList.add('input-error');
            copyProfileInput.style.borderColor = 'var(--danger-color)';
        }
    });

    // Delete Profile Button Click
    deleteProfileButton.addEventListener('click', deleteCurrentProfile);

    // Cancel Add Profile Button Click
    cancelAddProfileButton.addEventListener('click', () => {
        resetProfileActionsUI();
    });

    // Cancel Copy Profile Button Click
    cancelCopyProfileButton.addEventListener('click', () => {
        resetProfileActionsUI();
    });

    // Button management
    document.getElementById('addButton').addEventListener('click', e => addButton(e));
    document.getElementById('clearText').addEventListener('click', clearText);
    document.getElementById('addSeparator').addEventListener('click', addSeparator);
    const addSettingsBtnEl = document.getElementById('addSettingsButton');
    if (addSettingsBtnEl) {
        addSettingsBtnEl.addEventListener('click', (e) => addSettingsButton(e));


    }

    // Settings
    document.getElementById('autoSendToggle').addEventListener('change', updateGlobalSettings);
    document.getElementById('shortcutsToggle').addEventListener('change', updateGlobalSettings);
    document.getElementById('revertDefault').addEventListener('click', revertToDefault);
    if (queueHideActivationToggleEl) {
        queueHideActivationToggleEl.addEventListener('change', handleQueueHideActivationChange);
    }
    if (queueRandomizeEnabledEl) {
        queueRandomizeEnabledEl.addEventListener('change', handleQueueRandomizeToggleChange);
    }
    if (queueRandomizePercentInput) {
        queueRandomizePercentInput.addEventListener('change', handleQueueRandomizePercentChange);
    }

    // Drag and drop events - implementation in popup-page-customButtons.js
    // We use a two-phase check to allow dragging the whole card while preventing
    // drags from starting on interactive child elements.
    buttonCardsList.addEventListener('pointerdown', handlePointerDown, true); // Phase 1: Capture the initial target.
    buttonCardsList.addEventListener('dragstart', handleDragStart, true);     // Phase 2: Decide whether to start the drag.
    document.addEventListener('dragover', handleDragOver);                    // Track even when cursor leaves the list.
    buttonCardsList.addEventListener('drop', handleDrop);
    document.addEventListener('dragend', handleDragEnd); // dragend doesn't bubble, must be on document/window.

    // Button list event delegation for delete buttons
    buttonCardsList.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-button')) {
            const buttonItem = e.target.closest('.button-item');
            startUndoableDeletion(buttonItem);
        }
    });

    // Input Field Placeholder Behavior
    addProfileInput.addEventListener('input', () => {
        if (addProfileInput.value.trim() !== "") {
            addProfileInput.style.borderColor = '';
            addProfileInput.classList.remove('input-error');
        }
    });

    copyProfileInput.addEventListener('input', () => {
        if (copyProfileInput.value.trim() !== "") {
            copyProfileInput.style.borderColor = '';
            copyProfileInput.classList.remove('input-error');
        }
    });



    // Initialize event listeners for dynamic elements
    textareaSaverAndResizerFunc();
    attachEmojiInputListeners();
    attachAutoSendToggleListeners();
    // Call the function for your specific textarea by ID
    textareaInputAreaResizerFun('buttonText');

    // -------------------------
    // Open external links in new tabs
    // -------------------------
    function handleExternalLinkClick(e) {
        e.preventDefault();
        const url = e.currentTarget.href;
        chrome.tabs.create({ url });
    }

    const helpSection = document.getElementById('helpSection');
    if (helpSection) {
        const helpLinks = helpSection.querySelectorAll('a[href^="http"]');
        helpLinks.forEach(link => {
            link.addEventListener('click', handleExternalLinkClick);
        });
    }
});

// -------------------------
// 12. Utility Functions
// -------------------------

/**
 * This is not browser console!
 * Logs a message to the user-visible console with a timestamp.
 * @param {string} message - The message to log.
 */
function logToGUIConsole(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.textContent = `${timestamp}: ${message}`;
    consoleOutput.appendChild(logEntry);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

document.getElementById('openWelcomePage').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({
        url: chrome.runtime.getURL('welcome.html')
    });
});
