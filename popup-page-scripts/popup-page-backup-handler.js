// popup-page-backup-handler.js
// Version: 1.1
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.

'use strict';

// Function to export the current profile as a JSON file
function exportCurrentProfile() {
    logToGUIConsole('Initiating profile export...');

    try {
        // Serialize the currentProfile to JSON
        const profileJSON = JSON.stringify(currentProfile, null, 2);
        logToGUIConsole('Serialized currentProfile to JSON.');

        // Create a Blob from the JSON string
        const blob = new Blob([profileJSON], { type: 'application/json' });
        logToGUIConsole('Created Blob from JSON string.');

        // Create a temporary <a> element
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentProfile.PROFILE_NAME}_profile.json`;

        // Append to the document, trigger click, and remove
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        logToGUIConsole('Triggered download of the profile JSON file.');

        // Revoke the object URL
        URL.revokeObjectURL(url);
        logToGUIConsole('Revoked the object URL.');

        // Show a toast notification after initiating the download
        showToast('Profile Download Initiated', 'success');
    } catch (error) {
        console.error('Error during profile export:', error);
        logToGUIConsole(`Error during profile export: ${error.message}`);
        // Use toast notification instead of alert
        showToast('Failed to export profile. Please try again.', 'error');
    }
}

// Function to handle import profile button click
function handleImportButtonClick() {
    logToGUIConsole('Export Profile button clicked.');
    // Trigger the hidden file input
    document.getElementById('importFileInput').click();
}

// Function to handle the file input change event
async function handleImportProfile(event) {
    const file = event.target.files[0];
    if (!file) {
        logToGUIConsole('No file selected for import.');
        return;
    }

    logToGUIConsole(`Selected file for import: ${file.name}`);

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            logToGUIConsole(`Reading file content: ${file.name}`);
            const parsedProfile = JSON.parse(e.target.result);
            logToGUIConsole('Parsed JSON content successfully.');

            // Validate the parsed profile (e.g., check required fields)
            if (!parsedProfile.PROFILE_NAME || !parsedProfile.customButtons) {
                throw new Error('Invalid profile format. Missing required fields.');
            }
            logToGUIConsole('Imported profile structure is valid.');

            // Fetch the list of existing profiles
            const response = await chrome.runtime.sendMessage({ type: 'listProfiles' });
            const existingProfiles = response.profiles;

            // Check if a profile with the same name exists
            if (existingProfiles.includes(parsedProfile.PROFILE_NAME)) {
                logToGUIConsole(`A profile named "${parsedProfile.PROFILE_NAME}" already exists.`);
                // Show the confirmation div
                document.getElementById('confirmationDiv').style.display = 'block';
                // Scroll to the confirmation div
                document.getElementById('confirmationDiv').scrollIntoView({ behavior: 'smooth' });
                document.getElementById('errorDiv').style.display = 'none';

                // Store the parsedProfile temporarily
                window.tempParsedProfile = parsedProfile;
            } else {
                logToGUIConsole(`Profile name "${parsedProfile.PROFILE_NAME}" does not exist. Importing as a new profile.`);
                // Directly import the new profile
                importProfile(parsedProfile);
            }
        } catch (error) {
            console.error('Error parsing profile:', error);
            logToGUIConsole(`Error parsing profile: ${error.message}`);
            document.getElementById('errorDiv').style.display = 'block';
        }
    };
    reader.onerror = function (error) {
        console.error('File reading error:', error);
        logToGUIConsole(`File reading error: ${error.message}`);
        document.getElementById('errorDiv').style.display = 'block';
    };
    reader.readAsText(file);

    // Reset the file input value to allow re-importing the same file if needed
    event.target.value = '';
}

/**
 * Handles the logic for saving a profile (new or overwritten) and updating the UI.
 * @param {object} parsedProfile - The profile object to save.
 * @param {boolean} isOverwrite - Indicates if this is an overwrite operation.
 */
async function saveAndSwitchToImportedProfile(parsedProfile, isOverwrite) {
    const actionText = isOverwrite ? 'overwritten' : 'imported';
    const actionVerb = isOverwrite ? 'overwrite' : 'import';

    try {
        await chrome.runtime.sendMessage({
            type: 'saveConfig',
            profileName: parsedProfile.PROFILE_NAME,
            config: parsedProfile
        });

        // Reload profiles and switch to the new/overwritten profile
        await loadProfiles();
        profileSelect.value = parsedProfile.PROFILE_NAME;
        await switchProfile(parsedProfile.PROFILE_NAME);

        await updateInterface(); // Now awaiting the async function
        logToGUIConsole(`Profile "${parsedProfile.PROFILE_NAME}" ${actionText} successfully.`);
        showToast(`Profile "${parsedProfile.PROFILE_NAME}" has been ${actionText} successfully.`, 'success');
    } catch (error) {
        logToGUIConsole(`Failed to save the imported profile: ${error.message}`);
        showToast(`Failed to ${actionVerb} the profile. Please try again.`, 'error');
    }
}

// Function to overwrite the existing profile with the parsed profile
async function overwriteCurrentProfile() {
    const parsedProfile = window.tempParsedProfile;
    if (!parsedProfile) {
        logToGUIConsole('No parsed profile available to overwrite.');
        return;
    }

    logToGUIConsole(`Overwriting existing profile "${parsedProfile.PROFILE_NAME}" with imported profile.`);

    await saveAndSwitchToImportedProfile(parsedProfile, true);

    // Hide the confirmation div
    document.getElementById('confirmationDiv').style.display = 'none';

    // Clear the temporary parsed profile
    window.tempParsedProfile = null;
}

// Function to cancel the import process
function cancelImport() {
    logToGUIConsole('User canceled the profile overwrite.');
    // Hide the confirmation div
    document.getElementById('confirmationDiv').style.display = 'none';

    // Clear the temporary parsed profile
    window.tempParsedProfile = null;
}

// Function to import profile directly without confirmation
async function importProfile(parsedProfile) {
    logToGUIConsole(`Importing profile "${parsedProfile.PROFILE_NAME}" as a new profile.`);
    await saveAndSwitchToImportedProfile(parsedProfile, false);
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

