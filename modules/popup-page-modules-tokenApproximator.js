// modules/popup-page-modules-tokenApproximator.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// Handles UI load/save for the ChatGPT Token Approximator module in the popup.
// Counting/DOM logic is implemented separately (not in this step).

(() => {
  'use strict';
  if (window.__OCP_tokApprox_initDone) return;
  window.__OCP_tokApprox_initDone = true;

  // Local defaults (must match service-worker normalization)
  const DEFAULTS = Object.freeze({
    enabled: false,
    calibration: 1.0,
    threadMode: 'withEditors',        // 'withEditors' | 'ignoreEditors' | 'hide'
    showEditorCounter: true,
    placement: 'before',              // 'before' | 'after'
    countingMethod: 'ultralight-state-machine', // Default to the fastest & accurate model
  });

  // Safe toast helper (works with ocp_toast.js or falls back to basic)
  function toast(message, type = 'success') {
    try {
      // Preferred: namespaced or global helpers if present
      if (window.OCPToast && typeof window.OCPToast.show === 'function') {
        window.OCPToast.show(message, type);
        return;
      }
      if (typeof window.showToast === 'function') {
        window.showToast(message, type);
        return;
      }
    } catch (e) { /* ignore and fallback */ }
    // Fallback minimal toast
    const container = document.getElementById('toastContainer') || document.body;
    const el = document.createElement('div');
    el.className = `toast ${type ? 'toast-' + type : ''}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      try { el.remove(); } catch (_) {}
    }, 2400);
  }

  // Logging: use project logger if available
  function log(...args) {
    try {
      if (typeof window.logConCgp === 'function') {
        window.logConCgp('[popup-token-approx]', ...args);
      } else {
        console.log('[popup-token-approx]', ...args);
      }
    } catch { /* noop */ }
  }

  // Elements
  const elEnable = document.getElementById('chatgptTokenApproximatorEnableToggle');
  const elCalib = document.getElementById('tokenApproxCalibration');
  const elSettings = document.getElementById('tokenApproxSettingsContainer');
  const elModeRadios = () => Array.from(document.querySelectorAll('input[name="tokenApproxThreadMode"]'));
  const elEditorCb = document.getElementById('tokenApproxShowEditorCounter');
  const elPlacementBeforeCb = document.getElementById('tokenApproxPlacementBeforeCb'); // Hidden checkbox for compatibility
  const elPlacementRadioBefore = document.getElementById('tokenApproxPlacementBefore');
  const elPlacementRadioAfter = document.getElementById('tokenApproxPlacementAfter');
  
  // New dropdown for counting method
  const elCountingMethodSelect = document.getElementById('tokenApproxCountingMethod');
  
  // Website enablement checkboxes
  const elWebsitesList = document.getElementById('tokenApproxWebsitesList');
  // List of supported sites - must match the site names in InjectionTargetsOnWebsite
  const SUPPORTED_SITES = ['ChatGPT', 'Claude', 'Copilot', 'DeepSeek', 'AIStudio', 'Grok', 'Gemini', 'Perplexity'];
  
  // Legacy elements (kept for backward compatibility)
  const elSimpleMethodCb = document.getElementById('tokenApproxSimpleMethodToggle');
  const elMethodRadioAdvanced = document.getElementById('tokenApproxMethodAdvanced');
  const elMethodRadioSimple = document.getElementById('tokenApproxMethodSimple');
  
  // Model details toggle elements
  const elShowModelDetails = document.getElementById('tokenApproxShowModelDetails');
  const elModelDetails = document.getElementById('tokenApproxModelDetails');

  function normalize(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    
    // Validate counting method
    let countingMethod = DEFAULTS.countingMethod;
    if (s.countingMethod) {
      // List of valid model IDs
      const validModels = ['simple', 'advanced', 'cpt-blend-mix', 'single-regex-pass', 'ultralight-state-machine'];
      if (validModels.includes(s.countingMethod)) {
        countingMethod = s.countingMethod;
      } else if (s.countingMethod === 'simple') {
        countingMethod = 'simple';
      } else if (s.countingMethod === 'advanced') {
        countingMethod = 'advanced';
      }
    }
    
    // Handle enabled sites
    let enabledSites = { ...DEFAULTS.enabledSites };
    if (s.enabledSites && typeof s.enabledSites === 'object') {
      // Merge with defaults to ensure all sites are represented
      enabledSites = { ...enabledSites, ...s.enabledSites };
    }
    
    return {
      enabled: !!s.enabled,
      calibration: Number.isFinite(s.calibration) && s.calibration > 0 ? Number(s.calibration) : DEFAULTS.calibration,
      threadMode: (s.threadMode === 'ignoreEditors' || s.threadMode === 'hide') ? s.threadMode : DEFAULTS.threadMode,
      showEditorCounter: typeof s.showEditorCounter === 'boolean' ? s.showEditorCounter : DEFAULTS.showEditorCounter,
      placement: s.placement === 'after' ? 'after' : DEFAULTS.placement,
      countingMethod,
      enabledSites,
    };
  }

  function setUiFromSettings(settings) {
    const s = normalize(settings);
    if (elEnable) elEnable.checked = !!s.enabled;
    if (elSettings) elSettings.style.display = s.enabled ? '' : 'none';

    if (elCalib) {
      // Guard against invalid values; show fixed 2 decimals by default
      const v = Number.isFinite(s.calibration) ? s.calibration : DEFAULTS.calibration;
      elCalib.value = String(Math.max(0.01, Math.min(10, v)).toFixed(2));
    }

    const radios = elModeRadios();
    if (radios.length) {
      for (const r of radios) {
        r.checked = (r.value === s.threadMode);
      }
    }
    if (elEditorCb) elEditorCb.checked = !!s.showEditorCounter;
    
    // Update both the hidden checkbox and the visible radio buttons for placement
    const isBefore = (s.placement === 'before');
    if (elPlacementBeforeCb) elPlacementBeforeCb.checked = isBefore;
    if (elPlacementRadioBefore) elPlacementRadioBefore.checked = isBefore;
    if (elPlacementRadioAfter) elPlacementRadioAfter.checked = !isBefore;
    
    // Update the counting method dropdown
    if (elCountingMethodSelect) {
      elCountingMethodSelect.value = s.countingMethod;
    }
    
    // Update the hidden elements for backward compatibility
    const isSimple = (s.countingMethod === 'simple');
    if (elSimpleMethodCb) elSimpleMethodCb.checked = isSimple;
    if (elMethodRadioSimple) elMethodRadioSimple.checked = isSimple;
    if (elMethodRadioAdvanced) elMethodRadioAdvanced.checked = !isSimple;
    
    // Update website checkboxes
    if (elWebsitesList) {
      populateWebsiteCheckboxes(s.enabledSites || {});
    }
  }

  function collectSettingsFromUi() {
    const selected = (elModeRadios().find(r => r.checked) || {}).value || DEFAULTS.threadMode;
    const calibParsed = Number(elCalib && elCalib.value ? elCalib.value : DEFAULTS.calibration);
    const calibration = Number.isFinite(calibParsed) && calibParsed > 0 ? Math.max(0.01, Math.min(10, calibParsed)) : DEFAULTS.calibration;
    
    // Get selected counting method from dropdown
    const countingMethod = elCountingMethodSelect ? elCountingMethodSelect.value : DEFAULTS.countingMethod;
    
    // Collect enabled sites from checkboxes
    const enabledSites = collectEnabledSitesFromUi();
    
    return normalize({
      enabled: !!(elEnable && elEnable.checked),
      calibration,
      threadMode: selected,
      showEditorCounter: !!(elEditorCb && elEditorCb.checked),
      placement: (elPlacementRadioBefore && elPlacementRadioBefore.checked) ? 'before' : 'after',
      countingMethod,
      enabledSites,
    });
  }

  function save(settings, { silent = false } = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'saveTokenApproximatorSettings', settings: normalize(settings) },
          (response) => {
            if (chrome.runtime.lastError) {
              log('Save error:', chrome.runtime.lastError.message);
              if (!silent) toast('Failed to save Token Estimator settings', 'error');
              return resolve(false);
            }
            if (response && response.success) {
              log('Settings saved:', settings);
              if (!silent) toast('Token Estimator settings saved', 'success');
              return resolve(true);
            }
            log('Unexpected save response:', response);
            if (!silent) toast('Failed to save Token Estimator settings', 'error');
            resolve(false);
          }
        );
      } catch (e) {
        log('Save exception:', e);
        if (!silent) toast('Failed to save Token Estimator settings', 'error');
        resolve(false);
      }
    });
  }

  function load() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'getTokenApproximatorSettings' }, (response) => {
          if (chrome.runtime.lastError) {
            log('Load error:', chrome.runtime.lastError.message);
            setUiFromSettings(DEFAULTS);
            return resolve(DEFAULTS);
          }
          const settings = normalize(response && response.settings ? response.settings : DEFAULTS);
          setUiFromSettings(settings);
          log('Settings loaded:', settings);
          resolve(settings);
        });
      } catch (e) {
        log('Load exception:', e);
        setUiFromSettings(DEFAULTS);
        resolve(DEFAULTS);
      }
    });
  }

  // Wire UI events
  function attachEvents() {
    if (elEnable) {
      elEnable.addEventListener('change', async () => {
        const s = collectSettingsFromUi();
        if (elSettings) elSettings.style.display = s.enabled ? '' : 'none';
        await save(s);
      }, { passive: true });
    }
    if (elCalib) {
      elCalib.addEventListener('change', async () => {
        // Respect HTML validation first
        if (elCalib.validity && !elCalib.validity.valid) return;
        const s = collectSettingsFromUi();
        await save(s);
      });
      elCalib.addEventListener('input', () => {
        // live clamp (optional UX nicety)
        const v = Number(elCalib.value);
        if (!Number.isFinite(v)) return;
        if (v < 0.01) elCalib.value = '0.01';
        if (v > 10) elCalib.value = '10';
      });
    }
    elModeRadios().forEach(r => {
      r.addEventListener('change', async () => {
        const s = collectSettingsFromUi();
        await save(s);
      }, { passive: true });
    });
    if (elEditorCb) {
      elEditorCb.addEventListener('change', async () => {
        const s = collectSettingsFromUi();
        await save(s);
      }, { passive: true });
    }
    // Placement radio buttons
    if (elPlacementRadioBefore) {
      elPlacementRadioBefore.addEventListener('change', async () => {
        // Update the hidden checkbox to maintain compatibility
        if (elPlacementBeforeCb) elPlacementBeforeCb.checked = elPlacementRadioBefore.checked;
        const s = collectSettingsFromUi();
        await save(s);
      }, { passive: true });
    }
    
    if (elPlacementRadioAfter) {
      elPlacementRadioAfter.addEventListener('change', async () => {
        // Update the hidden checkbox to maintain compatibility
        if (elPlacementBeforeCb) elPlacementBeforeCb.checked = !elPlacementRadioAfter.checked;
        const s = collectSettingsFromUi();
        await save(s);
      }, { passive: true });
    }
    
    // Counting method dropdown
    if (elCountingMethodSelect) {
      elCountingMethodSelect.addEventListener('change', async () => {
        // Update the hidden elements for backward compatibility
        if (elSimpleMethodCb) {
          elSimpleMethodCb.checked = elCountingMethodSelect.value === 'simple';
        }
        if (elMethodRadioSimple) {
          elMethodRadioSimple.checked = elCountingMethodSelect.value === 'simple';
        }
        if (elMethodRadioAdvanced) {
          elMethodRadioAdvanced.checked = elCountingMethodSelect.value === 'advanced';
        }
        
        const s = collectSettingsFromUi();
        await save(s);
      }, { passive: true });
    }
    
    // Model details toggle
    if (elShowModelDetails) {
      elShowModelDetails.addEventListener('click', () => {
        const isHidden = elModelDetails.style.display === 'none';
        elModelDetails.style.display = isHidden ? 'block' : 'none';
        
        // Update toggle icon
        const toggleIcon = elShowModelDetails.querySelector('.toggle-icon');
        if (toggleIcon) {
          toggleIcon.textContent = isHidden ? '▼' : '▶';
        }
        
        // Update text content while preserving the icon
        // The HTML structure has the text as a text node after the span
        // We need to find and update only that text node
        const childNodes = Array.from(elShowModelDetails.childNodes);
        
        // Find the last text node (should be after the toggle icon span)
        let textNodeFound = false;
        for (let i = childNodes.length - 1; i >= 0; i--) {
          const node = childNodes[i];
          if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
            // Update the text node
            node.textContent = isHidden ? 'Hide model details' : 'Show model details';
            textNodeFound = true;
            break;
          }
        }
        
        // If no text node was found (shouldn't happen with the HTML structure),
        // create one to avoid breaking the functionality
        if (!textNodeFound && toggleIcon) {
          const textNode = document.createTextNode(isHidden ? 'Hide model details' : 'Show model details');
          elShowModelDetails.appendChild(textNode);
        }
      });
    }
  }

  // Listen to external changes (keep UI in sync if settings update elsewhere)
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'tokenApproximatorSettingsChanged' && msg.settings) {
        setUiFromSettings(msg.settings);
      }
    });
  } catch { /* noop */ }

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    attachEvents();
    load();
  });
  // Helper function to populate website checkboxes
  function populateWebsiteCheckboxes(enabledSites) {
    if (!elWebsitesList) return;
    
    // Clear existing content
    elWebsitesList.innerHTML = '';
    
    // Create a grid layout for the checkboxes
    const container = document.createElement('div');
    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'repeat(2, 1fr)';
    container.style.gap = '8px';
    
    // Create a checkbox for each supported site
    SUPPORTED_SITES.forEach(site => {
      const isEnabled = enabledSites && enabledSites[site] !== false;
      
      const label = document.createElement('label');
      label.className = 'checkbox-row';
      label.style.margin = '4px 0';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = isEnabled;
      checkbox.dataset.site = site;
      checkbox.className = 'tokenApproxSiteCheckbox';
      checkbox.id = `tokenApproxSite_${site}`;
      
      const text = document.createTextNode(site);
      
      label.appendChild(checkbox);
      label.appendChild(text);
      container.appendChild(label);
      
      // Add change event listener
      checkbox.addEventListener('change', async () => {
        const s = collectSettingsFromUi();
        await save(s);
      }, { passive: true });
    });
    
    elWebsitesList.appendChild(container);
  }
  
  // Helper function to collect enabled sites from UI
  function collectEnabledSitesFromUi() {
    const enabledSites = {};
    
    // Default all sites to enabled
    SUPPORTED_SITES.forEach(site => {
      enabledSites[site] = true;
    });
    
    // Update with checkbox values
    if (elWebsitesList) {
      const checkboxes = elWebsitesList.querySelectorAll('input[type="checkbox"].tokenApproxSiteCheckbox');
      checkboxes.forEach(checkbox => {
        if (checkbox.dataset.site) {
          enabledSites[checkbox.dataset.site] = checkbox.checked;
        }
      });
    }
    
    return enabledSites;
  }

  // In case the script loads after DOMContentLoaded (popup is small), guard-init:
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    attachEvents();
    load();
  }
})();
