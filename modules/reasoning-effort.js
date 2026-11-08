// Native reasoning controls for ChatGPT (Chat/Work) and Claude (Chat/Code).
// Read the site's current menu, never infer supported effort levels from a model name.
(() => {
    'use strict';
    if (window.OCPReasoningEffort) return;
    const supported = ['chatgpt.com', 'chat.openai.com', 'claude.ai'].includes(location.hostname);
    const claude = location.hostname === 'claude.ai';
    let settings = { enabled: false, placement: 'after' };
    let context = '';
    let levels = [];
    let busy = false;
    let timer;
    let probeContext = null;
    const notified = new Set();
    const groups = new Set();
    const normalize = raw => ({ enabled: raw?.enabled === true, placement: raw?.placement === 'before' ? 'before' : 'after' });
    const label = el => (el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim();
    const visible = el => el instanceof HTMLElement && el.isConnected && el.checkVisibility({ visibilityProperty: true }) && el.getClientRects().length > 0;
    const available = el => visible(el) && !el.matches(':disabled, [aria-disabled="true"], [data-disabled]');
    const own = node => (node instanceof Element ? node : node?.parentElement)?.closest('[data-ocp-reasoning], #max-extension-container, [id^="max-extension"]');
    const menus = () => [...document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"]')].filter(visible);
    const nativeButtons = () => [...document.querySelectorAll('button, [role="combobox"]')].filter(el => available(el) && !own(el));
    const effortName = /^(?:reasoning(?: effort)?|effort|thinking(?: time)?)(?:\b|:)|^(?:усилие|уровень рассуждений|время размышления)/i;
    const levelName = /^(none|minimal|low|medium|high|extra(?: high)?|xhigh|max|standard|extended|light|heavy)\b/i;

    function unavailable() {
        if (notified.has(context)) return;
        notified.add(context);
        window.showToast?.('Reasoning effort control was not found for this model or plan. If it is available, open the native model/effort menu once so the module can read it.', 'info');
    }

    function trigger() {
        const buttons = nativeButtons();
        const direct = buttons.find(el => effortName.test(label(el)) && (el.hasAttribute('aria-haspopup') || el.getAttribute('role') === 'combobox'));
        if (direct) return direct;
        if (claude) return buttons.find(el => /^Model:/i.test(label(el))) ?? null;
        return buttons.find(el => el.hasAttribute('aria-haspopup') && (/^(?:GPT-|ChatGPT|o[134](?:\b|-))/i.test(label(el))
            || /model.*(?:select|picker)|(?:select|choose).*model/i.test(el.getAttribute('aria-label') || ''))) ?? null;
    }

    function signature() {
        const model = nativeButtons().find(el => /^Model:|^(?:GPT-|ChatGPT|o[134](?:\b|-))/i.test(label(el)));
        const modes = [...document.querySelectorAll('[role="radio"][aria-checked="true"], [role="tab"][aria-selected="true"]')]
            .filter(el => !own(el) && !el.closest('[role="menu"], [role="dialog"], [role="listbox"]')).map(label).join('|');
        // Claude includes the current effort in the model button's accessible name.
        const modelName = label(model ?? document.createElement('span')).replace(/\s+(?:None|Minimal|Low|Medium|High|Extra|Max|Standard|Extended|Light|Heavy)(?:\s+\d[\s\S]*)?$/i, '');
        return `${location.pathname}|${modes}|${modelName}`;
    }

    function readLevels() {
        const result = [];
        for (const menu of menus()) {
            const items = [...menu.querySelectorAll('[data-effort-id], [role="menuitemradio"], [role="radio"], [role="option"], [role="menuitem"]')];
            for (const el of items) {
                if (!available(el) || el.hasAttribute('data-model-id')) continue;
                const text = label(el);
                const match = text.match(levelName);
                if (!match) continue;
                // Generic options are accepted only inside a reasoning-specific menu.
                const ownerId = menu.getAttribute('aria-labelledby');
                const ownerLabel = ownerId ? label(document.getElementById(ownerId) ?? menu) : '';
                const explicit = el.hasAttribute('data-effort-id');
                const reasoningMenu = effortName.test(ownerLabel) || /reasoning|effort|thinking time|higher effort/i.test(menu.textContent);
                if (!explicit && !reasoningMenu) continue;
                const id = el.getAttribute('data-effort-id') || match[1].toLowerCase();
                if (result.some(item => item.id === id)) continue;
                result.push({ id, name: match[1], selected: el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true', el });
            }
        }
        return result;
    }

    function render() {
        for (const group of groups) {
            if (!group.isConnected) { groups.delete(group); continue; }
            const stamp = JSON.stringify([busy, levels.map(({ id, name, selected }) => [id, name, selected])]);
            if (group.dataset.state === stamp) continue;
            group.dataset.state = stamp;
            group.hidden = !settings.enabled || levels.length === 0;
            group.replaceChildren(...levels.map(level => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = level.name;
                button.title = `Reasoning effort: ${level.name}`;
                button.setAttribute('aria-label', button.title);
                button.setAttribute('aria-pressed', String(level.selected));
                button.disabled = busy;
                button.style.cssText = `font:inherit;font-size:12px;cursor:pointer;border:1px solid ${level.selected ? 'currentColor' : 'transparent'};border-radius:5px;padding:2px 5px;margin:0 3px 5px 0;color:inherit;background:${level.selected ? 'color-mix(in srgb, currentColor 15%, transparent)' : 'transparent'};`;
                button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    void interact(level.id);
                });
                return button;
            }));
        }
    }

    // Menus mount asynchronously; observe rather than poll or assume a React render duration.
    function waitFor(find, timeout = 1200) {
        const initial = find();
        if (initial) return Promise.resolve(initial);
        return new Promise(resolve => {
            const observer = new MutationObserver(() => { const value = find(); if (value) finish(value); });
            const deadline = setTimeout(() => finish(null), timeout);
            function finish(value) { clearTimeout(deadline); observer.disconnect(); resolve(value); }
            observer.observe(document.body, { subtree: true, childList: true, attributes: true });
        });
    }

    function escape(el) {
        const target = el?.isConnected ? el : document.activeElement;
        for (const type of ['keydown', 'keyup']) target?.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true }));
    }

    async function interact(requestedId = null) {
        if (busy || !settings.enabled || !supported) return;
        // Do not disrupt a menu/dialog the user is currently operating.
        if (menus().length) {
            if (requestedId) window.showToast?.('Close the open menu, then choose a reasoning level.', 'info');
            return;
        }
        const opener = trigger();
        if (!opener) return;
        busy = true;
        render();
        const originalFocus = document.activeElement;
        const startingContext = signature();
        let submenu = null;
        let opened = false;
        try {
            opener.click();
            opened = true;
            await waitFor(() => menus().length > 0);
            let found = readLevels();
            if (!found.length) {
                submenu = menus().flatMap(menu => [...menu.querySelectorAll('[role="menuitem"], button')])
                    .find(el => available(el) && effortName.test(label(el))
                        && (el.hasAttribute('aria-haspopup') || /reasoning|effort|thinking time/i.test(label(el))));
                if (submenu) {
                    submenu.focus();
                    submenu.click();
                    submenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
                }
                found = await waitFor(() => { const values = readLevels(); return values.length ? values : null; }) || [];
            }
            if (signature() !== startingContext || !settings.enabled) return;
            levels = found.map(({ el, ...value }) => value);
            if (!found.length) unavailable();
            if (requestedId) {
                const target = found.find(level => level.id === requestedId);
                if (!target || !available(target.el)) throw new Error('This reasoning level is no longer available for the selected model.');
                const labelBefore = label(trigger() ?? opener);
                if (target.selected) return;
                target.el.click();
                // Confirm the site's checked state or updated trigger; never claim success on click alone.
                const confirmed = await waitFor(() => {
                    const checked = readLevels().find(level => level.id === requestedId && level.selected);
                    const currentLabel = label(trigger() ?? opener);
                    return checked || (new RegExp(`\\b${target.name}\\b`, 'i').test(currentLabel) && !new RegExp(`\\b${target.name}\\b`, 'i').test(labelBefore));
                });
                if (confirmed) levels = levels.map(level => ({ ...level, selected: level.id === requestedId }));
                else {
                    levels = levels.map(level => ({ ...level, selected: false }));
                    window.showToast?.('Reasoning choice sent. Open the native menu to confirm its current value.', 'info');
                }
            }
        } catch (error) {
            window.showToast?.(error.message || 'Could not change reasoning effort.', 'error');
        } finally {
            // Escape only menus opened by this operation; no outside click or composer changes.
            if (opened && signature() === startingContext) {
                if (submenu) escape(submenu);
                escape(opener);
                if (originalFocus?.isConnected && !own(originalFocus)) originalFocus.focus({ preventScroll: true });
            }
            busy = false;
            render();
            schedule();
        }
    }

    function reconcile() {
        if (!settings.enabled || busy) return;
        const nextContext = signature();
        if (nextContext !== context) {
            context = nextContext;
            levels = [];
            probeContext = null;
        }
        const found = readLevels();
        if (found.length) levels = found.map(({ el, ...value }) => value);
        else if (levels.length) {
            const currentLabel = label(trigger() ?? document.createElement('span'));
            const selected = levels.find(level => new RegExp(`\\b${level.name}(?:\\s+\\d[\\s\\S]*)?\\s*$`, 'i').test(currentLabel));
            if (selected) levels = levels.map(level => ({ ...level, selected: level.id === selected.id }));
        }
        render();
        if (probeContext !== context && trigger() && !menus().length) {
            probeContext = context;
            void interact();
        } else if (!trigger() && groups.size && document.querySelector('[contenteditable="true"], textarea')) {
            unavailable();
        }
    }

    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(reconcile, 250);
    }

    function refresh() {
        window.MaxExtensionButtonsInit?.updateButtonsForProfileChange?.('inline');
        window.MaxExtensionButtonsInit?.updateButtonsForProfileChange?.('panel');
        probeContext = null;
        levels = [];
        render();
        schedule();
    }

    const api = window.OCPReasoningEffort = {
        getToolbarPlacement: () => settings.placement,
        createToolbarButtons() {
            if (!supported || !settings.enabled) return [];
            const group = document.createElement('span');
            group.dataset.ocpReasoning = '';
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', 'Reasoning effort');
            group.hidden = true;
            groups.add(group);
            schedule();
            return [group];
        }
    };

    api.settingsReady = supported ? (async () => {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'getReasoningEffortSettings' });
            settings = normalize(response?.settings);
        } catch (error) { window.logConCgp?.('[reasoning-effort]', error); }
        chrome.runtime.onMessage.addListener(message => {
            if (message?.type !== 'reasoningEffortSettingsChanged') return;
            settings = normalize(message.settings);
            refresh();
        });
        const observer = new MutationObserver(records => {
            if (records.some(record => !own(record.target))) schedule();
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
            attributeFilter: ['aria-checked', 'aria-selected', 'aria-label', 'aria-expanded', 'data-state', 'disabled'] });
        window.addEventListener('popstate', schedule);
        schedule();
    })() : Promise.resolve();
})();
