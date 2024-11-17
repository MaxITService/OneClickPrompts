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
    } catch (error) {
        console.error('Error during profile export:', error);
        logToConsole(`Error during profile export: ${error.message}`);
        alert('Failed to export profile. Please try again.');
    }
}

// Function to handle import profile button click
function handleImportButtonClick() {
    logToConsole('Export Profile button clicked.');
    // Trigger the hidden file input
    document.getElementById('importFileInput').click();
}

// Function to handle the file input change event
function handleImportProfile(event) {
    const file = event.target.files[0];
    if (!file) {
        logToConsole('No file selected for import.');
        return;
    }

    logToConsole(`Selected file for import: ${file.name}`);

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            logToConsole(`Reading file content: ${file.name}`);
            const parsedProfile = JSON.parse(e.target.result);
            logToConsole('Parsed JSON content successfully.');

            // Validate the parsed profile (e.g., check required fields)
            if (!parsedProfile.PROFILE_NAME || !parsedProfile.customButtons) {
                throw new Error('Invalid profile format. Missing required fields.');
            }
            logToConsole('Imported profile structure is valid.');

            // Check if the profile name matches the current profile
            if (parsedProfile.PROFILE_NAME === currentProfile.PROFILE_NAME) {
                logToConsole(`Imported profile name "${parsedProfile.PROFILE_NAME}" matches the current profile.`);
                // Show the confirmation div
                document.getElementById('confirmationDiv').style.display = 'block';
                // Scroll to the confirmation div
                document.getElementById('confirmationDiv').scrollIntoView({ behavior: 'smooth' });
                document.getElementById('errorDiv').style.display = 'none';

                // Store the parsedProfile temporarily
                window.tempParsedProfile = parsedProfile;
            } else {
                logToConsole(`Imported profile name "${parsedProfile.PROFILE_NAME}" does not match the current profile "${currentProfile.PROFILE_NAME}". Proceeding to import without confirmation.`);
                // Directly overwrite the current profile
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

// Function to overwrite the current profile with the parsed profile
async function overwriteCurrentProfile() {
    const parsedProfile = window.tempParsedProfile;
    if (!parsedProfile) {
        logToConsole('No parsed profile available to overwrite.');
        return;
    }

    logToConsole(`Overwriting current profile "${currentProfile.PROFILE_NAME}" with imported profile "${parsedProfile.PROFILE_NAME}".`);
    currentProfile = parsedProfile;
    const saveSuccess = await saveCurrentProfile();

    if (saveSuccess) {
        updateInterface();
        logToConsole(`Profile "${currentProfile.PROFILE_NAME}" imported and overwritten successfully.`);
        alert(`Profile "${currentProfile.PROFILE_NAME}" has been overwritten successfully.`);
    } else {
        logToConsole('Failed to save the imported profile.');
        alert('Failed to overwrite the current profile. Please try again.');
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
    logToConsole(`Importing profile "${parsedProfile.PROFILE_NAME}" directly without confirmation.`);
    currentProfile = parsedProfile;
    const saveSuccess = await saveCurrentProfile();

    if (saveSuccess) {
        updateInterface();
        logToConsole(`Profile "${currentProfile.PROFILE_NAME}" imported successfully.`);
        alert(`Profile "${currentProfile.PROFILE_NAME}" has been imported successfully.`);
    } else {
        logToConsole('Failed to save the imported profile.');
        alert('Failed to import the profile. Please try again.');
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
