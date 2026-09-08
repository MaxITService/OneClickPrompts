import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';
import assert from 'node:assert/strict';
import { createClock, source } from './helpers.mjs';

export function page(t, html = '') {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error));
    const dom = new JSDOM(html, { url: 'https://chatgpt.com/c/first', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
    const observers = [];
    dom.window.MutationObserver = class extends dom.window.MutationObserver {
        constructor(callback) { super(callback); observers.push(this); }
    };
    t.after(() => {
        observers.forEach(observer => observer.disconnect());
        dom.window.close();
        assert.deepEqual(errors, [], 'The page must not report uncaught DOM errors');
    });
    const w = dom.window;
    const clock = createClock();
    Object.assign(w, {
        Date: clock.Date, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
        setInterval: clock.setInterval, clearInterval: clock.clearInterval,
        requestAnimationFrame: cb => clock.setTimeout(() => cb(clock.Date.now()), 16),
        cancelAnimationFrame: clock.clearTimeout,
        structuredClone, logConCgp() {}
    });
    return { w, clock,
        evaluate: code => vm.runInContext(code, dom.getInternalVMContext(), { timeout: 1000 }),
        load: async path => vm.runInContext(await source(path), dom.getInternalVMContext(), { filename: path })
    };
}
