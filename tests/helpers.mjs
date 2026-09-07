import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
export const copy = value => structuredClone(value);
export const settle = async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve();
};

// Time advances only when a test requests it; no real timers or multi-day waits.
export function createClock() {
    let now = 1_800_000_000_000;
    let nextId = 0;
    const pending = new Map();
    const delays = [];
    return {
        Date: class extends Date { static now() { return now; } },
        pending,
        delays,
        setTimeout(callback, delay = 0) {
            delays.push(delay);
            const id = ++nextId;
            pending.set(id, { callback, at: now + delay });
            return id;
        },
        clearTimeout(id) { pending.delete(id); },
        async advance(duration) {
            const target = now + duration;
            let count = 0;
            while (true) {
                const next = [...pending].filter(([, timer]) => timer.at <= target)
                    .sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                if (++count > 1000) throw new Error('Timer loop exceeded the test safety limit');
                now = next[1].at;
                pending.delete(next[0]);
                next[1].callback();
                await settle();
            }
            now = target;
            await settle();
        }
    };
}

export async function loadQueue({ snapshot = null, claim, saveSuccess = true } = {}) {
    const clock = createClock();
    const owner = { QUEUE_MAX_SIZE: 10 };
    const messages = [];
    const window = {
        MaxExtensionFloatingPanel: owner,
        globalMaxExtensionConfig: { enableQueueMode: true },
        addEventListener() {}
    };
    const context = vm.createContext({
        window, Date: clock.Date, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
        queueMicrotask, DOMException, AbortController,
        location: { href: 'https://chatgpt.com/c/test', origin: 'https://chatgpt.com' },
        sessionStorage: { getItem() { return null; }, setItem() {} },
        logConCgp() {},
        chrome: { runtime: { async sendMessage(message) {
            messages.push(copy(message));
            if (message.type === 'queuePersistenceClaim') {
                return claim ? await claim : { success: true, instanceId: 'test-instance-123456', snapshot };
            }
            return { success: saveSuccess };
        } } }
    });
    vm.runInContext(await source('floating-panel-queue-runtime.js'), context);
    return { runtime: owner.queueRuntime, owner, window, context, clock, messages };
}

// Clone on both read and write, like Chrome storage, to catch accidental aliasing.
export function createStorage(initial = {}) {
    const data = copy(initial);
    const calls = [];
    return {
        data, calls,
        async getKeys() { calls.push(['getKeys']); return Object.keys(data); },
        async get(keys) {
            calls.push(['get', copy(keys)]);
            if (keys == null) return copy(data);
            const list = typeof keys === 'string' ? [keys] : keys;
            return copy(Object.fromEntries(list.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])));
        },
        async set(values) { calls.push(['set', copy(values)]); Object.assign(data, copy(values)); },
        async remove(keys) {
            calls.push(['remove', copy(keys)]);
            for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key];
        }
    };
}
