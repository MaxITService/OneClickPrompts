// modules/chatgpt-exporter/message-picker.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
//
// ChatGPT Exporter — step 3 of 3 (only for "select messages"): a compact picker dialog.
//
// Design goals:
//   • Less scrolling: every message is ONE short row — role, number and only its first lines
//     (CSS line clamp). The full message never renders, so a 200-turn chat stays a short list.
//   • Fast bulk selection: All / None / Prompts / Answers / Invert act on the rows currently
//     visible, so "filter, then All" selects exactly what matched.
//   • Familiar list mechanics: click toggles, Shift+click selects a range (Gmail-style: the range
//     takes the clicked row's new state), Space toggles, arrows move, Shift+arrows extend,
//     Ctrl/Cmd+A selects all visible, Enter downloads, Esc cancels.
//   • Isolation: rendered in a Shadow DOM so ChatGPT's CSS cannot restyle it and ours cannot leak.
//     All message text is inserted with textContent (never innerHTML).
//   • Accessibility: role=dialog + aria-modal, listbox/option semantics with aria-selected,
//     roving tabindex, focus trap, focus restored to the invoking element on close.
//
// Public API:
//   window.OCPChatGptExporter.picker.open({ title, items }) -> Promise<{ ids, action } | null>
//     items:  [{ id, role: 'user'|'assistant', number, text, searchText, badges: string[] }]
//     action: 'download' | 'copy'; null when the user cancels.

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

    const STYLES = `
        :host {
            all: initial;
            position: fixed;
            inset: 0;
            z-index: 2147483646;
            font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
            color-scheme: light;
            --bg: #ffffff; --fg: #111827; --muted: #6b7280; --line: #e5e7eb;
            --hover: #f3f4f6; --selected: #f5f3ff; --accent: #7c3aed; --accent-hover: #6d28d9;
            --on-accent: #ffffff; --user: #2563eb; --assistant: #059669;
            --shadow: 0 24px 64px rgb(0 0 0 / 0.28);
        }
        :host(.dark) {
            color-scheme: dark;
            --bg: #1f1f23; --fg: #ececf1; --muted: #9ca3af; --line: #34343b;
            --hover: #2a2a30; --selected: #2e2745; --accent: #8b5cf6; --accent-hover: #a78bfa;
            --on-accent: #ffffff; --user: #60a5fa; --assistant: #34d399;
            --shadow: 0 24px 64px rgb(0 0 0 / 0.6);
        }
        *, *::before, *::after { box-sizing: border-box; }
        [hidden] { display: none !important; }

        .backdrop { position: absolute; inset: 0; background: rgb(0 0 0 / 0.45); backdrop-filter: blur(2px); animation: fade 0.15s ease-out; }
        .dialog {
            position: absolute; top: 50%; left: 50%; translate: -50% -50%;
            width: min(760px, calc(100vw - 32px)); max-height: min(82vh, 900px);
            display: flex; flex-direction: column; overflow: hidden;
            background: var(--bg); color: var(--fg);
            border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow);
            animation: pop 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        .head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 14px 6px 20px; }
        .titles { flex: 1; min-width: 0; }
        h2 { margin: 0; font-size: 17px; font-weight: 650; }
        .subtitle { margin: 2px 0 0; color: var(--muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .icon-btn { border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 16px; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; }
        .icon-btn:hover { background: var(--hover); color: var(--fg); }

        .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 20px 8px; }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .chip { border: 1px solid var(--line); background: transparent; color: var(--fg); border-radius: 999px; padding: 4px 12px; font: inherit; font-size: 13px; cursor: pointer; }
        .chip:hover { background: var(--hover); }
        .filter { flex: 1; min-width: 160px; font: inherit; font-size: 13px; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; }
        .hint { margin: 0; padding: 0 20px 8px; color: var(--muted); font-size: 12px; }

        .list { list-style: none; margin: 0; padding: 6px 8px; flex: 1; min-height: 120px; overflow-y: auto; overscroll-behavior: contain; border-block: 1px solid var(--line); }
        .row { display: grid; grid-template-columns: 18px 76px minmax(0, 1fr); align-items: start; gap: 10px; padding: 7px 10px; border-radius: 8px; cursor: pointer; user-select: none; outline: none; }
        .row + .row { margin-top: 2px; }
        .row:hover { background: var(--hover); }
        .row[aria-selected="true"] { background: var(--selected); }
        .row:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
        .check { width: 16px; height: 16px; margin-top: 2px; border: 1.5px solid var(--muted); border-radius: 4px; display: grid; place-items: center; }
        .row[aria-selected="true"] .check { background: var(--accent); border-color: var(--accent); }
        .row[aria-selected="true"] .check::after { content: ""; width: 4px; height: 8px; border: solid var(--on-accent); border-width: 0 2px 2px 0; rotate: 45deg; translate: 0 -1px; }
        .meta { display: flex; flex-direction: column; font-size: 12px; line-height: 1.35; }
        .role { font-weight: 650; }
        .row[data-role="user"] .role { color: var(--user); }
        .row[data-role="assistant"] .role { color: var(--assistant); }
        .num { color: var(--muted); font-variant-numeric: tabular-nums; }
        .body { min-width: 0; }
        .preview { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
        .badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
        .badges:empty { display: none; }
        .badge { font-size: 11px; padding: 0 6px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
        .empty { margin: 0; padding: 24px; text-align: center; color: var(--muted); }

        .foot { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 16px 14px 20px; }
        .count { flex: 1; min-width: 160px; color: var(--muted); font-size: 13px; }
        .actions { display: flex; gap: 8px; }
        .btn { font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
        .btn:hover:not(:disabled) { background: var(--hover); }
        .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
        .btn.primary:hover:not(:disabled) { background: var(--accent-hover); }
        .btn:disabled { opacity: 0.45; cursor: not-allowed; }
        button:focus-visible, .filter:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

        @keyframes pop { from { opacity: 0; scale: 0.97; } }
        @keyframes fade { from { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .dialog, .backdrop { animation: none; } }
        @media (max-width: 540px) {
            .row { grid-template-columns: 18px minmax(0, 1fr); }
            .meta { flex-direction: row; gap: 6px; }
            .body { grid-column: 2; }
            .hint { display: none; }
        }
    `;

    // Static markup only — every dynamic string is set later through textContent.
    const TEMPLATE = `
        <style>${STYLES}</style>
        <div class="backdrop" data-close></div>
        <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="ocp-exp-title" aria-describedby="ocp-exp-hint">
            <header class="head">
                <div class="titles">
                    <h2 id="ocp-exp-title">Export selected messages</h2>
                    <p class="subtitle"></p>
                </div>
                <button type="button" class="icon-btn" data-close aria-label="Close" title="Close (Esc)">&#x2715;</button>
            </header>
            <div class="toolbar">
                <div class="chips" role="group" aria-label="Quick select">
                    <button type="button" class="chip" data-select="all" title="Select every visible message">All</button>
                    <button type="button" class="chip" data-select="none" title="Clear every visible message">None</button>
                    <button type="button" class="chip" data-select="user" title="Select only your prompts">Prompts</button>
                    <button type="button" class="chip" data-select="assistant" title="Select only ChatGPT answers">Answers</button>
                    <button type="button" class="chip" data-select="invert" title="Invert the visible selection">Invert</button>
                </div>
                <input type="search" class="filter" placeholder="Filter messages&#x2026;" aria-label="Filter messages" spellcheck="false">
            </div>
            <p id="ocp-exp-hint" class="hint">Click a row to toggle &#xB7; Shift+click selects a range &#xB7; Space toggles &#xB7; Enter downloads &#xB7; Esc cancels</p>
            <ol class="list" role="listbox" aria-multiselectable="true" aria-label="Messages"></ol>
            <p class="empty" hidden>No messages match the filter.</p>
            <footer class="foot">
                <span class="count" aria-live="polite"></span>
                <div class="actions">
                    <button type="button" class="btn" data-action="copy" title="Copy the selected messages as Markdown">Copy Markdown</button>
                    <button type="button" class="btn primary" data-action="download" title="Download the selected messages as a .md file (Enter)">Download .md</button>
                </div>
            </footer>
        </section>
    `;

    function isDarkPage() {
        const root = document.documentElement;
        if (root.classList.contains('dark')) return true;
        if (root.classList.contains('light')) return false;
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    }

    function createRow(item) {
        const row = document.createElement('li');
        row.className = 'row';
        row.setAttribute('role', 'option');
        row.tabIndex = -1;
        row.dataset.id = item.id;
        row.dataset.role = item.role;

        const check = document.createElement('span');
        check.className = 'check';
        check.setAttribute('aria-hidden', 'true');

        const meta = document.createElement('span');
        meta.className = 'meta';
        const role = document.createElement('span');
        role.className = 'role';
        role.textContent = ROLE_LABELS[item.role] ?? item.role;
        const number = document.createElement('span');
        number.className = 'num';
        number.textContent = `#${item.number}`;
        meta.append(role, number);

        const body = document.createElement('span');
        body.className = 'body';
        const preview = document.createElement('span');
        preview.className = 'preview';
        preview.textContent = item.text;
        const badges = document.createElement('span');
        badges.className = 'badges';
        for (const badge of item.badges ?? []) {
            const chip = document.createElement('span');
            chip.className = 'badge';
            chip.textContent = BADGE_LABELS[badge] ?? badge;
            badges.append(chip);
        }
        body.append(preview, badges);

        row.append(check, meta, body);
        return row;
    }

    class PickerSession {
        #items;
        #rows = new Map();            // id -> <li>
        #selected = new Set();        // ids
        #anchorId = null;             // last row toggled without Shift (range start)
        #listeners = new AbortController();
        #previousFocus = document.activeElement;
        #resolve;
        #host;
        #root;
        #list;
        #filter;

        constructor(title, items) {
            this.#items = items;
            this.promise = new Promise((resolve) => { this.#resolve = resolve; });
            for (const item of items) this.#selected.add(item.id); // Start with everything selected.
            this.#mount(title);
        }

        focus() {
            this.#focusRow(this.#currentRow() ?? this.#visibleRows()[0]);
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
            this.focus();
        }

        #close(result) {
            this.#listeners.abort();
            this.#host.remove();
            if (this.#previousFocus?.isConnected) this.#previousFocus.focus?.({ preventScroll: true });
            this.#resolve(result);
        }

        #finish(action) {
            const ids = this.#items.map((item) => item.id).filter((id) => this.#selected.has(id));
            if (!ids.length) return;
            this.#close({ ids, action });
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
            for (const button of this.#root.querySelectorAll('[data-action]')) button.disabled = total === 0;
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
            row.focus();
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
            const focusable = [...this.#root.querySelectorAll('button:not(:disabled), .filter, .row[tabindex="0"]')]
                .filter((element) => !element.hidden && element.offsetParent !== null);
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

            const chip = target.closest('[data-select]');
            if (chip) return this.#bulkSelect(chip.dataset.select);

            const action = target.closest('[data-action]');
            if (action) return this.#finish(action.dataset.action);

            const row = target.closest('.row');
            if (row) {
                this.#toggle(row, event.shiftKey);
                this.#setRovingRow(row);
                row.focus({ preventScroll: true });
            }
        }

        #onKeydown(event) {
            const { key, shiftKey } = event;
            const target = event.target;

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
            if (!row) return;

            const navigation = { ArrowDown: 'next', ArrowUp: 'previous', Home: 'first', End: 'last' }[key];
            if (navigation) {
                event.preventDefault();
                this.#moveFocus(row, navigation, shiftKey);
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
     * @param {{ title: string, items: object[] }} options
     * @returns {Promise<{ ids: string[], action: 'download'|'copy' } | null>}
     */
    function open({ title, items }) {
        if (activeSession) {
            activeSession.focus();
            return activeSession.promise;
        }
        const session = new PickerSession(title, items);
        activeSession = session;
        session.promise.finally(() => {
            if (activeSession === session) activeSession = null;
        });
        return session.promise;
    }

    ns.picker = Object.freeze({ open });
})();
