'use strict';

// modules/popup-page-modules-tokenApproximator.js
// Handles the ChatGPT Token Approximator popup UI module (global settings)
// Version 1.0

document.addEventListener('DOMContentLoaded', () => {
  // --- Elements ---
  const moduleContainer = document.getElementById('chatgptTokenApproximatorModule');
  const enableToggle = document.getElementById('chatgptTokenApproximatorEnableToggle');
  // Also control the top switch row visibility with the collapsible
  const switchRow = moduleContainer?.querySelector('.section-content .switch-container');

  if (!moduleContainer || !enableToggle) {
    // Popup might be opened on a version without the module block yet
    console.warn('[tokenApproximator] Module elements not found; skipping initialization');
    return;
  }

  let currentSettings = { enabled: false };

  // --- State sync ---
  async function loadModuleState() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getTokenApproximatorSettings' });
      if (response && response.settings) {
        currentSettings = normalizeSettings(response.settings);
      }
      updateUIFromState();
    } catch (error) {
      console.error('[tokenApproximator] Failed to load settings:', error);
      updateUIFromState();
    }
    // Reflect current collapsible state after controls are updated
    updateSettingsVisibility();
  }

  async function saveModuleSettings() {
    try {
      await chrome.runtime.sendMessage({
        type: 'saveTokenApproximatorSettings',
        settings: currentSettings,
      });
    } catch (error) {
      console.error('[tokenApproximator] Failed to save settings:', error);
    }
  }

  function normalizeSettings(s) {
    return { enabled: !!s?.enabled };
  }

  // --- UI update (controls only; visibility handled by collapsible state) ---
  function updateUIFromState() {
    enableToggle.checked = currentSettings.enabled;
  }

  // --- Settings visibility is driven solely by collapsible expanded state ---
  function updateSettingsVisibility() {
    const isModuleExpanded = moduleContainer.classList.contains('expanded');
    // Hide/show the switch row based on expanded state
    if (switchRow) {
      // The switch container in HTML is in a flex row
      switchRow.style.display = isModuleExpanded ? 'flex' : 'none';
    }
  }

  // Observe expanded/collapsed state changes driven by centralized collapsible script
  const observer = new MutationObserver(() => {
    updateSettingsVisibility();
  });
  observer.observe(moduleContainer, { attributes: true, attributeFilter: ['class'] });

  // --- Events ---
  enableToggle.addEventListener('change', () => {
    currentSettings.enabled = enableToggle.checked;
    saveModuleSettings();
  });

  // --- Init ---
  loadModuleState();
});