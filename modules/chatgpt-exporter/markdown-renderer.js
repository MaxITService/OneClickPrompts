// modules/chatgpt-exporter/markdown-renderer.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
//
// ChatGPT Exporter — step 2 of 3: turns (from conversation-parser.js) -> Markdown text.
// Pure string functions, no DOM access, so every rule here is deterministic and unit-testable.
//
// What "preserving advanced outputs" means in practice:
//   • Math: ChatGPT writes LaTeX as \( … \) and \[ … \]; most Markdown tools (Obsidian, Typora,
//     GitHub, Pandoc) expect $ … $ and $$ … $$, so delimiters are converted — never inside code.
//     Math "widgets" that ChatGPT stores as private-use markers are unpacked to $$ blocks.
//   • Code: fences are emitted with a fence longer than any backtick run inside the code, so code
//     that itself contains ``` can never break out of its block.
//   • Tables / lists / headings: already Markdown in the payload; passed through untouched.
//   • Citations: ChatGPT embeds private-use markers (U+E200…U+E201) that the page swaps for
//     source chips. We swap them for Markdown links (or drop them when sources are disabled).
//     Deep research reports get numbered footnotes plus a reference list instead.
//   • Thinking / tool steps: rendered as a blockquote so they stay visually secondary.
//   • Canvas: every version is kept, code canvases as fenced code in the canvas language.
//
// Public API: window.OCPChatGptExporter.markdown =
//   { renderDocument, renderHeader, renderSection, assembleDocument, renderTurnBody,
//     previewOf, formatLocalDateTime }
// renderDocument(...) === assembleDocument(renderHeader(...), turns.map(renderSection)) — the
// picker relies on this to measure a selection from cached sections without re-rendering.

