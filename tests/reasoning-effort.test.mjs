import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../modules/reasoning-effort.js', import.meta.url), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(host = 'claude.ai', generic = false) {
    const dom = new JSDOM('<body><button id="model" aria-haspopup="menu" aria-label="Model: Sonnet 5.5 High">Sonnet 5.5 High</button><div contenteditable="true"></div></body>', { url: `https://${host}/new`, runScripts: 'outside-only', pretendToBeVisual: true });
    const { window: w } = dom;
    w.HTMLElement.prototype.checkVisibility = function () { return !this.hidden; };
    w.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{}]; };
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
    const notices = [];
    let listener;
    w.showToast = message => notices.push(message);
    w.chrome = { runtime: { sendMessage: async () => ({ settings: { enabled: true, compact: false } }), onMessage: { addListener: fn => { listener = fn; } } } };
    const model = w.document.getElementById('model');
    if (generic) model.setAttribute('aria-label', 'Reasoning effort: High');
    let selected = 'high';
    model.onclick = () => {
        const menu = w.document.createElement('div');
        menu.role = 'menu';
        menu.setAttribute('aria-labelledby', 'model');
        const effort = w.document.createElement('div');
        effort.role = 'menuitem';
        effort.textContent = 'Effort\nHigh';
        effort.onclick = () => {
            if (menu.querySelector('[data-effort-id]')) return;
            for (const [id, name] of [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra'], ['max', 'Max']]) {
                const item = w.document.createElement('div');
                item.role = 'menuitemradio';
                if (!generic) item.dataset.effortId = id;
                item.textContent = name;
                item.setAttribute('aria-checked', String(id === selected));
                item.onclick = () => {
                    selected = id;
                    model.setAttribute('aria-label', `${generic ? 'Reasoning effort:' : 'Model: Sonnet 5.5'} ${name}${id === 'max' ? ' 3.5× or more usage' : ''}`);
                    menu.remove();
                };
                menu.append(item);
            }
        };
        menu.append(effort);
        w.document.body.append(menu);
    };
    w.document.addEventListener('keydown', event => { if (event.key === 'Escape') w.document.querySelectorAll('[role="menu"]').forEach(el => el.remove()); });
    w.eval(source);
    await w.OCPReasoningEffort.settingsReady;
    const [group] = w.OCPReasoningEffort.createToolbarButtons();
    w.document.body.append(group);
    await pause(350);
    return { w, group, notices, model, close: () => w.close(), change: settings => listener({ type: 'reasoningEffortSettingsChanged', settings }) };
}

test('discovers all native efforts and confirms each selection from the site UI', async () => {
    const f = await fixture();
    try {
        assert.deepEqual([...f.group.querySelectorAll('button')].map(el => el.textContent), ['Low', 'Medium', 'High', 'Extra', 'Max']);
        for (const name of ['Low', 'Medium', 'High', 'Extra', 'Max']) {
            [...f.group.querySelectorAll('button')].find(el => el.textContent === name).click();
            await pause(50);
            assert.equal(f.model.getAttribute('aria-label'), `Model: Sonnet 5.5 ${name}${name === 'Max' ? ' 3.5× or more usage' : ''}`);
            assert.equal(f.group.querySelector('[aria-pressed="true"]').textContent, name);
            assert.equal(f.w.document.querySelector('[role="menu"]'), null);
        }
        assert.equal(f.notices.length, 0);
        await pause(350);
        assert.equal(f.group.querySelector('[aria-pressed="true"]').textContent, 'Max');
        const streamingText = f.w.document.createTextNode('Streaming');
        f.w.document.body.append(streamingText);
        streamingText.data = 'Streaming update';
        f.model.setAttribute('aria-label', 'Model: Sonnet 5.5 Low');
        await pause(350);
        assert.equal(f.group.querySelector('[aria-pressed="true"]').textContent, 'Low');
        f.change({ enabled: false });
        assert.equal(f.group.hidden, true);
    } finally { f.close(); }
});

