// modules/chatgpt-exporter/conversation-parser.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
//
// ChatGPT Exporter — step 1 of 3: conversation JSON -> turns (pure data, no Markdown, no UI).
//
// Source of truth is ChatGPT's own backend payload (`/backend-api/conversation/<id>`), not the DOM:
// the payload already carries the raw Markdown the model wrote (tables, code fences, LaTeX), plus
// the hidden structure the page only renders visually (reasoning, Canvas documents, Deep research
// reports, citations). Scraping the DOM would lose most of that and is virtualized on long chats.
//
// The payload stores a conversation as a TREE: `mapping[nodeId] = { message, parent, children }`.
// Editing a prompt or regenerating an answer forks the tree, and the page shows exactly one branch.
// We export that branch (root -> leaf); the leaf is resolved from the messages currently rendered
// so "what you see is what you export", with `current_node` as the fallback.
//
// Output (all plain, serializable data):
//   Conversation = { id, title, model, createTime, updateTime, turns: Turn[] }
//   Turn         = { id, index, role: 'user' | 'assistant', createTime: ms|null, blocks: Block[] }
//   Block        = one of
//     { kind: 'text',     text, references[], attachments[], quote }   prompt / answer Markdown
//     { kind: 'image',    title }                                       uploaded or generated image
//     { kind: 'thinking', steps: Step[], recap }                        reasoning ("Thought for 12s")
//         Step = { type: 'thought', summary, content } | { type: 'search', title, results[{title,url}] }
//     { kind: 'canvas',   textdocId, title, docType, content }          Canvas document version
//     { kind: 'code',     language, code }                              code-interpreter input
//     { kind: 'output',   text, hasImage }                              code-interpreter output
//     { kind: 'research', markdown, references[], status, note }        Deep research report
//
// Public API: window.OCPChatGptExporter.parser = { parseConversation, applyFinalTextdocs }

