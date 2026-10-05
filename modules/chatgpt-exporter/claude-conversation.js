// Claude.ai adapter for the shared Markdown exporter. Requests use only the current site's
// session; no tokens, cookies or conversation data are stored by the extension.
(() => {
    'use strict';

    const ns = (window.OCPChatGptExporter ??= {});
    if (ns.claude) return;

    const textBlock = (text, attachments = [], references = []) => ({
        kind: 'text', text, attachments, references, quote: ''
    });

    /** Older Claude chats embed artifact XML in otherwise ordinary Markdown. */
    function parseText(text) {
        const blocks = [];
        let offset = 0;
        for (const match of text.matchAll(/<antArtifact\b([^>]*)>([\s\S]*?)<\/antArtifact>/g)) {
            if (match.index > offset) blocks.push(textBlock(text.slice(offset, match.index)));
            const attribute = (name) => match[1].match(new RegExp(`${name}=["']([^"']*)["']`))?.[1] ?? '';
            const type = attribute('type');
            blocks.push({
                kind: 'canvas', label: 'Artifact', title: attribute('title') || 'Artifact', content: match[2],
                docType: type === 'text/html' ? 'code/html' : type === 'application/vnd.ant.code' ? `code/${attribute('language')}` : type === 'application/vnd.ant.react' ? 'code/react' : type === 'image/svg+xml' ? 'code/svg' : 'document'
            });
            offset = match.index + match[0].length;
        }
        if (offset < text.length) blocks.push(textBlock(text.slice(offset)));
        return blocks;
    }

    /** Follow the selected leaf's parents, rather than exporting alternative regenerated replies. */
    function branchMessages(data) {
        const messages = data.chat_messages;
        if (!Array.isArray(messages)) throw new Error('Claude conversation has no message list.');
        const byId = new Map(messages.map((message) => [message.uuid, message]));
        const leaf = data.current_leaf_message_uuid;
        if (!leaf) return messages;
        if (!byId.has(leaf)) throw new Error('Claude conversation leaf is missing.');
        const branch = [];
        const seen = new Set();
        let id = leaf;
        while (byId.has(id)) {
            if (seen.has(id)) throw new Error('Claude conversation branch contains a cycle.');
            seen.add(id);
            const message = byId.get(id);
            branch.push(message);
            id = message.parent_message_uuid;
            if (id && !byId.has(id) && id !== '00000000-0000-4000-8000-000000000000') {
                throw new Error('Claude conversation branch is incomplete.');
            }
        }
        return branch.reverse();
    }

    function parseConversation(data) {
        const turns = [];
        for (const message of branchMessages(data)) {
            if (!['human', 'assistant'].includes(message.sender)) continue;
            const blocks = [];
            const sources = new Map();
            let hasText = false;
            for (const part of message.content ?? []) {
                if (part.type === 'text' && typeof part.text === 'string' && part.text) {
                    blocks.push(...parseText(part.text));
                    hasText = true;
                    for (const citation of part.citations ?? []) {
                        const url = citation.url ?? citation.source?.url;
                        if (typeof url === 'string' && /^https?:\/\//.test(url)) {
                            sources.set(url, { url, title: citation.title ?? citation.source?.title ?? url });
                        }
                    }
                } else if (part.type === 'thinking') {
                    // Hidden thinking is unavailable; Claude supplies visible summaries instead.
                    const content = part.thinking || (part.summaries ?? []).map((item) => item.summary).filter(Boolean).join('\n\n');
                    if (content) blocks.push({ kind: 'thinking', steps: [{ type: 'thought', content, summary: '' }] });
                }
            }
            if (!hasText && typeof message.text === 'string' && message.text) blocks.push(...parseText(message.text));
            const attachments = [...new Set([...(message.attachments ?? []), ...(message.files ?? [])]
                .map((file) => file.file_name ?? file.filename ?? file.name).filter(Boolean))];
            if (attachments.length) blocks.push(textBlock('', attachments));
            if (sources.size) blocks.push(textBlock('', [], [{ type: 'sources_footnote', sources: [...sources.values()] }]));
            if (!blocks.length) continue;
            turns.push({
                id: message.uuid, index: turns.length,
                role: message.sender === 'human' ? 'user' : 'assistant', assistantName: 'Claude',
                createTime: message.created_at ?? null, blocks
            });
        }
        return {
            id: data.uuid, title: data.name || 'Claude conversation', model: data.model || '',
            createTime: data.created_at ?? null, updateTime: data.updated_at ?? null, turns
        };
    }

    function organizationId() {
        // lastActiveOrg is a non-secret workspace selector used by Claude's own UI.
        const cookie = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/)?.[1];
        if (cookie) {
            const id = decodeURIComponent(cookie);
            if (/^[\da-f-]{36}$/i.test(id)) return id;
        }
        for (const entry of performance.getEntriesByType('resource').toReversed()) {
            const url = new URL(entry.name, location.origin);
            const id = url.pathname.match(/^\/api\/organizations\/([\da-f-]{36})(?:\/|$)/i)?.[1];
            if (url.origin === location.origin && id) return id;
        }
        throw new Error('Claude workspace is unavailable.');
    }

    async function loadConversation(id, requestJson) {
        const org = organizationId();
        const path = `/api/organizations/${encodeURIComponent(org)}/chat_conversations/${encodeURIComponent(id)}?tree=True&rendering_mode=messages&render_all_tools=true`;
        return parseConversation(await requestJson(path));
    }

    /** Explicitly lossy recovery when the private API changes or is unavailable. */
    function readConversationFromPage() {
        const turns = [...document.querySelectorAll('[data-testid="user-message"], [data-testid="assistant-message"]')]
            .map((element, position) => {
                const user = element.dataset.testid === 'user-message';
                const content = user ? element : element.querySelector('[data-cds="Prose"], .standard-markdown, .prose');
                return {
                    id: `page-${position}`, role: user ? 'user' : 'assistant', assistantName: 'Claude',
                    createTime: null, blocks: [textBlock((content?.innerText || '').trim())]
                };
            })
            .filter((turn) => turn.blocks[0].text)
            .map((turn, index) => ({ ...turn, index }));
        const title = document.title.replace(/\s*[-|–]\s*Claude\s*$/i, '').trim() || 'Claude conversation';
        return { id: '', title, model: '', createTime: null, updateTime: null, turns };
    }

    ns.claude = Object.freeze({ loadConversation, parseConversation, readConversationFromPage });
})();
