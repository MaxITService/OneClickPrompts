// modules/chatgpt-exporter/message-picker.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
//
// ChatGPT Exporter — step 3 of 3 (only for "select messages"): a fullscreen picker dialog.
//
// Design goals:
//   • Fullscreen, with a centred readable column on wide monitors. A Minimize button shrinks it
//     into a small floating bar (bottom-right) so the chat can be scrolled and read; the bar
//     restores the picker with everything intact, or downloads / cancels directly.
//   • Less scrolling: every message is ONE short row — role, number and only its first lines
//     (CSS line clamp). A row can be expanded (chevron, or →/← keys) to read the full Markdown
//     that will be exported; its text is only built when first expanded. "Expand all" (becomes
//     "Collapse all" once every visible row is open) does the same for all filtered rows.
//   • Every fold / unfold, minimize and restore is animated (grid-rows 0fr↔1fr folds, no JS
//     measuring) and all motion is dropped under prefers-reduced-motion.
//   • Fast bulk selection: All / None / Prompts / Answers / Invert act on the rows currently
//     visible, so "filter, then All" selects exactly what matched.
//   • Familiar list mechanics: click toggles, Shift+click selects a range (Gmail-style: the range
//     takes the clicked row's new state), Space toggles, arrows move, Shift+arrows extend,
//     Ctrl/Cmd+A selects all visible, Enter downloads, Esc cancels.
//   • Live size of the selection: characters, KB and (when the Token Counter module is on) an
//     estimated token count, recomputed after every selection change via the `measure` callback.
//   • Looks like the extension's own settings popup: same purple accent, light-grey canvas,
//     white bordered cards, 4px-radius buttons, lavender section header, same font stack.
//   • Isolation: rendered in a Shadow DOM so ChatGPT's CSS cannot restyle it and ours cannot leak.
//     All message text is inserted with textContent (never innerHTML).
//   • Accessibility: role=dialog + aria-modal, listbox/option semantics with aria-selected and
//     aria-expanded, roving tabindex, focus trap, focus restored to the invoking element on close.
//
// Public API:
//   window.OCPChatGptExporter.picker.open({ title, items, getFullText, measure })
//       -> Promise<{ ids, action } | null>
//     items:       [{ id, role: 'user'|'assistant', number, text, searchText, badges: string[] }]
//     getFullText: (id) => string                     full Markdown of one message (lazy)
//     measure:     (ids) => { chars, bytes, tokens: number|null, tokenModel: string|null }
//     action:      'download' | 'copy'; null when the user cancels.