test('unsupported free ChatGPT control gives one notice and no invented levels', async () => {
    const f = await fixture('chatgpt.com');
    try {
        assert.equal(f.group.hidden, true);
        assert.equal(f.group.children.length, 0);
        assert.equal(f.notices.length, 0, 'no notice before the page settles');
        await pause(3200);
        assert.equal(f.notices.length, 1);
        f.w.history.pushState({}, '', '/c/another-chat');
        f.w.document.body.append(f.w.document.createElement('div'));
        await pause(350);
        assert.equal(f.notices.length, 1);
    } finally { f.close(); }
});

test('model change clears stale efforts and reports an unsupported model', async () => {
    const f = await fixture();
    try {
        f.model.onclick = () => {
            const menu = f.w.document.createElement('div');
            menu.role = 'menu';
            menu.textContent = 'Model settings';
            f.w.document.body.append(menu);
        };
        f.model.setAttribute('aria-label', 'Model: Haiku');
        await pause(1600);
        assert.equal(f.group.hidden, true);
        assert.equal(f.group.children.length, 0);
        assert.equal(f.notices.length, 1);
        assert.equal(f.w.document.querySelector('[role="menu"]'), null);
    } finally { f.close(); }
});

test('ChatGPT adapter discovers semantic effort menus without Claude data attributes', async () => {
    const f = await fixture('chatgpt.com', true);
    try {
        assert.equal(f.group.children.length, 5);
        [...f.group.querySelectorAll('button')].find(el => el.textContent === 'Medium').click();
        await pause(50);
        assert.equal(f.model.getAttribute('aria-label'), 'Reasoning effort: Medium');
        assert.equal(f.group.querySelector('[aria-pressed="true"]').textContent, 'Medium');
    } finally { f.close(); }
});

function boot(html, host, path = '/') {
    const dom = new JSDOM(`<body>${html}<div contenteditable="true"></div></body>`, { url: `https://${host}${path}`, runScripts: 'outside-only', pretendToBeVisual: true });
    const { window: w } = dom;
    w.HTMLElement.prototype.checkVisibility = function () { return !this.closest('[hidden]'); };
    w.HTMLElement.prototype.getClientRects = function () { return this.closest('[hidden]') ? [] : [{}]; };
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
    const notices = [];
    w.showToast = message => notices.push(message);
    w.chrome = { runtime: { sendMessage: async () => ({ settings: { enabled: true, compact: false } }), onMessage: { addListener() {} } } };
    w.document.addEventListener('keydown', event => { if (event.key === 'Escape') w.document.querySelectorAll('[role="menu"]').forEach(el => el.remove()); });
    return { w, notices };
}

async function mount(w) {
    w.eval(source);
    await w.OCPReasoningEffort.settingsReady;
    const [group] = w.OCPReasoningEffort.createToolbarButtons();
    w.document.body.append(group);
    return group;
}

// ChatGPT Chat/Codex: a slider whose position names exist only in the menu header.
async function sliderFixture({ names = ['Light', 'Medium', 'High', 'Extra High', 'Max', 'Ultra'], ids = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], value = 0 } = {}) {
    const { w, notices } = boot('<button id="effort" aria-haspopup="menu" data-composer-navigation-target="reasoning">Select effort</button>', 'chatgpt.com', '/codex');
    const opener = w.document.getElementById('effort');
    const state = { names, value, opens: 0 };
    const sync = () => { opener.dataset.selectedReasoningEffort = ids[state.value]; };
    sync();
    opener.onclick = () => {
        state.opens++;
        const menu = w.document.createElement('div');
        menu.role = 'menu';
        menu.innerHTML = `<div data-effort-header><span>GPT Test</span><span data-power-disabled></span></div><div role="menuitem" data-reasoning-slider><div role="slider" aria-valuemin="0"></div></div>`;
        const slider = menu.querySelector('[role="slider"]');
        const paint = () => {
            slider.setAttribute('aria-valuemax', String(state.names.length - 1));
            slider.setAttribute('aria-valuenow', String(state.value));
            menu.querySelector('[data-power-disabled]').textContent = state.names[state.value];
            sync();
        };
        paint();
        menu.querySelector('[data-reasoning-slider]').addEventListener('keydown', event => {
            const next = state.value + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0);
            if (next >= 0 && next < state.names.length) { state.value = next; paint(); }
        });
        w.document.body.append(menu);
    };
    const group = await mount(w);
    await pause(800);
    return { w, group, notices, state, close: () => w.close() };
}

