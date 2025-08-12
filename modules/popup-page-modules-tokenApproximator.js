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
    placement: 'before',               // 'before' | 'after'
    countingMethod: 'advanced',       // 'advanced' | 'simple'
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
  const elSimpleMethodCb = document.getElementById('tokenApproxSimpleMethodToggle');
  const elMethodRadioAdvanced = document.getElementById('tokenApproxMethodAdvanced');
  const elMethodRadioSimple = document.getElementById('tokenApproxMethodSimple');

  function normalize(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    return {
      enabled: !!s.enabled,
      calibration: Number.isFinite(s.calibration) && s.calibration > 0 ? Number(s.calibration) : DEFAULTS.calibration,
      threadMode: (s.threadMode === 'ignoreEditors' || s.threadMode === 'hide') ? s.threadMode : DEFAULTS.threadMode,
      showEditorCounter: typeof s.showEditorCounter === 'boolean' ? s.showEditorCounter : DEFAULTS.showEditorCounter,
      placement: s.placement === 'after' ? 'after' : DEFAULTS.placement,
      countingMethod: s.countingMethod === 'simple' ? 'simple' : DEFAULTS.countingMethod,
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
    
    // Update both the hidden checkbox and the visible radio buttons for counting method
    const isSimple = (s.countingMethod === 'simple');
    if (elSimpleMethodCb) elSimpleMethodCb.checked = isSimple;
    if (elMethodRadioSimple) elMethodRadioSimple.checked = isSimple;
    if (elMethodRadioAdvanced) elMethodRadioAdvanced.checked = !isSimple;
  }

  function collectSettingsFromUi() {
    const selected = (elModeRadios().find(r => r.checked) || {}).value || DEFAULTS.threadMode;
    const calibParsed = Number(elCalib && elCalib.value ? elCalib.value : DEFAULTS.calibration);
    const calibration = Number.isFinite(calibParsed) && calibParsed > 0 ? Math.max(0.01, Math.min(10, calibParsed)) : DEFAULTS.calibration;
    return normalize({
      enabled: !!(elEnable && elEnable.checked),
      calibration,
      threadMode: selected,
      showEditorCounter: !!(elEditorCb && elEditorCb.checked),
      placement: (elPlacementRadioBefore && elPlacementRadioBefore.checked) ? 'before' : 'after',
      countingMethod: (elSimpleMethodCb && elSimpleMethodCb.checked) ? 'simple' : 'advanced',
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
    
    // Counting method radio buttons
    if (elMethodRadioSimple) {
      elMethodRadioSimple.addEventListener('change', async () => {
        // Update the hidden checkbox to maintain compatibility
        if (elSimpleMethodCb) elSimpleMethodCb.checked = elMethodRadioSimple.checked;
        const s = collectSettingsFromUi();
        await save(s);
      }, { passive: true });
    }
    
    if (elMethodRadioAdvanced) {
      elMethodRadioAdvanced.addEventListener('change', async () => {
        // Update the hidden checkbox to maintain compatibility
        if (elSimpleMethodCb) elSimpleMethodCb.checked = !elMethodRadioAdvanced.checked;
        const s = collectSettingsFromUi();
        await save(s);
      }, { passive: true });
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
  // In case the script loads after DOMContentLoaded (popup is small), guard-init:
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    attachEvents();
    load();
  }
})();