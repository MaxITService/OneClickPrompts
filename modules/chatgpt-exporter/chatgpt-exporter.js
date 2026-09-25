// modules/chatgpt-exporter/chatgpt-exporter.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
//
// ChatGPT Exporter — orchestrator (loaded after conversation-parser.js, markdown-renderer.js and
// message-picker.js). Owns everything that touches the outside world:
//   • module settings (global, from the service worker StateStore: `modules.chatgptExporter`)
//   • the three toolbar buttons rendered by buttons-init-and-render.js:
//       Export chat          — whole visible branch
//       Export answers only  — ChatGPT turns only
//       Export selected      — opens the message picker
//     Click downloads a .md file, Shift+click copies the Markdown to the clipboard.
//   • fetching the conversation from ChatGPT's backend with the user's own session
//   • delivery (file download / clipboard) and user feedback (toasts)
//
// Data flow:  backend JSON --parser--> turns --(picker)--> selection --markdown--> file/clipboard
//
// For the picker, every message is rendered once into its final Markdown section (lazily, then
// cached). The picker's "show whole message" text, its live size line (characters, UTF-8 KB and
// — when the Token Counter module is on for ChatGPT — tokens by the model chosen there) and the
// exported file are all built from those same strings.
//
// Privacy: requests go only to the same origin the user is already on (chatgpt.com), using the
// session the page itself uses. The access token lives in memory for a few minutes and is never
// stored or sent anywhere else. No new extension permissions are needed: content-script fetches
// to the page's own origin are same-origin requests.
//
// If the backend is unreachable (API change, network, signed out) we fall back to the text of
// the messages rendered on the page, and say so, instead of failing silently.
//
// Public API (window.OCPChatGptExporter):
//   settingsReady            Promise that resolves once settings are loaded (never rejects)
//   getToolbarPlacement()    'before' | 'after' — relative to the custom buttons
//   createToolbarButtons()   HTMLButtonElement[] — empty when disabled or not on ChatGPT

