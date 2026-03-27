// popup-page-backup-handler.js
// Version: 2.0
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.

'use strict';

function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (response && response.error) {
                reject(new Error(response.error));
                return;
            }
            resolve(response);
        });
    });
}

function getBackupScopeSelect() {
    return document.getElementById('backupExportScope');
}

function getCurrentProfileNameForBackupUi() {
    if (currentProfile && typeof currentProfile.PROFILE_NAME === 'string' && currentProfile.PROFILE_NAME.trim()) {
        return currentProfile.PROFILE_NAME.trim();
    }

    const selectedValue = profileSelect && typeof profileSelect.value === 'string'
        ? profileSelect.value.trim()
        : '';
    return selectedValue || 'Current';
}

function refreshBackupScopeLabels(profileName = getCurrentProfileNameForBackupUi()) {
    const scopeSelect = getBackupScopeSelect();
    if (!scopeSelect) {
        return;
    }

    const currentProfileOption = scopeSelect.querySelector('option[value="currentProfile"]');
    if (currentProfileOption) {
        currentProfileOption.textContent = `Just current profile: ${profileName}`;
    }
}

function slugifyFilenamePart(value) {
    if (typeof value !== 'string') {
        return 'backup';
    }
    const trimmed = value.trim().toLowerCase();
    const slug = trimmed.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
    return slug || 'backup';
}

function getSelectedBackupScope() {
    const scopeSelect = getBackupScopeSelect();
    const scope = scopeSelect ? scopeSelect.value : 'currentProfile';
    if (scope === 'allProfiles' || scope === 'allProfilesAndAppSettings') {
        return scope;
    }
    return 'currentProfile';
}

function buildBackupFilename(payload) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const scope = payload.exportScope || 'currentProfile';
    const scopeName = scope === 'currentProfile'
        ? slugifyFilenamePart(payload.currentProfile || 'current-profile')
        : scope === 'allProfiles'
            ? 'all-profiles'
            : 'all-profiles-and-app-settings';

    return `OneClickPrompts_${scopeName}_${timestamp}.json`;
}

function downloadTextFile(contents, filename, mimeType) {
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

// Function to export a backup using the selected scope.
async function exportBackup() {
    const scope = getSelectedBackupScope();
    logToGUIConsole(`Initiating JSON backup export for scope: ${scope}.`);

    try {
        const response = await sendRuntimeMessage({
            type: 'getBackupPayload',
            scope,
        });
        const payload = response && response.payload;
        if (!payload) {
            throw new Error('Backup payload was empty.');
        }

        const filename = buildBackupFilename(payload);
        downloadTextFile(JSON.stringify(payload, null, 2), filename, 'application/json;charset=utf-8');

        logToGUIConsole(`Backup export created: ${filename}`);
        showToast('Backup download initiated.', 'success');
    } catch (error) {
        console.error('Error during backup export:', error);
        logToGUIConsole(`Error during backup export: ${error.message}`);
        showToast('Failed to export backup. Please try again.', 'error');
    }
}

// Function to handle import profile button click
function handleImportButtonClick() {
    logToGUIConsole('Import Backup button clicked.');
    document.getElementById('importFileInput').click();
}

function parseBackupText(text) {
    const normalizedText = typeof text === 'string'
        ? text.replace(/^\uFEFF/, '').trim()
        : '';
    if (!normalizedText) {
        throw new Error('Backup file was empty.');
    }

    return JSON.parse(normalizedText);
}

function extractIncomingProfileNames(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object') {
        return [];
    }

    if (typeof rawPayload.PROFILE_NAME === 'string' && Array.isArray(rawPayload.customButtons)) {
        return [rawPayload.PROFILE_NAME.trim()].filter(Boolean);
    }

    if (!rawPayload.profiles || typeof rawPayload.profiles !== 'object') {
        return [];
    }

    return Object.keys(rawPayload.profiles)
        .map((profileName) => profileName.trim())
        .filter(Boolean);
}

async function confirmProfileOverwrite(collisions) {
    if (!Array.isArray(collisions) || collisions.length === 0) {
        return true;
    }

    const profileList = collisions.join(', ');
    const message = collisions.length === 1
        ? `Backup contains an existing profile: ${profileList}. Overwrite it? Choosing Cancel will still import non-conflicting profiles and ignore unsafe bits.`
        : `Backup contains ${collisions.length} existing profiles: ${profileList}. Overwrite them? Choosing Cancel will still import non-conflicting profiles and ignore unsafe bits.`;

    if (window.OCPModal && typeof window.OCPModal.confirm === 'function') {
        return await window.OCPModal.confirm(message, 'Overwrite Existing Profiles', 'error');
    }

    return window.confirm(message);
}

