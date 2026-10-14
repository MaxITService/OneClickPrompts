// Gemini adapter for the shared Markdown exporter. The read-only history RPC uses the
// current page's session. Bootstrap values and chat contents stay in memory only.
(() => {
    'use strict';

    const ns = (window.OCPChatGptExporter ??= {});
    if (ns.gemini) return;

    const RPC_ID = 'hNvQHb';
    const PAGE_SIZE = 10;
    const MAX_PAGES = 100;
    const textBlock = (text, attachments = [], references = []) => ({
        kind: 'text', text, attachments, references, quote: ''
    });
    const strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string').join('\n\n') : '';
    const timestamp = (value) => Number.isFinite(value?.[0]) ? new Date(value[0] * 1000).toISOString() : null;

    function conversationTitle() {
        return document.title.replace(/\s*[-|–]\s*(?:Google\s+)?Gemini\s*$/i, '').trim() || 'Gemini conversation';
    }

    /** The page embeds this JSON for its own requests; read it without executing page scripts. */
    function bootstrap() {
        for (const script of document.scripts) {
            const match = script.textContent.match(/^\s*window\.WIZ_global_data\s*=\s*(\{[\s\S]*\});?\s*$/);
            if (!match) continue;
            const data = JSON.parse(match[1]);
            if (typeof data.SNlM0e === 'string' && data.SNlM0e) return data;
        }
        throw new Error('Gemini session metadata is unavailable.');
    }

    /** Batchexecute is XSSI-prefixed, with a byte count before each JSON frame. */
    function parseRpcResponse(raw) {
        for (const line of raw.split('\n')) {
            if (!line.trimStart().startsWith('[')) continue;
            for (const row of JSON.parse(line)) {
                if (row?.[0] !== 'wrb.fr' || row[1] !== RPC_ID || typeof row[2] !== 'string') continue;
                const data = JSON.parse(row[2]);
                if (!Array.isArray(data?.[0]) || (data[1] != null && typeof data[1] !== 'string')) {
                    throw new Error('Gemini history response has an unfamiliar structure.');
                }
                return { messages: data[0], cursor: data[1] || null };
            }
        }
        throw new Error('Gemini did not return conversation history.');
    }

    async function historyPage(id, cursor, session, signal) {
        const url = new URL('/_/BardChatUi/data/batchexecute', location.origin);
        url.search = new URLSearchParams({
            rpcids: RPC_ID,
            'source-path': location.pathname,
            bl: session.cfb2h || '',
            'f.sid': session.FdrFJe || '',
            hl: document.documentElement.lang || 'en',
            _reqid: String(Math.floor(Math.random() * 1_000_000)),
            rt: 'c'
        });
        const args = [`c_${id}`, PAGE_SIZE, cursor, 1, [0], [4], null, 1];
        const body = new URLSearchParams({
            'f.req': JSON.stringify([[[RPC_ID, JSON.stringify(args), null, 'generic']]]),
            at: session.SNlM0e
        });
        const response = await fetch(url, { method: 'POST', credentials: 'include', body, signal });
        if (!response.ok) throw new Error(`Gemini history request failed (HTTP ${response.status}).`);
        return parseRpcResponse(await response.text());
    }

    function sourcesOf(candidate) {
        const sources = new Map();
        const citations = candidate[2]?.[1];
        for (const citation of Array.isArray(citations) ? citations : []) {
            for (const source of Array.isArray(citation?.[2]) ? citation[2] : []) {
                if (!Array.isArray(source)) continue;
                const [url, title] = source;
                if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
                    sources.set(url, { url, title: typeof title === 'string' && title ? title : url });
                }
            }
        }
        return [...sources.values()];
    }

    function attachmentsOf(prompt) {
        const groups = Array.isArray(prompt[4]) ? prompt[4] : [];
        return [...new Set(groups.flatMap((group) => Array.isArray(group?.[4]) ? group[4] : [])
            .map((file) => file?.[2]).filter((name) => typeof name === 'string' && name))];
    }

    /** Generated-image URLs in the answer are internal placeholders, not downloadable files. */
    function imagesOf(candidate) {
        const images = candidate[12]?.[7]?.[0];
        if (!Array.isArray(images)) return [];
        return images.map((image) => ({
            kind: 'image', title: 'Generated image',
            placeholder: typeof image?.[1]?.[0] === 'string'
                && /^https?:\/\/googleusercontent\.com\/image_generation_content\//.test(image[1][0]) ? image[1][0] : ''
        }));
    }

    /** History arrives newest first. Each entry contains a prompt and the selected reply. */
    function parseConversation(messages, { id = '', title = conversationTitle() } = {}) {
        const turns = [];
        let model = '';
        for (const message of messages.toReversed()) {
            const messageId = message?.[0]?.[1];
            const prompt = message?.[2]?.[0];
            const response = message?.[3];
            if (typeof messageId !== 'string' || !Array.isArray(prompt) || !Array.isArray(response?.[0])) {
                throw new Error('Gemini history contains an unfamiliar message.');
            }
            const candidates = response[0];
            const selected = candidates.find((item) => item?.[0] === response[3])
                ?? (candidates.length === 1 ? candidates[0] : null);
            if (!selected) throw new Error('Gemini selected reply is unavailable.');
            const createTime = timestamp(message[4]);
            const addTurn = (role, blocks) => {
                if (!blocks.length) return;
                turns.push({ id: `${messageId}-${role}`, index: turns.length, role, assistantName: 'Gemini', createTime, blocks });
            };
            const promptText = typeof prompt[0] === 'string' ? prompt[0] : '';
            const attachments = attachmentsOf(prompt);
            const userBlocks = promptText || attachments.length ? [textBlock(promptText, attachments)] : [];
            addTurn('user', userBlocks);

            const blocks = [];
            // This is the summary supplied to Gemini's UI, never hidden model reasoning.
            const thinking = strings(selected[37]?.[0]);
            if (thinking) blocks.push({ kind: 'thinking', steps: [{ type: 'thought', content: thinking, summary: '' }] });
            const images = imagesOf(selected);
            const answer = images.reduce((text, image) => image.placeholder ? text.replaceAll(image.placeholder, '') : text, strings(selected[1])).trim();
            if (answer) blocks.push(textBlock(answer));
            blocks.push(...images.map(({ kind, title }) => ({ kind, title })));
            const sources = sourcesOf(selected);
            if (sources.length) blocks.push(textBlock('', [], [{ type: 'sources_footnote', sources }]));
            if (!blocks.length) throw new Error('Gemini reply content is unavailable.');
            addTurn('assistant', blocks);
            model = typeof response[31] === 'string' ? response[31] : typeof response[21] === 'string' ? response[21] : model;
        }
        return { id, title, model, createTime: turns[0]?.createTime ?? null, updateTime: turns.at(-1)?.createTime ?? null, turns };
    }

    async function loadConversation(id) {
        if (!/^[\da-f]+$/i.test(id)) throw new Error('Gemini conversation ID is invalid.');
        const path = location.pathname;
        const title = conversationTitle();
        const session = bootstrap();
        const messages = new Map();
        const cursors = new Set();
        const signal = AbortSignal.timeout(60_000);
        let cursor = null;
        for (let page = 0; page < MAX_PAGES; page++) {
            const result = await historyPage(id, cursor, session, signal);
            if (location.pathname !== path) throw new Error('Gemini conversation changed during export.');
            for (const message of result.messages) {
                const key = message?.[0]?.[1];
                if (typeof key !== 'string') throw new Error('Gemini history message has no ID.');
                if (!messages.has(key)) messages.set(key, message);
            }
            if (!result.cursor) return parseConversation([...messages.values()], { id, title });
            if (!result.messages.length || cursors.has(result.cursor)) throw new Error('Gemini history pagination did not advance.');
            cursors.add(result.cursor);
            cursor = result.cursor;
        }
        throw new Error('Gemini history exceeds the export page limit.');
    }

    /** Explicitly lossy recovery: strip message controls and duplicated screen-reader labels. */
    function readConversationFromPage() {
        const turns = [];
        for (const element of document.querySelectorAll('user-query, model-response')) {
            const user = element.matches('user-query');
            const content = element.querySelector(user ? '.query-text' : 'message-content .markdown');
            if (!content) continue;
            const clone = content.cloneNode(true);
            clone.querySelectorAll('button, .cdk-visually-hidden, [aria-hidden="true"], sources-carousel-inline, source-footnote').forEach((node) => node.remove());
            clone.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
            clone.querySelectorAll('p, pre, li, h1, h2, h3, h4, h5, h6, tr, blockquote').forEach((node) => node.append('\n\n'));
            const text = (clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
            if (!text) continue;
            turns.push({
                id: `page-${turns.length}`, index: turns.length, role: user ? 'user' : 'assistant',
                assistantName: 'Gemini', createTime: null, blocks: [textBlock(text)]
            });
        }
        return { id: '', title: conversationTitle(), model: '', createTime: null, updateTime: null, turns };
    }

    ns.gemini = Object.freeze({ loadConversation, parseConversation, parseRpcResponse, readConversationFromPage });
})();
