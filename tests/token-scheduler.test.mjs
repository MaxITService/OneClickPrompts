import test from 'node:test';
import assert from 'node:assert/strict';
import { page } from './page-harness.mjs';
import { settle } from './helpers.mjs';

async function setup(t) {
    const h = page(t);
    await h.load('modules/token-approximator/backend-scheduler.js');
    await h.load('modules/token-approximator/backend-worker-client.js');
    return { ...h, create: h.w.OCPTokenApproxScheduler.makeScheduler };
}

test('hundreds of streaming updates share one cooldown wake-up', async t => {
    const h = await setup(t);
    let runs = 0;
    const scheduler = h.create({ minCooldown: 600, runFn: async () => { runs++; } });
    scheduler.runNow();
    await settle();
    for (let i = 0; i < 300; i++) scheduler.markDirty();
    assert.equal(h.clock.pending.size, 1);
    await h.clock.advance(599);
    assert.equal(runs, 1);
    await h.clock.advance(17);
    assert.equal(runs, 2);
    assert.equal(h.clock.pending.size, 0);
});

test('edits arriving during a worker request run again after completion without overlap', async t => {
    const h = await setup(t);
    let complete;
    let runs = 0;
    const scheduler = h.create({ minCooldown: 100, runFn: () => {
        runs++;
        return runs === 1 ? new Promise(resolve => { complete = resolve; }) : Promise.resolve();
    } });
    scheduler.runNow();
    scheduler.markDirty();
    await h.clock.advance(500);
    assert.equal(runs, 1);
    complete();
    await settle();
    await h.clock.advance(16);
    assert.equal(runs, 2);
});

test('a failed counter update does not strand subsequent work', async t => {
    const h = await setup(t);
    let runs = 0;
    const scheduler = h.create({ minCooldown: 10, runFn: async () => { if (++runs === 1) throw new Error('worker failed'); } });
    scheduler.runNow();
    await settle();
    scheduler.markDirty();
    await h.clock.advance(26);
    assert.equal(runs, 2);
    assert.equal(scheduler.pauseInfo().running, false);
});

test('disabling or disposing a scheduler prevents delayed execution', async t => {
    const h = await setup(t);
    let enabled = true;
    let runs = 0;
    const scheduler = h.create({ isEnabled: () => enabled, runFn: async () => { runs++; } });
    scheduler.markDirty();
    enabled = false;
    await h.clock.advance(100);
    assert.equal(runs, 0);
    enabled = true;
    scheduler.markDirty();
    scheduler.dispose();
    await h.clock.advance(100);
    assert.equal(runs, 0);
    assert.equal(h.clock.pending.size, 0);
});

test('a live counter disable survives later page DOM changes and can be enabled again', async t => {
    const h = await setup(t);
    h.w.document.body.innerHTML = '<div id="buttons"></div><textarea>text</textarea>';
    const settings = { enabled: true, enabledSites: { ChatGPT: true }, threadMode: 'hide', showEditorCounter: false };
    const listeners = [];
    Object.assign(h.w, {
        InjectionTargetsOnWebsite: { activeSite: 'ChatGPT', selectors: { buttonsContainerId: 'buttons' } },
        OCPTokenApproxSettings: { loadSettings: async () => ({ ...settings }) },
        OCPTokenApproxWorker: { createEstimatorWorker: () => ({ postMessage() {} }) },
        chrome: { runtime: { onMessage: { addListener: listener => listeners.push(listener) } } }
    });
    await h.load('modules/token-approximator/backend-ui.js');
    await h.load('modules/backend-tokenApproximator.js');
    await settle();
    assert.ok(h.w.document.getElementById('ocp-token-approx-wrap'));
    assert.equal(listeners.length, 1);
    listeners[0]({ type: 'tokenApproximatorSettingsChanged', settings: { ...settings, enabled: false } });
    h.w.document.body.append(h.w.document.createElement('div'));
    await settle();
    await h.clock.advance(1000);
    assert.equal(h.w.document.getElementById('ocp-token-approx-wrap'), null);
    listeners[0]({ type: 'tokenApproximatorSettingsChanged', settings });
    await settle();
    assert.ok(h.w.document.getElementById('ocp-token-approx-wrap'));
});

