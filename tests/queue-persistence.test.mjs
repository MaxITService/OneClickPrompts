import test from 'node:test';
import assert from 'node:assert/strict';
import { source, createStorage } from './helpers.mjs';

const prefix = 'ocpQueueSnapshot.v1.';
const marker = 'ocpQueuePersistenceCleanup.v1';
const origin = 'https://chatgpt.com';
const sender = { tab: { id: 1 }, url: `${origin}/c/test` };
const journal = text => ({
    schemaVersion: 1, origin, savedAt: Date.now(),
    items: [{ queueId: 'queue-item-1', text, icon: 'Q' }],
    timerDurationMs: 60_000, timerRemainingMs: 10_000, nextQueueItemId: 2
});
let moduleNumber = 0;

test('refresh restores a newer tab backup after messaging failed', async () => {
    const { api, local } = await setup();
    const { instanceId, tabId } = await api.claimQueuePersistenceContext({}, sender);
    await api.saveQueuePersistenceSnapshot({ instanceId, snapshot: { ...journal('old'), savedAt: Date.now() - 1000 } }, sender);
    const snapshot = journal('latest unsent prompt');
    const result = await api.claimQueuePersistenceContext({ candidateInstanceId: instanceId,
        backup: { instanceId, tabId, savedAt: snapshot.savedAt, snapshot } }, sender);
    assert.equal(result.snapshot.items[0].text, 'latest unsent prompt');
    assert.equal(local.data[`${prefix}${instanceId}`].items[0].text, 'latest unsent prompt');
});

test('an empty tab backup prevents a completed prompt from returning after refresh', async () => {
    const { api, local } = await setup();
    const { instanceId, tabId } = await api.claimQueuePersistenceContext({}, sender);
    await api.saveQueuePersistenceSnapshot({ instanceId, snapshot: journal('already sent') }, sender);
    const result = await api.claimQueuePersistenceContext({ candidateInstanceId: instanceId,
        backup: { instanceId, tabId, savedAt: Date.now(), snapshot: null } }, sender);
    assert.equal(result.snapshot, null);
    assert.equal(local.data[`${prefix}${instanceId}`], undefined);
});

test('a copied backup cannot steal a queue after extension reload clears the registry', async () => {
    const { api, session } = await setup();
    const { instanceId, tabId } = await api.claimQueuePersistenceContext({}, sender);
    const snapshot = journal('original tab only');
    await api.saveQueuePersistenceSnapshot({ instanceId, snapshot }, sender);
    delete session.data['ocpQueuePersistenceRegistry.v1'];
    const backup = { instanceId, tabId, savedAt: snapshot.savedAt, snapshot };
    const duplicate = await api.claimQueuePersistenceContext({ candidateInstanceId: instanceId, backup },
        { ...sender, tab: { id: 2 } });
    assert.notEqual(duplicate.instanceId, instanceId);
    assert.equal(duplicate.snapshot, null);
    const original = await api.claimQueuePersistenceContext({ candidateInstanceId: instanceId, backup }, sender);
    assert.equal(original.instanceId, instanceId);
    assert.equal(original.snapshot.items[0].text, 'original tab only');
});

async function setup(initial = {}) {
    const local = createStorage(initial);
    const session = createStorage();
    globalThis.chrome = { storage: { local, session } };
    // This production module has no imports. A unique URL gives each test fresh module state.
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(await source('modules/service-worker-queue-persistence.js')).toString('base64')}#${++moduleNumber}`;
    return { api: await import(moduleUrl), local, session };
}

test('a duplicated tab receives a different queue and cannot overwrite the original', async () => {
    const { api } = await setup();
    const first = await api.claimQueuePersistenceContext({}, sender);
    assert.equal((await api.saveQueuePersistenceSnapshot({ instanceId: first.instanceId, snapshot: journal('original') }, sender)).success, true);
    const duplicateSender = { ...sender, tab: { id: 2 } };
    const second = await api.claimQueuePersistenceContext({ candidateInstanceId: first.instanceId }, duplicateSender);
    assert.notEqual(second.instanceId, first.instanceId);
    assert.equal(second.snapshot, null);
    assert.equal((await api.saveQueuePersistenceSnapshot({ instanceId: first.instanceId, snapshot: journal('overwrite') }, duplicateSender)).success, false);
    assert.equal((await api.deleteQueuePersistenceSnapshot({ instanceId: first.instanceId }, duplicateSender)).success, false);
});

