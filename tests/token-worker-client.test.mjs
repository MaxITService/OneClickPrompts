import test from 'node:test';
import assert from 'node:assert/strict';
import { page } from './page-harness.mjs';
import { settle } from './helpers.mjs';

async function setup(t) {
    const h = page(t);
    await h.load('modules/token-approximator/backend-worker-client.js');
    const workers = [];
    const client = h.w.OCPTokenApproxWorkerClient.create({ timeoutMs: 100, createWorker() {
        const worker = { sent: [], terminated: false,
            postMessage(payload) { this.sent.push(payload); }, terminate() { this.terminated = true; } };
        workers.push(worker);
        return worker;
    } });
    return { ...h, workers, client };
}

test('a silent worker times out, is terminated, and the next request creates a new worker', async t => {
    const h = await setup(t);
    const failed = assert.rejects(h.client.request({}), { name: 'TimeoutError' });
    await h.clock.advance(100);
    await failed;
    assert.equal(h.workers[0].terminated, true);
    const next = h.client.request({});
    const worker = h.workers[1];
    worker.onmessage({ data: { requestId: worker.sent[0].requestId, ok: true } });
    assert.equal((await next).ok, true);
    assert.equal(h.clock.pending.size, 0);
});

test('unrelated and duplicate replies cannot finish a current request', async t => {
    const h = await setup(t);
    let finished = false;
    const result = h.client.request({}).then(value => { finished = true; return value; });
    const worker = h.workers[0];
    worker.onmessage({ data: { requestId: -1 } });
    await settle();
    assert.equal(finished, false);
    worker.onmessage({ data: { requestId: worker.sent[0].requestId, ok: true } });
    await result;
    assert.doesNotThrow(() => worker.onmessage({ data: {} }));
    assert.equal(h.clock.pending.size, 0);
});

test('navigation cancellation ignores late replies from the previous worker', async t => {
    const h = await setup(t);
    const cancelled = assert.rejects(h.client.request({}), { name: 'AbortError' });
    const staleHandler = h.workers[0].onmessage;
    h.client.reset();
    await cancelled;
    let completed = false;
    const next = h.client.request({}).then(() => { completed = true; });
    staleHandler({ data: { requestId: 1, ok: true } });
    await settle();
    assert.equal(completed, false);
    h.workers[1].onmessage({ data: { requestId: 2, ok: true } });
    await next;
});

test('unreadable worker messages release the pending request and disposal prevents new work', async t => {
    const h = await setup(t);
    const failure = assert.rejects(h.client.request({}), /unreadable/);
    h.workers[0].onmessageerror();
    await failure;
    assert.equal(h.clock.pending.size, 0);
    h.client.dispose();
    await assert.rejects(h.client.request({}), { name: 'AbortError' });
});

test('a postMessage exception terminates the failed worker and does not leave a timer', async t => {
    const h = await setup(t);
    const client = h.w.OCPTokenApproxWorkerClient.create({ createWorker: () => ({
        postMessage() { throw new Error('DataCloneError'); }, terminate() {}
    }) });
    await assert.rejects(client.request({}), /DataCloneError/);
    assert.equal(h.clock.pending.size, 0);
});
