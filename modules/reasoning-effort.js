// Native reasoning controls for ChatGPT (Chat/Codex), Claude (Chat/Code) and Gemini.
// Levels are always read from the site's own UI (list menus or effort sliders); names and counts are never hardcoded.
(() => {
    'use strict';
    if (window.OCPReasoningEffort) return;
    const host = location.hostname;
    const supported = ['chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com'].includes(host);
    const claude = host === 'claude.ai';
    const MISSING_GRACE = 3000;
    const TYPING_IDLE = 2000;
    const STORE_KEY = 'ocpReasoningLevels';
    const MISSING_TOAST_KEY = 'ocpReasoningMissingToastDay';
    let settings = { enabled: false, compact: true, placement: 'after' };
    let context = '';
    let levels = [];
    let busy = false;
    let timer;
    let probeContext = null;
    let staleHint = '';
    let missingSince = 0;
    let lastTyping = -Infinity;
    let verifyAfter = false;
    let verifying = false;
    const notified = new Set();
    const groups = new Set();
    const cache = new Map(Object.entries(readStore()));

    const normalize = raw => ({ enabled: raw?.enabled === true, compact: raw?.compact !== false, placement: raw?.placement === 'before' ? 'before' : 'after' });
    const label = el => (el?.getAttribute('aria-label') || el?.innerText || el?.textContent || '').trim();
    const text = el => (el?.innerText || el?.textContent || '').trim();
    const visible = el => el instanceof HTMLElement && el.isConnected && el.checkVisibility({ visibilityProperty: true }) && el.getClientRects().length > 0;
    const available = el => visible(el) && !el.matches(':disabled, [aria-disabled="true"], [data-disabled]');
    const own = node => (node instanceof Element ? node : node?.parentElement)?.closest('[data-ocp-reasoning], #max-extension-container, [id^="max-extension"]');
    const menus = () => [...document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"]')].filter(visible);
    const nativeButtons = () => [...document.querySelectorAll('button, [role="combobox"]')].filter(el => available(el) && !own(el));
    // Gemini marks plain items aria-haspopup="false".
    const hasPopup = el => (el.getAttribute('aria-haspopup') ?? 'false') !== 'false';
    const lines = el => text(el).split('\n').map(line => line.trim()).filter(Boolean);
    const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const effortName = /^(?:reasoning(?: effort)?|effort|thinking(?: time| level| effort)?)(?:\b|:)|^(?:усилие|уровень рассуждений|время размышления)/i;
    // Only used to recognise unlabelled list items; slider and submenu levels are accepted structurally.
    const levelName = /^(none|minimal|instant|low|light|medium|standard|balanced|high|extended|deep|heavy|extra(?: high)?|xhigh|max|ultra)\b/i;
    const sliderSelector = '[data-reasoning-slider] [role="slider"], [data-reasoning-slider][role="slider"]';

    function readStore() {
        try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') ?? {}; } catch { return {}; }
    }
    function remember(key, value) {
        cache.set(key, value);
        try { localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries([...cache].slice(-40)))); } catch { /* storage unavailable */ }
    }

    // First real text node: list items often append a description ("Low Fast and efficient", "Max 3.5× usage").
    function firstText(el) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const value = node.data.trim();
            if (value && !node.parentElement?.closest('[aria-hidden="true"], mat-icon, svg')) return value;
        }
        return '';
    }

    // At most once per local calendar day per site; the in-memory set covers storage being unavailable.
    function unavailable() {
        if (notified.has(context)) return;
        notified.add(context);
        const today = new Date().toLocaleDateString('sv');
        try {
            if (localStorage.getItem(MISSING_TOAST_KEY) === today) return;
            localStorage.setItem(MISSING_TOAST_KEY, today);
        } catch { /* storage unavailable */ }
        window.showToast?.('Reasoning effort control was not found for this model or plan. If it is available, open the native model/effort menu once so the module can read it.', 'info');
    }

    function trigger() {
        const buttons = nativeButtons();
        const structural = buttons.find(el => el.matches('[data-composer-navigation-target="reasoning"], [data-test-id="bard-mode-menu-button"]'));
        if (structural) return structural;
        const direct = buttons.find(el => effortName.test(label(el)) && (el.hasAttribute('aria-haspopup') || el.getAttribute('role') === 'combobox'));
        if (direct) return direct;
        if (claude) return buttons.find(el => /^Model:/i.test(label(el))) ?? null;
        return buttons.find(el => el.hasAttribute('aria-haspopup') && (/^(?:GPT-|ChatGPT|o[134](?:\b|-))/i.test(label(el))
            || /model.*(?:select|picker)|(?:select|choose).*model/i.test(el.getAttribute('aria-label') || ''))) ?? null;
    }

    // Removes the current effort from a trigger's text so the context identifies mode+model, not the chosen level.
    function stripLevel(value) {
        const names = [...new Set([...levels, ...[...cache.values()].flat()].map(level => level.name))].sort((a, b) => b.length - a.length);
        let result = value.replace(/\s+\d+(?:\.\d+)?×[\s\S]*$/, '');
        for (const name of names) result = result.replace(new RegExp(`(?:^|[\\s\\n])${escapeRe(name)}\\s*$`, 'i'), '');
        return result.replace(new RegExp(`\\s+${levelName.source.slice(1)}\\s*$`, 'i'), '').trim();
    }

    // Context = site area + mode + model. Never the chat path: switching chats must not re-probe or re-notify.
    function signature(opener = trigger()) {
        const area = /^\/code(?:\/|$)/.test(location.pathname) ? 'code' : 'chat';
        const mode = document.querySelector('button[aria-label^="Switch mode"]')?.getAttribute('aria-label').replace(/^.*current mode:\s*/i, '') ?? '';
        const tabs = [...document.querySelectorAll('[role="radio"][aria-checked="true"], [role="tab"][aria-selected="true"]')]
            .filter(el => !own(el) && !el.closest('[role="menu"], [role="dialog"], [role="listbox"]')).map(label).join('|');
        let model = '';
        if (opener) {
            const parts = lines(opener);
            // ChatGPT shows "Thinking effort\n<Level>": the first line is stable, the last is the level.
            model = parts.length > 1 && effortName.test(parts[0]) ? `${label(opener)}|${parts[0]}` : stripLevel(label(opener));
            if (opener.dataset.composerNavigationTarget) model = 'codex-reasoning';
        }
        return [host, area, mode, tabs, model].join('|');
    }

    // What the closed trigger says about the current level: { known, level }.
    function triggerState(opener) {
        if (!opener || !levels.length) return { known: false, level: null };
        const id = opener.dataset.selectedReasoningEffort;
        if (id) return { known: true, hint: `id:${id}`, level: levels.find(level => level.id === id) ?? null };
        const parts = lines(opener);
        if (parts.length > 1 && effortName.test(parts[0])) {
            const name = parts.at(-1);
            return { known: true, hint: `name:${name}`, level: levels.find(level => level.name.toLowerCase() === name.toLowerCase()) ?? null };
        }
        // The accessible name is authoritative; visible text can lag behind it.
        const byLength = [...levels].sort((a, b) => b.name.length - a.name.length);
        for (const source of [opener.getAttribute('aria-label') ?? '', text(opener)]) {
            const level = byLength.find(item => new RegExp(`(?:^|\\s)${escapeRe(item.name)}(?:\\s+\\d[^\\n]*)?\\s*$`, 'im').test(source));
            if (level) return { known: false, level };
        }
        return { known: false, level: null };
    }

    // ---- List menus (Claude, Gemini, older ChatGPT) ----
    function readList(scope = null) {
        const result = [];
        for (const menu of scope ? [scope] : menus()) {
            const items = [...menu.querySelectorAll('[data-effort-id], [role="menuitemradio"], [role="radio"], [role="option"], [role="menuitem"]')];
            for (const el of items) {
                if (!available(el) || el.hasAttribute('data-model-id') || hasPopup(el)) continue;
                if (!scope && el.closest('[role="menu"], [role="listbox"], [role="dialog"]') !== menu) continue;
                const name = firstText(el) || label(el);
                const explicit = el.hasAttribute('data-effort-id');
                // A submenu we opened from an effort item is trusted structurally; elsewhere require a level-like name.
                const match = name.match(levelName);
                if (!explicit && !scope) {
                    const ownerId = menu.getAttribute('aria-labelledby');
                    const ownerLabel = ownerId ? label(document.getElementById(ownerId)) : '';
                    const reasoningMenu = effortName.test(ownerLabel) || /reasoning|effort|thinking time|higher effort/i.test(menu.textContent);
                    if (!match || !reasoningMenu) continue;
                }
                if (scope && !explicit && el.getAttribute('role') !== 'menuitemradio' && el.getAttribute('role') !== 'radio' && !match) continue;
                const id = el.getAttribute('data-effort-id') || (explicit ? '' : name.toLowerCase());
                if (!id || result.some(item => item.id === id)) continue;
                result.push({ id, name: explicit ? (match?.[1] ?? name) : name, selected: el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true', el });
            }
        }
        return result;
    }

    // ---- Effort sliders (ChatGPT Chat and Codex) ----
    function findSlider() {
        for (const menu of menus()) {
            const slider = menu.querySelector(sliderSelector);
            if (slider) return { menu, slider, keys: slider.closest('[data-reasoning-slider]') ?? slider };
        }
        return null;
    }
    const sliderValue = slider => Number(slider.getAttribute('aria-valuenow'));
    const sliderRange = slider => [Number(slider.getAttribute('aria-valuemin') || 0), Number(slider.getAttribute('aria-valuemax'))];

    function sliderName({ menu, slider }) {
        const header = menu.querySelector('[data-effort-header]');
        const fromHeader = header?.querySelector('[data-power-disabled], [data-effort-only], [data-accent="true"]');
        const headerText = text(fromHeader);
        if (headerText) return headerText;
        const statusId = (slider.closest('[aria-describedby]')?.getAttribute('aria-describedby') || '').split(/\s+/)[0];
        const status = text(statusId ? document.getElementById(statusId) : slider.closest('[data-reasoning-slider]')?.querySelector('[role="status"]'));
        return status.replace(/,?\s*\d+\s+of\s+\d+\.?$/i, '').trim() || slider.getAttribute('aria-valuetext') || String(sliderValue(slider) + 1);
    }

    async function stepSlider(handle, direction) {
        const before = sliderValue(handle.slider);
        const key = direction > 0 ? 'ArrowRight' : 'ArrowLeft';
        for (const type of ['keydown', 'keyup']) handle.keys.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true }));
        const moved = await waitFor(() => {
            const current = findSlider();
            if (current && sliderValue(current.slider) !== before) return current;
            return null;
        }, 1000);
        // Let header/trigger text settle after aria-valuenow (no rAF: it never fires in background tabs).
        if (moved) await new Promise(resolve => setTimeout(resolve, 30));
        return moved;
    }

    const sliderId = (opener, name) => opener?.dataset.selectedReasoningEffort || name.toLowerCase();

    // Walks the slider once to read every position's native name, then returns to the original value.
    async function discoverSlider(handle, opener) {
        const [min, max] = sliderRange(handle.slider);
        const origin = sliderValue(handle.slider);
        const names = new Map([[origin, { name: sliderName(handle), id: sliderId(opener, sliderName(handle)) }]]);
        let current = handle;
        try {
            for (let value = origin; value > min; value--) {
                current = await stepSlider(current, -1);
                if (!current) throw new Error('slider did not respond');
                names.set(sliderValue(current.slider), { name: sliderName(current), id: sliderId(opener, sliderName(current)) });
            }
            for (let value = min; value < max; value++) {
                current = await stepSlider(current, 1);
                if (!current) throw new Error('slider did not respond');
                names.set(sliderValue(current.slider), { name: sliderName(current), id: sliderId(opener, sliderName(current)) });
            }
        } finally {
            current = await moveSlider(current ?? findSlider(), origin);
        }
        if (names.size !== max - min + 1) return null;
        return [...names].sort(([a], [b]) => a - b).map(([index, value]) => ({ ...value, index, selected: index === origin }));
    }

    async function moveSlider(handle, target) {
        let current = handle;
        while (current && sliderValue(current.slider) !== target) {
            current = await stepSlider(current, Math.sign(target - sliderValue(current.slider)));
        }
        return current;
    }

    function render() {
        for (const group of groups) {
            if (!group.isConnected) { groups.delete(group); continue; }
            const stamp = JSON.stringify([settings.compact, busy, levels.map(({ id, name, selected }) => [id, name, selected])]);
            if (group.dataset.state === stamp) continue;
            group.dataset.state = stamp;
            group.hidden = !settings.enabled || levels.length === 0;
            group.replaceChildren(...levels.map(level => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = settings.compact ? [...level.name][0] : level.name;
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

    // Menus mount asynchronously; observe rather than poll or assume a render duration.
    function waitFor(find, timeout = 1200) {
        const initial = find();
        if (initial) return Promise.resolve(initial);
        return new Promise(resolve => {
            const observer = new MutationObserver(() => { const value = find(); if (value) finish(value); });
            const deadline = setTimeout(() => finish(null), timeout);
            function finish(value) { clearTimeout(deadline); observer.disconnect(); resolve(value); }
            observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        });
    }

    function escape(el) {
        const target = el?.isConnected ? el : document.activeElement;
        for (const type of ['keydown', 'keyup']) target?.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true }));
    }

    function adopt(found, key) {
        levels = found.map(({ el, ...value }) => value);
        if (levels.length) remember(key, levels.map(({ selected, ...value }) => value));
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
        const startingContext = signature(opener);
        let submenu = null;
        let opened = false;
        try {
            opener.click();
            opened = true;
            await waitFor(() => menus().length > 0);
            // Whichever native structure appears first decides the adapter.
            await waitFor(() => findSlider() || readList().length || submenuItem(), 600);
            const slider = findSlider();
            if (slider) await sliderInteract(slider, opener, startingContext, requestedId);
            else submenu = await listInteract(opener, startingContext, requestedId);
        } catch (error) {
            window.showToast?.(error.message || 'Could not change reasoning effort.', 'error');
        } finally {
            // Escape only menus opened by this operation; no outside click or composer changes.
            if (opened) {
                if (submenu?.isConnected) escape(submenu);
                if (menus().length) escape(document.activeElement && menus().some(menu => menu.contains(document.activeElement)) ? document.activeElement : opener);
                if (menus().length) escape(opener);
                if (originalFocus?.isConnected && !own(originalFocus)) originalFocus.focus({ preventScroll: true });
            }
            context = signature();
            busy = false;
            render();
            if (verifyAfter) {
                verifyAfter = false;
                verifying = true;
                setTimeout(() => void interact().finally(() => { verifying = false; }), 150);
            } else schedule();
        }
    }

    async function sliderInteract(handle, opener, startingContext, requestedId) {
        const key = startingContext;
        const [min, max] = sliderRange(handle.slider);
        const known = cache.get(key);
        let found = known?.length === max - min + 1 && known.every(level => Number.isFinite(level.index))
            ? known.map(level => ({ ...level, selected: level.index === sliderValue(handle.slider) }))
            : null;
        // Verify cached names against the visible position; a mismatch means the model changed.
        const here = found?.find(level => level.selected);
        if (here && here.name !== sliderName(handle)) found = null;
        if (!found || !requestedId) found = await discoverSlider(handle, opener) ?? [];
        if (!settings.enabled) return;
        adopt(found, key);
        if (!found.length) { unavailable(); return; }
        if (!requestedId) return;
        const target = found.find(level => level.id === requestedId);
        if (!target) throw new Error('This reasoning level is not available for the selected model.');
        const current = findSlider();
        const moved = current && await moveSlider(current, target.index);
        if (moved && sliderValue(moved.slider) === target.index) levels = levels.map(level => ({ ...level, selected: level.id === requestedId }));
        else {
            levels = levels.map(level => ({ ...level, selected: false }));
            window.showToast?.('Reasoning choice sent. Open the native menu to confirm its current value.', 'info');
        }
    }

    const submenuItem = () => menus().flatMap(menu => [...menu.querySelectorAll('[role="menuitem"], button')])
        .find(el => available(el) && effortName.test(firstText(el) || label(el))
            && (hasPopup(el) || /reasoning|effort|thinking time/i.test(label(el)))) ?? null;

    async function listInteract(opener, startingContext, requestedId) {
        let found = readList();
        let submenu = null;
        if (!found.length) {
            submenu = submenuItem();
            if (submenu) {
                submenu.focus();
                submenu.click();
                if (submenu.getAttribute('aria-expanded') !== 'true') submenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
                const scopeOf = () => {
                    const controlled = document.getElementById(submenu.getAttribute('aria-controls') || '');
                    return visible(controlled) ? controlled : null;
                };
                found = await waitFor(() => { const values = readList(scopeOf()); return values.length ? values : null; }) || [];
            }
        }
        if (signature() !== startingContext || !settings.enabled) return submenu;
        adopt(found, startingContext);
        if (!found.length) unavailable();
        if (!requestedId) return submenu;
        const target = found.find(level => level.id === requestedId);
        if (!target || !available(target.el)) throw new Error('This reasoning level is no longer available for the selected model.');
        if (target.selected) return submenu;
        const stateBefore = `${label(opener)}\n${text(opener)}`;
        target.el.click();
        // Confirm the site's checked state or updated trigger; never claim success on click alone.
        const nameRe = new RegExp(`(?:^|\\s)${escapeRe(target.name)}\\b`, 'i');
        const outcome = await waitFor(() => {
            if (target.el.isConnected && target.el.getAttribute('aria-checked') === 'true') return 'checked';
            const now = trigger();
            const stateNow = `${label(now)}\n${text(now)}`;
            if (stateNow !== stateBefore && nameRe.test(stateNow)) return 'checked';
            return !target.el.isConnected && !menus().length ? 'unmounted' : null;
        });
        const confirmed = outcome === 'checked';
        if (confirmed) levels = levels.map(level => ({ ...level, selected: level.id === requestedId }));
        else {
            // Some menus (Gemini) unmount on click and the trigger does not show the level: re-read the menu once.
            levels = levels.map(level => ({ ...level, selected: false }));
            if (!target.el.isConnected && !verifying) verifyAfter = true;
            else window.showToast?.('Reasoning choice sent. Open the native menu to confirm its current value.', 'info');
        }
        return submenu;
    }

    function reconcile() {
        if (!settings.enabled || busy || !supported) return;
        const opener = trigger();
        const nextContext = signature(opener);
        if (nextContext !== context) {
            context = nextContext;
            const known = cache.get(context);
            levels = known ? known.map(level => ({ ...level, selected: false })) : [];
            probeContext = known ? context : null;
            staleHint = '';
        }
        const openSlider = findSlider();
        if (openSlider) {
            // The user has the native menu open: passively check that our level count still matches.
            const [min, max] = sliderRange(openSlider.slider);
            if (levels.length && levels.length !== max - min + 1) probeContext = null;
            else if (levels.length) levels = levels.map(level => ({ ...level, selected: level.index === sliderValue(openSlider.slider) }));
        } else {
            const found = readList();
            if (found.length) adopt(found, context);
            else if (levels.length && opener) {
                const state = triggerState(opener);
                if (state.level) levels = levels.map(level => ({ ...level, selected: level.id === state.level.id }));
                else if (state.known && state.hint !== staleHint) {
                    // The site reports a level we do not know: the model or plan changed; read the menu again.
                    staleHint = state.hint;
                    probeContext = null;
                }
            }
        }
        render();
        if (opener) {
            missingSince = 0;
            if (probeContext !== context && !menus().length) {
                const idle = performance.now() - lastTyping;
                // Never pop menus while the user is typing; retry once they pause.
                if (idle < TYPING_IDLE) { timer = setTimeout(reconcile, TYPING_IDLE - idle + 50); return; }
                probeContext = context;
                void interact();
            }
        } else if (groups.size && document.querySelector('[contenteditable="true"], textarea')) {
            // The trigger often renders after the composer; only report it missing once the page has settled.
            if (!missingSince) missingSince = performance.now();
            const waited = performance.now() - missingSince;
            if (waited >= MISSING_GRACE) unavailable();
            else { clearTimeout(timer); timer = setTimeout(reconcile, MISSING_GRACE - waited + 50); }
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
        context = '';
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
            const next = normalize(message.settings);
            const toolbarChanged = next.enabled !== settings.enabled || next.placement !== settings.placement;
            settings = next;
            if (toolbarChanged) refresh();
            else render();
        });
        const typing = event => { if (event.isTrusted && !own(event.target)) lastTyping = performance.now(); };
        document.addEventListener('keydown', typing, true);
        document.addEventListener('input', typing, true);
        const observer = new MutationObserver(records => {
            if (records.some(record => !own(record.target))) schedule();
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
            attributeFilter: ['aria-checked', 'aria-selected', 'aria-label', 'aria-expanded', 'aria-valuenow', 'data-state', 'data-selected-reasoning-effort', 'disabled'] });
        window.addEventListener('popstate', schedule);
        schedule();
    })() : Promise.resolve();
})();
