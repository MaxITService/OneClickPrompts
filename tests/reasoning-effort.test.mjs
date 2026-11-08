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
    w.chrome = { runtime: { sendMessage: async () => ({ settings: { enabled: true } }), onMessage: { addListener: fn => { listener = fn; } } } };
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
        assert.equal(f.notices.length, 1);
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
