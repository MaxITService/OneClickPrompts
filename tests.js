// tests.js
// Version: 1.0
// Test functions for config.js functionality
'use strict';

// Function 1: Test if default profile is automatically created and saved when no profile exists
async function testDefaultProfileCreation() {
    logConCgp('[tests] Starting default profile creation test');
    
    // First, clear storage using a message to the service worker
    await chrome.runtime.sendMessage({ type: 'clearStorage' });
    logConCgp('[tests] Storage cleared');

    // Request config from service worker
    const response = await chrome.runtime.sendMessage({ type: 'getConfig' });
    const config = response.config;
    
    // Verify the config matches default structure
    const isValid = config.PROFILE_NAME === "Default" && 
                   Array.isArray(config.customButtons) &&
                   config.customButtons.length > 0;
    
    logConCgp('[tests] Default profile creation test result:', isValid);
    logConCgp('[tests] Retrieved config:', config);
    
    return isValid;
}

// Function 2: Test saving a modified profile
async function testProfileSave() {
    logConCgp('[tests] Starting profile save test');
    
    // Create test profile configuration
    const testConfig = {
        PROFILE_NAME: "Test Profile",
        ENABLE_SHORTCUTS_DEFAULT: true,
        globalAutoSendEnabled: true,
        enableShortcuts: true,
        firstModificationDone: false,
        customButtons: [
            { icon: '🔥', text: ' Test button', autoSend: true },
            { separator: true }
        ]
    };
    
    // Save profile using message
    await chrome.runtime.sendMessage({ 
        type: 'saveConfig',
        profileName: "Test Profile",
        config: testConfig
    });
    
    // Verify save by loading it back
    const response = await chrome.runtime.sendMessage({ 
        type: 'getConfig'
    });
    const savedConfig = response.config;
    
    const isValid = savedConfig.PROFILE_NAME === "Test Profile" && 
                   savedConfig.customButtons.length === 2;
    
    logConCgp('[tests] Profile save test result:', isValid);
    logConCgp('[tests] Saved config:', savedConfig);
    
    return isValid;
}

// Function 3: Test loading a specific profile
async function testProfileLoad() {
    logConCgp('[tests] Starting profile load test');
    
    // Create and save two test profiles
    const profile1 = {
        PROFILE_NAME: "Profile1",
        ENABLE_SHORTCUTS_DEFAULT: true,
        globalAutoSendEnabled: true,
        enableShortcuts: true,
        firstModificationDone: false,
        customButtons: [{ icon: '1️⃣', text: ' Profile 1 button', autoSend: true }]
    };
    
    const profile2 = {
        PROFILE_NAME: "Profile2",
        ENABLE_SHORTCUTS_DEFAULT: true,
        globalAutoSendEnabled: true,
        enableShortcuts: true,
        firstModificationDone: false,
        customButtons: [{ icon: '2️⃣', text: ' Profile 2 button', autoSend: true }]
    };
    
    // Save both profiles
    await chrome.runtime.sendMessage({ 
        type: 'saveConfig',
        profileName: "Profile1",
        config: profile1
    });
    
    await chrome.runtime.sendMessage({ 
        type: 'saveConfig',
        profileName: "Profile2",
        config: profile2
    });
    
    // Switch to Profile2
    await chrome.runtime.sendMessage({ 
        type: 'switchProfile',
        profileName: "Profile2"
    });
    
    // Verify correct profile is loaded
    const response = await chrome.runtime.sendMessage({ type: 'getConfig' });
    const loadedConfig = response.config;
    
    const isValid = loadedConfig.PROFILE_NAME === "Profile2" && 
                   loadedConfig.customButtons[0].icon === '2️⃣';
    
    logConCgp('[tests] Profile load test result:', isValid);
    logConCgp('[tests] Loaded config:', loadedConfig);
    
    return isValid;
}

// Function 4: Run all tests
async function runConfigTests() {
    logConCgp('[tests] Starting configuration tests');
    
    try {
        const defaultTest = await testDefaultProfileCreation();
        logConCgp('[tests] Default profile creation test:', defaultTest ? 'PASSED' : 'FAILED');
        
        const saveTest = await testProfileSave();
        logConCgp('[tests] Profile save test:', saveTest ? 'PASSED' : 'FAILED');
        
        const loadTest = await testProfileLoad();
        logConCgp('[tests] Profile load test:', loadTest ? 'PASSED' : 'FAILED');
        
        logConCgp('[tests] All tests completed');
        return defaultTest && saveTest && loadTest;
    } catch (error) {
        logConCgp('[tests] Error during tests:', error);
        return false;
    }
}

// Run tests when extension loads
// runConfigTests().then(success => {
//     logConCgp('[tests] Configuration test suite result:', success ? 'PASSED' : 'FAILED');
// });
