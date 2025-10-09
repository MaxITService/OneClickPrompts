// popup-page-profiles.js
// instructions for the AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// There are just helper functions that handle profile switching and so on.
// -------------------------
// 1. Minimal Default Config
// -------------------------

// Minimal Default configuration object for empty profiles
const minimalDefaultConfig = {
    PROFILE_NAME: "Empty Profile",
    ENABLE_SHORTCUTS_DEFAULT: true,
    globalAutoSendEnabled: true,
    enableShortcuts: true,
    firstModificationDone: false,
    customButtons: [], // No buttons or separators
    queueRandomizeEnabled: false,
    queueRandomizePercent: 5,
    queueHideActivationToggle: false
};

// -------------------------
// 2. Profile Management Functions
// -------------------------

/**
 * Loads all profiles and sets the current profile.
 */
async function loadProfiles() {
    try {
        // Ensure a profile exists before listing; creates Default on first run.
        const configResponse = await chrome.runtime.sendMessage({ type: 'getConfig' });
        currentProfile = configResponse.config;

        // Retrieve all stored profiles.
        const profilesResponse = await chrome.runtime.sendMessage({ type: 'listProfiles' });
        profileSelect.innerHTML = ''; // Clear existing options.

        // Use returned profiles or fall back to the current profile name if none exist.
        const profiles = (profilesResponse.profiles && profilesResponse.profiles.length > 0)
            ? profilesResponse.profiles
            : [currentProfile.PROFILE_NAME];
        if (!profilesResponse.profiles || profilesResponse.profiles.length === 0) {
            logToGUIConsole('No stored profiles found; using current profile as fallback.');
        }

        profiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile;
            option.textContent = profile;
            profileSelect.appendChild(option);
        });

        // Set the current profile as selected
        profileSelect.value = currentProfile.PROFILE_NAME;

        updateInterface();
        logToGUIConsole(`Loaded profile: ${currentProfile.PROFILE_NAME}`);
    } catch (error) {
        logToGUIConsole(`Error loading profiles: ${error.message}`);
    }
}

/**
 * Switches to a different profile.
 * @param {string} profileName - The name of the profile to switch to.
 */
async function switchProfile(profileName) {
    try {
        // Request the profile switch.
        await chrome.runtime.sendMessage({
            type: 'switchProfile',
            profileName: profileName
        });

        // Now retrieve the configuration for the current profile.
        const configResponse = await chrome.runtime.sendMessage({ type: 'getConfig' });
        if (configResponse && configResponse.config) {
            currentProfile = configResponse.config;
            updateInterface();
            logToGUIConsole(`Switched to profile: ${profileName}`);
            updateSaveStatus();
        } else {
            logToGUIConsole(`Error: Unable to retrieve configuration after switching to profile "${profileName}".`);
        }
    } catch (error) {
        logToGUIConsole(`Error switching profile: ${error.message}`);
    }
}



// -------------------------
// 3. Profile Actions (Add, Copy, Delete)
// -------------------------

/**
 * Validates a profile name against being empty or already existing.
 * @param {string} profileName - The name to validate.
 * @param {string} actionType - The type of action (e.g., 'creation', 'copy') for logging.
 * @returns {{isValid: boolean, name: string|null}} - An object indicating if the name is valid and the trimmed name.
 */
function validateProfileName(profileName, actionType) {
    const trimmedProfileName = profileName.trim();
    if (trimmedProfileName === "") {
        showToast('Profile name cannot be empty.', 'error');
        logToGUIConsole(`Profile ${actionType} failed: Empty name provided.`);
        return { isValid: false, name: null };
    }

    const existingProfiles = Array.from(profileSelect.options).map(option => option.value);
    if (existingProfiles.includes(trimmedProfileName)) {
        showToast('A profile with this name already exists.', 'error');
        logToGUIConsole(`Profile ${actionType} failed: "${trimmedProfileName}" already exists.`);
        return { isValid: false, name: null };
    }
    return { isValid: true, name: trimmedProfileName };
}

/**
 * Creates a new empty profile.
 * @param {string} profileName - The name of the new profile.
 */
async function addNewEmptyProfile(profileName) {
    const validation = validateProfileName(profileName, 'creation');
    if (!validation.isValid) return false;
    const trimmedProfileName = validation.name;

    try {
        // Initialize new profile with minimal settings
        const newConfig = { ...minimalDefaultConfig, PROFILE_NAME: trimmedProfileName };
        await chrome.runtime.sendMessage({
            type: 'saveConfig',
            profileName: trimmedProfileName,
            config: newConfig
        });

        await loadProfiles();
        profileSelect.value = trimmedProfileName;
        await switchProfile(trimmedProfileName);
        showToast(`Profile "${trimmedProfileName}" added successfully.`, 'success');
        logToGUIConsole(`Created new empty profile: ${trimmedProfileName}`);
        return true;
    } catch (error) {
        showToast(`Error creating profile: ${error.message}`, 'error');
        logToGUIConsole(`Error creating profile: ${error.message}`);
        return false;
    }
}

// -------------------------
/**
 * Copies the current profile to a new profile.
 * @param {string} profileName - The name of the new profile.
 */
async function copyCurrentProfile(profileName) {
    const validation = validateProfileName(profileName, 'copy');
    if (!validation.isValid) return false;
    const trimmedProfileName = validation.name;

    try {
        // Deep copy current profile settings
        const newConfig = JSON.parse(JSON.stringify(currentProfile));
        newConfig.PROFILE_NAME = trimmedProfileName;

        await chrome.runtime.sendMessage({
            type: 'saveConfig',
            profileName: trimmedProfileName,
            config: newConfig
        });

        await loadProfiles();
        profileSelect.value = trimmedProfileName;
        await switchProfile(trimmedProfileName);
        showToast(`Profile duplicated as "${trimmedProfileName}" successfully.`, 'success');
        logToGUIConsole(`Copied profile to new profile: ${trimmedProfileName}`);
        return true;
    } catch (error) {
        showToast(`Error copying profile: ${error.message}`, 'error');
        logToGUIConsole(`Error copying profile: ${error.message}`);
        return false;
    }
}

/**
 * Deletes the current profile.
 */
async function deleteCurrentProfile() {
    // --- Modified deletion logic for safety ---
    // Check that currentProfile is defined and has a PROFILE_NAME property.
    if (!currentProfile || !currentProfile.PROFILE_NAME) {
        showToast('No profile is loaded to delete.', 'error');
        return;
    }

    const profileName = currentProfile.PROFILE_NAME;

    if (profileName === 'Default') {
        alert('Cannot delete Default profile');
        return;
    }

    if (!confirm(`Delete profile "${profileName}"?`)) return;

    try {
        await chrome.runtime.sendMessage({
            type: 'deleteProfile',
            profileName: profileName
        });

        await loadProfiles();
        logToGUIConsole(`Deleted profile: ${profileName}`);
        showToast(`Profile "${profileName}" deleted successfully.`, 'success');
    } catch (error) {
        showToast(`Error deleting profile: ${error.message}`, 'error');
        logToGUIConsole(`Error deleting profile: ${error.message}`);
    }
}


