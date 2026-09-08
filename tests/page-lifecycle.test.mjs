import test from 'node:test';
import assert from 'node:assert/strict';
import { page } from './page-harness.mjs';
import { settle } from './helpers.mjs';

async function initialize(t) {
    const h = page(t);
    const requests = [];
    const listeners = [];
    let injections = 0;
    Object.assign(h.w, {
        chrome: { runtime: {
            onMessage: { addListener: listener => listeners.push(listener) },
            sendMessage: (message, callback) => { requests.push({ ...message, callback }); }
        } },
        InjectionTargetsOnWebsite: { activeSite: 'ChatGPT', selectors: {} },
        buttonBoxCheckingAndInjection() { injections++; }
    });
    await h.load('init.js');
    return { ...h, requests, listeners, get injections() { return injections; } };
}

test('history and DOM notifications coalesce one route change and ignore same-URL replaceState', async t => {
    const h = await initialize(t);
    let navigations = 0;
    h.w.document.addEventListener('ocp-page-navigated', () => navigations++);
    h.w.history.replaceState({}, '', h.w.location.href);
    await h.clock.advance(150);
    assert.equal(h.requests.length, 1);
    h.w.history.pushState({}, '', '/c/second');
    h.w.document.body.append(h.w.document.createElement('div'));
    await settle();
    h.w.history.replaceState({}, '', '/c/third');
    await h.clock.advance(150);
    assert.equal(navigations, 2);
    assert.equal(h.requests.length, 2);
});

test('a late configuration response from the old route cannot start page initialization', async t => {
    const h = await initialize(t);
    const old = h.requests[0];
    h.w.history.pushState({}, '', '/c/second');
    await h.clock.advance(150);
    old.callback({ config: { PROFILE_NAME: 'Old', customButtons: [] } });
    assert.equal(h.requests.length, 2);
    assert.equal(h.w.globalMaxExtensionConfig, undefined);
    h.requests[1].callback({ config: { PROFILE_NAME: 'New', customButtons: [] } });
    h.requests[2].callback({ settings: {} });
    h.requests[3].callback({ settings: {} });
    h.requests[4].callback({ settings: { isVisible: false } });
    await settle();
    assert.equal(h.w.globalMaxExtensionConfig.PROFILE_NAME, 'New');
    assert.equal(h.injections, 1);
});

test('a profile broadcast received while settings load takes precedence over the older config', async t => {
    const h = await initialize(t);
    h.requests[0].callback({ config: { PROFILE_NAME: 'Old', customButtons: [] } });
    h.listeners[0]({ type: 'profileChanged', config: { PROFILE_NAME: 'Latest', customButtons: [] } }, {}, () => {});
    h.requests[1].callback({ settings: {} });
    h.requests[2].callback({ settings: {} });
    h.requests[3].callback({ settings: {} });
    await settle();
    assert.equal(h.w.globalMaxExtensionConfig.PROFILE_NAME, 'Latest');
    assert.equal(h.injections, 1);
});

test('a mutation storm performs bounded container scans and cancellation releases its work', async t => {
    const h = page(t);
    await h.load('utils.js');
    let scans = 0;
    h.w.MaxExtensionUtils.pickUsableContainer = () => { scans++; return null; };
    const controller = h.w.MaxExtensionUtils.waitForElements('#missing', () => assert.fail('not present'));
    for (let index = 0; index < 200; index++) {
        h.w.document.body.append(h.w.document.createElement('span'));
        await settle();
    }
    assert.equal(scans, 1);
    await h.clock.advance(100);
    assert.equal(scans, 2);
    controller.cancel();
    assert.equal(h.clock.pending.size, 0);
    assert.equal(controller.isPending(), false);
});

test('extended monitoring does not restart a pending search on streamed mutations', async t => {
    const h = page(t);
    await h.load('buttons-injection.js');
    let retries = 0;
    h.w.enforceResiliencyMeasures = () => { retries++; };
    h.w.__OCP_inlineSearchController = { isPending: () => true };
    h.w.startExtendedMonitoringWithObserver();
    for (let index = 0; index < 5; index++) {
        h.w.document.body.append(h.w.document.createElement('span'));
        await settle();
        await h.clock.advance(150);
    }
    assert.equal(retries, 0);
    h.w.__OCP_inlineSearchController = null;
    h.w.document.body.append(h.w.document.createElement('span'));
    await settle();
    await h.clock.advance(150);
    assert.equal(retries, 1);
    h.w.OneClickPropmts_extendedMonitoringObserver.disconnect();
});

test('restarting extended monitoring replaces its expiration timer', async t => {
    const h = page(t);
    await h.load('buttons-injection.js');
    h.w.startExtendedMonitoringWithObserver();
    const previous = h.w.OneClickPropmts_extendedMonitoringObserver;
    await h.clock.advance(1000);
    h.w.startExtendedMonitoringWithObserver();
    assert.notEqual(h.w.OneClickPropmts_extendedMonitoringObserver, previous);
    assert.equal(h.clock.pending.size, 1);
    await h.clock.advance(2 * 60 * 60 * 1000 - 1000);
    assert.ok(h.w.OneClickPropmts_extendedMonitoringObserver);
    await h.clock.advance(1000);
    assert.equal(h.w.OneClickPropmts_extendedMonitoringObserver, null);
});