test('slider adapter reads every native position name and restores the original value', async () => {
    const f = await sliderFixture({ value: 2 });
    try {
        assert.deepEqual([...f.group.querySelectorAll('button')].map(el => el.textContent), ['Light', 'Medium', 'High', 'Extra High', 'Max', 'Ultra']);
        assert.equal(f.state.value, 2);
        assert.equal(f.group.querySelector('[aria-pressed="true"]').textContent, 'High');
        assert.equal(f.w.document.querySelector('[role="menu"]'), null);
        [...f.group.querySelectorAll('button')].find(el => el.textContent === 'Ultra').click();
        await pause(200);
        assert.equal(f.state.value, 5);
        assert.equal(f.group.querySelector('[aria-pressed="true"]').textContent, 'Ultra');
        assert.equal(f.w.document.querySelector('[role="menu"]'), null);
        const opens = f.state.opens;
        f.w.history.pushState({}, '', '/codex/tasks/other');
        f.w.document.body.append(f.w.document.createElement('div'));
        await pause(400);
        assert.equal(f.state.opens, opens, 'switching chats must not re-probe');
        f.state.value = 0;
        f.w.document.getElementById('effort').dataset.selectedReasoningEffort = 'low';
        await pause(400);
        assert.equal(f.group.querySelector('[aria-pressed="true"]').textContent, 'Light');
        assert.equal(f.notices.length, 0);
    } finally { f.close(); }
});

test('slider adapter re-reads levels when the site reports an unknown level', async () => {
    const f = await sliderFixture({ names: ['Instant', 'Medium', 'High'], ids: ['instant', 'medium', 'high'], value: 1 });
    try {
        assert.equal(f.group.children.length, 3);
        f.state.names = ['Light', 'Medium', 'High', 'Max'];
        f.w.document.getElementById('effort').dataset.selectedReasoningEffort = 'max';
        f.state.value = 3;
        await pause(900);
        assert.deepEqual([...f.group.querySelectorAll('button')].map(el => el.textContent), ['Light', 'Medium', 'High', 'Max']);
    } finally { f.close(); }
});

test('Gemini adapter opens the thinking submenu and reads level names without descriptions', async () => {
    const { w, notices } = boot('<button data-test-id="bard-mode-menu-button" aria-label="Open mode picker, currently Flash">Flash</button>', 'gemini.google.com', '/app');
    const opener = w.document.querySelector('button');
    let selected = 'low';
    opener.onclick = () => {
        const menu = w.document.createElement('div');
        menu.role = 'menu';
        menu.innerHTML = `<div role="menuitemradio" aria-checked="true">Quick answers</div><div role="menuitem" aria-haspopup="true" aria-controls="sub"><mat-icon>bolt</mat-icon><span>Thinking level</span></div>`;
        menu.querySelector('[aria-controls]').onclick = () => {
            const sub = w.document.createElement('div');
            sub.role = 'menu';
            sub.id = 'sub';
            for (const [name, hint] of [['Low', 'Fast and efficient'], ['Medium', 'Balanced depth'], ['High', 'Extra thorough']]) {
                const item = w.document.createElement('div');
                item.role = 'menuitemradio';
                item.setAttribute('aria-checked', String(name.toLowerCase() === selected));
                item.innerHTML = `<span> ${name} </span><span>${hint}</span>`;
                // Like Gemini: the whole menu unmounts on selection, and the trigger never shows the level.
                item.onclick = () => { selected = name.toLowerCase(); w.document.querySelectorAll('[role="menu"]').forEach(el => el.remove()); };
                sub.append(item);
            }
            w.document.body.append(sub);
        };
        w.document.body.append(menu);
    };
    const group = await mount(w);
    try {
        await pause(900);
        assert.deepEqual([...group.querySelectorAll('button')].map(el => el.textContent), ['Low', 'Medium', 'High']);
        assert.equal(group.querySelector('[aria-pressed="true"]').textContent, 'Low');
        [...group.querySelectorAll('button')].find(el => el.textContent === 'High').click();
        await pause(900);
        assert.equal(selected, 'high');
        assert.equal(group.querySelector('[aria-pressed="true"]').textContent, 'High');
        assert.equal(w.document.querySelector('[role="menu"]'), null);
        assert.equal(notices.length, 0);
    } finally { w.close(); }
});