// popup-page-backup-handler.js
// Version: 1.0
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.

// Function to export the current profile as a JSON file
function exportCurrentProfile() {
    // Serialize the currentProfile to JSON
    const profileJSON = JSON.stringify(currentProfile, null, 2);
    
    // Create a Blob from the JSON string
    const blob = new Blob([profileJSON], { type: 'application/json' });
    
    // Create a temporary <a> element
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProfile.PROFILE_NAME}_profile.json`;
    
    // Append to the document, trigger click, and remove
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Revoke the object URL
    URL.revokeObjectURL(url);
    
    logToConsole('Profile exported successfully.');
}

// Function to handle import profile button click
function handleImportButtonClick() {
    // Trigger the hidden file input
    document.getElementById('importFileInput').click();
}

// Function to handle the file input change event
function handleImportProfile(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsedProfile = JSON.parse(e.target.result);
            
            // Validate the parsed profile (e.g., check required fields)
            if (!parsedProfile.PROFILE_NAME || !parsedProfile.customButtons) {
                throw new Error('Invalid profile format.');
            }
            
            // Additional validation for date formats or other fields can be added here
            
            // Show the confirmation div
            document.getElementById('confirmationDiv').style.display = 'block';
            
            // Store the parsedProfile temporarily
            window.tempParsedProfile = parsedProfile;
            
            // Hide the error div if previously shown
            document.getElementById('errorDiv').style.display = 'none';
        } catch (error) {
            console.error('Error parsing profile:', error);
            document.getElementById('errorDiv').style.display = 'block';
        }
    };
    reader.readAsText(file);
    
    // Reset the file input value to allow re-importing the same file if needed
    event.target.value = '';
}

// Function to overwrite the current profile with the parsed profile
async function overwriteCurrentProfile() {
    const parsedProfile = window.tempParsedProfile;
    if (!parsedProfile) return;
    
    currentProfile = parsedProfile;
    const saveSuccess = await saveCurrentProfile();
    
    if (saveSuccess) {
        updateInterface();
        logToConsole(`Profile "${currentProfile.PROFILE_NAME}" imported and overwritten successfully.`);
    } else {
        logToConsole('Failed to save the imported profile.');
    }
    
    // Hide the confirmation div
    document.getElementById('confirmationDiv').style.display = 'none';
    
    // Clear the temporary parsed profile
    window.tempParsedProfile = null;
}

// Function to cancel the import process
function cancelImport() {
    // Hide the confirmation div
    document.getElementById('confirmationDiv').style.display = 'none';
    
    // Clear the temporary parsed profile
    window.tempParsedProfile = null;
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