test('invalid journals cannot overwrite a valid saved queue', async () => {
    const { api, local } = await setup();
    const { instanceId } = await api.claimQueuePersistenceContext({}, sender);
    await api.saveQueuePersistenceSnapshot({ instanceId, snapshot: journal('keep') }, sender);
    const duplicateIds = journal('bad');
    duplicateIds.items.push({ ...duplicateIds.items[0] });
    assert.equal((await api.saveQueuePersistenceSnapshot({ instanceId, snapshot: duplicateIds }, sender)).success, false);
    const wrongOrigin = { ...journal('wrong site'), origin: 'https://claude.ai' };
    assert.equal((await api.saveQueuePersistenceSnapshot({ instanceId, snapshot: wrongOrigin }, sender)).success, false);
    assert.equal(local.data[`${prefix}${instanceId}`].items[0].text, 'keep');
});

test('non-finite and unsafe journal counters cannot replace a valid recovery snapshot', async () => {
    const { api, local } = await setup();
    const { instanceId } = await api.claimQueuePersistenceContext({}, sender);
    await api.saveQueuePersistenceSnapshot({ instanceId, snapshot: journal('keep') }, sender);
    for (const field of ['timerDurationMs', 'timerRemainingMs', 'nextQueueItemId', 'savedAt']) {
        for (const value of [Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, -1]) {
            const snapshot = { ...journal('invalid'), [field]: value };
            const response = await api.saveQueuePersistenceSnapshot({ instanceId, snapshot }, sender);
            assert.equal(response.success, false, `${field}=${value} must be rejected`);
        }
    }
    assert.equal(local.data[`${prefix}${instanceId}`].items[0].text, 'keep');
});

test('cleanup reads only queue journals and concurrent claims perform one sweep', async () => {
    const old = { ...journal('expired'), savedAt: Date.now() - 8 * 86_400_000 };
    const { api, local } = await setup({
        [`${prefix}expired`]: old,
        [`${prefix}fresh`]: journal('fresh'),
        'profiles.Personal': { customButtons: [{ text: 'private prompt' }] },
        'chatCache': 'large unrelated cache'
    });
    await Promise.all([1, 2, 3].map(id => api.claimQueuePersistenceContext({}, { ...sender, tab: { id } })));
    assert.equal(local.data[`${prefix}expired`], undefined);
    assert.equal(local.data[`${prefix}fresh`].items[0].text, 'fresh');
    assert.equal(local.data.chatCache, 'large unrelated cache');
    assert.equal(local.calls.filter(([method]) => method === 'getKeys').length, 1);
    for (const [method, keys] of local.calls) {
        if (method !== 'get') continue;
        assert.notEqual(keys, null);
        assert.ok((Array.isArray(keys) ? keys : [keys]).every(key => key.startsWith(prefix)));
    }
});

test('failed cleanup does not postpone the next cleanup attempt for a day', async () => {
    const { api, local, session } = await setup({ [`${prefix}old`]: { savedAt: 1 } });
    const remove = local.remove;
    local.remove = async () => { throw new Error('storage temporarily unavailable'); };
    await assert.rejects(api.claimQueuePersistenceContext({}, sender), /temporarily unavailable/);
    assert.equal(session.data[marker], undefined);
    local.remove = remove;
    assert.equal((await api.claimQueuePersistenceContext({}, sender)).success, true);
    assert.equal(local.data[`${prefix}old`], undefined);
    assert.ok(session.data[marker] > 0);
});

test('a fresh save waits for expiration cleanup and survives it', async () => {
    const { api, local, session } = await setup();
    const { instanceId } = await api.claimQueuePersistenceContext({}, sender);
    local.data[`${prefix}${instanceId}`] = { ...journal('old'), savedAt: 1 };
    delete session.data[marker];
    const get = local.get;
    let signalRead, releaseRead;
    const reading = new Promise(resolve => { signalRead = resolve; });
    const release = new Promise(resolve => { releaseRead = resolve; });
    local.get = async keys => {
        const result = await get(keys);
        if (Array.isArray(keys) && keys.includes(`${prefix}${instanceId}`)) {
            signalRead();
            await release;
        }
        return result;
    };
    const cleanup = api.claimQueuePersistenceContext({}, { ...sender, tab: { id: 2 } });
    await reading;
    const save = api.saveQueuePersistenceSnapshot({ instanceId, snapshot: journal('fresh replacement') }, sender);
    releaseRead();
    await Promise.all([cleanup, save]);
    assert.equal(local.data[`${prefix}${instanceId}`].items[0].text, 'fresh replacement');
});
