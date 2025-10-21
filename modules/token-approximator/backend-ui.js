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

  function buildTooltip(kind, status, settings) {
    const prefix =
      kind === 'thread'
        ? (settings.threadMode === 'ignoreEditors'
          ? 'Whole-thread tokens (thread only)'
          : 'Whole-thread tokens (with editors)')
        : 'Editor tokens';

    let postfix = '';
    switch (status) {
      case 'loading': postfix = 'calculating.'; break;
      case 'fresh': postfix = 'updated just now'; break;
      case 'stale': postfix = 'stale - click to re-estimate'; break;
      case 'paused': postfix = 'paused while tab inactive'; break;
      default: postfix = ''; break;
    }

    const cta = kind === 'thread'
      ? '  Click to re-estimate now.'
      : '  Click to re-estimate.';

    return `${prefix} - ${postfix}${cta}`;
  }

  function setTooltip(el, kind, status, settings) {
    if (!el) return;
    const next = buildTooltip(kind, status, settings);
    if (el.__tooltipText !== next) {
      el.title = next;
      el.__tooltipText = next;
      el.__tooltipStatus = status;
    }
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

