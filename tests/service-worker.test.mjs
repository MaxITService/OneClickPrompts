import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from './helpers.mjs';
import { handleMessage } from '../modules/service-worker-message-router.js';
import { StateStore } from '../modules/service-worker-auxiliary-state-store.js';
import { runStateOperation } from '../modules/service-worker-operation-queue.js';

const profile = name => ({ PROFILE_NAME: name, customButtons: [{ text: `Prompt in ${name}`, icon: 'P' }] });
function setup(t, initial = {}) {
    t.mock.method(console, 'log', () => {});
    const local = createStorage(initial);
    globalThis.chrome = {
        storage: { local, session: createStorage() },
        tabs: { query: async () => [], sendMessage: async () => {} },
        runtime: { getURL: path => `https://extension.test/${path}` }
    };
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => profile('Default') }));
    return local;
}
const request = payload => new Promise(resolve => handleMessage(payload, {}, resolve));

test('saving an inactive profile does not switch all tabs back to that profile', async t => {
    const local = setup(t, { currentProfile: 'Work', 'profiles.Work': profile('Work'), 'profiles.Other': profile('Other') });
    assert.equal((await request({ type: 'saveConfig', profileName: 'Other', config: profile('Other') })).success, true);
    assert.equal(local.data.currentProfile, 'Work');
});

test('a transient profile read error cannot overwrite the existing Default profile', async t => {
    const local = setup(t, { currentProfile: 'Work', 'profiles.Work': profile('Work'), 'profiles.Default': profile('Personal default') });
    const get = local.get;
    local.get = async keys => {
        if (keys.includes('profiles.Work')) throw new Error('temporary read failure');
        return get(keys);
    };
    assert.ok((await request({ type: 'getConfig' })).error);
    assert.equal(local.data['profiles.Default'].customButtons[0].text, 'Prompt in Personal default');
    assert.equal(local.data.currentProfile, 'Work');
});

test('a missing active profile falls back to the saved Default instead of resetting it', async t => {
    const local = setup(t, { currentProfile: 'Missing', 'profiles.Default': profile('Default') });
    const result = await request({ type: 'getConfig' });
    assert.equal(result.config.customButtons[0].text, 'Prompt in Default');
    assert.equal(local.data.currentProfile, 'Default');
    assert.equal(local.calls.some(([method, data]) => method === 'set' && Object.hasOwn(data, 'profiles.Default')), false);
});

test('simultaneous create-from-editor requests both survive', async t => {
    const local = setup(t, { currentProfile: 'Work', 'profiles.Work': profile('Work') });
    const results = await Promise.all(['first', 'second'].map(text => request({ type: 'createCustomButtonFromEditorText', text })));
    assert.ok(results.every(result => result.success));
    assert.deepEqual(local.data['profiles.Work'].customButtons.map(button => button.text), ['Prompt in Work', 'first', 'second']);
});

test('Cross-Chat settings and copied prompt survive concurrent updates', async t => {
    setup(t);
    await Promise.all([StateStore.saveCrossChat({ enabled: true }), StateStore.saveStoredPrompt('copied text')]);
    const result = await StateStore.getCrossChat();
    assert.equal(result.settings.enabled, true);
    assert.equal(result.storedPrompt, 'copied text');
});

test('floating panel and selector maps preserve concurrent updates for different sites', async t => {
    setup(t);
    await Promise.all([
        StateStore.saveFloatingPanelSettings('chatgpt.com', { x: 10 }),
        StateStore.saveFloatingPanelSettings('claude.ai', { x: 20 }),
        StateStore.saveCustomSelectors('ChatGPT', { editor: '#first' }),
        StateStore.saveCustomSelectors('Claude', { editor: '#second' })
    ]);
    assert.deepEqual(await StateStore.getFloatingPanelSettings('chatgpt.com'), { x: 10 });
    assert.deepEqual(await StateStore.getFloatingPanelSettings('claude.ai'), { x: 20 });
    assert.deepEqual(await StateStore.getCustomSelectors('ChatGPT'), { editor: '#first' });
    assert.deepEqual(await StateStore.getCustomSelectors('Claude'), { editor: '#second' });
});

