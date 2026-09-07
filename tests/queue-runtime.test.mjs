import test from 'node:test';
import assert from 'node:assert/strict';
import { loadQueue } from './helpers.mjs';

const prompt = text => ({ text, icon: 'Q', autoSend: true });

test('queue capacity includes the prompt currently being sent', async () => {
    const { runtime } = await loadQueue();
    await runtime.ready;
    runtime.enqueueMany([prompt('first'), prompt('second')], 2);
    const first = runtime.takeNext();
    assert.equal(runtime.enqueue(prompt('overflow'), 2), null);
    assert.equal(runtime.takeNext(), null);
    assert.equal(runtime.confirmInFlightSent('wrong-id'), false);
    assert.equal(runtime.snapshot.inFlightItem.queueId, first.queueId);
    runtime.restoreFront(first);
    runtime.restoreFront(first);
    assert.deepEqual(Array.from(runtime.snapshot.items, item => item.text), ['first', 'second']);
});

test('long countdowns use bounded timers and dispatch exactly once at the deadline', async () => {
    const { runtime, clock } = await loadQueue();
    await runtime.ready;
    runtime.enqueue(prompt('later'), 10);
    const maximumTimer = 2 ** 31 - 1;
    const duration = maximumTimer + 60_000;
    let sends = 0;
    runtime.schedule(duration, () => sends++);
    await clock.advance(maximumTimer);
    assert.equal(sends, 0);
    assert.equal(runtime.snapshot.phase, 'waiting');
    await clock.advance(59_999);
    assert.equal(sends, 0);
    await clock.advance(1);
    assert.equal(sends, 1);
    assert.ok(clock.delays.every(delay => delay <= maximumTimer));
});

test('pause preserves remaining time; resume waits only that remainder', async () => {
    const { runtime, clock } = await loadQueue();
    await runtime.ready;
    runtime.enqueue(prompt('later'), 10);
    let sends = 0;
    runtime.schedule(60_000, () => sends++);
    await clock.advance(20_000);
    assert.equal(runtime.pause(), 40_000);
    await clock.advance(100_000);
    assert.equal(sends, 0);
    runtime.resume(() => sends++);
    await clock.advance(39_999);
    assert.equal(sends, 0);
    await clock.advance(1);
    assert.equal(sends, 1);
});

test('reset cancels timers and in-progress dispatch signals', async () => {
    const { runtime, owner, clock } = await loadQueue();
    await runtime.ready;
    runtime.enqueue(prompt('cancel me'), 10);
    const controller = new AbortController();
    owner.__queueDispatchController = controller;
    let sends = 0;
    runtime.schedule(1000, () => sends++);
    const generation = runtime.snapshot.generation;
    runtime.reset();
    assert.equal(controller.signal.aborted, true);
    assert.equal(runtime.isCurrentGeneration(generation), false);
    await clock.advance(2000);
    assert.equal(sends, 0);
    assert.equal(runtime.snapshot.items.length, 0);
});

test('crash recovery puts an uncertain send first and never resumes automatically', async () => {
    const { runtime, clock } = await loadQueue({ snapshot: {
        items: [{ ...prompt('next'), queueId: 'queue-item-2' }],
        inFlightItem: { ...prompt('uncertain'), queueId: 'queue-item-1' },
        timerDurationMs: 60_000, timerRemainingMs: 30_000, nextQueueItemId: 3
    } });
    await runtime.ready;
    assert.deepEqual(Array.from(runtime.snapshot.items, item => item.text), ['uncertain', 'next']);
    assert.equal(runtime.snapshot.status.text, 'Check last send');
    assert.equal(runtime.snapshot.isRunning, false);
    assert.equal(clock.pending.size, 0);
});

test('edits made while recovery loads take precedence over the old journal', async () => {
    let resolveClaim;
    const claim = new Promise(resolve => { resolveClaim = resolve; });
    const { runtime } = await loadQueue({ claim });
    runtime.enqueue(prompt('new'), 10);
    resolveClaim({ success: true, instanceId: 'test-instance-123456', snapshot: {
        items: [{ ...prompt('old'), queueId: 'queue-item-99' }]
    } });
    await runtime.ready;
    assert.deepEqual(Array.from(runtime.snapshot.items, item => item.text), ['new']);
});

test('retry reuses an intact draft instead of inserting the same prompt twice', async () => {
    const { runtime, window } = await loadQueue();
    await runtime.ready;
    const item = runtime.enqueue(prompt('hello'), 10);
    const editor = { value: '', isConnected: true };
    const createContext = () => new window.MaxExtensionQueueSendContext(item, new AbortController().signal, runtime, runtime.snapshot.generation);
    let insertions = 0;
    await createContext().insert(editor, () => { insertions++; editor.value = 'hello'; });
    await createContext().insert(editor, () => { insertions++; editor.value += 'hello'; });
    assert.equal(insertions, 1);
    assert.equal(editor.value, 'hello');
    editor.value = 'my new draft';
    await assert.rejects(createContext().insert(editor, () => insertions++), /editor changed/);
    assert.equal(insertions, 1);
});

test('a failed draft journal blocks sending, and navigation invalidates the context', async () => {
    const { runtime, window, context } = await loadQueue({ saveSuccess: false });
    await runtime.ready;
    const item = runtime.enqueue(prompt('hello'), 10);
    const send = new window.MaxExtensionQueueSendContext(item, new AbortController().signal, runtime, runtime.snapshot.generation);
    const editor = { value: '', isConnected: true };
    await assert.rejects(send.insert(editor, () => { editor.value = 'hello'; }), /could not be saved/);
    context.location.href = 'https://chatgpt.com/c/another';
    assert.throws(() => send.assertActive(), /conversation changed/);
});
