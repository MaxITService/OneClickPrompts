import test from 'node:test';
import assert from 'node:assert/strict';
import { page } from './page-harness.mjs';

async function setup(t) {
    const h = page(t);
    const model = { estimate: () => 42, getMetadata: () => ({ id: 'test' }) };
    h.w.OCPTokenApproxHelpers = {
        getRegistry: () => ({ getModel: () => model }), ensureDefaultModel() {},
        resolveModelId: () => 'test', getActiveSite: () => 'Gemini', log() {},
        getModelConstructors: () => [class TokenModelRegistry {}], getCatalog: () => ({})
    };
    await h.load('modules/token-approximator/backend-worker.js');
    return { ...h, model, api: h.w.OCPTokenApproxWorker };
}

test('on-page estimator failures preserve request identity instead of reporting zero tokens', async t => {
    const h = await setup(t);
    h.model.estimate = () => { throw new Error('estimator failed'); };
    const result = h.api.runEstimation({ requestId: 17, texts: { editorText: 'text' } });
    assert.equal(result.ok, false);
    assert.equal(result.requestId, 17);
    assert.equal(result.error, 'estimator failed');
});

test('terminating the CSP fallback prevents scheduled estimation and response delivery', async t => {
    const h = await setup(t);
    let runs = 0;
    h.model.estimate = () => { runs++; return 1; };
    const worker = h.api.createEstimatorWorker('Gemini');
    worker.onmessage = () => assert.fail('Terminated estimator delivered a result');
    worker.postMessage({ requestId: 1, texts: { editorText: 'text' } });
    worker.terminate();
    await h.clock.advance(1);
    assert.equal(runs, 0);
});

test('worker blob URLs are released on startup or termination and on constructor failure', async t => {
    const h = await setup(t);
    const released = [];
    h.w.URL.createObjectURL = () => 'blob:test';
    h.w.URL.revokeObjectURL = url => released.push(url);
    h.w.Worker = class {
        listeners = {};
        addEventListener(type, handler) { this.listeners[type] = handler; }
        terminate() {}
    };
    const worker = h.api.createEstimatorWorker('ChatGPT');
    worker.listeners.message();
    worker.terminate();
    assert.deepEqual(released, ['blob:test']);
    h.w.Worker = class { constructor() { throw new Error('Worker blocked'); } };
    assert.throws(() => h.api.createEstimatorWorker('ChatGPT'), /Worker blocked/);
    assert.deepEqual(released, ['blob:test', 'blob:test']);
});