(() => {
    'use strict';

    const ns = (window.OCPChatGptExporter ??= {});
    if (ns.createToolbarButtons) return;

    const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);
    const SETTINGS_CHANGED_MESSAGE = 'chatgptExporterSettingsChanged';
    // Button icons are user-editable in the popup; defaults live in modules/module-button-icons.js.
    const buttonIcons = window.OCPModuleButtonIcons;
    const DEFAULT_SETTINGS = Object.freeze({
        enabled: false,
        placement: 'after',
        includeThinking: true,
        includeSources: true,
        icons: buttonIcons.defaults.chatgptExporter
    });
    const REQUEST_TIMEOUT_MS = 30_000;
    const ACCESS_TOKEN_TTL_MS = 5 * 60_000;
    const MAX_FILE_TITLE_LENGTH = 80;

    const log = (...args) => window.logConCgp?.('[chatgpt-exporter]', ...args);
    const toast = (message, type = 'info', options) => window.showToast?.(message, type, options);

    /** An error whose message is written for the user and can be shown as-is. */
    class ExportError extends Error {}

    function normalizeSettings(raw) {
        const value = raw && typeof raw === 'object' ? raw : {};
        return {
            enabled: value.enabled === true,
            placement: value.placement === 'before' ? 'before' : 'after',
            includeThinking: value.includeThinking !== false,
            includeSources: value.includeSources !== false,
            icons: buttonIcons.normalize('chatgptExporter', value.icons)
        };
    }

    // ---------------------------------------------------------------------------------------
    // Settings
    // ---------------------------------------------------------------------------------------

    const isChatGptHost = CHATGPT_HOSTS.has(location.hostname);
    let settings = { ...DEFAULT_SETTINGS };

    async function loadSettings() {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'getChatGptExporterSettings' });
            if (response?.settings) settings = normalizeSettings(response.settings);
        } catch (error) {
            log('Could not load settings; module stays disabled.', error?.message || error);
        }
    }

    function refreshToolbars() {
        const init = window.MaxExtensionButtonsInit;
        init?.updateButtonsForProfileChange?.('inline');
        init?.updateButtonsForProfileChange?.('panel');
    }

    if (isChatGptHost) {
        chrome.runtime.onMessage.addListener((message) => {
            if (message?.type !== SETTINGS_CHANGED_MESSAGE || !message.settings) return;
            const next = normalizeSettings(message.settings);
            const toolbarChanged = next.enabled !== settings.enabled
                || next.placement !== settings.placement
                || Object.keys(next.icons).some((key) => next.icons[key] !== settings.icons[key]);
            settings = next;
            if (toolbarChanged) refreshToolbars();
        });
    }

    // ---------------------------------------------------------------------------------------
    // ChatGPT backend access
    // ---------------------------------------------------------------------------------------

    class HttpError extends Error {
        constructor(status, path) {
            super(`HTTP ${status} for ${path}`);
            this.status = status;
        }
    }

    async function requestJson(path, headers = {}) {
        const response = await fetch(path, {
            headers,
            credentials: 'include',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (!response.ok) throw new HttpError(response.status, path);
        return response.json();
    }

    const chatGptApi = new class {
        #token = null;
        #tokenExpiresAt = 0;

        async #accessToken(forceRefresh) {
            if (!forceRefresh && this.#token && Date.now() < this.#tokenExpiresAt) return this.#token;
            const session = await requestJson('/api/auth/session');
            if (!session?.accessToken) throw new ExportError('You seem to be signed out of ChatGPT. Sign in and try again.');
            this.#token = session.accessToken;
            this.#tokenExpiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;
            return this.#token;
        }

        /** GET with bearer auth; one retry with a fresh token if the cached one was rejected. */
        async #authorizedJson(path) {
            try {
                return await requestJson(path, { Authorization: `Bearer ${await this.#accessToken(false)}` });
            } catch (error) {
                if (error?.status !== 401) throw error;
                return requestJson(path, { Authorization: `Bearer ${await this.#accessToken(true)}` });
            }
        }

        conversation(conversationId) {
            return this.#authorizedJson(`/backend-api/conversation/${encodeURIComponent(conversationId)}`);
        }

        textdocs(conversationId) {
            return this.#authorizedJson(`/backend-api/conversation/${encodeURIComponent(conversationId)}/textdocs`);
        }
    }();

    function currentConversationId() {
        return location.pathname.match(/\/c\/([^/?#]+)/)?.[1] ?? '';
    }

    /** Lossy fallback: plain text of the messages currently rendered on the page. */
    function readConversationFromPage() {
        const turns = [...document.querySelectorAll('[data-message-author-role]')]
            .map((element, position) => ({
                id: element.getAttribute('data-message-id') || `page-${position}`,
                role: element.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant',
                createTime: null,
                blocks: [{ kind: 'text', text: (element.innerText || '').trim(), references: [], attachments: [], quote: '' }]
            }))
            .filter((turn) => turn.blocks[0].text)
            .map((turn, index) => ({ ...turn, index }));
        const title = document.title.replace(/\s*[-|–]\s*ChatGPT\s*$/i, '').trim() || 'ChatGPT conversation';
        return { id: '', title, model: '', createTime: null, updateTime: null, turns };
    }

    async function loadConversation() {
        const conversationId = currentConversationId();
        if (!conversationId) {
            throw new ExportError('Open a saved chat first: new and temporary chats have no conversation to export yet.');
        }
        const sourceUrl = `${location.origin}${location.pathname}`;

        try {
            const conversation = ns.parser.parseConversation(await chatGptApi.conversation(conversationId));
            if (conversation.turns.some((turn) => turn.blocks.some((block) => block.kind === 'canvas'))) {
                try {
                    ns.parser.applyFinalTextdocs(conversation, await chatGptApi.textdocs(conversationId));
                } catch (error) {
                    log('Canvas final versions unavailable; using replayed history.', error?.message || error);
                }
            }
            return { ...conversation, sourceUrl };
        } catch (error) {
            if (error instanceof ExportError) throw error;
            log('Backend export failed; falling back to page text.', error);
            const fallback = readConversationFromPage();
            if (!fallback.turns.length) throw new ExportError('Could not read this conversation. Reload the page and try again.');
            toast('ChatGPT data was unavailable, so the visible page text was exported instead (formatting may be simplified).', 'warning', 6000);
            return { ...fallback, sourceUrl };
        }
    }

    // ---------------------------------------------------------------------------------------
    // Delivery
    // ---------------------------------------------------------------------------------------

    function buildFileName(title, mode) {
        const safeTitle = title
            .normalize('NFC')
            .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, ' ') // Characters no file system accepts.
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_FILE_TITLE_LENGTH)
            .replace(/[. ]+$/, '') || 'ChatGPT conversation';
        const suffix = { answers: ' (answers)', selection: ' (selection)' }[mode] ?? '';
        const date = ns.markdown.formatLocalDateTime(new Date()).slice(0, 10);
        return `${safeTitle}${suffix} ${date}.md`;
    }

    function downloadText(text, fileName) {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.hidden = true;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        // Revoke later: the browser reads the blob asynchronously after the click.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    async function copyText(text) {
        const writer = window.MaxExtensionButtons?.__writeTextToClipboard;
        if (typeof writer === 'function') return writer.call(window.MaxExtensionButtons, text);
        return navigator.clipboard.writeText(text);
    }

    async function deliver(markdown, { fileName, delivery, count }) {
        const what = `${count} message${count === 1 ? '' : 's'}`;
        if (delivery === 'copy') {
            await copyText(markdown);
            toast(`Copied ${what} as Markdown.`, 'success');
        } else {
            downloadText(markdown, fileName);
            // A page cannot observe whether Chrome actually saved the file (its repeated-download
            // protection may block it silently), so report "started", never "saved", and offer
            // the clipboard as a fallback that needs no extra permission.
            toast(`Download started: ${fileName} (${what}). If Chrome blocked it, copy instead.`, 'info', {
                duration: 8000,
                customButtons: [{
                    text: 'Copy instead',
                    title: 'Copy the same Markdown to the clipboard',
                    onClick: async () => {
                        try {
                            await copyText(markdown);
                            toast(`Copied ${what} as Markdown.`, 'success');
                        } catch (error) {
                            log('Clipboard fallback failed:', error);
                            toast('Could not copy to the clipboard.', 'error');
                        }
                        return true;
                    }
                }]
            });
        }
    }

    // ---------------------------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------------------------

    function toPickerItem(turn) {
        const preview = ns.markdown.previewOf(turn);
        return {
            id: turn.id,
            role: turn.role,
            number: turn.index + 1,
            text: preview.text,
            searchText: preview.searchText,
            badges: preview.badges
        };
    }

    // ---------------------------------------------------------------------------------------
    // Selection size (picker footer): characters, UTF-8 KB and Token Counter estimate
    // ---------------------------------------------------------------------------------------

    /** Code points and UTF-8 bytes in one pass (String#length would count UTF-16 units). */
    function measureText(text) {
        let chars = 0;
        let bytes = 0;
        for (const character of text) {
            const codePoint = character.codePointAt(0);
            chars++;
            bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
        }
        return { chars, bytes };
    }

    /**
     * Uses the model and calibration chosen in the Token Counter module, only when that module is
     * enabled for ChatGPT; otherwise null (the picker then shows no token figure).
     * @returns {Promise<{ name: string, estimate: (text: string) => number } | null>}
     */
    async function loadTokenEstimator() {
        try {
            const { settings: tokenSettings } = await chrome.runtime.sendMessage({ type: 'getTokenApproximatorSettings' }) ?? {};
            if (!tokenSettings?.enabled || tokenSettings.enabledSites?.ChatGPT === false) return null;
            const registry = window.OCP_createTokenModelRegistry?.();
            if (!registry) return null;
            const modelId = registry.resolveModelId(tokenSettings.countingMethod);
            const model = registry.getModel(modelId) ?? registry.getDefaultModel();
            if (!model) return null;
            const calibration = Number.isFinite(tokenSettings.calibration) && tokenSettings.calibration > 0 ? tokenSettings.calibration : 1;
            const name = window.OCP_TOKEN_MODEL_CATALOG?.getModelMetadata(model.getMetadata().id)?.shortName ?? modelId;
            return { name, estimate: (text) => model.estimate(text, calibration) };
        } catch (error) {
            log('Token Counter unavailable for the picker; token figure hidden.', error?.message || error);
            return null;
        }
    }

    /**
     * Renders each selected-mode section once (lazily) and answers the picker's questions from
     * that cache: the full Markdown of one message, and the size of any selection. The final
     * export is assembled from the very same strings, so the numbers shown are the file's numbers.
     */
    function createSectionCache(conversation, renderOptions, tokenEstimator) {
        const turnsById = new Map(conversation.turns.map((turn) => [turn.id, turn]));
        const header = ns.markdown.renderHeader(conversation, renderOptions);
        const headerSize = measureText(header);
        let headerTokens = null;
        const cache = new Map();

        const entry = (id) => {
            let value = cache.get(id);
            if (!value) {
                const text = ns.markdown.renderSection(turnsById.get(id), renderOptions);
                value = { text, ...measureText(text), tokens: null };
                cache.set(id, value);
            }
            return value;
        };
        const tokensOf = (value) => (value.tokens ??= tokenEstimator.estimate(value.text));
        const sectionsOf = (ids) => ids.map(entry).filter((value) => value.text);

        return {
            fullText: (id) => entry(id).text || '(This message has nothing to export with the current settings.)',

            measure(ids) {
                const sections = sectionsOf(ids);
                // Mirrors assembleDocument: header + "\n\n" + sections joined by "\n\n" + "\n".
                const separators = sections.length ? 2 + 2 * (sections.length - 1) + 1 : 0;
                let chars = headerSize.chars + separators;
                let bytes = headerSize.bytes + separators;
                for (const section of sections) {
                    chars += section.chars;
                    bytes += section.bytes;
                }
                let tokens = null;
                if (tokenEstimator) {
                    headerTokens ??= tokenEstimator.estimate(header);
                    tokens = sections.reduce((sum, section) => sum + tokensOf(section), headerTokens);
                }
                return { chars, bytes, tokens, tokenModel: tokenEstimator?.name ?? null };
            },

            document: (ids) => ns.markdown.assembleDocument(header, sectionsOf(ids).map((section) => section.text))
        };
    }

    /** Returns `{ turns, mode, delivery, markdown? }`, or null when the user cancelled. */
    async function chooseTurns(actionId, conversation, renderOptions, delivery, onBeforePicker) {
        const { turns } = conversation;
        switch (actionId) {
            case 'full':
                return { turns, mode: 'full', delivery };
            case 'answers':
                return { turns: turns.filter((turn) => turn.role === 'assistant'), mode: 'answers', delivery };
            case 'select': {
                const sections = createSectionCache(conversation, { ...renderOptions, mode: 'selection' }, await loadTokenEstimator());
                onBeforePicker();
                const choice = await ns.picker.open({
                    title: conversation.title,
                    items: turns.map(toPickerItem),
                    getFullText: sections.fullText,
                    measure: sections.measure
                });
                if (!choice) return null;
                const chosen = new Set(choice.ids);
                return {
                    turns: turns.filter((turn) => chosen.has(turn.id)),
                    mode: 'selection',
                    delivery: choice.action,
                    markdown: sections.document(choice.ids)
                };
            }
            default:
                throw new Error(`Unknown export action: ${actionId}`);
        }
    }

    let exportInProgress = false;

    function setBusy(button, busy) {
        button.setAttribute('aria-busy', String(busy));
        button.style.opacity = busy ? '0.5' : '';
        button.style.cursor = busy ? 'progress' : 'pointer';
    }

    async function runAction(actionId, button, { copy }) {
        if (exportInProgress) {
            toast('An export is already in progress.', 'info');
            return;
        }
        exportInProgress = true;
        setBusy(button, true);
        try {
            const conversation = await loadConversation();
            if (!conversation.turns.length) throw new ExportError('This chat has no messages to export yet.');

            const renderOptions = {
                includeThinking: settings.includeThinking,
                includeSources: settings.includeSources,
                sourceUrl: conversation.sourceUrl
            };
            const plan = await chooseTurns(actionId, conversation, renderOptions, copy ? 'copy' : 'download', () => setBusy(button, false));
            if (!plan) return;
            if (!plan.turns.length) throw new ExportError('Nothing to export: no matching messages.');

            const markdown = plan.markdown ?? ns.markdown.renderDocument(conversation, plan.turns, { ...renderOptions, mode: plan.mode });
            await deliver(markdown, {
                fileName: buildFileName(conversation.title, plan.mode),
                delivery: plan.delivery,
                count: plan.turns.length
            });
            log(`Exported ${plan.turns.length} turn(s), mode=${plan.mode}, delivery=${plan.delivery}, ${markdown.length} chars.`);
        } catch (error) {
            log('Export failed:', error);
            toast(error instanceof ExportError ? error.message : 'Export failed. Reload the page and try again.', 'error', 5000);
        } finally {
            exportInProgress = false;
            setBusy(button, false);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Toolbar buttons
    // ---------------------------------------------------------------------------------------

    const SHIFT_HINT = '\n• Shift+click: copy the Markdown to the clipboard instead.';
    // `id` doubles as the key of the action's icon in settings.icons.
    const ACTIONS = [
        {
            id: 'full',
            label: 'Export chat to Markdown',
            tooltip: `Export chat to Markdown\n• Click: download the whole conversation (the branch you are viewing) as a .md file.${SHIFT_HINT}`
        },
        {
            id: 'answers',
            label: 'Export ChatGPT answers to Markdown',
            tooltip: `Export answers only\n• Click: download only ChatGPT's answers, without your prompts.${SHIFT_HINT}`
        },
        {
            id: 'select',
            label: 'Export selected messages to Markdown',
            tooltip: 'Export selected messages\n• Click: pick messages from a compact list (first lines only, expand any message to read it whole), see the size of the selection, then download or copy it.'
        }
    ];

    function createButton(action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = settings.icons[action.id];
        button.dataset.ocpExporterAction = action.id;
        button.setAttribute('aria-label', action.label);
        button.title = action.tooltip;
        // Same footprint as the custom prompt buttons so the row stays aligned.
        button.style.cssText = `
            background-color: transparent;
            border: none;
            cursor: pointer;
            padding: 1px;
            font-size: 20px;
            margin-right: 5px;
            margin-bottom: 5px;
        `;
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void runAction(action.id, button, { copy: event.shiftKey && action.id !== 'select' });
        });
        return button;
    }

    function createToolbarButtons() {
        if (!settings.enabled || window.InjectionTargetsOnWebsite?.activeSite !== 'ChatGPT') return [];
        return ACTIONS.map(createButton);
    }

    ns.settingsReady = isChatGptHost ? loadSettings() : Promise.resolve();
    ns.getToolbarPlacement = () => settings.placement;
    ns.createToolbarButtons = createToolbarButtons;
})();
