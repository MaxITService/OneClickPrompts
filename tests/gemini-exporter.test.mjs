import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { source } from './helpers.mjs';

const message = (id, prompt, answer, seconds = 1_790_000_000) => {
    const candidate = [`rc_${id}`, [answer]];
    const response = [[candidate], null, null, candidate[0]];
    response[31] = 'gemini-test';
    return [[`c_test`, `r_${id}`], null, [[prompt]], response, [seconds, 0]];
};
const frame = (messages, cursor = null) => `)]}'\n\n123\n${JSON.stringify([
    ['wrb.fr', 'other', '{}'], ['wrb.fr', 'hNvQHb', JSON.stringify([messages, cursor, null, []])]
])}\n`;

async function adapter(fetch = () => { throw new Error('Unexpected network request'); }) {
    const location = { pathname: '/app/abc123', origin: 'https://gemini.google.com' };
    const context = vm.createContext({
        window: {}, location, fetch, URL, URLSearchParams, AbortSignal,
        document: {
            title: 'Saved chat - Google Gemini', documentElement: { lang: 'en' },
            scripts: [{ textContent: 'window.WIZ_global_data = {"SNlM0e":"test-csrf","cfb2h":"test-build","FdrFJe":"test-session"};' }]
        }
    });
    vm.runInContext(await source('modules/chatgpt-exporter/gemini-conversation.js'), context);
    vm.runInContext(await source('modules/chatgpt-exporter/markdown-renderer.js'), context);
    return { api: context.window.OCPChatGptExporter.gemini, markdown: context.window.OCPChatGptExporter.markdown, context, location };
}

test('Gemini exports the selected reply, original Markdown, summaries and sources in chronological order', async () => {
    const first = message('first', 'Explain', '### Answer\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n\\(x^2\\)\n\n```js\nconst x = 1;\n```');
    const active = first[3][0][0];
    first[3][0].unshift(['rc_old', ['Discarded regenerated reply']]);
    active[37] = [['Visible thinking summary']];
    active[2] = [null, [[['cited text'], [1], [['https://example.com/reference', 'Reference title']]]]];
    const { api, markdown } = await adapter();
    const result = api.parseConversation([message('last', 'Next', 'Final', 1_790_000_010), first], { id: 'abc123', title: 'Title' });
    assert.deepEqual(result.turns.map(turn => turn.role).join(','), 'user,assistant,user,assistant');
    assert.equal(result.turns[1].id, 'r_first-assistant');
    assert.equal(result.model, 'gemini-test');
    assert.equal(result.createTime, '2026-09-21T14:13:20.000Z');
    const rendered = markdown.renderDocument(result, result.turns, { mode: 'full', includeThinking: true, includeSources: true });
    assert.match(rendered, /## Gemini/);
    assert.match(rendered, /\| A \| B \|/);
    assert.ok(rendered.includes('$x^2$'));
    assert.ok(rendered.includes('```js\nconst x = 1;\n```'));
    assert.match(rendered, /Visible thinking summary/);
    assert.match(rendered, /\[Reference title\]\(https:\/\/example.com\/reference\)/);
    assert.doesNotMatch(rendered, /Discarded regenerated/);
    const withoutExtras = markdown.renderDocument(result, result.turns, { mode: 'full', includeThinking: false, includeSources: false });
    assert.doesNotMatch(withoutExtras, /Visible thinking summary|Reference title/);
});

test('Gemini RPC parser rejects absent or incompatible history frames', async () => {
    const { api } = await adapter();
    assert.equal(api.parseRpcResponse(frame([message('one', 'Q', 'A')], 'next')).cursor, 'next');
    assert.throws(() => api.parseRpcResponse(")]}'\n[]"), /did not return/);
    assert.throws(() => api.parseRpcResponse(frame(null)), /unfamiliar structure/);
});

test('Gemini keeps attachment names and replaces internal generated-image placeholders with image markers', async () => {
    const row = message('image', '', '\n\nhttp://googleusercontent.com/image_generation_content/test\n\n');
    row[2][0][4] = [[null, null, null, null, [
        [null, 1, 'reference.jpg', 'https://example.com/private-thumbnail'],
        [null, 1, 'notes.pdf', 'https://example.com/private-document']
    ]]];
    row[3][0][0][12] = [];
    row[3][0][0][12][7] = [[[null, ['http://googleusercontent.com/image_generation_content/test']]], null, [true]];
    const { api, markdown } = await adapter();
    const conversation = api.parseConversation([row], { title: 'Image chat' });
    assert.equal(conversation.turns.length, 2);
    const rendered = markdown.renderDocument(conversation, conversation.turns, { mode: 'full' });
    assert.match(rendered, /Attached: `reference.jpg`, `notes.pdf`/);
    assert.match(rendered, /\[Image: Generated image\]/);
    assert.doesNotMatch(rendered, /image_generation_content|private-thumbnail|private-document/);
});

test('Gemini loads all pages, deduplicates overlapping entries and keeps requests on the current origin', async () => {
    const requests = [];
    const newest = message('new', 'Latest question', 'Latest answer', 1_790_000_010);
    const oldest = message('old', 'First question', 'First answer');
    const { api } = await adapter(async (url, options) => {
        const payload = JSON.parse(JSON.parse(options.body.get('f.req'))[0][0][1]);
        requests.push({ url, options, payload });
        return { ok: true, text: async () => requests.length === 1 ? frame([newest], 'older') : frame([newest, oldest]) };
    });
    const conversation = await api.loadConversation('abc123');
    assert.equal(requests.length, 2);
    assert.equal(conversation.turns.length, 4);
    assert.equal(conversation.turns[0].blocks[0].text, 'First question');
    assert.equal(conversation.title, 'Saved chat');
    for (const request of requests) {
        assert.equal(request.url.origin, 'https://gemini.google.com');
        assert.equal(request.url.pathname, '/_/BardChatUi/data/batchexecute');
        assert.equal(request.options.credentials, 'include');
        assert.equal(request.options.method, 'POST');
        assert.equal(request.options.body.get('at'), 'test-csrf');
        assert.equal(request.payload[0], 'c_abc123');
    }
    assert.equal(requests[0].payload[2], null);
    assert.equal(requests[1].payload[2], 'older');
});

test('Gemini refuses stalled pagination instead of reporting a truncated history as complete', async () => {
    let calls = 0;
    const { api } = await adapter(async () => {
        calls++;
        return { ok: true, text: async () => frame([message('one', 'Q', 'A')], 'same-cursor') };
    });
    await assert.rejects(api.loadConversation('abc123'), /pagination did not advance/);
    assert.equal(calls, 2);
});

test('Gemini detects navigation during export and missing session metadata', async () => {
    const harness = await adapter(async () => {
        harness.location.pathname = '/app/def456';
        return { ok: true, text: async () => frame([message('one', 'Q', 'A')]) };
    });
    await assert.rejects(harness.api.loadConversation('abc123'), /changed during export/);
    harness.context.document.scripts = [];
    await assert.rejects(harness.api.loadConversation('def456'), /metadata is unavailable/);
    await assert.rejects(harness.api.loadConversation('invalid/route'), /ID is invalid/);
});