(() => {
    'use strict';

    const ns = (window.OCPChatGptExporter ??= {});
    if (ns.markdown) return;

    const CITATION_MARKER = /[^]*/g;
    const PRIVATE_USE_CHARS = /[-]/g;
    const LEGACY_CITATION = /【\d+(?::\d+)?†[^】]*】/g;
    const GENUI_WIDGET = /genui(\{[^\n]*?\})\n?/g;
    const WRITING_BLOCK = /:::writing\{([^}]*)\}([\s\S]*?):::/g;
    const FILE_PLACEHOLDER = /\{\{file:[^}]+\}\}/g;
    // Split points that must never be rewritten: fenced blocks and inline code spans.
    const CODE_SEGMENT = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g;
    const WEB_REFERENCE_TYPES = new Set(['webpage', 'webpage_extended', 'grouped_webpages']);
    const CANVAS_LANGUAGE_ALIASES = { react: 'jsx', html: 'html', python: 'python' };
    const RESEARCH_STATUS_LABELS = {
        user_stopped: 'Research stopped',
        rate_limited: 'Rate limit reached',
        researching: 'Research in progress',
        unknown: 'Research state unavailable'
    };

    // ---------------------------------------------------------------------------------------
    // Small Markdown primitives
    // ---------------------------------------------------------------------------------------

    const pad2 = (value) => String(value).padStart(2, '0');

    /** `2026-09-25 14:03` in the user's local time zone. */
    function formatLocalDateTime(value) {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    }

    /** Applies `transform` to prose only; code fences and inline code are returned verbatim. */
    function mapOutsideCode(text, transform) {
        return text
            .split(CODE_SEGMENT)
            .map((segment, index) => (index % 2 === 1 ? segment : transform(segment)))
            .join('');
    }

    function fenced(code, language = '') {
        const longestRun = Math.max(0, ...Array.from(code.matchAll(/`{3,}/g), (match) => match[0].length));
        const fence = '`'.repeat(Math.max(3, longestRun + 1));
        return `${fence}${language}\n${code.replace(/\n+$/, '')}\n${fence}`;
    }

    function blockquote(markdown) {
        return markdown.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
    }

    function link(label, url) {
        const text = String(label || url).replace(/\s+/g, ' ').replace(/([[\]])/g, '\\$1').trim();
        const target = /[\s()<>]/.test(url) ? `<${url}>` : url;
        return `[${text}](${target})`;
    }

    function hostOf(url) {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
    }

    // ---------------------------------------------------------------------------------------
    // Text transforms
    // ---------------------------------------------------------------------------------------

    function unpackMathWidgets(text) {
        return text.replace(GENUI_WIDGET, (marker, json) => {
            try {
                const latex = JSON.parse(json)?.math_block_widget_always_prefetch_v2?.content;
                return typeof latex === 'string' ? `$$\n${latex.trim()}\n$$\n` : '';
            } catch {
                return '';
            }
        });
    }

    function convertMathDelimiters(text) {
        return mapOutsideCode(text, (prose) => prose
            .replace(/\\\[([\s\S]*?)\\\]/g, (match, latex) => `$$${latex}$$`)
            // Inline math must hug its delimiters ("$x$", not "$ x $") for most renderers.
            .replace(/\\\(([\s\S]*?)\\\)/g, (match, latex) => `$${latex.trim()}$`));
    }

    /** `:::writing{variant="email" subject="Hi"} body :::` -> bold label + body. */
    function convertWritingBlocks(text) {
        return text.replace(WRITING_BLOCK, (match, attributes, body) => {
            const attribute = (name) => attributes.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
            const variant = attribute('variant');
            const subject = attribute('subject');
            const label = [variant && variant[0].toUpperCase() + variant.slice(1), subject].filter(Boolean).join(': ');
            return label ? `**${label}**\n\n${body.trim()}` : body.trim();
        });
    }

    function stripLeftoverMarkers(text) {
        return text
            .replace(CITATION_MARKER, '')
            .replace(LEGACY_CITATION, '')
            .replace(PRIVATE_USE_CHARS, '')
            .replace(FILE_PLACEHOLDER, '');
    }

    /** Inline replacement for one `content_references` entry, or '' to drop the marker. */
    function inlineCitation(reference, includeSources) {
        if (WEB_REFERENCE_TYPES.has(reference.type)) {
            if (!includeSources) return '';
            const item = reference.items?.[0] ?? reference;
            if (item.url) return `(${link(item.attribution || item.title || hostOf(item.url), item.url)})`;
            return reference.alt ?? '';
        }
        if (reference.type === 'file') {
            const name = reference.name || reference.alt;
            return name ? `\`${name}\`` : '';
        }
        if (reference.type === 'image_group') {
            const urls = reference.safe_urls ?? [];
            return urls.length ? `\n\n${urls.map((url) => `![image](${url})`).join('\n\n')}\n\n` : '';
        }
        // Entities, products, navigation lists…: ChatGPT supplies display text as `alt`/`name`.
        return reference.alt ?? reference.name ?? '';
    }

    /** Replaces citation markers; the longest marker goes first so no marker is a prefix of another. */
    function replaceReferences(text, references, replacementFor) {
        const candidates = (references ?? [])
            .filter((reference) => typeof reference?.matched_text === 'string' && reference.matched_text && reference.type !== 'sources_footnote')
            .sort((a, b) => b.matched_text.length - a.matched_text.length);

        return candidates.reduce((output, reference) => output.replaceAll(reference.matched_text, (match, offset, whole) => {
            const replacement = replacementFor(reference);
            // Keep a single space between the cited word and a "(Source)" link.
            const needsSpace = replacement.startsWith('(') && offset > 0 && !/\s/.test(whole[offset - 1]);
            return needsSpace ? ` ${replacement}` : replacement;
        }), text);
    }

    function renderRichText(text, references, options) {
        let output = unpackMathWidgets(text);
        output = replaceReferences(output, references, (reference) => inlineCitation(reference, options.includeSources));
        output = stripLeftoverMarkers(output);
        output = convertWritingBlocks(output);
        return convertMathDelimiters(output).trim();
    }

    /** Deep research: numbered footnotes (unique per report via `prefix`) plus a reference list. */
    function renderResearchMarkdown(markdown, references, options, prefix) {
        const footnotes = new Map();
        let output = unpackMathWidgets(markdown);
        output = replaceReferences(output, references, (reference) => {
            if (!WEB_REFERENCE_TYPES.has(reference.type)) return inlineCitation(reference, options.includeSources);
            const url = reference.url ?? reference.items?.[0]?.url;
            if (!options.includeSources || !url) return '';
            if (!footnotes.has(url)) {
                footnotes.set(url, {
                    label: `${prefix}${footnotes.size + 1}`,
                    title: reference.title ?? reference.items?.[0]?.title ?? hostOf(url)
                });
            }
            return `[^${footnotes.get(url).label}]`;
        });
        output = convertMathDelimiters(convertWritingBlocks(stripLeftoverMarkers(output))).trim();
        if (!footnotes.size) return output;

        const list = Array.from(footnotes, ([url, { label, title }]) => `[^${label}]: ${link(title, url)}`).join('\n');
        return `${output}\n\n#### References\n\n${list}`;
    }

    /** User prompts are plain text on the page: keep their single line breaks as hard breaks. */
    function renderPromptText(text) {
        return mapOutsideCode(text, (prose) => prose.replace(/([^\n])\n(?=[^\n])/g, '$1  \n')).trim();
    }

    // ---------------------------------------------------------------------------------------
    // Blocks and turns
    // ---------------------------------------------------------------------------------------

    function renderThinking(block) {
        const chunks = [`**${block.recap || 'Thinking'}**`];
        for (const step of block.steps) {
            if (step.type === 'thought') {
                const summary = step.summary ? `*${step.summary.trim()}*` : '';
                chunks.push([summary, step.content.trim()].filter(Boolean).join('\n\n'));
            } else if (step.type === 'search') {
                const results = step.results.map((result) => `- ${link(result.title, result.url)}`).join('\n');
                chunks.push([`*Searched: ${step.title}*`, results].filter(Boolean).join('\n\n'));
            }
        }
        return blockquote(chunks.filter(Boolean).join('\n\n'));
    }

    function renderCanvas(block, options) {
        const heading = `### Canvas: ${block.title || 'Untitled'}`;
        if (block.docType?.startsWith('code/')) {
            const language = block.docType.slice('code/'.length);
            return `${heading}\n\n${fenced(block.content, CANVAS_LANGUAGE_ALIASES[language] ?? language)}`;
        }
        return `${heading}\n\n${renderRichText(block.content, [], options)}`;
    }

    function renderResearch(block, options, turn) {
        if (!block.markdown) return `*${RESEARCH_STATUS_LABELS[block.status] ?? `Deep research: ${block.status}`}*`;
        const note = block.note ? `*${block.note.trim()}*\n\n` : '';
        return note + renderResearchMarkdown(block.markdown, block.references, options, `r${turn.index + 1}-`);
    }

    function renderTextBlock(block, options, turn) {
        const parts = [];
        if (block.quote) parts.push(blockquote(block.quote));
        if (block.text.trim()) {
            parts.push(turn.role === 'user' ? renderPromptText(block.text) : renderRichText(block.text, block.references, options));
        }
        if (block.attachments?.length) {
            parts.push(`*Attached: ${block.attachments.map((name) => `\`${name}\``).join(', ')}*`);
        }
        return parts.join('\n\n');
    }

    function renderBlock(block, options, turn) {
        switch (block.kind) {
            case 'text': return renderTextBlock(block, options, turn);
            case 'image': return `*[Image${block.title ? `: ${block.title}` : ''}]*`;
            case 'thinking': return options.includeThinking ? renderThinking(block) : '';
            case 'canvas': return renderCanvas(block, options);
            case 'research': return renderResearch(block, options, turn);
            case 'code': return options.includeThinking ? `**Code**\n\n${fenced(block.code, block.language)}` : '';
            case 'output': {
                if (!options.includeThinking) return '';
                const text = block.text.trim() ? `\n\n${fenced(block.text)}` : '';
                return `**Output**${text}${block.hasImage ? '\n\n*[Chart / image output]*' : ''}`;
            }
            default: return '';
        }
    }

    /** "Sources" footer that ChatGPT shows under web-search answers (deduplicated by URL). */
    function renderSourcesFooter(turn) {
        const seen = new Map();
        for (const block of turn.blocks) {
            if (block.kind !== 'text') continue;
            for (const reference of block.references ?? []) {
                if (reference?.type !== 'sources_footnote') continue;
                for (const source of reference.sources ?? []) {
                    if (source?.url && !seen.has(source.url)) seen.set(source.url, source.title || source.attribution || hostOf(source.url));
                }
            }
        }
        if (!seen.size) return '';
        return `**Sources**\n\n${Array.from(seen, ([url, title]) => `- ${link(title, url)}`).join('\n')}`;
    }

    /**
     * @param {object} turn - Parsed turn.
     * @param {{ includeThinking: boolean, includeSources: boolean }} options
     */
    function renderTurnBody(turn, options) {
        const parts = turn.blocks.map((block) => renderBlock(block, options, turn));
        if (options.includeSources) parts.push(renderSourcesFooter(turn));
        return parts.map((part) => part.trim()).filter(Boolean).join('\n\n');
    }

    /** Collapses runs of blank lines left by removed markers, but never inside code. */
    function collapseBlankLines(markdown) {
        return mapOutsideCode(markdown, (prose) => prose.replace(/\n{3,}/g, '\n\n'));
    }

    const roleHeading = (turn) => `## ${turn.role === 'user' ? 'User' : 'ChatGPT'}`;

    /** One `## Heading` + body section, or '' when the turn renders to nothing. */
    function renderSection(turn, options, heading = roleHeading(turn)) {
        const body = renderTurnBody(turn, options);
        return body ? collapseBlankLines(`${heading}\n\n${body}`) : '';
    }

    /**
     * YAML front matter (read by Obsidian, Jekyll, Hugo, Pandoc…) plus the `# Title` line.
     * @param {{ mode: string, sourceUrl?: string, exportedAt?: Date }} options
     */
    function renderHeader(conversation, options) {
        const frontMatter = [
            '---',
            `title: ${JSON.stringify(conversation.title)}`, // JSON strings are valid YAML scalars.
            options.sourceUrl && `source: ${options.sourceUrl}`,
            conversation.model && `model: ${conversation.model}`,
            conversation.createTime && `created: ${formatLocalDateTime(conversation.createTime)}`,
            `exported: ${formatLocalDateTime(options.exportedAt ?? new Date())}`,
            `scope: ${options.mode}`,
            '---'
        ].filter(Boolean).join('\n');
        return `${frontMatter}\n\n# ${conversation.title}`;
    }

    /** Joins a header and pre-rendered sections exactly the way renderDocument does. */
    function assembleDocument(header, sections) {
        return `${header}\n\n${sections.join('\n\n')}\n`;
    }

    /**
     * Full Markdown document.
     * @param {object} conversation - Result of parser.parseConversation.
     * @param {object[]} turns - The turns to include, in order.
     * @param {{ mode: 'full'|'answers'|'selection', includeThinking: boolean, includeSources: boolean,
     *           sourceUrl?: string, exportedAt?: Date }} options
     */
    function renderDocument(conversation, turns, options) {
        const sections = [];
        for (const turn of turns) {
            // "answers" mode only contains assistant turns, so the count is the answer number.
            const heading = options.mode === 'answers' ? `## Answer ${sections.length + 1}` : roleHeading(turn);
            const section = renderSection(turn, options, heading);
            if (section) sections.push(section);
        }
        return assembleDocument(renderHeader(conversation, options), sections);
    }

    // ---------------------------------------------------------------------------------------
    // Previews for the message picker
    // ---------------------------------------------------------------------------------------

    function toPlainText(markdown) {
        return stripLeftoverMarkers(markdown.replace(GENUI_WIDGET, ' [math] '))
            .replace(/^\s*(```|~~~)[^\n]*$/gm, ' ')
            .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
            .replace(/\\[()[\]]/g, '')
            .replace(/[*_~`|]+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function blockPlainText(block) {
        switch (block.kind) {
            case 'text': return [block.quote, block.text, block.attachments?.length ? `[${block.attachments.join(', ')}]` : ''].filter(Boolean).join(' ');
            case 'research': return block.markdown || RESEARCH_STATUS_LABELS[block.status] || '';
            case 'canvas': return `Canvas: ${block.title} ${block.content}`;
            case 'image': return `[Image${block.title ? `: ${block.title}` : ''}]`;
            case 'code': return block.code;
            default: return '';
        }
    }

    /**
     * Compact description of a turn for the picker.
     * @returns {{ text: string, searchText: string, badges: string[] }}
     */
    function previewOf(turn, maxLength = 320) {
        const PRIMARY = new Set(['text', 'research', 'canvas', 'image']);
        const primary = turn.blocks.filter((block) => PRIMARY.has(block.kind));
        const source = (primary.length ? primary : turn.blocks).map(blockPlainText).join(' ');
        const plain = toPlainText(source);
        const badges = [...new Set(turn.blocks.map((block) => block.kind).filter((kind) => kind !== 'text'))];
        if (turn.blocks.some((block) => block.attachments?.length)) badges.push('attachment');
        return {
            text: plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain || '(empty)',
            searchText: plain.toLowerCase(),
            badges
        };
    }

    ns.markdown = Object.freeze({
        renderDocument,
        renderHeader,
        renderSection,
        assembleDocument,
        renderTurnBody,
        previewOf,
        formatLocalDateTime
    });
})();
