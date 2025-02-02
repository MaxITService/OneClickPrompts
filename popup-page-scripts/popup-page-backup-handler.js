// popup-page-backup-handler.js
// Version: 1.1
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.

'use strict';

// Function to export the current profile as a JSON file
function exportCurrentProfile() {
    logToConsole('Initiating profile export...');

    try {
        // Serialize the currentProfile to JSON
        const profileJSON = JSON.stringify(currentProfile, null, 2);
        logToConsole('Serialized currentProfile to JSON.');

        // Create a Blob from the JSON string
        const blob = new Blob([profileJSON], { type: 'application/json' });
        logToConsole('Created Blob from JSON string.');

        // Create a temporary <a> element
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentProfile.PROFILE_NAME}_profile.json`;

        // Append to the document, trigger click, and remove
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        logToConsole('Triggered download of the profile JSON file.');

        // Revoke the object URL
        URL.revokeObjectURL(url);
        logToConsole('Revoked the object URL.');

        // Show a toast notification after initiating the download
        showToast('Profile Download Initiated', 'success');
    } catch (error) {
        console.error('Error during profile export:', error);
        logToConsole(`Error during profile export: ${error.message}`);
        // Use toast notification instead of alert
        showToast('Failed to export profile. Please try again.', 'error');
    }
}

// Function to handle import profile button click
function handleImportButtonClick() {
    logToConsole('Export Profile button clicked.');
    // Trigger the hidden file input
    document.getElementById('importFileInput').click();
}

// Function to handle the file input change event
async function handleImportProfile(event) {
    const file = event.target.files[0];
    if (!file) {
        logToConsole('No file selected for import.');
        return;
    }

    logToConsole(`Selected file for import: ${file.name}`);

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            logToConsole(`Reading file content: ${file.name}`);
            const parsedProfile = JSON.parse(e.target.result);
            logToConsole('Parsed JSON content successfully.');

            // Validate the parsed profile (e.g., check required fields)
            if (!parsedProfile.PROFILE_NAME || !parsedProfile.customButtons) {
                throw new Error('Invalid profile format. Missing required fields.');
            }
            logToConsole('Imported profile structure is valid.');

            // Fetch the list of existing profiles
            const response = await chrome.runtime.sendMessage({ type: 'listProfiles' });
            const existingProfiles = response.profiles;

            // Check if a profile with the same name exists
            if (existingProfiles.includes(parsedProfile.PROFILE_NAME)) {
                logToConsole(`A profile named "${parsedProfile.PROFILE_NAME}" already exists.`);
                // Show the confirmation div
                document.getElementById('confirmationDiv').style.display = 'block';
                // Scroll to the confirmation div
                document.getElementById('confirmationDiv').scrollIntoView({ behavior: 'smooth' });
                document.getElementById('errorDiv').style.display = 'none';

                // Store the parsedProfile temporarily
                window.tempParsedProfile = parsedProfile;
            } else {
                logToConsole(`Profile name "${parsedProfile.PROFILE_NAME}" does not exist. Importing as a new profile.`);
                // Directly import the new profile
                importProfile(parsedProfile);
            }
        } catch (error) {
            console.error('Error parsing profile:', error);
            logToConsole(`Error parsing profile: ${error.message}`);
            document.getElementById('errorDiv').style.display = 'block';
        }
    };
    reader.onerror = function (error) {
        console.error('File reading error:', error);
        logToConsole(`File reading error: ${error.message}`);
        document.getElementById('errorDiv').style.display = 'block';
    };
    reader.readAsText(file);

    // Reset the file input value to allow re-importing the same file if needed
    event.target.value = '';
}

// Function to overwrite the existing profile with the parsed profile
async function overwriteCurrentProfile() {
    const parsedProfile = window.tempParsedProfile;
    if (!parsedProfile) {
        logToConsole('No parsed profile available to overwrite.');
        return;
    }

    logToConsole(`Overwriting existing profile "${parsedProfile.PROFILE_NAME}" with imported profile.`);

    try {
        await chrome.runtime.sendMessage({
            type: 'saveConfig',
            profileName: parsedProfile.PROFILE_NAME,
            config: parsedProfile
        });

        // Reload profiles and switch to the imported profile
        await loadProfiles();
        profileSelect.value = parsedProfile.PROFILE_NAME;
        await switchProfile(parsedProfile.PROFILE_NAME);

        updateInterface();
        logToConsole(`Profile "${parsedProfile.PROFILE_NAME}" imported and overwritten successfully.`);
        // Use toast notification instead of alert
        showToast(`Profile "${parsedProfile.PROFILE_NAME}" has been overwritten successfully.`, 'success');
    } catch (error) {
        logToConsole(`Failed to save the imported profile: ${error.message}`);
        // Use toast notification instead of alert
        showToast('Failed to overwrite the existing profile. Please try again.', 'error');
    }

    // Hide the confirmation div
    document.getElementById('confirmationDiv').style.display = 'none';

    // Clear the temporary parsed profile
    window.tempParsedProfile = null;
}

// Function to cancel the import process
function cancelImport() {
    logToConsole('User canceled the profile overwrite.');
    // Hide the confirmation div
    document.getElementById('confirmationDiv').style.display = 'none';

    // Clear the temporary parsed profile
    window.tempParsedProfile = null;
}

// Function to import profile directly without confirmation
async function importProfile(parsedProfile) {
    logToConsole(`Importing profile "${parsedProfile.PROFILE_NAME}" as a new profile.`);
    try {
        await chrome.runtime.sendMessage({
            type: 'saveConfig',
            profileName: parsedProfile.PROFILE_NAME,
            config: parsedProfile
        });

        // Reload profiles and switch to the new profile
        await loadProfiles();
        profileSelect.value = parsedProfile.PROFILE_NAME;
        await switchProfile(parsedProfile.PROFILE_NAME);

        updateInterface();
        logToConsole(`Profile "${parsedProfile.PROFILE_NAME}" imported successfully.`);
        // Use toast notification instead of alert
        showToast(`Profile "${parsedProfile.PROFILE_NAME}" has been imported successfully.`, 'success');
    } catch (error) {
        logToConsole(`Failed to save the imported profile: ${error.message}`);
        // Use toast notification instead of alert
        showToast('Failed to import the profile. Please try again.', 'error');
    }
}

// Attach event listeners after DOM content is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Export Profile button
    document.getElementById('exportProfile').addEventListener('click', exportCurrentProfile);

    // Import Profile button
    document.getElementById('importProfile').addEventListener('click', handleImportButtonClick);

    // File input change event
    document.getElementById('importFileInput').addEventListener('change', handleImportProfile);

    // Confirmation buttons
    document.getElementById('confirmOverwrite').addEventListener('click', overwriteCurrentProfile);
    document.getElementById('cancelOverwrite').addEventListener('click', cancelImport);
});
