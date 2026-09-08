import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { source } from './helpers.mjs';

test('the manifest content scripts exist and parse together in their declared order', async () => {
    const manifest = JSON.parse(await source('manifest.json'));
    for (const entry of manifest.content_scripts) {
        const paths = entry.js.map(path => path.replace(/^\//, ''));
        const scripts = await Promise.all(paths.map(source));
        new vm.Script(scripts.join('\n;\n'));
        assert.ok(paths.indexOf('modules/token-approximator/backend-scheduler.js') < paths.indexOf('modules/backend-tokenApproximator.js'));
    }
});
