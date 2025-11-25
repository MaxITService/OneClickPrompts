// modules/selector-auto-detector/selector-save.js
// Builds CSS selectors from heuristic finds and persists them as custom selectors.

'use strict';

const ATTRIBUTE_PRIORITY = [
    'data-testid',
    'data-test',
    'data-qa',
    'aria-label',
    'id',
    'name',
    'placeholder'
];
const CLASS_LIMIT = 3;
const PATH_DEPTH_LIMIT = 4;

function escapeCss(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(value);
    }
    return String(value).replace(/"/g, '\\"');
}

function isUniqueSelector(selector) {
    try {
        return document.querySelectorAll(selector).length === 1;
    } catch {
        return false;
    }
}

function buildAttributeSelector(element) {
    const tag = element.tagName.toLowerCase();
    for (const attr of ATTRIBUTE_PRIORITY) {
        const value = element.getAttribute(attr);
        if (!value) continue;
        if (attr === 'id') {
            const candidate = `#${escapeCss(value)}`;
            if (isUniqueSelector(candidate)) return candidate;
        } else {
            const candidate = `${tag}[${attr}="${escapeCss(value)}"]`;
            if (isUniqueSelector(candidate)) return candidate;
        }
    }
    return null;
}

function buildClassSelector(element) {
    const tag = element.tagName.toLowerCase();
    const usefulClasses = Array.from(element.classList || []).filter(cls => {
        return cls.length > 1 && !/^ocp[-_]/i.test(cls) && !/^custom-send-button/i.test(cls);
    }).slice(0, CLASS_LIMIT);

    if (usefulClasses.length === 0) return null;

    const candidate = `${tag}.${usefulClasses.map(escapeCss).join('.')}`;
    if (isUniqueSelector(candidate)) {
        return candidate;
    }
    return null;
}

function buildDomPathSelector(element) {
    const segments = [];
    let node = element;
    let depth = 0;
    while (node && node.tagName && depth < PATH_DEPTH_LIMIT) {
        const tag = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (!parent) break;
        const siblings = Array.from(parent.children).filter(child => child.tagName === node.tagName);
        const index = siblings.indexOf(node) + 1;
        segments.unshift(`${tag}:nth-of-type(${index})`);
        const candidate = segments.join(' > ');
        if (isUniqueSelector(candidate)) {
            return candidate;
        }
        node = parent;
        depth += 1;
    }
    return null;
}

function deriveSelectorFromElement(element) {
    if (!element || !element.tagName) return null;
    // Prefer attributes first, then classes, then structural path.
    const attributeSelector = buildAttributeSelector(element);
    if (attributeSelector) return attributeSelector;

    const classSelector = buildClassSelector(element);
    if (classSelector) return classSelector;

    const pathSelector = buildDomPathSelector(element);
    if (pathSelector) return pathSelector;

    return null;
}

function normalizeSelectors(current, fallback) {
    const merged = { ...fallback, ...current };
    merged.containers = Array.isArray(current.containers) ? [...current.containers] : (Array.isArray(fallback?.containers) ? [...fallback.containers] : []);
    merged.sendButtons = Array.isArray(current.sendButtons) ? [...current.sendButtons] : (Array.isArray(fallback?.sendButtons) ? [...fallback.sendButtons] : []);
    merged.editors = Array.isArray(current.editors) ? [...current.editors] : (Array.isArray(fallback?.editors) ? [...fallback.editors] : []);
    merged.buttonsContainerId = current.buttonsContainerId || fallback?.buttonsContainerId || '';
    merged.threadRoot = current.threadRoot || fallback?.threadRoot || '';
    return merged;
}

async function loadSelectors(site) {
    const defaults = (window.InjectionTargetsOnWebsite && typeof window.InjectionTargetsOnWebsite.getDefaultSelectors === 'function')
        ? window.InjectionTargetsOnWebsite.getDefaultSelectors(site)
        : {};
    let current = {};
    try {
        const response = await chrome.runtime.sendMessage({ type: 'getCustomSelectors', site });
        if (response && response.selectors) {
            current = response.selectors;
        }
    } catch (error) {
        console.warn('[selector-save] Failed to load custom selectors', error);
    }
    return normalizeSelectors(current, defaults);
}

function prependUnique(value, list) {
    const sanitizedList = Array.isArray(list) ? list : [];
    return [value, ...sanitizedList.filter(item => item && item !== value)];
}

async function saveSelectorFromElement({ site, type, element, selectorOverride }) {
    if (!element || !site) {
        return { ok: false, reason: 'invalidArgs' };
    }
    const selector = selectorOverride || deriveSelectorFromElement(element);
    if (!selector) {
        return { ok: false, reason: 'selectorNotDerived' };
    }

    const targetKey = type === 'editor' ? 'editors' : (type === 'sendButton' ? 'sendButtons' : null);
    if (!targetKey) {
        return { ok: false, reason: 'unknownType' };
    }

    if (typeof logConCgp === 'function') {
        logConCgp('[SelectorAutoDetector] Preparing selector save.', { site, type: targetKey, selector });
    }

    const selectors = await loadSelectors(site);
    selectors[targetKey] = prependUnique(selector, selectors[targetKey]);

    try {
        await chrome.runtime.sendMessage({
            type: 'saveCustomSelectors',
            site,
            selectors
        });
    } catch (error) {
        console.warn('[selector-save] Failed to persist selector', error);
        return { ok: false, reason: 'persistFailed' };
    }

    if (typeof logConCgp === 'function') {
        logConCgp('[SelectorAutoDetector] Selector saved to custom selectors.', { site, type: targetKey, selector });
    }

    if (window.InjectionTargetsOnWebsite && window.InjectionTargetsOnWebsite.selectors) {
        const live = window.InjectionTargetsOnWebsite.selectors;
        const liveList = Array.isArray(live[targetKey]) ? live[targetKey] : [];
        window.InjectionTargetsOnWebsite.selectors[targetKey] = prependUnique(selector, liveList);
    }

    return { ok: true, selector, site, type: targetKey };
}

export const OCPSelectorPersistence = {
    deriveSelectorFromElement,
    saveSelectorFromElement
};

window.OCPSelectorPersistence = OCPSelectorPersistence;