(() => {
    'use strict';

    const ns = (window.OCPChatGptExporter ??= {});
    if (ns.picker) return;

    const HOST_ID = 'ocp-chatgpt-exporter-picker';
    const ROLE_LABELS = { user: 'You', assistant: 'ChatGPT' };
    const BADGE_LABELS = {
        thinking: 'Thinking',
        canvas: 'Canvas',
        research: 'Deep research',
        code: 'Code',
        output: 'Code output',
        image: 'Image',
        attachment: 'Files'
    };
    const numberFormat = new Intl.NumberFormat();
    const kilobyteFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    // Palette and metrics mirror common-ui-elements/common-style.css + dark-theme.css and the
    // popup's button / input / collapsible styles (popup-page-styles/*).
    const STYLES = `
        :host {
            all: initial;
            position: fixed;
            inset: 0;
            z-index: 2147483646;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            color-scheme: light;
            --primary: #7a5cc8; --primary-hover: #6a4abd; --on-primary: #ffffff;
            --primary-faded: rgba(122, 92, 200, 0.08); --primary-ring: rgba(122, 92, 200, 0.18);
            --canvas: #f9f9f9; --card: #ffffff; --border: #cccccc; --line: #ececec;
            --text: #333333; --muted: #888888; --row-hover: #f5f3fb; --button-hover: #e6e6e6;
            --code-bg: #f8f8f8;
            --header-bg: linear-gradient(135deg, rgba(122, 92, 200, 0.08) 0%, rgba(122, 92, 200, 0.04) 50%, rgba(122, 92, 200, 0.06) 100%);
            --header-border: rgba(122, 92, 200, 0.15);
            --shadow: 0 16px 48px rgba(122, 92, 200, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08);
        }
        :host(.dark) {
            color-scheme: dark;
            --primary: #9a79d3; --primary-hover: #b195e0; --on-primary: #ffffff;
            --primary-faded: rgba(154, 121, 211, 0.14); --primary-ring: rgba(154, 121, 211, 0.3);
            --canvas: #222222; --card: #2a2a2a; --border: #444444; --line: #363636;
            --text: #eeeeee; --muted: #888888; --row-hover: #312d3a; --button-hover: #3a3a3a;
            --code-bg: #252525;
            --header-bg: linear-gradient(135deg, rgba(154, 121, 211, 0.16) 0%, rgba(154, 121, 211, 0.08) 50%, rgba(154, 121, 211, 0.12) 100%);
            --header-border: rgba(154, 121, 211, 0.25);
            --shadow: 0 16px 48px rgba(0, 0, 0, 0.55), 0 4px 16px rgba(0, 0, 0, 0.3);
        }
        :host {
            /* One motion curve for every fold, minimize and restore. */
            --ease: cubic-bezier(0.4, 0, 0.2, 1);
            --fold-time: 0.28s;
            --window-time: 0.24s;
            /* Fullscreen, but the working column stays readable on very wide monitors:
               backgrounds span the viewport while content is centred within this width. */
            --column: 1280px;
            --gutter: max(16px, (100% - var(--column)) / 2);
        }
        /* Minimized: the overlay stops catching the mouse so the chat underneath scrolls and
           clicks normally; only the small floating bar stays interactive. */
        :host(.minimized) { pointer-events: none; }
        *, *::before, *::after { box-sizing: border-box; }
        [hidden] { display: none !important; }

        .dialog {
            position: absolute; inset: 0;
            display: flex; flex-direction: column; overflow: hidden;
            background: var(--canvas); color: var(--text);
            transform-origin: calc(100% - 40px) calc(100% - 120px); /* shrinks toward the minimized bar */
            transition: opacity var(--window-time) var(--ease), scale var(--window-time) var(--ease), visibility 0s;
            animation: pop 0.2s var(--ease);
        }
        :host(.minimized) .dialog {
            opacity: 0; scale: 0.94; visibility: hidden;
            transition: opacity var(--window-time) var(--ease), scale var(--window-time) var(--ease), visibility 0s linear var(--window-time);
        }

        /* Header: same lavender strip as an expanded collapsible section in the popup. */
        .head { display: flex; align-items: center; gap: 12px; padding: 12px calc(var(--gutter) - 4px) 12px var(--gutter); background: var(--header-bg); border-bottom: 1px solid var(--header-border); }
        .head-actions { display: flex; gap: 4px; }
        .titles { flex: 1; min-width: 0; }
        h2 { margin: 0; font-size: 16px; font-weight: 600; color: var(--primary); }
        .subtitle { margin: 2px 0 0; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .content { display: flex; flex-direction: column; gap: 10px; padding: 12px var(--gutter); min-height: 0; flex: 1; }
        .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .hint { margin: 0; color: var(--muted); font-size: 12px; }

        button { font: inherit; }
        .btn {
            padding: 6px 12px; font-size: 13px; line-height: 1.4; cursor: pointer;
            border: 1px solid var(--border); border-radius: 4px; background: var(--card); color: var(--text);
            transition: background 0.3s ease, transform 0.2s ease, border-color 0.3s ease;
        }
        .btn:hover:not(:disabled) { background: var(--button-hover); }
        .btn:active:not(:disabled) { transform: scale(0.98); }
        .btn.primary { background: var(--primary); border-color: var(--primary); color: var(--on-primary); font-weight: 600; }
        .btn.primary:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); }
        .btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .icon-btn { width: 32px; height: 32px; padding: 0; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--muted); font-size: 15px; cursor: pointer; display: grid; place-items: center; transition: background 0.2s ease, color 0.2s ease; }
        .icon-btn:hover { background: var(--button-hover); color: var(--text); }
        .icon-btn.minimize::before { content: ""; width: 12px; height: 2px; border-radius: 1px; background: currentColor; translate: 0 4px; }

        .filter {
            flex: 1; min-width: 180px; padding: 7px 10px; font: inherit; font-size: 13px;
            color: var(--text); background: var(--card);
            border: 1px solid var(--border); border-radius: 4px; outline: none;
            transition: border-color 0.3s ease, box-shadow 0.3s ease;
        }
        .filter:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-ring); }

        /* The list is a white card, like a .section in the popup. */
        .list {
            list-style: none; margin: 0; padding: 0; flex: 1; min-height: 140px;
            overflow-y: auto; overscroll-behavior: contain;
            background: var(--card); border: 1px solid var(--border); border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }
        .row {
            display: grid; grid-template-columns: 18px 72px minmax(0, 1fr) 24px; align-items: start; gap: 10px;
            padding: 8px 10px 8px 12px; cursor: pointer; user-select: none; outline: none;
            border-bottom: 1px solid var(--line); transition: background 0.15s ease;
        }
        .row:last-child { border-bottom: 0; }
        .row:hover { background: var(--row-hover); }
        .row[aria-selected="true"] { background: var(--primary-faded); box-shadow: inset 3px 0 0 var(--primary); }
        .row:focus-visible { box-shadow: inset 0 0 0 2px var(--primary); }
        .row[aria-selected="true"]:focus-visible { box-shadow: inset 3px 0 0 var(--primary), inset 0 0 0 2px var(--primary); }

        .check { width: 18px; height: 18px; margin-top: 1px; border: 1.5px solid var(--border); border-radius: 4px; background: var(--card); display: grid; place-items: center; transition: background 0.15s ease, border-color 0.15s ease; }
        .row[aria-selected="true"] .check { background: var(--primary); border-color: var(--primary); }
        .row[aria-selected="true"] .check::after { content: ""; width: 5px; height: 9px; border: solid var(--on-primary); border-width: 0 2px 2px 0; rotate: 45deg; translate: 0 -1px; }

        .meta { display: flex; flex-direction: column; font-size: 12px; line-height: 1.35; padding-top: 1px; }
        .role { font-weight: 600; }
        .row[data-role="user"] .role { color: var(--primary); }
        .num { color: var(--muted); font-variant-numeric: tabular-nums; }

        .body { min-width: 0; }

        /* Folds: height animates through a 0fr <-> 1fr grid track, so content of any (unknown)
           height opens and closes smoothly without measuring it in JS. A closed fold is also
           visibility:hidden (after the motion ends) — out of the accessibility tree, find-in-page
           and text selection. The two-line preview folds shut while the full text folds open. */
        .fold {
            display: grid; grid-template-rows: 1fr; opacity: 1;
            transition: grid-template-rows var(--fold-time) var(--ease), opacity var(--fold-time) var(--ease), visibility 0s;
        }
        .fold > * { min-height: 0; overflow: hidden; }
        .row[aria-expanded="true"] .preview-fold,
        .row[aria-expanded="false"] .full-fold {
            grid-template-rows: 0fr; opacity: 0; visibility: hidden;
            transition: grid-template-rows var(--fold-time) var(--ease), opacity var(--fold-time) var(--ease), visibility 0s linear var(--fold-time);
        }
        .preview { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
        .badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
        .badges:empty { display: none; }
        .badge { font-size: 11px; line-height: 1.5; padding: 0 7px; border-radius: 999px; color: var(--primary); background: var(--primary-faded); }
        .full {
            margin: 6px 0 0; padding: 10px 12px; max-height: 60vh; overflow: auto;
            white-space: pre-wrap; overflow-wrap: anywhere;
            font: 12.5px/1.5 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
            background: var(--code-bg); border: 1px solid var(--line); border-radius: 6px;
            user-select: text; cursor: text;
        }

        /* Expand chevron: the popup's collapsible toggle icon, in miniature. Points DOWN while
           the message is folded ("unfold below") and turns to point UP once it is unfolded. */
        .expand { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; cursor: pointer; display: grid; place-items: center; background: var(--primary-faded); transition: background 0.2s ease, rotate var(--fold-time) var(--ease); }
        .expand::before { content: ""; width: 6px; height: 6px; border: solid var(--primary); border-width: 0 2px 2px 0; rotate: 45deg; translate: 0 -1px; }
        .expand:hover { background: var(--primary-ring); }
        .row[aria-expanded="true"] .expand { rotate: 180deg; }
        /* Set for one synchronous flip on rows outside the viewport during Expand/Collapse all. */
        .row.no-motion .fold, .row.no-motion .expand { transition: none !important; }
        /* Fixed width so the label swap (Expand all <-> Collapse all) doesn't shift the toolbar. */
        .expand-all { min-width: 104px; }

        .empty { margin: 0; padding: 24px; text-align: center; color: var(--muted); }

        .foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 10px var(--gutter) 14px; border-top: 1px solid var(--line); background: var(--card); }
        .summary { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 2px; font-variant-numeric: tabular-nums; }
        .count { font-size: 13px; font-weight: 600; }
        .stats { font-size: 12px; color: var(--muted); }
        .actions { display: flex; gap: 8px; }

        /* Minimized bar: floats above ChatGPT's composer, bottom-right. Clicking its main part
           restores the fullscreen picker exactly as it was (selection, filter, scroll, folds). */
        .mini {
            position: absolute; right: 20px; bottom: 112px; max-width: calc(100% - 40px);
            display: flex; align-items: center; gap: 6px; padding: 6px;
            background: var(--card); color: var(--text);
            border: 1px solid var(--header-border); border-radius: 10px; box-shadow: var(--shadow);
            opacity: 0; translate: 0 12px; scale: 0.96; visibility: hidden;
            transition: opacity var(--window-time) var(--ease), translate var(--window-time) var(--ease), scale var(--window-time) var(--ease), visibility 0s linear var(--window-time);
        }
        :host(.minimized) .mini {
            pointer-events: auto; opacity: 1; translate: 0 0; scale: 1; visibility: visible;
            transition: opacity var(--window-time) var(--ease), translate var(--window-time) var(--ease), scale var(--window-time) var(--ease), visibility 0s;
        }
        .mini-restore {
            display: flex; align-items: center; gap: 10px; min-width: 0; padding: 4px 10px 4px 6px;
            border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; text-align: start;
            transition: background 0.2s ease;
        }
        .mini-restore:hover { background: var(--row-hover); }
        .mini-icon { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--primary-faded); }
        .mini-icon::before { content: ""; width: 6px; height: 6px; border: solid var(--primary); border-width: 2px 2px 0 0; rotate: -45deg; translate: 0 1px; }
        .mini-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
        .mini-title { font-size: 13px; font-weight: 600; color: var(--primary); }
        .mini-count { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }

        button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

        @keyframes pop { from { opacity: 0; scale: 0.985; } }
        @media (prefers-reduced-motion: reduce) {
            .dialog { animation: none; }
            .dialog, .mini, .fold, .expand, .row, .btn, .icon-btn, .mini-restore { transition: none !important; }
        }
        @media (max-width: 560px) {
            .mini { right: 12px; bottom: 96px; max-width: calc(100% - 24px); }
            .mini .btn.primary { display: none; }
            .row { grid-template-columns: 18px minmax(0, 1fr) 24px; }
            .meta { flex-direction: row; gap: 6px; grid-column: 2; }
            .body { grid-column: 2; }
            .expand { grid-row: 1; grid-column: 3; }
            .hint { display: none; }
        }
    `;

    // Static markup only — every dynamic string is set later through textContent.
    const TEMPLATE = `
        <style>${STYLES}</style>
        <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="ocp-exp-title" aria-describedby="ocp-exp-hint">
            <header class="head">
                <div class="titles">
                    <h2 id="ocp-exp-title">Export selected messages</h2>
                    <p class="subtitle"></p>
                </div>
                <div class="head-actions">
                    <button type="button" class="icon-btn minimize" data-minimize aria-label="Minimize" title="Minimize to read and scroll the chat"></button>
                    <button type="button" class="icon-btn" data-close aria-label="Close" title="Close (Esc)">&#x2715;</button>
                </div>
            </header>
            <div class="content">
                <div class="toolbar">
                    <div class="chips" role="group" aria-label="Quick select">
                        <button type="button" class="btn" data-select="all" title="Select every visible message">All</button>
                        <button type="button" class="btn" data-select="none" title="Clear every visible message">None</button>
                        <button type="button" class="btn" data-select="user" title="Select only your prompts">Prompts</button>
                        <button type="button" class="btn" data-select="assistant" title="Select only ChatGPT answers">Answers</button>
                        <button type="button" class="btn" data-select="invert" title="Invert the visible selection">Invert</button>
                    </div>
                    <input type="search" class="filter" placeholder="Filter messages&#x2026;" aria-label="Filter messages" spellcheck="false">
                    <button type="button" class="btn expand-all" data-expand-all>Expand all</button>
                </div>
                <p id="ocp-exp-hint" class="hint">Click a row to select &#xB7; Shift+click selects a range &#xB7; chevron or &#x2192; / &#x2190; shows the whole message &#xB7; Enter downloads &#xB7; Esc cancels</p>
                <ol class="list" role="listbox" aria-multiselectable="true" aria-label="Messages"></ol>
                <p class="empty" hidden>No messages match the filter.</p>
            </div>
            <footer class="foot">
                <div class="summary" aria-live="polite">
                    <span class="count"></span>
                    <span class="stats"></span>
                </div>
                <div class="actions">
                    <button type="button" class="btn" data-action="copy" title="Copy the selected messages as Markdown">Copy Markdown</button>
                    <button type="button" class="btn primary" data-action="download" title="Download the selected messages as a .md file (Enter)">Download .md</button>
                </div>
            </footer>
        </section>
        <div class="mini" role="region" aria-label="Message picker (minimized)">
            <button type="button" class="mini-restore" data-restore title="Restore the message picker">
                <span class="mini-icon" aria-hidden="true"></span>
                <span class="mini-text">
                    <span class="mini-title">Export selected messages</span>
                    <span class="mini-count"></span>
                </span>
            </button>
            <button type="button" class="btn primary" data-action="download" title="Download the selected messages as a .md file">Download .md</button>
            <button type="button" class="icon-btn" data-close aria-label="Cancel export" title="Cancel export">&#x2715;</button>
        </div>
    `;

    function isDarkPage() {
        const root = document.documentElement;
        if (root.classList.contains('dark')) return true;
        if (root.classList.contains('light')) return false;
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function createRow(item) {
        const row = element('li', 'row');
        row.setAttribute('role', 'option');
        row.setAttribute('aria-expanded', 'false');
        row.tabIndex = -1;
        row.dataset.id = item.id;
        row.dataset.role = item.role;

        const check = element('span', 'check');
        check.setAttribute('aria-hidden', 'true');

        const meta = element('span', 'meta');
        meta.append(element('span', 'role', ROLE_LABELS[item.role] ?? item.role), element('span', 'num', `#${item.number}`));

        const body = element('div', 'body'); // div: it will also hold the block-level full-text fold
        const badges = element('span', 'badges');
        for (const badge of item.badges ?? []) badges.append(element('span', 'badge', BADGE_LABELS[badge] ?? badge));
        const previewFold = element('span', 'fold preview-fold');
        previewFold.append(element('span', 'preview', item.text));
        body.append(previewFold, badges);

        const expand = element('button', 'expand');
        expand.type = 'button';
        expand.tabIndex = -1; // Reached with →/← from the row; keeps Tab order short.
        expand.title = 'Show the whole message';
        expand.setAttribute('aria-label', 'Show the whole message');

        row.append(check, meta, body, expand);
        return row;
    }

    function formatStats({ chars, bytes, tokens, tokenModel }) {
        const parts = [
            `${numberFormat.format(chars)} characters`,
            `${kilobyteFormat.format(bytes / 1024)} KB`
        ];
        if (Number.isFinite(tokens)) {
            parts.push(`≈ ${numberFormat.format(tokens)} tokens${tokenModel ? ` (${tokenModel})` : ''}`);
        }
        return parts.join(' · ');
    }

    class PickerSession {
        #items;
        #getFullText;
        #measure;
        #rows = new Map();            // id -> <li>
        #selected = new Set();        // ids
        #anchorId = null;             // last row toggled without Shift (range start)
        #statsFrame = 0;
        #listeners = new AbortController();
        #previousFocus = document.activeElement;
        #resolve;
        #host;
        #root;
        #list;
        #filter;

        constructor({ title, items, getFullText, measure }) {
            this.#items = items;
            this.#getFullText = getFullText;
            this.#measure = measure;
            this.promise = new Promise((resolve) => { this.#resolve = resolve; });
            for (const item of items) this.#selected.add(item.id); // Start with everything selected.
            this.#mount(title);
        }

        focus() {
            if (this.#minimized) this.#setMinimized(false);
            else this.#focusRow(this.#currentRow() ?? this.#visibleRows()[0]);
        }

        // ----- minimize / restore ---------------------------------------------------------

        get #minimized() {
            return this.#host.classList.contains('minimized');
        }

        /**
         * Minimized = the fullscreen dialog fades/shrinks away (all state kept in the DOM) and a
         * small bar remains, while the host stops intercepting the mouse so the chat can be
         * scrolled and read. Restoring brings the dialog back exactly as it was.
         */
        #setMinimized(minimized) {
            if (this.#minimized === minimized) return;
            this.#host.classList.toggle('minimized', minimized);
            this.#root.querySelector('.dialog').setAttribute('aria-modal', String(!minimized));
            if (minimized) this.#root.querySelector('.mini-restore').focus({ preventScroll: true });
            else this.#focusRow(this.#currentRow() ?? this.#visibleRows()[0]);
        }

        // ----- lifecycle ------------------------------------------------------------------

        #mount(title) {
            this.#host = document.createElement('div');
            this.#host.id = HOST_ID;
            this.#host.classList.toggle('dark', isDarkPage());
            this.#root = this.#host.attachShadow({ mode: 'open' });
            this.#root.innerHTML = TEMPLATE;

            this.#root.querySelector('.subtitle').textContent = title;
            this.#list = this.#root.querySelector('.list');
            this.#filter = this.#root.querySelector('.filter');

            const fragment = document.createDocumentFragment();
            for (const item of this.#items) {
                const row = createRow(item);
                this.#rows.set(item.id, row);
                fragment.append(row);
            }
            this.#list.append(fragment);

            const { signal } = this.#listeners;
            this.#root.addEventListener('click', (event) => this.#onClick(event), { signal });
            this.#root.addEventListener('keydown', (event) => this.#onKeydown(event), { signal });
            this.#filter.addEventListener('input', () => this.#applyFilter(), { signal });
            // Keep ChatGPT's and our own page-level shortcuts from firing while the dialog is open.
            for (const type of ['keydown', 'keyup', 'keypress']) {
                this.#host.addEventListener(type, (event) => event.stopPropagation(), { signal });
            }

            document.body.append(this.#host);
            this.#syncSelectionUi();
            this.#syncExpandAllUi();
            this.focus();
        }

        #close(result) {
            cancelAnimationFrame(this.#statsFrame);
            this.#listeners.abort();
            this.#host.remove();
            if (this.#previousFocus?.isConnected) this.#previousFocus.focus?.({ preventScroll: true });
            this.#resolve(result);
        }

        #selectedIds() {
            return this.#items.map((item) => item.id).filter((id) => this.#selected.has(id));
        }

        #finish(action) {
            const ids = this.#selectedIds();
            if (ids.length) this.#close({ ids, action });
        }

        // ----- selection ------------------------------------------------------------------

        #visibleRows() {
            return [...this.#rows.values()].filter((row) => !row.hidden);
        }

        #setSelected(row, selected) {
            if (selected) this.#selected.add(row.dataset.id);
            else this.#selected.delete(row.dataset.id);
        }

        #toggle(row, extendRange) {
            const next = !this.#selected.has(row.dataset.id);
            const anchor = extendRange && this.#anchorId ? this.#rows.get(this.#anchorId) : null;
            if (anchor && !anchor.hidden) {
                const visible = this.#visibleRows();
                const [from, to] = [visible.indexOf(anchor), visible.indexOf(row)].sort((a, b) => a - b);
                visible.slice(from, to + 1).forEach((candidate) => this.#setSelected(candidate, next));
            } else {
                this.#setSelected(row, next);
                this.#anchorId = row.dataset.id;
            }
            this.#syncSelectionUi();
        }

        #bulkSelect(mode) {
            for (const row of this.#visibleRows()) {
                const isSelected = this.#selected.has(row.dataset.id);
                const next = {
                    all: true,
                    none: false,
                    invert: !isSelected,
                    user: row.dataset.role === 'user',
                    assistant: row.dataset.role === 'assistant'
                }[mode];
                if (next !== undefined) this.#setSelected(row, next);
            }
            this.#anchorId = null;
            this.#syncSelectionUi();
        }

        #syncSelectionUi() {
            let prompts = 0;
            let answers = 0;
            for (const [id, row] of this.#rows) {
                const selected = this.#selected.has(id);
                row.setAttribute('aria-selected', String(selected));
                if (!selected) continue;
                if (row.dataset.role === 'user') prompts++;
                else answers++;
            }
            const total = prompts + answers;
            this.#root.querySelector('.count').textContent =
                `${total} of ${this.#rows.size} selected · ${prompts} prompt${prompts === 1 ? '' : 's'}, ${answers} answer${answers === 1 ? '' : 's'}`;
            this.#root.querySelector('.mini-count').textContent = `${total} of ${this.#rows.size} selected`;
            for (const button of this.#root.querySelectorAll('[data-action]')) button.disabled = total === 0;
            this.#scheduleStats();
        }

        /** Size stats can be costly on huge chats: coalesce bursts of changes into one frame. */
        #scheduleStats() {
            cancelAnimationFrame(this.#statsFrame);
            this.#statsFrame = requestAnimationFrame(() => {
                const stats = this.#root.querySelector('.stats');
                const ids = this.#selectedIds();
                if (!ids.length || typeof this.#measure !== 'function') {
                    stats.textContent = '';
                    return;
                }
                try {
                    stats.textContent = formatStats(this.#measure(ids));
                } catch {
                    stats.textContent = '';
                }
            });
        }

        #applyFilter() {
            const query = this.#filter.value.trim().toLowerCase();
            const searchById = new Map(this.#items.map((item) => [item.id, item.searchText ?? '']));
            for (const [id, row] of this.#rows) {
                row.hidden = Boolean(query) && !searchById.get(id).includes(query);
            }
            const visible = this.#visibleRows();
            this.#root.querySelector('.empty').hidden = visible.length > 0;
            if (!visible.includes(this.#currentRow())) this.#setRovingRow(visible[0]);
            this.#syncExpandAllUi();
        }

        // ----- expand / collapse ----------------------------------------------------------

        #isExpanded(row) {
            return row.getAttribute('aria-expanded') === 'true';
        }

        /**
         * Expands or collapses one row or many at once.
         * Batched so "Expand all" on a long chat stays smooth: every read (row rects) happens
         * first, then all new folds are built, then ONE forced reflow, then all attributes flip.
         * Only rows currently inside the list viewport animate; rows scrolled out of sight switch
         * instantly (nobody sees them, and hundreds of simultaneous height transitions would
         * relayout the whole list every frame). Scroll anchoring keeps the visible part steady.
         * `reveal`: scroll the row into view when its unfold finishes (single, user-initiated toggles).
         */
        #setExpanded(rows, expanded, { reveal = false } = {}) {
            const changing = [rows].flat().filter((row) => this.#isExpanded(row) !== expanded);
            if (!changing.length) return;

            const instant = [];
            if (changing.length > 1) {
                const view = this.#list.getBoundingClientRect();
                for (const row of changing) {
                    const box = row.getBoundingClientRect();
                    if (box.bottom < view.top || box.top > view.bottom) instant.push(row);
                }
                for (const row of instant) row.classList.add('no-motion');
            }

            let built = false;
            if (expanded) {
                for (const row of changing) built = this.#ensureFullText(row) || built;
            }
            // New folds must get their closed style computed before the flip, or they pop in.
            if (built) void this.#list.offsetHeight;

            const label = expanded ? 'Show only the first lines' : 'Show the whole message';
            for (const row of changing) {
                const button = row.querySelector('.expand');
                button.title = label;
                button.setAttribute('aria-label', label);
                row.setAttribute('aria-expanded', String(expanded));
                if (reveal && expanded) row.dataset.reveal = '';
                else delete row.dataset.reveal;
            }

            if (instant.length) {
                // Compute the flipped style while transitions are off, then re-enable them;
                // changing only `transition` afterwards starts nothing.
                void this.#list.offsetHeight;
                for (const row of instant) row.classList.remove('no-motion');
            }
            this.#syncExpandAllUi();
        }

        /**
         * Builds a row's full-text fold on first expand only, so long chats stay cheap to open.
         * It is inserted while the row is still aria-expanded="false" (fold closed).
         * @returns {boolean} true when a fold was created.
         */
        #ensureFullText(row) {
            if (row.querySelector('.full-fold')) return false;
            const fold = element('div', 'fold full-fold');
            const inner = element('div', 'full-inner');
            inner.append(element('pre', 'full', this.#getFullText?.(row.dataset.id) ?? ''));
            fold.append(inner);
            fold.addEventListener('transitionend', (event) => {
                if (event.target !== fold || event.propertyName !== 'grid-template-rows' || !('reveal' in row.dataset)) return;
                delete row.dataset.reveal;
                this.#revealExpanded(row);
            }, { signal: this.#listeners.signal });
            row.querySelector('.body').append(fold);
            return true;
        }

        /** "Expand all" / "Collapse all": acts on the visible (filtered) rows, like the select chips. */
        #toggleAllExpanded() {
            const visible = this.#visibleRows();
            this.#setExpanded(visible, !visible.every((row) => this.#isExpanded(row)));
        }

        /** The button reads "Collapse all" only while every visible row is expanded. */
        #syncExpandAllUi() {
            const button = this.#root.querySelector('[data-expand-all]');
            const visible = this.#visibleRows();
            const allExpanded = visible.length > 0 && visible.every((row) => this.#isExpanded(row));
            button.textContent = allExpanded ? 'Collapse all' : 'Expand all';
            button.title = allExpanded ? 'Show only the first lines of every visible message' : 'Show the whole text of every visible message';
            button.disabled = visible.length === 0;
        }

        /** After an unfold finishes, scroll so the opened message is in view (top first if tall). */
        #revealExpanded(row) {
            if (row.getAttribute('aria-expanded') !== 'true') return;
            const list = this.#list.getBoundingClientRect();
            const box = row.getBoundingClientRect();
            if (box.top >= list.top && box.bottom <= list.bottom) return;
            row.scrollIntoView({ block: box.height > list.height ? 'start' : 'nearest', behavior: 'smooth' });
        }

        #toggleExpanded(row) {
            this.#setExpanded(row, !this.#isExpanded(row), { reveal: true });
        }

        // ----- focus & keyboard -----------------------------------------------------------

        #currentRow() {
            return this.#list.querySelector('.row[tabindex="0"]');
        }

        #setRovingRow(row) {
            this.#currentRow()?.setAttribute('tabindex', '-1');
            row?.setAttribute('tabindex', '0');
        }

        #focusRow(row) {
            if (!row) {
                this.#filter.focus();
                return;
            }
            this.#setRovingRow(row);
            row.focus({ preventScroll: true });
            row.scrollIntoView({ block: 'nearest' });
        }

        #moveFocus(fromRow, target, extendSelection) {
            const visible = this.#visibleRows();
            if (!visible.length) return;
            const index = visible.indexOf(fromRow);
            const destination = {
                next: visible[Math.min(visible.length - 1, index + 1)],
                previous: visible[Math.max(0, index - 1)],
                first: visible[0],
                last: visible.at(-1)
            }[target];
            this.#focusRow(destination);
            if (extendSelection && destination) {
                this.#setSelected(destination, true);
                this.#syncSelectionUi();
            }
        }

        #trapFocus(event) {
            // Scoped to the dialog: the minimized bar's buttons are not part of the modal cycle.
            const focusable = [...this.#root.querySelector('.dialog').querySelectorAll('button:not(:disabled):not(.expand), .filter, .row[tabindex="0"]')]
                .filter((node) => !node.hidden && node.offsetParent !== null);
            if (!focusable.length) return;
            const active = this.#root.activeElement;
            const first = focusable[0];
            const last = focusable.at(-1);
            if (event.shiftKey && (active === first || !active)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        }

        #onClick(event) {
            const target = event.target;
            if (target.closest('[data-close]')) return this.#close(null);
            if (target.closest('[data-minimize]')) return this.#setMinimized(true);
            if (target.closest('[data-restore]')) return this.#setMinimized(false);
            if (target.closest('[data-expand-all]')) return this.#toggleAllExpanded();

            const chip = target.closest('[data-select]');
            if (chip) return this.#bulkSelect(chip.dataset.select);

            const action = target.closest('[data-action]');
            if (action) return this.#finish(action.dataset.action);

            const row = target.closest('.row');
            if (!row) return;
            this.#setRovingRow(row);
            if (target.closest('.expand')) {
                this.#toggleExpanded(row);
                row.focus({ preventScroll: true });
                return;
            }
            // Clicks inside the expanded text are for reading/selecting text, not for selection.
            if (target.closest('.full')) return;
            this.#toggle(row, event.shiftKey);
            row.focus({ preventScroll: true });
        }

        #onKeydown(event) {
            const { key, shiftKey } = event;
            const target = event.target;

            // Minimized bar: plain buttons (Enter/Space work natively), no focus trap; Esc restores
            // rather than cancels, so the selection is never lost by accident.
            if (this.#minimized) {
                if (key === 'Escape') {
                    event.preventDefault();
                    this.#setMinimized(false);
                }
                return;
            }

            if (key === 'Escape') {
                event.preventDefault();
                // First Esc clears an active filter, the next one closes.
                if (target === this.#filter && this.#filter.value) {
                    this.#filter.value = '';
                    this.#applyFilter();
                } else {
                    this.#close(null);
                }
                return;
            }
            if (key === 'Tab') return this.#trapFocus(event);

            if (target === this.#filter) {
                if (key === 'ArrowDown' || key === 'Enter') {
                    event.preventDefault();
                    this.#focusRow(this.#visibleRows()[0]);
                }
                return;
            }

            const row = target.closest?.('.row');
            if (!row || target.closest('.full')) return;

            const navigation = { ArrowDown: 'next', ArrowUp: 'previous', Home: 'first', End: 'last' }[key];
            if (navigation) {
                event.preventDefault();
                this.#moveFocus(row, navigation, shiftKey);
            } else if (key === 'ArrowRight' || key === 'ArrowLeft') {
                event.preventDefault();
                this.#setExpanded(row, key === 'ArrowRight', { reveal: true });
            } else if (key === ' ') {
                event.preventDefault();
                this.#toggle(row, shiftKey);
            } else if (key === 'Enter') {
                event.preventDefault();
                this.#finish('download');
            } else if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'a') {
                event.preventDefault();
                this.#bulkSelect('all');
            }
        }
    }

    let activeSession = null;

    /**
     * Opens the picker (or re-focuses the one already open).
     * @param {{ title: string, items: object[], getFullText?: Function, measure?: Function }} options
     * @returns {Promise<{ ids: string[], action: 'download'|'copy' } | null>}
     */
    function open(options) {
        if (activeSession) {
            activeSession.focus();
            return activeSession.promise;
        }
        const session = new PickerSession(options);
        activeSession = session;
        session.promise.finally(() => {
            if (activeSession === session) activeSession = null;
        });
        return session.promise;
    }

    ns.picker = Object.freeze({ open });
})();