test('popup collapse patches merge rather than replacing other section states', async t => {
    setup(t);
    await Promise.all([
        StateStore.setUiPopupState({ collapsibles: { first: true } }),
        StateStore.setUiPopupState({ collapsibles: { second: false } })
    ]);
    assert.deepEqual((await StateStore.getUiPopupState()).collapsibles, { first: true, second: false });
});

test('a failed storage operation releases its queue and other namespaces can progress', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const first = runStateOperation('test-one', async () => { await gate; throw new Error('failed'); });
    const failure = assert.rejects(first, /failed/);
    const second = runStateOperation('test-one', () => 2);
    assert.equal(await runStateOperation('test-two', () => 3), 3);
    release();
    await failure;
    assert.equal(await second, 2);
});

test('malformed runtime messages return an error without throwing', async t => {
    setup(t);
    assert.ok((await request(null)).error);
    assert.ok((await request({})).error);
});

test('an import storage failure leaves profiles and settings unchanged', async t => {
    const local = setup(t, { currentProfile: 'Work', 'profiles.Work': profile('Work'), 'ui.theme': 'light' });
    const before = structuredClone(local.data);
    local.set = async () => { throw new Error('QUOTA_BYTES exceeded'); };
    const result = await request({ type: 'applyBackupPayload', payload: {
        kind: 'OneClickPromptsBackup', backupVersion: 3, currentProfile: 'Imported',
        profiles: { Imported: profile('Imported') }, appSettings: { theme: 'dark' }
    } });
    assert.equal(result.success, false);
    assert.deepEqual(local.data, before);
});

test('an import prepares profiles, legacy settings and the active profile in one write', async t => {
    const local = setup(t, { currentProfile: 'Work', 'profiles.Work': profile('Work') });
    const result = await request({ type: 'applyBackupPayload', payload: {
        kind: 'OneClickPromptsBackup', backupVersion: 3, currentProfile: 'Imported',
        profiles: { Imported: profile('Imported') }, appSettings: {
            theme: 'dark', floatingPanel: { 'chatgpt.com': { x: 42 } },
            crossChatSettings: { enabled: true }, crossChatStoredPrompt: 'saved prompt'
        }
    } });
    assert.equal(result.success, true);
    assert.equal(local.calls.filter(([method]) => method === 'set').length, 1);
    assert.equal(local.data.currentProfile, 'Imported');
    assert.equal(local.data.darkTheme, 'dark');
    assert.equal(local.data.crossChatStoredPrompt, 'saved prompt');
    assert.deepEqual(local.data['floating_panel_chatgpt.com'], { x: 42 });
});

test('invalid imported button data is rejected before any write', async t => {
    const local = setup(t, { currentProfile: 'Work', 'profiles.Work': profile('Work') });
    const result = await request({ type: 'applyBackupPayload', payload: {
        kind: 'OneClickPromptsBackup', backupVersion: 3,
        profiles: { Good: profile('Good'), Bad: { customButtons: [null] } }
    } });
    assert.equal(result.success, false);
    assert.equal(local.calls.some(([method]) => method === 'set'), false);
});

test('backup fallback uses the actual recovered profile name', async t => {
    setup(t, { currentProfile: 'Missing', 'profiles.Default': profile('Default') });
    const result = await request({ type: 'getBackupPayload', scope: 'currentProfile' });
    assert.equal(result.payload.currentProfile, 'Default');
    assert.deepEqual(Object.keys(result.payload.profiles), ['Default']);
});

test('structured floating-panel settings do not read unrelated prompt caches', async t => {
    const local = setup(t, { floatingPanel: { 'chatgpt.com': { x: 1 } }, chatCache: 'large' });
    assert.deepEqual(await StateStore.getFloatingPanelSettings('chatgpt.com'), { x: 1 });
    assert.deepEqual(local.calls, [['get', ['floatingPanel']]]);
});

