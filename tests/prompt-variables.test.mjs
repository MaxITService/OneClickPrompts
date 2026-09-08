import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { source, createStorage } from './helpers.mjs';

async function setup(settings) {
    const local = createStorage({ ocpPromptVariablesSettings: settings });
    const context = vm.createContext({ window: {}, chrome: { storage: { local } }, logConCgp() {} });
    vm.runInContext(await source('buttons.js'), context);
    return { local, variables: context.window.MaxExtensionPromptVariables, context };
}

test('variables substitute case-insensitively and reserved object names remain ordinary text', async () => {
    const { variables } = await setup({ enabled: true, customVariables: [
        { name: '__proto__', value: 'prototype text' }, { name: 'constructor', value: 'constructor text' },
        { name: 'Company', value: '$& {{date}}' }
    ] });
    const result = await variables.resolvePromptText('{{var:__proto__}} / {%{constructor}%} / {{var:company}}');
    assert.equal(result, 'prototype text / constructor text / $& {{date}}');
});

test('failed variable reads stop prompt preparation instead of sending unresolved placeholders', async () => {
    const { variables, local } = await setup({ enabled: true });
    local.get = async () => { throw new Error('storage unavailable'); };
    await assert.rejects(variables.resolvePromptText('Hello {{var:name}}'), /Unable to load prompt variables/);
    assert.equal(await variables.resolvePromptText('ordinary prompt'), 'ordinary prompt');
});

test('null variable settings are handled as disabled without throwing', async () => {
    const { variables } = await setup(null);
    assert.equal(await variables.resolvePromptText('{{today}}'), '{{today}}');
});

test('failed example initialization leaves the caller snapshot untouched', async () => {
    const { variables, context } = await setup({ enabled: true });
    context.chrome.runtime = { async sendMessage() { return { success: false, error: 'storage failed' }; } };
    const config = { PROFILE_NAME: 'Work', customButtons: [] };
    assert.equal(await variables.ensureFirstRunDateExampleButton(config), config);
    assert.deepEqual(config.customButtons, []);
    assert.equal(variables.shineState, null);
});
