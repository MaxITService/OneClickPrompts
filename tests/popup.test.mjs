import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { source } from './helpers.mjs';

async function popup(t, buttons = []) {
    const dom = new JSDOM(await source('popup.html'), {
        url: 'https://extension.test/popup.html', runScripts: 'outside-only'
    });
    t.after(() => dom.window.close());
    const w = dom.window;
    const writes = [];
    Object.assign(w, {
        currentProfile: { PROFILE_NAME: 'Test', customButtons: buttons },
        buttonCardsList: w.document.getElementById('buttonCardsList'),
        profileSelect: w.document.getElementById('profileSelect'),
        structuredClone,
        scrollTo() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
        logToGUIConsole() {}, showToast() {},
        chrome: { runtime: { async sendMessage() { return { settings: { enabled: false } }; } } },
        async saveCurrentProfile(profile = w.currentProfile) { writes.push(structuredClone(profile)); return true; },
        debouncedSaveCurrentProfile() { writes.push(structuredClone(w.currentProfile)); },
        async withProfileTransition(action) { return action(); }
    });
    w.HTMLElement.prototype.scrollIntoView = () => {};
    const loadScript = async path => vm.runInContext(await source(path), dom.getInternalVMContext(), { filename: path });
    await loadScript('popup-page-scripts/popup-page-customButtons.js');
    await w.updatebuttonCardsList();
    return { w, writes, document: w.document, loadScript };
}

test('prompt and icon HTML stay literal, including closing textarea tags and entities', async t => {
    const text = '\n</textarea><img id="injected" src=x> &amp; "quoted"';
    const icon = '</textarea><b id="icon-injected">RU</b>';
    const { document } = await popup(t, [{ text, icon }]);
    assert.equal(document.querySelector('#buttonCardsList textarea.text-input').value, text);
    assert.equal(document.querySelector('#buttonCardsList textarea.emoji-input').value, icon);
    assert.equal(document.getElementById('injected'), null);
    assert.equal(document.getElementById('icon-injected'), null);
});

test('search matches Cyrillic and icons without changing stored order or shortcut indices', async t => {
    const buttons = [{ text: 'Объясни очередь', icon: 'RU' }, { separator: true }, { text: 'Calculate', icon: '🛠️' }];
    const { w, document } = await popup(t, buttons);
    const original = structuredClone(buttons);
    document.getElementById('buttonSearch').value = 'ОБЪЯСНИ';
    w.applyButtonSearch();
    const cards = [...document.querySelectorAll('.button-item')];
    assert.deepEqual(cards.map(card => card.hidden), [false, true, true]);
    assert.equal(cards[0].draggable, false);
    document.getElementById('buttonSearch').value = '🛠';
    w.applyButtonSearch();
    assert.deepEqual(cards.map(card => card.hidden), [true, true, false]);
    assert.equal(cards[2].dataset.index, '2');
    document.getElementById('buttonSearch').value = '';
    w.applyButtonSearch();
    assert.ok(cards.every(card => !card.hidden && card.draggable));
    assert.deepEqual(w.currentProfile.customButtons, original);
});

test('editing a visible stale card after a neighbour is removed updates the correct button once', async t => {
    const first = { text: 'first', icon: '1' };
    const second = { text: 'second', icon: '2' };
    const { w, document, writes } = await popup(t, [first, second]);
    const textareas = document.querySelectorAll('#buttonCardsList textarea.text-input');
    w.textareaSaverAndResizerFunc(false); // Rebinding must not multiply saves.
    w.currentProfile.customButtons.splice(0, 1);
    textareas[1].value = 'changed';
    textareas[1].dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.equal(second.text, 'changed');
    assert.equal(writes.length, 1);
    textareas[0].value = 'deleted card event';
    textareas[0].dispatchEvent(new w.Event('input'));
    assert.equal(second.text, 'changed');
    assert.equal(writes.length, 1);
});

test('duplicate inserts an independent copy next to the source and drops its custom hotkey', async t => {
    const first = { text: 'original', icon: 'A', autoSend: false, hotkey: { combo: 'alt+keyq' } };
    const { w, document, writes } = await popup(t, [first, { text: 'next', icon: 'B' }]);
    await w.duplicateButtonCard(document.querySelector('.button-item'));
    assert.deepEqual(Array.from(w.currentProfile.customButtons, button => button.text), ['original', 'original', 'next']);
    const duplicate = w.currentProfile.customButtons[1];
    assert.equal(duplicate.hotkey, undefined);
    assert.equal(duplicate.autoSend, false);
    duplicate.text = 'independent';
    assert.equal(first.text, 'original');
    assert.equal(first.hotkey.combo, 'alt+keyq');
    assert.equal(writes.length, 1);
});

test('a rejected duplicate save restores the original list', async t => {
    const original = { text: 'keep', icon: 'A' };
    const { w, document } = await popup(t, [original]);
    w.saveCurrentProfile = async () => false;
    await w.duplicateButtonCard(document.querySelector('.button-item'));
    assert.equal(w.currentProfile.customButtons.length, 1);
    assert.equal(w.currentProfile.customButtons[0], original);
});

test('an older asynchronous card render cannot replace a more recent profile', async t => {
    const { w, document } = await popup(t, [{ text: 'old', icon: 'A' }]);
    let finishOld;
    w.chrome.runtime.sendMessage = () => new Promise(resolve => { finishOld = resolve; });
    const oldRender = w.updatebuttonCardsList();
    w.currentProfile = { PROFILE_NAME: 'New', customButtons: [{ text: 'new profile', icon: 'B' }] };
    w.chrome.runtime.sendMessage = async () => ({ settings: { enabled: false } });
    await w.updatebuttonCardsList();
    finishOld({ settings: { enabled: false } });
    await oldRender;
    assert.equal(document.querySelector('#buttonCardsList textarea.text-input').value, 'new profile');
});

test('backup parser accepts a UTF-8 BOM and filenames preserve Cyrillic safely', async t => {
    const { w, loadScript } = await popup(t);
    await loadScript('popup-page-scripts/popup-page-backup-handler.js');
    assert.equal(w.parseBackupText('\uFEFF {"backupVersion":3} ').backupVersion, 3);
    assert.throws(() => w.parseBackupText('not JSON'));
    assert.match(w.buildBackupFilename({ currentProfile: 'Мой профиль / <test>', exportScope: 'currentProfile' }), /мой-профиль-test/);
});

test('successful import followed by a refresh failure reports that data was already imported', async t => {
    const { w, document, loadScript } = await popup(t);
    await loadScript('popup-page-scripts/popup-page-backup-handler.js');
    w.console.error = () => {};
    w.sendRuntimeMessage = async message => message.type === 'listProfiles'
        ? { profiles: [] }
        : { success: true, result: { currentProfile: 'Imported', importedProfiles: ['Imported'] } };
    w.loadProfiles = async () => false;
    const target = { files: [{ name: 'backup.json', async text() { return '{"profiles":{"Imported":{}}}'; } }], value: 'backup.json' };
    await w.handleImportProfile({ target });
    assert.match(document.querySelector('#errorDiv p').textContent, /backup was imported, but settings could not refresh/i);
    assert.equal(document.getElementById('importProfile').disabled, false);
    assert.equal(target.value, '');
});
