// modules/module-button-icons.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
//
// Single source of truth for the user-editable emoji icons of buttons that modules inject into the
// chat toolbar (Cross-Chat, ChatGPT Exporter). Each module stores its icons under `settings.icons`.
//
// Loaded in three contexts, so it is a dependency-free classic script that publishes a global:
//   • content scripts  — manifest.json (before buttons.js)
//   • popup            — <script> tag in popup.html (before the module UI scripts)
//   • service worker   — side-effect `import './module-button-icons.js'` from the state store
//
// Public API (globalThis.OCPModuleButtonIcons):
//   defaults                    { [moduleId]: { [iconKey]: emoji } } (frozen)
//   normalize(moduleId, raw)    complete icon map: every key present, blank/invalid → default
//   normalizeIcon(value, fb)    one icon: trimmed, at most MAX_GRAPHEMES visible characters, blank → fb
//   MAX_GRAPHEMES               how many user-perceived characters an icon may have

(() => {
    'use strict';

    if (globalThis.OCPModuleButtonIcons) return;

    const DEFAULTS = Object.freeze({
        crossChat: Object.freeze({
            copy: '📋',
            paste: '📥',
            broadcast: '⬆️',
            shield: '😷' // broadcast button while this tab refuses incoming broadcasts
        }),
        chatgptExporter: Object.freeze({
            full: '📑',
            answers: '🤖',
            select: '☑️'
        })
    });

    // Two graphemes: room for one ZWJ/flag emoji or a short text label like "MD", nothing longer.
    const MAX_GRAPHEMES = 2;
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

    function normalizeIcon(value, fallback) {
        if (typeof value !== 'string') return fallback;
        const trimmed = value.trim();
        if (!trimmed) return fallback;
        return Array.from(segmenter.segment(trimmed), ({ segment }) => segment)
            .slice(0, MAX_GRAPHEMES)
            .join('');
    }

    function normalize(moduleId, raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return Object.fromEntries(
            Object.entries(DEFAULTS[moduleId] ?? {}).map(([key, fallback]) => [key, normalizeIcon(source[key], fallback)])
        );
    }

    globalThis.OCPModuleButtonIcons = Object.freeze({ defaults: DEFAULTS, normalize, normalizeIcon, MAX_GRAPHEMES });
})();
