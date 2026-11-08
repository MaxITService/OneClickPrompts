'use strict';

document.addEventListener('DOMContentLoaded', async () => {
    const enabled = document.getElementById('reasoningEffortEnableToggle');
    const placement = document.getElementById('reasoningEffortPlacement');
    if (!enabled || !placement) return;
    let settings;
    function render() {
        enabled.checked = settings?.enabled === true;
        placement.value = settings?.placement === 'before' ? 'before' : 'after';
    }
    async function save() {
        const next = { enabled: enabled.checked, placement: placement.value };
        enabled.disabled = placement.disabled = true;
        try {
            const response = await chrome.runtime.sendMessage({ type: 'saveReasoningEffortSettings', settings: next });
            if (!response?.success) throw new Error(response?.error || 'Could not save reasoning effort settings.');
            settings = next;
        } catch (error) { window.showToast?.(error.message, 'error'); }
        finally { render(); enabled.disabled = placement.disabled = false; }
    }
    enabled.disabled = placement.disabled = true;
    try {
        const response = await chrome.runtime.sendMessage({ type: 'getReasoningEffortSettings' });
        if (response?.error) throw new Error(response.error);
        settings = response?.settings;
        render();
        enabled.disabled = placement.disabled = false;
    } catch (error) { window.showToast?.(error.message || 'Could not load reasoning effort settings.', 'error'); }
    enabled.addEventListener('change', save);
    placement.addEventListener('change', save);
});
