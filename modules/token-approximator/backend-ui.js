// modules/token-approximator/backend-ui.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// UI helpers for the Token Approximator backend script.

(() => {
  'use strict';

  if (window.OCPTokenApproxUI) {
    return;
  }

  const STYLE_ID = 'ocp-token-approx-style';
  const WRAP_ID = 'ocp-token-approx-wrap';
  const CSS = `
  .ocp-tokapprox-wrap{display:flex;gap:8px;align-items:center;flex-wrap:wrap;
    font:600 12px/1.1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif}
  .ocp-tokapprox-chip{
    user-select:none;cursor:pointer;border-radius:12px;padding:4px 8px;
    background:var(--ocp-chip-bg,rgba(127,127,127,.08));
    box-shadow:inset 0 0 0 1px rgba(0,0,0,.08);
  }
  .ocp-tokapprox-chip .lbl{opacity:.8;margin-right:4px}
  .ocp-tokapprox-chip .val{letter-spacing:.2px}
  @keyframes ocpTokApproxSpin{to{transform:rotate(1turn)}}
  .ocp-tokapprox-chip.ocp-tokapprox-loading .val{
    display:inline-flex;align-items:center;justify-content:center;
    width:32px;height:12px;letter-spacing:0;font-size:0;vertical-align:-2px
  }
  .ocp-tokapprox-chip.ocp-tokapprox-loading .val::before{
    content:"";box-sizing:border-box;width:10px;height:10px;
    border:2px solid currentColor;border-right-color:transparent;border-radius:50%;
    animation:ocpTokApproxSpin .75s linear infinite;opacity:.85
  }
  @media (prefers-reduced-motion: reduce){
    .ocp-tokapprox-chip.ocp-tokapprox-loading .val::before{
      animation:none;border-right-color:currentColor;opacity:.55
    }
  }
  .ocp-tokapprox-hidden{display:none !important}
  `;

  function ensureStyleOnce() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.documentElement.appendChild(style);
  }

  function createUiIfNeeded() {
    ensureStyleOnce();
    let wrap = document.getElementById(WRAP_ID);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = WRAP_ID;
      wrap.className = 'ocp-tokapprox-wrap';

      const threadChip = document.createElement('div');
      threadChip.className = 'ocp-tokapprox-chip';
      threadChip.dataset.kind = 'thread';
      threadChip.title = 'Whole-thread tokens - calculating.';
      threadChip.innerHTML = '<span class="lbl">T:</span><span class="val">-------</span>';

      const editorChip = document.createElement('div');
      editorChip.className = 'ocp-tokapprox-chip';
      editorChip.dataset.kind = 'editor';
      editorChip.title = 'Editor tokens - calculating.';
      editorChip.innerHTML = '<span class="lbl">E:</span><span class="val">-------</span>';

      wrap.appendChild(threadChip);
      wrap.appendChild(editorChip);
    }
    return wrap;
  }

  function getChip(kind) {
    const wrap = createUiIfNeeded();
    return wrap.querySelector(`.ocp-tokapprox-chip[data-kind="${kind}"]`);
  }

  function placeUi(placement, buttonsContainerId) {
    const wrap = createUiIfNeeded();
    const container = document.getElementById(buttonsContainerId);
    if (!container) return;

    wrap.style.display = 'inline-flex';
    wrap.style.flex = '0 0 auto';
    wrap.style.gap = '8px';
    wrap.style.marginRight = placement === 'before' ? '8px' : '0';
    wrap.style.marginLeft = placement === 'after' ? '8px' : '0';

    if (placement === 'before') {
      if (wrap.parentElement !== container || wrap !== container.firstChild) {
        container.insertAdjacentElement('afterbegin', wrap);
      }
    } else {
      if (wrap.parentElement !== container || wrap !== container.lastElementChild) {
        container.insertAdjacentElement('beforeend', wrap);
      }
    }
  }

  function showHideBySettings(settings) {
    const wrap = createUiIfNeeded();
    const threadChip = wrap.querySelector('.ocp-tokapprox-chip[data-kind="thread"]');
    const editorChip = wrap.querySelector('.ocp-tokapprox-chip[data-kind="editor"]');
    if (!threadChip || !editorChip) {
      return;
    }

    if (settings.threadMode === 'hide') {
      threadChip.classList.add('ocp-tokapprox-hidden');
    } else {
      threadChip.classList.remove('ocp-tokapprox-hidden');
    }

    if (settings.showEditorCounter) {
      editorChip.classList.remove('ocp-tokapprox-hidden');
    } else {
      editorChip.classList.add('ocp-tokapprox-hidden');
    }
  }

  function formatTokens(est) {
    if (!Number.isFinite(est) || est <= 0) return '-------';
    if (est < 1000) {
      const bucket = Math.max(100, Math.ceil(est / 100) * 100);
      return `<${bucket}`;
    }
    const k = Math.ceil(est / 1000);
    return `${k}k`;
  }

  function getCountingMethodLabel(settings) {
    const requestedId = settings?.countingMethod || window.OCP_TOKEN_MODEL_DEFAULT_ID || 'ultralight-state-machine';
    const helpers = window.OCPTokenApproxHelpers || null;
    const catalog = helpers?.getCatalog?.() || window.OCP_TOKEN_MODEL_CATALOG || null;
    const resolvedId = helpers?.resolveModelId?.(requestedId) ||
      catalog?.legacyMethodMap?.[requestedId] ||
      requestedId;
    const metadata = catalog?.getModelMetadata?.(resolvedId) ||
      catalog?.metadataById?.[resolvedId] ||
      null;
    return metadata?.shortName || metadata?.name || resolvedId || requestedId;
  }

  function buildTooltip(kind, status, settings) {
    const site = window.InjectionTargetsOnWebsite?.activeSite || '';
    const prefix =
      kind === 'thread'
        ? (settings.threadMode === 'ignoreEditors'
          ? 'Whole-thread tokens (thread only)'
          : 'Whole-thread tokens (with editors)')
        : 'Editor tokens';

    let postfix = '';
    switch (status) {
      case 'loading': postfix = 'calculating'; break;
      case 'warming': postfix = 'warming ChatGPT cache - scroll slowly through the thread'; break;
      case 'partial': postfix = 'partial - loaded messages only'; break;
      case 'fresh': postfix = 'updated just now'; break;
      case 'stale': postfix = 'stale - click to re-estimate'; break;
      case 'paused': postfix = 'paused while tab inactive'; break;
      default: postfix = ''; break;
    }

    const cta = kind === 'thread' && site === 'ChatGPT'
      ? ' Click to scan the loaded ChatGPT thread and re-estimate.'
      : (kind === 'thread' ? ' Click to re-estimate now.' : ' Click to re-estimate.');

    const virtualizedHint = kind === 'thread' && site === 'ChatGPT'
      ? ' ChatGPT may unload older messages; scroll through the thread to let OneClickPrompts cache and count more of it.'
      : '';
    const method = ` Method: ${getCountingMethodLabel(settings)}.`;

    return `${prefix} - ${postfix}.${method}${cta}${virtualizedHint}`;
  }

  function setTooltip(el, kind, status, settings) {
    if (!el) return;
    setLoadingVisual(el, status === 'loading');
    const next = buildTooltip(kind, status, settings);
    if (el.__tooltipText !== next) {
      el.title = next;
      el.setAttribute('data-ocp-tooltip', next);
      try {
        window.OCPTooltip?.updateText?.(el, next);
      } catch {
        /* noop */
      }
      el.__tooltipText = next;
      el.__tooltipStatus = status;
    }
  }

  function setLoadingVisual(el, isLoading) {
    el.classList.toggle('ocp-tokapprox-loading', isLoading);
    if (isLoading) {
      el.setAttribute('aria-busy', 'true');
      el.setAttribute('aria-live', 'polite');
      return;
    }
    el.removeAttribute('aria-busy');
  }

  function markFreshThenStale(el, kind, settings) {
    if (!el) return;
    if (el.__staleTimer) {
      clearTimeout(el.__staleTimer);
      el.__staleTimer = null;
    }
    setTooltip(el, kind, 'fresh', settings);
    const delay = kind === 'editor' ? 12000 : 6500;
    el.__staleTimer = setTimeout(() => {
      setTooltip(el, kind, 'stale', settings);
      el.__staleTimer = null;
    }, delay);
  }

  function markLoading(el, kind, settings) {
    if (!el) return;
    if (el.__staleTimer) {
      clearTimeout(el.__staleTimer);
      el.__staleTimer = null;
    }
    setTooltip(el, kind, 'loading', settings);
  }

  function markPaused(el, kind, settings) {
    if (!el) return;
    setTooltip(el, kind, 'paused', settings);
  }

  window.OCPTokenApproxUI = Object.freeze({
    STYLE_ID,
    WRAP_ID,
    ensureStyleOnce,
    createUiIfNeeded,
    getChip,
    placeUi,
    showHideBySettings,
    formatTokens,
    buildTooltip,
    setTooltip,
    markFreshThenStale,
    markLoading,
    markPaused
  });
})();