async function refreshPopupAfterImport(result) {
    refreshBackupScopeLabels(result.currentProfile || getCurrentProfileNameForBackupUi());
    await loadProfiles();

    if (result && result.currentProfile) {
        profileSelect.value = result.currentProfile;
        await switchProfile(result.currentProfile);
    } else {
        await updateInterface();
    }

    // Theme script does not auto-listen for changes, so refresh it explicitly.
    try {
        const themeResponse = await sendRuntimeMessage({ type: 'getTheme' });
        if (typeof applyTheme === 'function') {
            const theme = themeResponse && (themeResponse.theme === 'dark' || themeResponse.theme === 'light')
                ? themeResponse.theme
                : 'light';
            applyTheme(theme);
            const darkThemeToggle = document.getElementById('darkThemeToggle');
            if (darkThemeToggle) {
                darkThemeToggle.checked = theme === 'dark';
            }
        }
    } catch (error) {
        logToGUIConsole(`Theme refresh after import failed: ${error.message}`);
    }
}

function summarizeImportResult(result) {
    const importedCount = Array.isArray(result.importedProfiles) ? result.importedProfiles.length : 0;
    const skippedCount = Array.isArray(result.skippedProfiles) ? result.skippedProfiles.length : 0;
    const appSettingsApplied = !!result.appSettingsApplied;

    if (importedCount === 0 && appSettingsApplied) {
        return 'App settings imported successfully.';
    }

    if (skippedCount > 0) {
        if (appSettingsApplied) {
            return `Imported ${importedCount} profile(s), applied app settings, and skipped ${skippedCount} existing profile(s).`;
        }
        return `Imported ${importedCount} profile(s). Skipped ${skippedCount} existing profile(s).`;
    }

    if (appSettingsApplied) {
        return `Imported ${importedCount} profile(s) and app settings.`;
    }

    return `Imported ${importedCount} profile(s).`;
}

// Function to handle the file input change event
async function handleImportProfile(event) {
    const file = event.target.files[0];
    if (!file) {
        logToGUIConsole('No file selected for import.');
        return;
    }

    logToGUIConsole(`Selected file for import: ${file.name}`);

    try {
        const fileText = await file.text();
        const parsedPayload = parseBackupText(fileText);
        const incomingProfileNames = extractIncomingProfileNames(parsedPayload);
        logToGUIConsole(`Parsed backup payload successfully. Incoming profiles: ${incomingProfileNames.join(', ') || 'none'}.`);

        const existingProfilesResponse = await sendRuntimeMessage({ type: 'listProfiles' });
        const existingProfiles = Array.isArray(existingProfilesResponse?.profiles) ? existingProfilesResponse.profiles : [];
        const collisions = incomingProfileNames.filter((profileName) => existingProfiles.includes(profileName));
        const overwriteExisting = await confirmProfileOverwrite(collisions);

        const importResponse = await sendRuntimeMessage({
            type: 'applyBackupPayload',
            payload: parsedPayload,
            options: { overwriteExisting },
        });

        const result = importResponse && importResponse.result ? importResponse.result : {
            importedProfiles: [],
            skippedProfiles: [],
            appSettingsApplied: false,
        };

        await refreshPopupAfterImport(result);

        const summary = summarizeImportResult(result);
        const importedCount = Array.isArray(result.importedProfiles) ? result.importedProfiles.length : 0;
        const skippedCount = Array.isArray(result.skippedProfiles) ? result.skippedProfiles.length : 0;
        const appSettingsApplied = !!result.appSettingsApplied;
        const toastType = importedCount === 0 && skippedCount > 0 && !appSettingsApplied ? 'info' : 'success';
        logToGUIConsole(summary);
        showToast(summary, toastType);
        document.getElementById('confirmationDiv')?.classList.add('is-hidden');
        document.getElementById('errorDiv')?.classList.add('is-hidden');
    } catch (error) {
        console.error('Error importing backup:', error);
        logToGUIConsole(`Error importing backup: ${error.message}`);
        document.getElementById('errorDiv')?.classList.remove('is-hidden');
        showToast('Failed to import backup. Please check the JSON file.', 'error');
    } finally {
        event.target.value = '';
    }
}

// Attach event listeners after DOM content is loaded
document.addEventListener('DOMContentLoaded', () => {
    refreshBackupScopeLabels();

    if (profileSelect) {
        profileSelect.addEventListener('change', (event) => {
            const profileName = event && event.target ? event.target.value : getCurrentProfileNameForBackupUi();
            refreshBackupScopeLabels(profileName);
        });
    }

    document.getElementById('exportProfile').addEventListener('click', exportBackup);
    document.getElementById('importProfile').addEventListener('click', handleImportButtonClick);
    document.getElementById('importFileInput').addEventListener('change', handleImportProfile);

    // Keep legacy inline confirmation elements hidden. We now use modal confirmation for multi-profile imports.
    document.getElementById('confirmOverwrite')?.addEventListener('click', () => {
        document.getElementById('confirmationDiv')?.classList.add('is-hidden');
    });
    document.getElementById('cancelOverwrite')?.addEventListener('click', () => {
        document.getElementById('confirmationDiv')?.classList.add('is-hidden');
    });
});