(() => {
    'use strict';

    const ns = (window.OCPChatGptExporter ??= {});
    if (ns.parser) return;

    const CANVAS_CREATE = 'canmore.create_textdoc';
    const CANVAS_UPDATE = 'canmore.update_textdoc';
    const CODE_INTERPRETER = 'python';
    const DEEP_RESEARCH_CONNECTOR = 'connector_openai_deep_research';
    const LEGACY_DEEP_RESEARCH_TASK_PREFIX = 'deepresch_';
    // Context blobs (memory, custom instructions) that ChatGPT injects but never displays.
    const HIDDEN_CONTENT_TYPES = new Set(['model_editable_context', 'user_editable_context']);

    const parseJson = (text) => {
        try { return JSON.parse(text); } catch { return null; }
    };

    const toMillis = (seconds) => (Number.isFinite(seconds) ? Math.round(seconds * 1000) : null);

    const stringParts = (content) => (Array.isArray(content?.parts) ? content.parts : [])
        .filter((part) => typeof part === 'string');

    const attachmentNames = (message) => (message.metadata?.attachments ?? [])
        .map((attachment) => attachment?.name)
        .filter(Boolean);

    /** Raw text of a message whose payload is a single string (text part or code body). */
    function singleTextPayload(message) {
        const { content } = message;
        if (content?.content_type === 'code' && typeof content.text === 'string') return content.text;
        const parts = stringParts(content);
        return parts.length === 1 ? parts[0] : null;
    }

    // ---------------------------------------------------------------------------------------
    // Branch resolution
    // ---------------------------------------------------------------------------------------

    function descendToLeaf(mapping, nodeId) {
        let current = nodeId;
        // Follow the newest child: this matches ChatGPT's default for branches the user never toggled.
        while (mapping[current]?.children?.length) {
            current = mapping[current].children.at(-1);
        }
        return current;
    }

    function ancestorsOf(mapping, nodeId) {
        const ids = [];
        for (let current = nodeId; current && mapping[current]; current = mapping[current].parent) {
            ids.push(current);
        }
        return ids.reverse();
    }

    /**
     * Picks the leaf of the branch the user is looking at.
     * `current_node` is right in the common case; if the page renders a message that is not on
     * that branch (the user switched "< 2/3 >" variants), we follow the last rendered message.
     */
    function resolveLeafId(mapping, currentNode, renderedIds) {
        const rendered = renderedIds.filter((id) => mapping[id]);
        if (currentNode && mapping[currentNode]) {
            const onCurrentBranch = new Set(ancestorsOf(mapping, currentNode));
            if (rendered.every((id) => onCurrentBranch.has(id))) return currentNode;
        }
        if (rendered.length) return descendToLeaf(mapping, rendered.at(-1));
        return currentNode && mapping[currentNode] ? currentNode : null;
    }

    function readRenderedMessageIds(doc) {
        if (!doc?.querySelectorAll) return [];
        return [...doc.querySelectorAll('[data-message-id]')]
            .map((element) => element.getAttribute('data-message-id'))
            .filter(Boolean);
    }

    // ---------------------------------------------------------------------------------------
    // Canvas
    // ---------------------------------------------------------------------------------------

    /**
     * Replays a `canmore.update_textdoc` call. Each update is a regex `pattern` (usually `.*` for
     * a full rewrite) plus a literal `replacement`. Patterns come from the model and are not
     * guaranteed to be valid JS regexes, so a failing update is skipped rather than aborting —
     * the final version is re-synced from the textdocs endpoint anyway (see applyFinalTextdocs).
     */
    function applyCanvasUpdates(content, updates) {
        return updates.reduce((doc, update) => {
            if (typeof update?.pattern !== 'string') return doc;
            try {
                const regex = new RegExp(update.pattern, update.multiple ? 'gs' : 's');
                const replacement = String(update.replacement ?? '');
                return doc.replace(regex, () => replacement);
            } catch {
                return doc;
            }
        }, content);
    }

    // ---------------------------------------------------------------------------------------
    // Turn assembly
    // ---------------------------------------------------------------------------------------

    function isDisplayedMessage(message) {
        if (!message) return false;
        if (message.author?.role === 'system') return false;
        if (message.metadata?.is_visually_hidden_from_conversation === true) return false;
        return !HIDDEN_CONTENT_TYPES.has(message.content?.content_type);
    }

    /** Accumulates blocks for one turn; reasoning fragments are merged into a single block. */
    class TurnBuilder {
        constructor(id, index, role, createTime) {
            this.turn = { id, index, role, createTime, blocks: [] };
        }

        push(block) {
            this.turn.blocks.push(block);
        }

        thinking() {
            const last = this.turn.blocks.at(-1);
            if (last?.kind === 'thinking') return last;
            const block = { kind: 'thinking', steps: [], recap: '' };
            this.push(block);
            return block;
        }

        /** The most recent search step, if reasoning is still collecting its results. */
        pendingSearchStep() {
            const last = this.turn.blocks.at(-1);
            const step = last?.kind === 'thinking' ? last.steps.at(-1) : null;
            return step?.type === 'search' ? step : null;
        }

        /** Deep research reports stream several widget states; keep the most complete one. */
        setResearch(block) {
            const existing = this.turn.blocks.find((candidate) => candidate.kind === 'research');
            if (!existing) {
                this.push(block);
            } else if (block.markdown || !existing.markdown) {
                Object.assign(existing, block);
            }
        }
    }

    function parseDeepResearchWidget(message) {
        const sdk = message.metadata?.chatgpt_sdk;
        if (sdk?.attribution_id !== DEEP_RESEARCH_CONNECTOR) return null;

        const note = sdk.tool_response_metadata?.venus_widget_state?.steering_acknowledgement ?? '';
        const state = typeof sdk.widget_state === 'string' ? parseJson(sdk.widget_state) : null;
        const report = state?.report_message;
        const markdown = typeof report?.content?.parts?.[0] === 'string' ? report.content.parts[0] : '';
        const status = state?.status ?? sdk.tool_response_metadata?.venus_widget_state?.status ?? 'unknown';

        return {
            kind: 'research',
            markdown: status === 'completed' ? markdown : '',
            references: report?.metadata?.content_references ?? [],
            status,
            note
        };
    }

    /**
     * Translates one backend message into blocks on `builder`.
     * `next` is the following node's message: Canvas tool responses carry the textdoc id there.
     */
    function appendMessage(builder, message, next, canvasDocs) {
        const role = message.author?.role;
        const content = message.content ?? {};
        const type = content.content_type;
        const recipient = message.recipient ?? 'all';
        const metadata = message.metadata ?? {};

        // Canvas titles/types are announced in metadata of several message kinds; remember them.
        if (metadata.canvas?.textdoc_id && metadata.canvas.title) {
            const doc = canvasDocs.get(metadata.canvas.textdoc_id) ?? { content: '' };
            canvasDocs.set(metadata.canvas.textdoc_id, {
                ...doc,
                title: metadata.canvas.title,
                docType: metadata.canvas.textdoc_type ?? doc.docType ?? 'document'
            });
        }

        const research = parseDeepResearchWidget(message);
        if (research) {
            builder.setResearch(research);
            return;
        }

        if (role === 'assistant' && recipient === CANVAS_CREATE) {
            const payload = parseJson(singleTextPayload(message) ?? '');
            if (typeof payload?.content !== 'string') return;
            const textdocId = next?.metadata?.canvas?.textdoc_id ?? null;
            const doc = { title: payload.name || 'Canvas', docType: payload.type || 'document', content: payload.content };
            if (textdocId) canvasDocs.set(textdocId, doc);
            builder.push({ kind: 'canvas', textdocId, ...doc });
            return;
        }

        if (role === 'assistant' && recipient === CANVAS_UPDATE) {
            const payload = parseJson(singleTextPayload(message) ?? '');
            const response = next?.metadata?.canvas;
            if (!Array.isArray(payload?.updates) || response?.is_failure) return;
            const textdocId = response?.textdoc_id ?? null;
            const previous = (textdocId && canvasDocs.get(textdocId)) || { title: 'Canvas', docType: 'document', content: '' };
            const doc = {
                title: previous.title || 'Canvas',
                docType: response?.textdoc_type ?? previous.docType ?? 'document',
                content: applyCanvasUpdates(previous.content ?? '', payload.updates)
            };
            if (textdocId) canvasDocs.set(textdocId, doc);
            builder.push({ kind: 'canvas', textdocId, ...doc });
            return;
        }

        if (role === 'assistant' && type === 'thoughts') {
            const thinking = builder.thinking();
            for (const thought of content.thoughts ?? []) {
                thinking.steps.push({ type: 'thought', summary: thought?.summary ?? '', content: thought?.content ?? '' });
            }
            return;
        }

        if (role === 'assistant' && type === 'reasoning_recap') {
            builder.thinking().recap = typeof content.content === 'string' ? content.content : '';
            return;
        }

        if (role === 'assistant' && type === 'code' && metadata.reasoning_status === 'is_reasoning') {
            const title = metadata.reasoning_title || metadata.search_queries?.map((query) => query?.q).filter(Boolean).join(', ') || '';
            if (title) builder.thinking().steps.push({ type: 'search', title, results: [] });
            return;
        }

        if (role === 'tool' && Array.isArray(metadata.search_result_groups)) {
            const step = builder.pendingSearchStep();
            if (step) {
                for (const group of metadata.search_result_groups) {
                    const entry = group?.entries?.[0];
                    if (entry?.url) step.results.push({ title: entry.title || group.domain || entry.url, url: entry.url });
                }
            }
            return;
        }

        if (role === 'assistant' && recipient === CODE_INTERPRETER && type === 'code') {
            if (content.text?.trim()) builder.push({ kind: 'code', language: content.language || 'python', code: content.text });
            return;
        }

        if (role === 'tool' && type === 'execution_output') {
            const hasImage = (metadata.aggregate_result?.messages ?? []).some((item) => item?.message_type === 'image');
            if (content.text?.trim() || hasImage) builder.push({ kind: 'output', text: content.text ?? '', hasImage });
            return;
        }

        if (type === 'multimodal_text') {
            const imageTitle = metadata.image_gen_title || '';
            const isToolImage = role === 'tool';
            let hasText = false;
            for (const part of content.parts ?? []) {
                if (typeof part === 'string') {
                    if (part.trim() && !isToolImage) {
                        builder.push({ kind: 'text', text: part, references: [], attachments: [], quote: '' });
                        hasText = true;
                    }
                } else if (part?.content_type === 'image_asset_pointer') {
                    // Uploaded images are also listed as attachments; avoid naming them twice.
                    if (isToolImage || !attachmentNames(message).length) builder.push({ kind: 'image', title: imageTitle });
                } else if (part?.content_type === 'audio_transcription' && part.text?.trim()) {
                    builder.push({ kind: 'text', text: part.text, references: [], attachments: [], quote: '' });
                    hasText = true;
                }
            }
            const attachments = attachmentNames(message);
            if (attachments.length) {
                const lastText = hasText ? builder.turn.blocks.findLast((block) => block.kind === 'text') : null;
                if (lastText) lastText.attachments = attachments;
                else builder.push({ kind: 'text', text: '', references: [], attachments, quote: '' });
            }
            return;
        }

        // Everything below is a plain Markdown message, visible only when addressed to the user.
        if (type !== 'text' || (role === 'assistant' && recipient !== 'all') || role === 'tool') return;

        const text = stringParts(content).join('\n');
        const attachments = attachmentNames(message);
        if (!text.trim() && !attachments.length) return;

        if (metadata.async_task_id?.startsWith(LEGACY_DEEP_RESEARCH_TASK_PREFIX)) {
            builder.setResearch({ kind: 'research', markdown: text, references: metadata.content_references ?? [], status: 'completed', note: '' });
            return;
        }

        builder.push({
            kind: 'text',
            text,
            references: metadata.content_references ?? [],
            attachments,
            quote: typeof metadata.targeted_reply === 'string' ? metadata.targeted_reply.trim() : ''
        });
    }

    /**
     * @param {object} data - Payload of GET /backend-api/conversation/<id>.
     * @param {{ renderedIds?: string[], doc?: Document }} [options]
     * @returns {{ id: string, title: string, model: string, createTime: number|null, updateTime: number|null, turns: object[] }}
     */
    function parseConversation(data, { renderedIds, doc = globalThis.document } = {}) {
        const mapping = data?.mapping;
        if (!mapping || typeof mapping !== 'object') {
            throw new Error('Conversation payload has no message mapping.');
        }

        const leafId = resolveLeafId(mapping, data.current_node, renderedIds ?? readRenderedMessageIds(doc));
        const path = leafId ? ancestorsOf(mapping, leafId) : [];
        const canvasDocs = new Map();
        const turns = [];
        let builder = null;

        path.forEach((nodeId, position) => {
            const message = mapping[nodeId]?.message;
            if (!isDisplayedMessage(message)) return;

            const role = message.author?.role === 'user' ? 'user' : 'assistant';
            // Every prompt opens a turn; everything the assistant side does until then (tools,
            // reasoning, Canvas, the answer itself) belongs to one assistant turn.
            if (!builder || role === 'user' || builder.turn.role !== role) {
                builder = new TurnBuilder(nodeId, turns.length, role, toMillis(message.create_time));
                turns.push(builder.turn);
            }
            const next = mapping[path[position + 1]]?.message ?? null;
            appendMessage(builder, message, next, canvasDocs);
        });

        const visibleTurns = turns
            .filter((turn) => turn.blocks.length > 0)
            .map((turn, index) => ({ ...turn, index }));

        return {
            id: data.conversation_id ?? data.id ?? '',
            title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'ChatGPT conversation',
            model: data.default_model_slug ?? '',
            createTime: toMillis(data.create_time),
            updateTime: toMillis(data.update_time),
            turns: visibleTurns
        };
    }

    /**
     * Canvas history replay is best-effort, so the LAST version of every document is replaced
     * with the authoritative text from GET /backend-api/conversation/<id>/textdocs.
     * Mutates and returns `conversation`.
     */
    function applyFinalTextdocs(conversation, textdocs) {
        if (!Array.isArray(textdocs) || !textdocs.length) return conversation;
        const finalById = new Map(textdocs.filter((doc) => doc?.id && typeof doc.content === 'string').map((doc) => [doc.id, doc]));
        const lastBlockById = new Map();
        for (const turn of conversation.turns) {
            for (const block of turn.blocks) {
                if (block.kind === 'canvas' && block.textdocId) lastBlockById.set(block.textdocId, block);
            }
        }
        for (const [id, block] of lastBlockById) {
            const final = finalById.get(id);
            if (!final) continue;
            block.content = final.content;
            if (final.title) block.title = final.title;
            if (final.textdoc_type) block.docType = final.textdoc_type;
        }
        return conversation;
    }

    ns.parser = Object.freeze({ parseConversation, applyFinalTextdocs });
})();