test('malformed saves leave the profile intact and a following valid save can proceed', async t => {
    const original = profile('Work');
    const local = setup(t, { currentProfile: 'Work', 'profiles.Work': original });
    const bad = await request({ type: 'saveConfig', profileName: 'Work', config: { customButtons: [null] } });
    assert.equal(bad.success, false);
    assert.deepEqual(local.data['profiles.Work'], original);
    assert.equal((await request({ type: 'saveConfig', profileName: 'Work', config: original })).success, true);
});

test('a stale editor action cannot guess between two identical prompt texts', async t => {
    const original = profile('Work');
    original.customButtons = [{ text: 'same', icon: 'A' }, { text: 'same', icon: 'B' }];
    const local = setup(t, { currentProfile: 'Work', 'profiles.Work': original });
    const result = await request({ type: 'updateCustomButtonFromEditorOptions', profileName: 'Work', buttonIndex: 99, text: 'same', newText: 'replacement' });
    assert.equal(result.reason, 'ambiguous_button');
    assert.deepEqual(local.data['profiles.Work'], original);
});

test('an example request from an old profile cannot overwrite the new active profile', async t => {
    const local = setup(t, {
        currentProfile: 'New', 'profiles.New': profile('New'), 'profiles.Old': profile('Old'),
        ocpPromptVariablesSettings: { enabled: true }
    });
    const before = structuredClone(local.data);
    const result = await request({ type: 'ensurePromptVariableExample', profileName: 'Old' });
    assert.equal(result.added, false);
    assert.deepEqual(local.data, before);
});

test('concurrent example initialization and editor creation preserve every button once', async t => {
    const local = setup(t, {
        currentProfile: 'Work', 'profiles.Work': profile('Work'), ocpPromptVariablesSettings: { enabled: true }
    });
    const results = await Promise.all([
        request({ type: 'ensurePromptVariableExample', profileName: 'Work' }),
        request({ type: 'createCustomButtonFromEditorText', text: 'newly saved' }),
        request({ type: 'ensurePromptVariableExample', profileName: 'Work' })
    ]);
    assert.ok(results.every(result => result.success));
    assert.deepEqual(local.data['profiles.Work'].customButtons.map(button => button.text), [
        'Prompt in Work', 'Today is {{today}}.', 'newly saved'
    ]);
    assert.equal(local.data.ocpPromptVariablesSettings.dateExampleInitialized, true);
});

test('example storage failure cannot mark initialization complete or alter prompts', async t => {
    const local = setup(t, {
        currentProfile: 'Work', 'profiles.Work': profile('Work'), ocpPromptVariablesSettings: { enabled: true }
    });
    const before = structuredClone(local.data);
    local.set = async () => { throw new Error('write failed'); };
    assert.equal((await request({ type: 'ensurePromptVariableExample', profileName: 'Work' })).success, false);
    assert.deepEqual(local.data, before);
});

test('variable toggle and initialization preserve variables and the completed example flag', async t => {
    const variables = [{ name: 'company', value: 'Test' }];
    const local = setup(t, {
        currentProfile: 'Work', 'profiles.Work': profile('Work'),
        ocpPromptVariablesSettings: { enabled: true, customVariables: variables }
    });
    await Promise.all([
        request({ type: 'ensurePromptVariableExample', profileName: 'Work' }),
        request({ type: 'savePromptVariableSettings', settings: { enabled: false } })
    ]);
    assert.deepEqual(local.data.ocpPromptVariablesSettings, {
        enabled: false, dateExampleInitialized: true, customVariables: variables
    });
});

test('a disconnected popup response cannot block later state operations', async t => {
    setup(t, { currentProfile: 'Work', 'profiles.Work': profile('Work') });
    handleMessage({ type: 'getConfig' }, {}, () => { throw new Error('Port closed'); });
    assert.equal((await request({ type: 'getConfig' })).config.PROFILE_NAME, 'Work');
});
