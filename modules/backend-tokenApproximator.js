// modules/backend-tokenApproximator.js
/* Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS. */
(() => {
  'use strict';
  if (window.__OCP_tokApprox_backend_initDone) return;
  window.__OCP_tokApprox_backend_initDone = true;

  // ---- Guards & site detection ----
  const Site = (window.InjectionTargetsOnWebsite && window.InjectionTargetsOnWebsite.activeSite) || 'Unknown';
  if (Site !== 'ChatGPT') return; // Only ChatGPT supported in this step.

  // Logging helper required by project
  function log(...args) {
    try {
      if (typeof window.logConCgp === 'function') {
        window.logConCgp('[tok-approx]', ...args);
      } else {
        console.log('[tok-approx]', ...args);
      }
    } catch { /* noop */ }
  }

  // ---- Settings load/save bridge ----
  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'getTokenApproximatorSettings' }, (resp) => {
          if (chrome.runtime.lastError) {
            return resolve({
              enabled: false,
              calibration: 1.0,
              threadMode: 'withEditors',
              showEditorCounter: false,
              placement: 'after'
            });
          }
          const s = resp && resp.settings ? resp.settings : {};
          resolve({
            enabled: !!s.enabled,
            calibration: Number.isFinite(s.calibration) && s.calibration > 0 ? Number(s.calibration) : 1.0,
            threadMode: (s.threadMode === 'ignoreEditors' || s.threadMode === 'hide') ? s.threadMode : 'withEditors',
            showEditorCounter: !!s.showEditorCounter,
            placement: s.placement === 'before' ? 'before' : 'after'
          });
        });
      } catch {
        resolve({
          enabled: false,
          calibration: 1.0,
          threadMode: 'withEditors',
          showEditorCounter: false,
          placement: 'after'
        });
      }
    });
  }

  // ---- DOM targets from utils.js ----
  const selectors = (window.InjectionTargetsOnWebsite && window.InjectionTargetsOnWebsite.selectors) || {};
  const THREAD_SELECTOR = selectors.threadRoot || '#thread';
  const BUTTONS_CONTAINER_ID = selectors.buttonsContainerId || 'chatgpt-custom-buttons-container';

  // ---- Mini CSS for counters ----
  const STYLE_ID = 'ocp-token-approx-style';
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
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.documentElement.appendChild(s);
  }

  // ---- UI creation & placement ----
  const WRAP_ID = 'ocp-token-approx-wrap';
  function createUiIfNeeded() {
    ensureStyleOnce();
    let wrap = document.getElementById(WRAP_ID);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = WRAP_ID;
      wrap.className = 'ocp-tokapprox-wrap';
      // Thread chip
      const t = document.createElement('div');
      t.className = 'ocp-tokapprox-chip';
      t.dataset.kind = 'thread';
      t.title = 'Whole-thread tokens — calculating…';
      t.innerHTML = `<span class="lbl">T:</span><span class="val">-------</span>`;
      // Editor chip
      const e = document.createElement('div');
      e.className = 'ocp-tokapprox-chip';
      e.dataset.kind = 'editor';
      e.title = 'Editor tokens — calculating…';
      e.innerHTML = `<span class="lbl">E:</span><span class="val">-------</span>`;

      wrap.appendChild(t);
      wrap.appendChild(e);
    }
    return wrap;
  }

  function placeUi(placement) {
    const wrap = createUiIfNeeded();
    const container = document.getElementById(BUTTONS_CONTAINER_ID);
    if (!container) return;

    // behave nicely in a flex row
    wrap.style.display = 'inline-flex';
    wrap.style.flex = '0 0 auto';
    wrap.style.gap = '8px';
    wrap.style.marginRight = placement === 'before' ? '8px' : '0';
    wrap.style.marginLeft  = placement === 'after'  ? '8px' : '0';

    // move INSIDE the buttons container (not as a sibling)
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
    // Thread visibility
    if (settings.threadMode === 'hide') {
      threadChip.classList.add('ocp-tokapprox-hidden');
    } else {
      threadChip.classList.remove('ocp-tokapprox-hidden');
    }
    // Editor visibility
    if (settings.showEditorCounter) {
      editorChip.classList.remove('ocp-tokapprox-hidden');
    } else {
      editorChip.classList.add('ocp-tokapprox-hidden');
    }
  }

  // ---- Formatting ----
  function formatTokens(est) {
    if (!Number.isFinite(est) || est <= 0) return '-------';
    // For values below 1000, always show "<next 100" (conservative / higher bucket).
    if (est < 1000) {
      const bucket = Math.max(100, Math.ceil(est / 100) * 100);
      return `<${bucket}`;
    }
    // 1000+ -> ceil to thousands as "Nk"
    const k = Math.ceil(est / 1000);
    return `${k}k`;
  }

  // ---- Tooltip helpers (stable prefix + state postfix; no "T:" in tooltip) ----
  function buildTooltip(kind, status, settings) {
    // Descriptive prefix
    const prefix =
      kind === 'thread'
        ? (settings.threadMode === 'ignoreEditors'
            ? 'Whole-thread tokens (thread only)'
            : 'Whole-thread tokens (with editors)')
        : 'Editor tokens';

    // State postfix
    let postfix = '';
    switch (status) {
      case 'loading': postfix = 'calculating…'; break;
      case 'fresh':   postfix = 'updated just now'; break;
      case 'stale':   postfix = 'stale — click to re-estimate'; break;
      case 'paused':  postfix = 'paused while tab inactive'; break;
      default:        postfix = ''; break;
    }
    // CTA: always present on thread; also helpful on editor
    const cta = kind === 'thread' ? ' • Click to re-estimate now.' : ' • Click to re-estimate.';
    return `${prefix} — ${postfix}${cta}`;
  }

  function setTooltip(el, kind, status, settings) {
    const next = buildTooltip(kind, status, settings);
    if (el.__tooltipText !== next) {
      el.title = next;
      el.__tooltipText = next;
      el.__tooltipStatus = status;
    }
  }

  // ---- State visuals ----
  function markFreshThenStale(el, kind, settings) {
    // cancel previous stale timer so multiple updates don't flicker
    if (el.__staleTimer) {
      clearTimeout(el.__staleTimer);
      el.__staleTimer = null;
    }
    // No visual class changes anymore
    setTooltip(el, kind, 'fresh', settings);

    // Still set up timer for tooltip state change
    const STALE_DELAY_MS = kind === 'editor' ? 12000 : 6500;
    el.__staleTimer = setTimeout(() => {
      setTooltip(el, kind, 'stale', settings);
      el.__staleTimer = null;
    }, STALE_DELAY_MS);
  }

  function markLoading(el, kind, settings) {
    // No class toggling; keep tooltip update
    setTooltip(el, kind, 'loading', settings);
  }

  function markPaused(el, kind, settings) {
    // No class toggling; keep tooltip update
    setTooltip(el, kind, 'paused', settings);
  }

  // ---- Worker (off-main-thread) ----
  function createEstimatorWorker() {
    const workerCode = `
      self.onmessage = (e) => {
        try {
          const { texts, scale, countingMethod } = e.data || {};
          const out = {};
          for (const key of Object.keys(texts || {})) {
            out[key] = estimate(texts[key] || '', scale, countingMethod);
          }
          self.postMessage({ ok: true, estimates: out });
        } catch (err) {
          self.postMessage({ ok: false, error: (err && err.message) || String(err) });
        }
      };

      function estimate(rawInput, scaleIn, countingMethod = 'advanced') {
        const scale = Number.isFinite(scaleIn) && scaleIn > 0 ? scaleIn : 1.0;
        const raw = String(rawInput || '');
        const text = raw.replace(/\\s+/g, ' ').trim();
        const normChars = text.length;
        
        // Simple heuristic mode: 1 token = 4 characters
        if (countingMethod === 'simple') {
          return Math.round((normChars / 4) * scale);
        }
        
        // Advanced mode - original algorithm
        // --- Adapted from provided script to work on TEXT only ---
        const CFG = {
          wordsDivisor: 0.75,
          cptBase: 4.9,
          cptCodeBump: 1.0,
          cptCjkBump: 0.7,
          cptSpaceBump: 0.5,
          weights: { default:[2,1], code:[2,1], cjk:[1,3] },
          capPct: 0.12
        };

        // Words
        let wordsOnly = 0;
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
          const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
          for (const s of seg.segment(text)) if (s.isWordLike) wordsOnly++;
        } else {
          const m = text.match(/\\p{L}[\\p{L}\\p{M}\\p{N}_'-]*|\\p{N}+/gu);
          wordsOnly = m ? m.length : 0;
        }

        // Features
        const codeSymbols = (text.match(/[{}\\[\\]();:.,=+\\-*/<>|&]/g) || []).length;
        const codeWords = (text.match(/\\b[A-Za-z]*[A-Z][a-z]+[A-Za-z]*\\b|[_$][A-Za-z0-9_$]*|[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+/g) || []).length;
        const codeRatio = Math.min(1, (codeSymbols + 0.5*codeWords) / Math.max(1, wordsOnly + codeSymbols));
        const spaces = (text.match(/ /g) || []).length;
        const whitespaceRatio = spaces / Math.max(1, normChars);
        const cjkCount = (text.match(/[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]/gu) || []).length;
        const cjkRatio = cjkCount / Math.max(1, normChars);

        // Models
        const tokens_by_words_raw = Math.round(wordsOnly / CFG.wordsDivisor);
        const cpt =
          CFG.cptBase +
          CFG.cptCodeBump * codeRatio +
          CFG.cptCjkBump  * cjkRatio +
          CFG.cptSpaceBump * whitespaceRatio;
        const tokens_by_chars_raw = Math.round(normChars / Math.max(3.8, cpt));

        // Blend weights
        let [wW, wC] = CFG.weights.default;
        if (cjkRatio > 0.15) [wW, wC] = CFG.weights.cjk;
        else if (codeRatio > 0.30) [wW, wC] = CFG.weights.code;

        // Cap divergence
        const hiCap = Math.round(tokens_by_chars_raw * (1 + CFG.capPct));
        const loCap = Math.round(tokens_by_chars_raw * (1 - CFG.capPct));
        const words_capped = Math.max(loCap, Math.min(hiCap, tokens_by_words_raw));

        // Final est with calibration
        const est = Math.round(((words_capped*wW + tokens_by_chars_raw*wC) / (wW+wC)) * scale);
        return est;
      }
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }

  // ---- Snapshot helpers (keep DOM work light; heavy regex goes to worker) ----
  const EDITOR_SELECTOR = '[contenteditable="true"],textarea,input:not([type="hidden"])';

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility !== 'visible' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return !!(r.width || r.height);
  }

  function getThreadRoot() {
    return document.querySelector(THREAD_SELECTOR);
  }

  function getThreadText() {
    const root = getThreadRoot();
    if (!root) return '';
    // innerText respects visibility & layout; good enough and fast to snapshot.
    try { return root.innerText || ''; } catch { return root.textContent || ''; }
  }

  function listEditors() {
    return Array.from(document.querySelectorAll(EDITOR_SELECTOR))
      .filter(el => isVisible(el));
  }

  function editorsText() {
    const parts = [];
    for (const el of listEditors()) {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        parts.push(el.value || '');
      } else {
        parts.push(el.innerText || el.textContent || '');
      }
    }
    return parts.join('\n');
  }

  // ---- Schedulers: separate for thread and editor ----
  function makeScheduler({ runFn, minCooldown = 1000 }) {
    let dirty = false;
    let running = false;
    let lastRun = 0;
    let scheduled = false;

    function schedule(leading = false) {
      if (document.visibilityState !== 'visible') return; // active tab only
      const now = Date.now();
      if (leading && !running && now - lastRun > minCooldown) {
        tick();
        return;
      }
      if (scheduled) return;
      scheduled = true;
      const cb = () => {
        scheduled = false;
        const since = Date.now() - lastRun;
        if (since < minCooldown) {
          setTimeout(() => schedule(false), minCooldown - since);
          return;
        }
        if (dirty && !running) tick();
      };
      if ('requestIdleCallback' in window) {
        requestIdleCallback(cb, { timeout: minCooldown + 200 });
      } else {
        requestAnimationFrame(cb);
      }
    }

    async function tick() {
      if (running) return;
      running = true;
      dirty = false;
      lastRun = Date.now();
      try {
        await runFn();
      } finally {
        running = false;
      }
    }

    return {
      markDirty() { dirty = true; schedule(false); },
      runNow() { if (!running) { dirty = true; schedule(true); } },
      // Only clicking should bypass cooldown:
      // expose an explicit forceNow() used exclusively by the click handler.
      forceNow() {
        if (running) { dirty = true; return; }
        dirty = true;
        lastRun = 0; // ensures schedule(true) runs immediately
        schedule(true);
      },
      pauseInfo() { return { running }; }
    };
  }

  // ---- Main init ----
  (async () => {
    const settings = await loadSettings();
    if (!settings.enabled) return;

    // One-time log line per spec (parameters only)
    log(`Loaded (site=${Site}) with`, {
      calibration: settings.calibration,
      threadMode: settings.threadMode,
      showEditorCounter: settings.showEditorCounter,
      placement: settings.placement,
      threadSelector: THREAD_SELECTOR,
      countingMethod: settings.countingMethod
    });

    // Ensure UI exists and placed
    const waitForButtons = () => new Promise(resolve => {
      const existing = document.getElementById(BUTTONS_CONTAINER_ID);
      if (existing) return resolve(existing);
      const obs = new MutationObserver(() => {
        const el = document.getElementById(BUTTONS_CONTAINER_ID);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    });

    await waitForButtons();
    placeUi(settings.placement);
    showHideBySettings(settings);

    // We'll use a more comprehensive observer defined below

    // Update title hints initially
    const wrap = createUiIfNeeded();
    const threadChip = wrap.querySelector('.ocp-tokapprox-chip[data-kind="thread"]');
    const editorChip = wrap.querySelector('.ocp-tokapprox-chip[data-kind="editor"]');
    // Initialize tooltips to descriptive "loading"
    try {
      setTooltip(threadChip, 'thread', 'loading', settings);
      setTooltip(editorChip, 'editor', 'loading', settings);
    } catch {}

    // Worker shared for both schedulers
    const worker = createEstimatorWorker();

    function estimateAndPaint(mode) {
      return new Promise((resolve) => {
        // ----- Query for elements inside the callback for resilience -----
        const wrap = document.getElementById(WRAP_ID);
        if (!wrap) return resolve();
        const threadChip = wrap.querySelector('.ocp-tokapprox-chip[data-kind="thread"]');
        const editorChip = wrap.querySelector('.ocp-tokapprox-chip[data-kind="editor"]');
        // ----- End query -----

        worker.onmessage = (ev) => {
          // Re-query elements inside the async callback to ensure they are fresh
          const currentWrap = document.getElementById(WRAP_ID);
          if (!currentWrap) return resolve();
          const currentThreadChip = currentWrap.querySelector('.ocp-tokapprox-chip[data-kind="thread"]');
          const currentEditorChip = currentWrap.querySelector('.ocp-tokapprox-chip[data-kind="editor"]');
          if (!currentThreadChip || !currentEditorChip) return resolve();

          const { ok, estimates } = ev.data || {};
          if (!ok || !estimates) return resolve();
          // Paint Thread chip
          if (settings.threadMode !== 'hide') {
            const use = (settings.threadMode === 'ignoreEditors') ? estimates.threadOnly : estimates.all;
            currentThreadChip.querySelector('.val').textContent = formatTokens(use);
            markFreshThenStale(currentThreadChip, 'thread', settings);
          }
          // Paint Editor chip (if visible)
          if (settings.showEditorCounter) {
            currentEditorChip.querySelector('.val').textContent = formatTokens(estimates.editorsOnly);
            markFreshThenStale(currentEditorChip, 'editor', settings);
          }
          resolve();
        };
        // Set loading state
        if (threadChip && settings.threadMode !== 'hide') {
          markLoading(threadChip, 'thread', settings);
        }
        if (editorChip && settings.showEditorCounter) {
          markLoading(editorChip, 'editor', settings);
        }

        const rootTxt = getThreadText();
        const edTxt = editorsText();
        const texts = {
          all: `${rootTxt}\n${edTxt}`.trim(),
          threadOnly: rootTxt,
          editorsOnly: edTxt
        };
        worker.postMessage({
          texts,
          scale: settings.calibration,
          countingMethod: settings.countingMethod
        });
      });
    }

    // Thread scheduler (mutations + scroll + visibility)
    const threadScheduler = makeScheduler({
      minCooldown: 15000, // Reduced from 15000 for better responsiveness on change
      runFn: () => estimateAndPaint('thread')
    });
    
    // Replace the simple observer with one that can re-create the UI
    const keepInRow = new MutationObserver(() => {
      const container = document.getElementById(BUTTONS_CONTAINER_ID);
      if (!container) return; // Not an error, page might be changing

      const wrap = document.getElementById(WRAP_ID);

      if (!wrap) {
        // UI is missing, re-create and place it.
        log('Token Approximator UI is missing, re-injecting.');
        placeUi(settings.placement);
        showHideBySettings(settings);
        // Force an immediate calculation to populate the new UI.
        threadScheduler.forceNow();
        editorScheduler.forceNow();
      } else if (!container.contains(wrap)) {
        // UI exists but is detached, just move it back.
        log('Token Approximator UI is misplaced, re-attaching.');
        placeUi(settings.placement);
      }
    });
    keepInRow.observe(document.documentElement, { childList: true, subtree: true });
    // Editor scheduler (typing + lifecycle)
    const editorScheduler = makeScheduler({
      minCooldown: 600, // faster editor updates
      runFn: () => estimateAndPaint('editor')
    });

    // Event wiring
    const threadRoot = getThreadRoot();
    if (threadRoot) {
      const mo = new MutationObserver(() => { threadScheduler.markDirty(); editorScheduler.markDirty(); });
      mo.observe(threadRoot, { childList: true, characterData: true, subtree: true });
      // Scroll on container & window (virtualization)
      const scrollTarget = threadRoot.closest('[class*="overflow"],[class*="scroll"],main,body') || window;
      (scrollTarget === window ? window : scrollTarget).addEventListener('scroll', () => {
        threadScheduler.markDirty();
      }, { passive: true });
    }

    // Editors lifecycle: on any DOM change, rediscover
    const moAll = new MutationObserver(() => { editorScheduler.markDirty(); });
    moAll.observe(document.documentElement, { childList: true, subtree: true });

    // Typing
    document.addEventListener('input', (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      if (t.matches(EDITOR_SELECTOR)) editorScheduler.markDirty();
    }, true);

    // Visibility control
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (settings.threadMode !== 'hide') {
          markLoading(threadChip, 'thread', settings);
          threadScheduler.runNow(); // respects cooldown
        }
        if (settings.showEditorCounter) {
          markLoading(editorChip, 'editor', settings);
          editorScheduler.runNow(); // respects cooldown
        }
      } else {
        if (settings.threadMode !== 'hide') markPaused(threadChip, 'thread', settings);
        if (settings.showEditorCounter) markPaused(editorChip, 'editor', settings);
      }
    });

    // Safety ticks (cooldown-aware)
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      threadScheduler.markDirty();
      editorScheduler.markDirty();
    }, 45000);

    // Click-to-refresh (debounced by scheduler)
    // Use a delegated listener on document for resilience against UI re-creation
    document.addEventListener('click', (e) => {
      const el = e.target.closest(`#${WRAP_ID} .ocp-tokapprox-chip`);
      if (!el) return; // Click was not on one of our chips

      // el is now confirmed to be one of our chips
      if (el.dataset.kind === 'thread' && settings.threadMode !== 'hide') {
        markLoading(el, 'thread', settings);
        threadScheduler.forceNow();
      } else if (el.dataset.kind === 'editor' && settings.showEditorCounter) {
        markLoading(el, 'editor', settings);
        editorScheduler.forceNow();
      }
    }, true); // Use capture phase to handle click before other listeners

    // First run
    if (settings.threadMode !== 'hide') threadScheduler.runNow();
    if (settings.showEditorCounter) editorScheduler.runNow();

    // React to settings changes live
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || msg.type !== 'tokenApproximatorSettingsChanged' || !msg.settings) return;
        Object.assign(settings, {
          enabled: !!msg.settings.enabled,
          calibration: Number.isFinite(msg.settings.calibration) && msg.settings.calibration > 0 ? Number(msg.settings.calibration) : settings.calibration,
          threadMode: (msg.settings.threadMode === 'ignoreEditors' || msg.settings.threadMode === 'hide') ? msg.settings.threadMode : 'withEditors',
          showEditorCounter: !!msg.settings.showEditorCounter,
          placement: msg.settings.placement === 'before' ? 'before' : 'after',
          countingMethod: msg.settings.countingMethod === 'simple' ? 'simple' : 'advanced'
        });
        placeUi(settings.placement);
        showHideBySettings(settings);
        // Refresh tooltip prefixes (thread mode may have changed)
        try {
          setTooltip(threadChip, 'thread', threadChip.__tooltipStatus || 'stale', settings);
          setTooltip(editorChip, 'editor', editorChip.__tooltipStatus || 'stale', settings);
        } catch {}
        // Refresh on change
        if (settings.threadMode !== 'hide') threadScheduler.runNow();
        if (settings.showEditorCounter) editorScheduler.runNow();
      });
    } catch { /* noop */ }
  })();
})();