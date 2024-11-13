// popup-page-script.js
// Version: 1.5
// Main script for Max Extension configuration interface

'use strict';

// State management
let currentProfile = null;
let isDragging = false;
let draggedItem = null;

// DOM Elements
const profileSelect = document.getElementById('profileSelect');
const buttonList = document.getElementById('buttonList');
const consoleOutput = document.getElementById('console');
const saveStatus = document.getElementById('saveStatus');

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
    customButtons: [] // No buttons or separators
};

// -------------------------
// 2. Profile Management Functions
// -------------------------

// Load all profiles and set the current profile
async function loadProfiles() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'listProfiles' });
        profileSelect.innerHTML = ''; // Clear existing options

        response.profiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile;
            option.textContent = profile;
            profileSelect.appendChild(option);
        });

        // Load current profile
        const configResponse = await chrome.runtime.sendMessage({ type: 'getConfig' });
        currentProfile = configResponse.config;
        profileSelect.value = currentProfile.PROFILE_NAME;

        updateInterface();
        logToConsole(`Loaded profile: ${currentProfile.PROFILE_NAME}`);
    } catch (error) {
        logToConsole(`Error loading profiles: ${error.message}`);
    }
}

// Switch to a different profile
async function switchProfile(profileName) {
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'switchProfile',
            profileName: profileName
        });

        currentProfile = response.config;
        updateInterface();
        logToConsole(`Switched to profile: ${profileName}`);
        updateSaveStatus();
    } catch (error) {
        logToConsole(`Error switching profile: ${error.message}`);
    }
}

// -------------------------
// 3. Add New Empty Profile
// -------------------------

// Function to create a new empty profile using minimalDefaultConfig
async function addNewEmptyProfile() {
    const profileName = prompt('Enter new profile name:');
    if (!profileName) {
        logToConsole('Profile creation canceled: No name provided.');
        return;
    }

    // Trim whitespace and validate profile name
    const trimmedProfileName = profileName.trim();
    if (trimmedProfileName === "") {
        alert('Profile name cannot be empty.');
        logToConsole('Profile creation failed: Empty name provided.');
        return;
    }

    // Check if profile name already exists
    const existingProfiles = Array.from(profileSelect.options).map(option => option.value);
    if (existingProfiles.includes(trimmedProfileName)) {
        alert('A profile with this name already exists. Please choose a different name.');
        logToConsole(`Profile creation failed: "${trimmedProfileName}" already exists.`);
        return;
    }

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
        logToConsole(`Created new empty profile: ${trimmedProfileName}`);
    } catch (error) {
        logToConsole(`Error creating profile: ${error.message}`);
    }
}

// -------------------------
// 4. Copy Current Profile
// (Optional: No changes needed for Step 1 and 2)
// -------------------------

async function copyCurrentProfile() {
    const newProfileName = prompt('Enter a name for the new profile:');
    if (!newProfileName) {
        logToConsole('Profile copy canceled: No name provided.');
        return;
    }

    // Check if profile name already exists
    const existingProfiles = Array.from(profileSelect.options).map(option => option.value);
    if (existingProfiles.includes(newProfileName)) {
        alert('A profile with this name already exists. Please choose a different name.');
        logToConsole(`Profile copy failed: "${newProfileName}" already exists.`);
        return;
    }

    try {
        // Deep copy current profile settings
        const newConfig = JSON.parse(JSON.stringify(currentProfile));
        newConfig.PROFILE_NAME = newProfileName;

        await chrome.runtime.sendMessage({
            type: 'saveConfig',
            profileName: newProfileName,
            config: newConfig
        });

        await loadProfiles();
        profileSelect.value = newProfileName;
        await switchProfile(newProfileName);
        logToConsole(`Copied profile to new profile: ${newProfileName}`);
    } catch (error) {
        logToConsole(`Error copying profile: ${error.message}`);
    }
}

