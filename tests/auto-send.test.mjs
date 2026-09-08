import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { source, createClock, settle } from './helpers.mjs';

async function setup(t) {
    const dom = new JSDOM('<textarea id="editor"></textarea><button id="send">Send</button>', {
        url: 'https://chatgpt.com', runScripts: 'outside-only'
    });
    t.after(() => dom.window.close());
    const w = dom.window;
    const clock = createClock();
    Object.assign(w, {
        Date: clock.Date, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
        setInterval: clock.setInterval, clearInterval: clock.clearInterval, logConCgp() {},
        InjectionTargetsOnWebsite: { selectors: { editors: ['#editor'], sendButtons: ['#send'] } }
    });
    w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 40 });
    for (const path of ['per-website-button-clicking-mechanics/buttons-clicking-shared.js', 'modules/selector-auto-detector/selector-guard.js']) {
        vm.runInContext(await source(path), dom.getInternalVMContext(), { filename: path });
    }
    const button = w.document.getElementById('send');
    const abort = new w.AbortController();
    let clicks = 0;
    let cleared = false;
    const queueContext = {
        signal: abort.signal,
        async checkpointDraft() {}, isDraftIntact: () => true, isEditorCleared: () => cleared
    };
    const config = {
        queueContext, findButton: async () => button, findStopButton: () => null,
        clickAction: () => { clicks++; cleared = true; }
    };
    return { w, clock, button, abort, queueContext, config, get clicks() { return clicks; },
        run: overrides => w.ButtonsClickingShared.performAutoSend({ ...config, ...overrides }) };
}

test('auto-send clicks once, observes the cleared editor, and releases all timers', async t => {
    const h = await setup(t);
    const result = h.run();
    await h.clock.advance(1000);
    assert.equal((await result).status, 'sent');
    assert.equal(h.clicks, 1);
    assert.equal(h.clock.pending.size, 0);
    assert.equal(h.w.sharedAutoSendCancel, null);
});

test('a click without acceptance times out as unconfirmed and is never repeated', async t => {
    const h = await setup(t);
    let clicks = 0;
    const result = h.run({ clickAction() { clicks++; } });
    await h.clock.advance(6000);
    assert.equal((await result).status, 'unconfirmed');
    assert.equal(clicks, 1);
    assert.equal(h.clock.pending.size, 0);
});

test('aborting during an asynchronous button lookup prevents a late click', async t => {
    const h = await setup(t);
    let resolveLookup;
    const result = h.run({ findButton: () => new Promise(resolve => { resolveLookup = resolve; }) });
    await h.clock.advance(100);
    h.abort.abort();
    resolveLookup(h.button);
    await settle();
    assert.equal((await result).status, 'cancelled');
    assert.equal(h.clicks, 0);
    assert.equal(h.clock.pending.size, 0);
});

test('a new send run supersedes a pending lookup without letting the old run click', async t => {
    const h = await setup(t);
    let resolveLookup;
    const old = h.run({ findButton: () => new Promise(resolve => { resolveLookup = resolve; }) });
    await h.clock.advance(100);
    const current = h.run();
    resolveLookup(h.button);
    await h.clock.advance(500);
    assert.equal((await old).reason, 'superseded');
    assert.equal((await current).status, 'sent');
    assert.equal(h.clicks, 1);
});

test('button removal during draft persistence prevents sending', async t => {
    const h = await setup(t);
    h.queueContext.checkpointDraft = async () => h.button.remove();
    const result = h.run({ maxAttempts: 1 });
    await h.clock.advance(100);
    assert.equal((await result).reason, 'click_rejected');
    assert.equal(h.clicks, 0);
});

test('a normal send rechecks a button disabled during asynchronous validation', async t => {
    const h = await setup(t);
    const result = h.run({ queueContext: null, maxAttempts: 1, async preClickValidation() {
        h.button.disabled = true;
        return true;
    } });
    await h.clock.advance(100);
    assert.equal((await result).reason, 'click_rejected');
    assert.equal(h.clicks, 0);
});

test('missing send controls exhaust the search and release its timer', async t => {
    const h = await setup(t);
    const result = h.run({ findButton: async () => null, maxAttempts: 3 });
    await h.clock.advance(500);
    assert.equal((await result).status, 'not_found');
    assert.equal(h.clock.pending.size, 0);
});

test('Stop must remain absent before a queued prompt can be sent', async t => {
    const h = await setup(t);
    const stop = h.w.document.createElement('button');
    stop.setAttribute('aria-label', 'Stop generating');
    h.w.document.body.append(stop);
    const result = h.run({ postStopAbsenceDelay: 600 });
    await h.clock.advance(1000);
    assert.equal(h.clicks, 0);
    stop.remove();
    await h.clock.advance(599);
    assert.equal(h.clicks, 0);
    await h.clock.advance(1000);
    assert.equal((await result).status, 'sent');
    assert.equal(h.clicks, 1);
    assert.equal(h.clock.pending.size, 0);
});

test('cancelling during Stop confirmation clears its delayed callback too', async t => {
    const h = await setup(t);
    h.button.setAttribute('aria-label', 'Stop');
    const result = h.run({ stopConfirmationDelay: 1000 });
    await h.clock.advance(100);
    h.abort.abort();
    assert.equal((await result).status, 'cancelled');
    assert.equal(h.clock.pending.size, 0);
});

test('selector lookup works without the optional detector and skips malformed or hidden matches', async t => {
    const h = await setup(t);
    const hidden = h.button.cloneNode(true);
    hidden.id = 'hidden';
    hidden.style.display = 'none';
    h.w.document.body.prepend(hidden);
    h.w.InjectionTargetsOnWebsite.selectors.sendButtons = ['[broken', '#hidden', '#send'];
    assert.equal(await h.w.OneClickPromptsSelectorGuard.findSendButton(), h.button);
    assert.equal((await h.w.OneClickPromptsSelectorGuard.findEditor()).id, 'editor');
    h.button.remove();
    assert.equal(await h.w.OneClickPromptsSelectorGuard.findSendButton(), null);
});

test('fixed controls are visible and a second Stop attribute is respected', async t => {
    const h = await setup(t);
    h.button.style.position = 'fixed';
    assert.equal(h.button.offsetParent, null);
    assert.equal(h.w.ButtonsClickingShared.isVisibleInteractiveElement(h.button), true);
    h.button.setAttribute('aria-label', 'Generation control');
    h.button.setAttribute('data-testid', 'stop-button');
    assert.equal(h.w.ButtonsClickingShared.isBusyStopButton(h.button), true);
});

test('navigating away cancels a pending normal send before it can target the next chat', async t => {
    const h = await setup(t);
    const result = h.run({ queueContext: null });
    h.w.document.dispatchEvent(new h.w.CustomEvent('ocp-page-navigated'));
    await h.clock.advance(500);
    assert.equal((await result).reason, 'page_navigated');
    assert.equal(h.clicks, 0);
    assert.equal(h.clock.pending.size, 0);
});