test('counter rendering cannot retrigger itself and manual queue fields are excluded from editor text', async t => {
    const h = await setup(t);
    h.w.document.body.innerHTML = '<div id="buttons"></div><textarea id="composer">actual prompt</textarea>'
        + '<div id="max-extension-floating-panel"><textarea>long saved prompt</textarea></div>';
    h.w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 40 });
    const requests = [];
    Object.assign(h.w, {
        InjectionTargetsOnWebsite: { activeSite: 'ChatGPT', selectors: { buttonsContainerId: 'buttons', editors: ['textarea'] } },
        OCPTokenApproxSettings: { loadSettings: async () => ({
            enabled: true, enabledSites: { ChatGPT: true }, threadMode: 'hide', showEditorCounter: true
        }) },
        OCPTokenApproxWorker: { createEstimatorWorker: () => {
            const worker = { postMessage(payload) {
                requests.push(payload);
                h.clock.setTimeout(() => worker.onmessage({ data: { ok: true, requestId: payload.requestId, estimates: { editorText: 3 } } }), 1);
            } };
            return worker;
        } },
        chrome: { runtime: { onMessage: { addListener() {} } } }
    });
    await h.load('modules/token-approximator/backend-ui.js');
    await h.load('modules/backend-tokenApproximator.js');
    await settle();
    await h.clock.advance(5000);
    assert.equal(requests.length, 1, 'Rendering the result must not create an estimation loop');
    assert.equal(requests[0].texts.editorText, 'actual prompt');
    const composer = h.w.document.getElementById('composer');
    composer.value = 'edited prompt';
    composer.dispatchEvent(new h.w.Event('input', { bubbles: true }));
    await h.clock.advance(1000);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].texts.editorText, 'edited prompt');
});

test('unknown editor DOM stays unavailable without loading flashes and recovers when the composer returns', async t => {
    const h = await setup(t);
    h.w.document.body.innerHTML = '<div id="buttons"></div><textarea id="composer">text</textarea>';
    h.w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 40 });
    const requests = [];
    Object.assign(h.w, {
        InjectionTargetsOnWebsite: { activeSite: 'ChatGPT', selectors: { buttonsContainerId: 'buttons', editors: ['#composer'], threadRoot: '[invalid' } },
        OCPTokenApproxSettings: { loadSettings: async () => ({
            enabled: true, enabledSites: { ChatGPT: true }, threadMode: 'ignoreEditors', showEditorCounter: true
        }) },
        OCPTokenApproxWorker: { createEstimatorWorker: () => {
            const worker = { postMessage(payload) {
                requests.push(payload);
                h.clock.setTimeout(() => worker.onmessage?.({ data: { ok: true, requestId: payload.requestId, estimates: { editorText: 3 } } }), 1);
            }, terminate() {} };
            return worker;
        } },
        chrome: { runtime: { onMessage: { addListener() {} } } }
    });
    await h.load('modules/token-approximator/backend-ui.js');
    await h.load('modules/backend-tokenApproximator.js');
    await settle();
    await h.clock.advance(1000);
    const editorChip = h.w.document.querySelector('[data-kind="editor"]');
    const threadChip = h.w.document.querySelector('[data-kind="thread"]');
    assert.equal(editorChip.__tooltipStatus, 'fresh');
    assert.equal(threadChip.__tooltipStatus, 'error');
    h.w.document.getElementById('composer').remove();
    await settle();
    await h.clock.advance(1000);
    assert.equal(editorChip.__tooltipStatus, 'error');
    assert.match(editorChip.title, /unavailable/);
    let loadingFlashes = 0;
    // Observe actual resulting classes on mutations, including visibility-triggered retries.
    const observer = new h.w.MutationObserver(() => {
        if (editorChip.classList.contains('ocp-tokapprox-loading') || threadChip.classList.contains('ocp-tokapprox-loading')) loadingFlashes++;
    });
    observer.observe(h.w.document.body, { attributes: true, subtree: true });
    for (let index = 0; index < 4; index++) {
        h.w.document.body.append(h.w.document.createElement('span'));
        Object.defineProperty(h.w.document, 'visibilityState', { configurable: true, value: 'hidden' });
        h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
        Object.defineProperty(h.w.document, 'visibilityState', { configurable: true, value: 'visible' });
        h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
        await settle();
        await h.clock.advance(3000);
    }
    assert.equal(loadingFlashes, 0);
    assert.equal(editorChip.__tooltipStatus, 'error', 'The old stale timer must not erase unavailable state');
    assert.equal(requests.length, 1);
    const composer = h.w.document.createElement('textarea');
    composer.id = 'composer'; composer.value = 'restored';
    h.w.document.body.append(composer);
    await settle();
    await h.clock.advance(1000);
    assert.equal(editorChip.__tooltipStatus, 'fresh');
    assert.equal(requests.length, 2);
    observer.disconnect();
});
