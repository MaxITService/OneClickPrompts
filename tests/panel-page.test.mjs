import test from 'node:test';
import assert from 'node:assert/strict';
import { page } from './page-harness.mjs';
import { source } from './helpers.mjs';

async function setup(t) {
    const h = page(t);
    await h.load('floating-panel.js');
    await h.load('floating-panel-ui-creation.js');
    const panel = h.w.MaxExtensionFloatingPanel;
    Object.assign(panel, {
        updatePanelFromSettings() {}, debouncedSavePanelSettings() {},
        makeDraggable() {}, initializeQueueSection() {}
    });
    h.w.chrome = { runtime: { getURL: path => `https://extension.test/${path}` } };
    return { ...h, panel };
}

test('overlapping page initialization creates one floating panel and fetches its template once', async t => {
    const h = await setup(t);
    const template = await source('floating-panel-files/floating-panel.html');
    let respond;
    let fetches = 0;
    h.w.fetch = () => { fetches++; return new Promise(resolve => { respond = resolve; }); };
    const first = h.panel.createFloatingPanel();
    const second = h.panel.createFloatingPanel();
    assert.equal(first, second);
    respond({ ok: true, text: async () => template });
    const panel = await first;
    assert.ok(panel);
    assert.equal(await second, panel);
    assert.equal(fetches, 1);
    assert.equal(h.w.document.querySelectorAll('#max-extension-floating-panel').length, 1);
});

test('a failed panel setup removes its partial DOM and allows a clean retry', async t => {
    const h = await setup(t);
    const template = await source('floating-panel-files/floating-panel.html');
    h.w.fetch = async () => ({ ok: true, text: async () => template });
    h.panel.initializeQueueSection = () => { throw new Error('setup failed'); };
    assert.equal(await h.panel.createFloatingPanel(), null);
    assert.equal(h.panel.panelElement, null);
    assert.equal(h.w.document.getElementById('max-extension-floating-panel'), null);
    assert.equal(h.panel.__panelDomEvents.signal.aborted, true);
    h.panel.initializeQueueSection = () => {};
    assert.ok(await h.panel.createFloatingPanel());
});

test('responsive queue setup disconnects the previous observer and keeps one resize listener', async t => {
    const h = await setup(t);
    const observers = [];
    h.w.ResizeObserver = class {
        constructor() { this.disconnected = false; observers.push(this); }
        observe() {}
        disconnect() { this.disconnected = true; }
    };
    h.panel.panelElement = h.w.document.body;
    const remove = t.mock.method(h.w, 'removeEventListener');
    h.panel.initializeResponsiveQueueToggle();
    const oldPlacement = h.panel.updateQueueTogglePlacement;
    h.panel.initializeResponsiveQueueToggle();
    assert.equal(observers[0].disconnected, true);
    assert.equal(observers[1].disconnected, false);
    assert.ok(remove.mock.calls.some(({ arguments: args }) => args[0] === 'resize' && args[1] === oldPlacement));
    assert.equal(h.clock.pending.size, 1);
});

test('an expanded manual queue renders without feeding another runtime update back into itself', async t => {
    const h = page(t, '<button id="manual"></button><section id="cards"></section>');
    await h.load('floating-panel.js');
    await h.load('floating-panel-ui-queue.js');
    const panel = h.w.MaxExtensionFloatingPanel;
    let notifications = 0;
    Object.assign(panel, {
        manualQueueExpanded: true,
        manualQueueModeButton: h.w.document.getElementById('manual'),
        manualQueueSection: h.w.document.getElementById('cards'),
        queueRuntime: { notifyState: options => { notifications++; panel.syncQueueUiFromState(options); } }
    });
    h.w.globalMaxExtensionConfig = { enableQueueMode: true };
    h.evaluate('window.MaxExtensionFloatingPanel.syncQueueUiFromState()');
    assert.equal(notifications, 0);
    assert.equal(panel.manualQueueExpanded, true);
    assert.equal(panel.manualQueueSection.style.display, 'block');
    h.w.globalMaxExtensionConfig.enableQueueMode = false;
    h.evaluate('window.MaxExtensionFloatingPanel.syncQueueUiFromState()');
    assert.equal(panel.manualQueueExpanded, false);
    h.w.globalMaxExtensionConfig.enableQueueMode = true;
    h.evaluate('window.MaxExtensionFloatingPanel.syncQueueUiFromState()');
    assert.equal(panel.manualQueueExpanded, true);
    assert.equal(notifications, 0);
});

test('page settings save uses the configuration profile even if the panel label is stale', async t => {
    const h = await setup(t);
    await h.load('floating-panel-settings.js');
    const messages = [];
    h.w.chrome.runtime.sendMessage = (message, callback) => { messages.push(message); callback({ success: true }); };
    h.panel.currentProfileName = 'Old';
    h.w.globalMaxExtensionConfig = { PROFILE_NAME: 'New', customButtons: [] };
    h.panel.saveCurrentProfileConfig();
    assert.equal(messages[0].profileName, 'New');
    assert.equal(messages[0].config.PROFILE_NAME, 'New');
});
