// modules/selector-auto-detector/selector-save.js
// Builds CSS selectors from heuristic finds and persists them as custom selectors.

'use strict';

const ATTRIBUTE_PRIORITY = [
    'data-testid',
    'data-test',
    'data-qa',
    'data-chatgpt-composer',
    'data-app-shell-main-surface',
    'data-composer-body',
    'data-composer-footer-responsive',
    'aria-label',
    'id',
    'name',
    'placeholder'
];
const CLASS_LIMIT = 3;

function escapeCss(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(value);
    }
    return String(value).replace(/"/g, '\\"');
}

function quoteAttributeValue(value) {
    return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\a ').replaceAll('\r', '\\d ')}"`;
}

function isUniqueSelector(selector, element) {
    try {
        const matches = document.querySelectorAll(selector);
        return matches.length === 1 && matches[0] === element;
    } catch {
        return false;
    }
}

function buildAttributeSelector(element) {
    const tag = element.tagName.toLowerCase();
    for (const attr of ATTRIBUTE_PRIORITY) {
        const value = element.getAttribute(attr);
        if (value === null) continue;
        if (attr === 'id') {
            const candidate = `#${escapeCss(value)}`;
            if (isUniqueSelector(candidate, element)) return candidate;
        } else {
            const candidate = value === '' ? `${tag}[${attr}]` : `${tag}[${attr}=${quoteAttributeValue(value)}]`;
            if (isUniqueSelector(candidate, element)) return candidate;
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
    if (isUniqueSelector(candidate, element)) {
        return candidate;
    }
    return null;
}

function relativePathFromAncestor(element, ancestor) {
    const segments = [];
    let node = element;
    while (node && node !== ancestor) {
        const tag = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (!parent) return null;
        const siblings = Array.from(parent.children).filter(child => child.tagName === node.tagName);
        const index = siblings.indexOf(node) + 1;
        segments.unshift(`${tag}:nth-of-type(${index})`);
        node = parent;
    }
    return node === ancestor ? segments.join(' > ') : null;
}

function buildAnchoredPathSelector(element, anchorBuilder) {
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const anchor = anchorBuilder(ancestor);
        if (!anchor) continue;
        const relativePath = relativePathFromAncestor(element, ancestor);
        if (!relativePath) continue;
        const candidate = `${anchor} > ${relativePath}`;
        if (isUniqueSelector(candidate, element)) return candidate;
    }
    return null;
}

function buildDomPathSelector(element) {
    if (!document.body?.contains(element)) return null;
    if (element === document.body) return 'body';
    const relativePath = relativePathFromAncestor(element, document.body);
    const candidate = relativePath ? `body > ${relativePath}` : null;
    return candidate && isUniqueSelector(candidate, element) ? candidate : null;
}

function deriveSelectorFromElement(element) {
    if (!element || !element.tagName || !element.isConnected) return null;
    // A stable attribute on an ancestor is preferable to a generated class on the element.
    const attributeSelector = buildAttributeSelector(element);
    if (attributeSelector) return attributeSelector;

    const anchoredAttributePath = buildAnchoredPathSelector(element, buildAttributeSelector);
    if (anchoredAttributePath) return anchoredAttributePath;

    const classSelector = buildClassSelector(element);
    if (classSelector) return classSelector;

    const anchoredClassPath = buildAnchoredPathSelector(element, buildClassSelector);
    if (anchoredClassPath) return anchoredClassPath;

    const pathSelector = buildDomPathSelector(element);
    if (pathSelector) return pathSelector;

    return null;
}

function normalizeSelectors(current, fallback) {
    const merged = { ...fallback, ...current };
    merged.containers = Array.isArray(current.containers) ? [...current.containers] : (Array.isArray(fallback?.containers) ? [...fallback.containers] : []);
    merged.sendButtons = Array.isArray(current.sendButtons) ? [...current.sendButtons] : (Array.isArray(fallback?.sendButtons) ? [...fallback.sendButtons] : []);
    merged.editors = Array.isArray(current.editors) ? [...current.editors] : (Array.isArray(fallback?.editors) ? [...fallback.editors] : []);
    merged.stopButtons = Array.isArray(current.stopButtons) ? [...current.stopButtons] : (Array.isArray(fallback?.stopButtons) ? [...fallback.stopButtons] : []);
    merged.buttonsContainerId = current.buttonsContainerId || fallback?.buttonsContainerId || '';
    merged.threadRoot = current.threadRoot || fallback?.threadRoot || '';
    return merged;
}

async function loadSelectors(site) {
    const defaults = (window.InjectionTargetsOnWebsite && typeof window.InjectionTargetsOnWebsite.getDefaultSelectors === 'function')
        ? window.InjectionTargetsOnWebsite.getDefaultSelectors(site)
        : {};
    try {
        const response = await chrome.runtime.sendMessage({ type: 'getCustomSelectors', site });
        if (response?.error) {
            throw new Error(response.error);
        }
        if (!response || !Object.prototype.hasOwnProperty.call(response, 'selectors')) {
            throw new Error('The service worker did not return selector state.');
        }
        const current = response.selectors && typeof response.selectors === 'object'
            ? response.selectors
            : {};
        return { ok: true, selectors: normalizeSelectors(current, defaults) };
    } catch (error) {
        if (typeof logConCgp === 'function') {
            logConCgp('[selector-save] Failed to load custom selectors', error?.message || error);
        }
        return { ok: false, reason: 'loadFailed', error };
    }
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

    const targetKey = type === 'editor' ? 'editors' :
        (type === 'sendButton' ? 'sendButtons' :
            (type === 'stopButton' ? 'stopButtons' :
                (type === 'container' ? 'containers' : null)));
    if (!targetKey) {
        return { ok: false, reason: 'unknownType' };
    }

    if (typeof logConCgp === 'function') {
        logConCgp('[SelectorAutoDetector] Preparing selector save.', { site, type: targetKey, selector });
    }

    const loaded = await loadSelectors(site);
    if (!loaded.ok) {
        return { ok: false, reason: loaded.reason || 'loadFailed' };
    }
    const selectors = loaded.selectors;
    selectors[targetKey] = prependUnique(selector, selectors[targetKey]);

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'saveCustomSelectors',
            site,
            selectors
        });
        if (response?.success !== true) {
            throw new Error(response?.error || 'The service worker rejected the selector save.');
        }
    } catch (error) {
        if (typeof logConCgp === 'function') {
            logConCgp('[selector-save] Failed to persist selector', error?.message || error);
        }
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