// Delete the current profile
async function deleteCurrentProfile() {
    if (currentProfile.PROFILE_NAME === 'Default') {
        alert('Cannot delete Default profile');
        return;
    }

    if (!confirm(`Delete profile "${currentProfile.PROFILE_NAME}"?`)) return;

    try {
        await chrome.runtime.sendMessage({
            type: 'deleteProfile',
            profileName: currentProfile.PROFILE_NAME
        });

        await loadProfiles();
        logToConsole(`Deleted profile: ${currentProfile.PROFILE_NAME}`);
    } catch (error) {
        logToConsole(`Error deleting profile: ${error.message}`);
    }
}

// -------------------------
// 5. Button Management Functions
// -------------------------

async function addButton() {
    const icon = document.getElementById('buttonIcon').value || '✨';
    const text = document.getElementById('buttonText').value || 'New Button';
    const autoSend = document.getElementById('buttonAutoSendToggle').checked;

    currentProfile.customButtons.push({
        icon: icon,
        text: text,
        autoSend: autoSend
    });

    await saveCurrentProfile();
    updateButtonList();
    logToConsole('Added new button');
}

async function addSeparator() {
    currentProfile.customButtons.push({ separator: true });
    await saveCurrentProfile();
    updateButtonList();
    logToConsole('Added separator');
}

async function deleteButton(index) {
    currentProfile.customButtons.splice(index, 1);
    await saveCurrentProfile();
    updateButtonList();
    logToConsole('Deleted button');
}

// -------------------------
// 7. Settings Management
// -------------------------

async function updateGlobalSettings() {
    currentProfile.globalAutoSendEnabled = document.getElementById('autoSendToggle').checked;
    currentProfile.enableShortcuts = document.getElementById('shortcutsToggle').checked;
    await saveCurrentProfile();
    logToConsole('Updated global settings');
}

async function revertToDefault() {
    if (!confirm('Revert current profile to default settings?')) return;

    try {
        const response = await chrome.runtime.sendMessage({ type: 'createDefaultProfile' });
        currentProfile = response.config;
        await saveCurrentProfile();
        updateInterface();
        logToConsole('Reverted to default settings');
    } catch (error) {
        logToConsole(`Error reverting to default: ${error.message}`);
    }
}

// -------------------------
// 8. Save and Update Functions
// -------------------------

async function saveCurrentProfile() {
    try {
        await chrome.runtime.sendMessage({
            type: 'saveConfig',
            profileName: currentProfile.PROFILE_NAME,
            config: currentProfile
        });
        updateSaveStatus();
        return true;
    } catch (error) {
        logToConsole(`Error saving profile: ${error.message}`);
        return false;
    }
}

function updateSaveStatus() {
    const timestamp = new Date().toLocaleTimeString();
    saveStatus.textContent = `Last saved: ${timestamp}`;
}

// -------------------------
// 10. Event Listeners
// -------------------------

document.addEventListener('DOMContentLoaded', () => {
    loadProfiles();

    // Profile management
    profileSelect.addEventListener('change', (e) => switchProfile(e.target.value));
    document.getElementById('addProfile').addEventListener('click', addNewEmptyProfile);
    document.getElementById('copyProfile').addEventListener('click', copyCurrentProfile);
    document.getElementById('deleteProfile').addEventListener('click', deleteCurrentProfile);

    // Button management
    document.getElementById('addButton').addEventListener('click', addButton);
    document.getElementById('addSeparator').addEventListener('click', addSeparator);

    // Settings
    document.getElementById('autoSendToggle').addEventListener('change', updateGlobalSettings);
    document.getElementById('shortcutsToggle').addEventListener('change', updateGlobalSettings);
    document.getElementById('revertDefault').addEventListener('click', revertToDefault);

    // Drag and drop
    buttonList.addEventListener('dragstart', handleDragStart);
    buttonList.addEventListener('dragover', handleDragOver);
    buttonList.addEventListener('drop', handleDrop);
    buttonList.addEventListener('dragend', handleDragEnd);

    // Button list event delegation
    buttonList.addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-button')) {
            const buttonItem = e.target.closest('.button-item');
            const index = parseInt(buttonItem.dataset.index);
            await deleteButton(index);
        }
    });

    // Initialize event listeners
    attachTextareaAutoResize();
    attachEmojiInputListeners();
    attachAutoSendToggleListeners();
});
