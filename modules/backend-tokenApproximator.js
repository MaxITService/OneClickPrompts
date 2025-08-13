// modules/backend-tokenApproximator.js
/* Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS. */
(() => {
  'use strict';
  if (window.__OCP_tokApprox_backend_initDone) return;
  window.__OCP_tokApprox_backend_initDone = true;

  // ---- Guards & site detection ----
  const Site = (window.InjectionTargetsOnWebsite && window.InjectionTargetsOnWebsite.activeSite) || 'Unknown';

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
              showEditorCounter: true,
              placement: 'before',
              countingMethod: 'ultralight-state-machine', // Default to ultralight
              enabledSites: {
                'ChatGPT': true,
                'Claude': true,
                'Copilot': true,
                'DeepSeek': true,
                'AIStudio': true,
                'Grok': true,
                'Gemini': true
              }
            });
          }
          const s = resp && resp.settings ? resp.settings : {};
          
          // Default enabled sites if not provided
          const defaultEnabledSites = {
            'ChatGPT': true,
            'Claude': true,
            'Copilot': true,
            'DeepSeek': true,
            'AIStudio': true,
            'Grok': true,
            'Gemini': true
          };
          
          // Use provided enabledSites if exists, otherwise use defaults
          const enabledSites = s.enabledSites && typeof s.enabledSites === 'object'
            ? s.enabledSites
            : defaultEnabledSites;
          
          resolve({
            calibration: Number.isFinite(s.calibration) && s.calibration > 0 ? Number(s.calibration) : 1.0,
            enabled: !!s.enabled,
            threadMode: (s.threadMode === 'ignoreEditors' || s.threadMode === 'hide') ? s.threadMode : 'withEditors',
            showEditorCounter: typeof s.showEditorCounter === 'boolean' ? s.showEditorCounter : true,
            placement: s.placement === 'after' ? 'after' : 'before',
            countingMethod: s.countingMethod || 'ultralight-state-machine', // Default to ultralight
            enabledSites
          });
        });
      } catch {
        resolve({
          enabled: false,
          calibration: 1.0,
          threadMode: 'withEditors',
          showEditorCounter: false,
          placement: 'after',
          countingMethod: 'ultralight-state-machine',
          enabledSites: {
            'ChatGPT': true,
            'Claude': true,
            'Copilot': true,
            'DeepSeek': true,
            'AIStudio': true,
            'Grok': true,
            'Gemini': true
          }
        });
      }
    });
  }

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

  function placeUi(placement, buttonsContainerId) {
    const wrap = createUiIfNeeded();
    const container = document.getElementById(buttonsContainerId);
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

  // ---- Worker (off-main-thread) with models ----
  function createEstimatorWorker() {
    // Include the model base, registry, and all implementations directly in the worker
    const workerCode = `
      // ----- Model Base -----
      class TokenCountingModelBase {
        constructor() {
          if (this.constructor === TokenCountingModelBase) {
            throw new Error('TokenCountingModelBase is abstract and cannot be instantiated directly');
          }
        }
      
        getMetadata() {
          throw new Error('getMetadata() must be implemented by subclass');
        }
      
        estimate(text, calibration = 1.0) {
          throw new Error('estimate() must be implemented by subclass');
        }
      
        normalizeText(rawInput) {
          const text = String(rawInput || '').replace(/\\s+/g, ' ').trim();
          return text;
        }
      
        applyCalibration(tokens, calibration) {
          const scale = Number.isFinite(calibration) && calibration > 0 ? calibration : 1.0;
          return Math.round(tokens * scale);
        }
      }

      // ----- Registry -----
      class TokenModelRegistry {
        constructor() {
          this.models = new Map();
          this.defaultModelId = 'ultralight-state-machine';
        }
      
        register(modelInstance) {
          if (!modelInstance || typeof modelInstance.getMetadata !== 'function') {
            throw new Error('Model must implement getMetadata() method');
          }
          if (typeof modelInstance.estimate !== 'function') {
            throw new Error('Model must implement estimate() method');
          }
      
          const metadata = modelInstance.getMetadata();
          if (!metadata.id || typeof metadata.id !== 'string') {
            throw new Error('Model metadata must include a valid string id');
          }
      
          this.models.set(metadata.id, modelInstance);
        }
      
        getModel(modelId) {
          return this.models.get(modelId) || null;
        }
      
        getDefaultModel() {
          return this.getModel(this.defaultModelId) || this.models.values().next().value;
        }
      
        getAllModels() {
          return Array.from(this.models.values());
        }
      
        getAllMetadata() {
          return this.getAllModels().map(model => model.getMetadata());
        }
      
        hasModel(modelId) {
          return this.models.has(modelId);
        }
      
        mapLegacyMethod(legacyMethod) {
          const mapping = {
            'simple': 'simple',
            'advanced': 'advanced'
          };
          return mapping[legacyMethod] || this.defaultModelId;
        }
      
        resolveModelId(countingMethod) {
          // If it's already a valid model ID, return it
          if (this.hasModel(countingMethod)) {
            return countingMethod;
          }
          
          // Try to map from legacy method
          const mappedId = this.mapLegacyMethod(countingMethod);
          if (this.hasModel(mappedId)) {
            return mappedId;
          }
          
          // Fallback to default
          return this.defaultModelId;
        }
      
        setDefaultModel(modelId) {
          if (!this.hasModel(modelId)) {
            throw new Error(\`Model '\${modelId}' is not registered\`);
          }
          this.defaultModelId = modelId;
        }
      }

      // ----- Simple Model -----
      class SimpleTokenModel {
        getMetadata() {
          return {
            id: 'simple',
            name: '1 word is 4 tokens',
            shortName: 'Simple (1:4)',
            description: 'Simple approximation: 1 token ≈ 4 characters'
          };
        }
      
        estimate(rawInput, calibration = 1.0) {
          const text = this.normalizeText(rawInput);
          const charCount = text.length;
          
          // Simple heuristic: 1 token = 4 characters
          const rawTokens = Math.max(0, Math.round(charCount / 4));
          
          return this.applyCalibration(rawTokens, calibration);
        }
      
        normalizeText(rawInput) {
          const text = String(rawInput || '').replace(/\\s+/g, ' ').trim();
          return text;
        }
      
        applyCalibration(tokens, calibration) {
          const scale = Number.isFinite(calibration) && calibration > 0 ? calibration : 1.0;
          return Math.round(tokens * scale);
        }
      }

      // ----- Advanced Model -----
      class AdvancedTokenModel {
        getMetadata() {
          return {
            id: 'advanced',
            name: 'Advanced heuristics',
            shortName: 'Advanced',
            description: 'Uses intelligent heuristics that adapt to different content types'
          };
        }
      
        estimate(rawInput, calibration = 1.0) {
          const text = this.normalizeText(rawInput);
          const normChars = text.length;
          
          if (!normChars) return 0;
      
          const CFG = {
            wordsDivisor: 0.75,
            cptBase: 4.9,
            cptCodeBump: 1.0,
            cptCjkBump: 0.7,
            cptSpaceBump: 0.5,
            weights: { default: [2, 1], code: [2, 1], cjk: [1, 3] },
            capPct: 0.12
          };
      
          // Words count using Intl.Segmenter or regex fallback
          let wordsOnly = 0;
          if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
            for (const s of seg.segment(text)) {
              if (s.isWordLike) wordsOnly++;
            }
          } else {
            const m = text.match(/\\p{L}[\\p{L}\\p{M}\\p{N}_'-]*|\\p{N}+/gu);
            wordsOnly = m ? m.length : 0;
          }
      
          // Feature detection
          const codeSymbols = (text.match(/[{}\\[\\]();:.,=+\\-*/<>|&]/g) || []).length;
          const codeWords = (text.match(/\\b[A-Za-z]*[A-Z][a-z]+[A-Za-z]*\\b|[_$][A-Za-z0-9_$]*|[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+/g) || []).length;
          const codeRatio = Math.min(1, (codeSymbols + 0.5 * codeWords) / Math.max(1, wordsOnly + codeSymbols));
          
          const spaces = (text.match(/ /g) || []).length;
          const whitespaceRatio = spaces / Math.max(1, normChars);
          
          const cjkCount = (text.match(/[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]/gu) || []).length;
          const cjkRatio = cjkCount / Math.max(1, normChars);
      
          // Token estimates
          const tokens_by_words_raw = Math.round(wordsOnly / CFG.wordsDivisor);
          const cpt = CFG.cptBase + CFG.cptCodeBump * codeRatio + CFG.cptCjkBump * cjkRatio + CFG.cptSpaceBump * whitespaceRatio;
          const tokens_by_chars_raw = Math.round(normChars / Math.max(3.8, cpt));
      
          // Blend weights selection
          let [wW, wC] = CFG.weights.default;
          if (cjkRatio > 0.15) [wW, wC] = CFG.weights.cjk;
          else if (codeRatio > 0.30) [wW, wC] = CFG.weights.code;
      
          // Cap divergence
          const hiCap = Math.round(tokens_by_chars_raw * (1 + CFG.capPct));
          const loCap = Math.round(tokens_by_chars_raw * (1 - CFG.capPct));
          const words_capped = Math.max(loCap, Math.min(hiCap, tokens_by_words_raw));
      
          // Final estimate
          const est = Math.round((words_capped * wW + tokens_by_chars_raw * wC) / (wW + wC));
          
          return this.applyCalibration(est, calibration);
        }
      
        normalizeText(rawInput) {
          const text = String(rawInput || '').replace(/\\s+/g, ' ').trim();
          return text;
        }
      
        applyCalibration(tokens, calibration) {
          const scale = Number.isFinite(calibration) && calibration > 0 ? calibration : 1.0;
          return Math.round(tokens * scale);
        }
      }

      // ----- CPT Blend Mix Model -----
      class CptBlendMixTokenModel {
        getMetadata() {
          return {
            id: 'cpt-blend-mix',
            name: 'CPT Blend/Mix',
            shortName: 'Blend/Mix',
            description: 'Sometimes best accuracy, sometimes off. 70% slower than Ultralight state machine.'
          };
        }
      
        estimate(rawInput, calibration = 1.0) {
          const text = this.normalizeText(rawInput);
          if (!text.length) return 0;
      
          const CFG = {
            wordsDivisor: 0.75,
            cptBase: 4.0,
            cjkCPT: 1.0,
            codeCPT: 3.0,
            weights: { default: [2, 1], code: [2, 1], cjk: [1, 3] },
            capPct: 0.12
          };
      
          const normChars = text.length;
      
          // Words count using Intl.Segmenter or regex fallback
          let wordsOnly = 0;
          if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
            for (const s of seg.segment(text)) {
              if (s.isWordLike) wordsOnly++;
            }
          } else {
            const m = text.match(/\\p{L}[\\p{L}\\p{M}\\p{N}_'-]*|\\p{N}+/gu);
            wordsOnly = m ? m.length : 0;
          }
      
          // Code & CJK features
          const codeSymbols = (text.match(/[{}\\[\\]();:.,=+\\-*/<>|&]/g) || []).length;
          const codeWords = (text.match(/\\b[A-Za-z]*[A-Z][a-z]+[A-Za-z]*\\b|[_$][A-Za-z0-9_$]*|[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+/g) || []).length;
          let codeRatio = Math.min(1, (codeSymbols + 0.5 * codeWords) / Math.max(1, wordsOnly + codeSymbols));
      
          const cjkCount = (text.match(/[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]/gu) || []).length;
          let cjkRatio = cjkCount / Math.max(1, normChars);
      
          let otherRatio = 1 - cjkRatio - codeRatio;
          if (otherRatio < 0) {
            const total = cjkRatio + codeRatio;
            if (total > 0) {
              cjkRatio /= total;
              codeRatio /= total;
            } else {
              cjkRatio = 0;
              codeRatio = 0;
            }
            otherRatio = 0;
          }
      
          const tokens_by_words_raw = Math.round(wordsOnly / CFG.wordsDivisor);
          const cpt = CFG.cptBase * otherRatio + CFG.cjkCPT * cjkRatio + CFG.codeCPT * codeRatio;
          const tokens_by_chars_raw = Math.round(normChars / Math.max(1e-9, cpt));
      
          // Choose weights
          let [wW, wC] = CFG.weights.default;
          if (cjkRatio > 0.15) [wW, wC] = CFG.weights.cjk;
          else if (codeRatio > 0.30) [wW, wC] = CFG.weights.code;
      
          // Cap divergence
          const hiCap = Math.round(tokens_by_chars_raw * (1 + CFG.capPct));
          const loCap = Math.round(tokens_by_chars_raw * (1 - CFG.capPct));
          const words_capped = Math.max(loCap, Math.min(hiCap, tokens_by_words_raw));
      
          const tokens_raw = (words_capped * wW + tokens_by_chars_raw * wC) / (wW + wC);
          const finalTokens = Math.round(tokens_raw);
      
          return this.applyCalibration(finalTokens, calibration);
        }
      
        normalizeText(rawInput) {
          const text = String(rawInput || '').replace(/\\s+/g, ' ').trim();
          return text;
        }
      
        applyCalibration(tokens, calibration) {
          const scale = Number.isFinite(calibration) && calibration > 0 ? calibration : 1.0;
          return Math.round(tokens * scale);
        }
      }

      // ----- Single Regex Pass Model -----
      class SingleRegexPassTokenModel {
        constructor() {
          // Single regex to match all token-like patterns
          this.TOKEN_REGEX = /\\p{L}+|\\p{N}+|\\p{sc=Han}|\\p{sc=Hiragana}|\\p{sc=Katakana}|\\p{sc=Hangul}|[^\\s\\p{L}\\p{N}]/gu;
        }
      
        getMetadata() {
          return {
            id: 'single-regex-pass',
            name: 'Single regex model',
            shortName: 'Single Regex',
            description: 'Seems to be most accurate. single-regex model. 30% slower than Ultralight state machine.'
          };
        }
      
        estimate(rawInput, calibration = 1.0) {
          const text = this.normalizeText(rawInput);
          if (!text.length) return 0;
      
          // Single pass regex matching
          const matches = text.match(this.TOKEN_REGEX);
          const rawTokens = matches ? matches.length : 0;
      
          return this.applyCalibration(rawTokens, calibration);
        }
      
        normalizeText(rawInput) {
          const text = String(rawInput || '').replace(/\\s+/g, ' ').trim();
          return text;
        }
      
        applyCalibration(tokens, calibration) {
          const scale = Number.isFinite(calibration) && calibration > 0 ? calibration : 1.0;
          return Math.round(tokens * scale);
        }
      }

      // ----- Ultralight State Machine Model -----
      class UltralightStateMachineTokenModel {
        constructor() {
          // RegExp patterns for character classification
          this.RE_WORDLIKE = /[\\p{L}\\p{N}_']/u;
          this.RE_CJK = /[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]/u;
          this.RE_SEP = /[.,;:=\\-+*/<>|&(){}\\[\\]]/u;
        }
      
        getMetadata() {
          return {
            id: 'ultralight-state-machine',
            name: 'Ultralight state machine',
            shortName: 'Ultralight SM',
            description: 'Fastest. Good accuracy. Ultralight state machine.'
          };
        }
      
        estimate(rawInput, calibration = 1.0) {
          const text = this.normalizeText(rawInput);
          const len = text.length;
          if (!len) return 0;
      
          let tokens = 0, inWord = false;
      
          // Character-by-character state machine
          for (let i = 0; i < len; i++) {
            const ch = text[i];
            
            // CJK character handling
            if (this.RE_CJK.test(ch)) {
              tokens++;
              inWord = false;
              continue;
            }
            
            // Space handling (reset word state)
            if (ch === ' ') {
              inWord = false;
              continue;
            }
            
            // Separator handling (count as tokens)
            if (this.RE_SEP.test(ch)) {
              tokens++;
              inWord = false;
              continue;
            }
            
            // Word-like character handling
            if (this.RE_WORDLIKE.test(ch)) {
              // Only increment token count when starting a new word
              if (!inWord) {
                tokens++;
                inWord = true;
              }
            } else {
              // Other characters (not word-like, spaces, or separators)
              tokens++;
              inWord = false;
            }
          }
      
          return this.applyCalibration(tokens, calibration);
        }
      
        normalizeText(rawInput) {
          const text = String(rawInput || '').replace(/\\s+/g, ' ').trim();
          return text;
        }
      
        applyCalibration(tokens, calibration) {
          const scale = Number.isFinite(calibration) && calibration > 0 ? calibration : 1.0;
          return Math.round(tokens * scale);
        }
      }

      // ----- Registry setup -----
      const registry = new TokenModelRegistry();
      
      // Register all models
      registry.register(new SimpleTokenModel());
      registry.register(new AdvancedTokenModel());
      registry.register(new CptBlendMixTokenModel());
      registry.register(new SingleRegexPassTokenModel());
      registry.register(new UltralightStateMachineTokenModel());
      
      // Set ultralight as default
      registry.setDefaultModel('ultralight-state-machine');

      // ----- Worker message handler -----
      self.onmessage = (e) => {
        try {
          const { texts, scale, countingMethod } = e.data || {};
          
          // Resolve model ID (handling legacy 'simple'/'advanced' values)
          const modelId = registry.resolveModelId(countingMethod);
          
          // Get the model instance
          const model = registry.getModel(modelId) || registry.getDefaultModel();
          
          // Apply the model to each text
          const out = {};
          for (const key of Object.keys(texts || {})) {
            out[key] = model.estimate(texts[key] || '', scale);
          }
          
          self.postMessage({ ok: true, estimates: out, modelUsed: model.getMetadata().id });
        } catch (err) {
          self.postMessage({ ok: false, error: (err && err.message) || String(err) });
        }
      };
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
    const selectors = (window.InjectionTargetsOnWebsite && window.InjectionTargetsOnWebsite.selectors) || {};
    const threadSelector = selectors.threadRoot;
    if (!threadSelector) return null;
    return document.querySelector(threadSelector);
  }

  function getThreadText(excludeEditors = false) {
    const root = getThreadRoot();
    if (!root) return '';
    
    if (excludeEditors) {
      // For "ignoreEditors" mode, create a clone and remove editors
      const clone = root.cloneNode(true);
      
      // Remove all editor elements from the clone
      const editorsInThread = clone.querySelectorAll(EDITOR_SELECTOR);
      for (const editor of editorsInThread) {
        editor.parentNode.removeChild(editor);
      }
      
      // Get text from the modified clone
      try { return clone.innerText || ''; } catch { return clone.textContent || ''; }
    } else {
      // For normal mode, get all text including editors
      // innerText respects visibility & layout; good enough and fast to snapshot.
      try { return root.innerText || ''; } catch { return root.textContent || ''; }
    }
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
    
    // Skip if site is not enabled in settings
    if (!settings.enabledSites || !settings.enabledSites[Site]) {
      log(`Token Approximator disabled for site: ${Site}`);
      return;
    }

    // --- DEFER SELECTOR LOADING UNTIL HERE ---
    const selectors = (window.InjectionTargetsOnWebsite && window.InjectionTargetsOnWebsite.selectors) || {};
    const THREAD_SELECTOR = selectors.threadRoot;
    const BUTTONS_CONTAINER_ID = selectors.buttonsContainerId || 'chatgpt-custom-buttons-container';
    
    // Check if threadRoot selector is defined for this site
    const effectiveSettings = { ...settings };
    // If threadRoot is not defined and threadMode is not 'hide', hide thread counter
    if (!THREAD_SELECTOR && effectiveSettings.threadMode !== 'hide') {
      log(`Thread selector not defined for ${Site}, hiding thread counter`);
      effectiveSettings.threadMode = 'hide';
    }
    // One-time log line per spec (parameters only)
    log(`Loaded (site=${Site}) with`, {
      calibration: effectiveSettings.calibration,
      threadMode: effectiveSettings.threadMode,
      showEditorCounter: effectiveSettings.showEditorCounter,
      placement: effectiveSettings.placement,
      threadSelector: THREAD_SELECTOR,
      countingMethod: effectiveSettings.countingMethod
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
    placeUi(settings.placement, BUTTONS_CONTAINER_ID);
    showHideBySettings(effectiveSettings);

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

    // ---- INDEPENDENT COUNTER FUNCTIONS ----
    // Completely separate thread and editor estimation to prevent coupling issues
    
    function estimateThreadTokens() {
      return new Promise((resolve) => {
        // Skip if thread mode is hide or if no thread selector
        if (effectiveSettings.threadMode === 'hide' || !THREAD_SELECTOR) {
          return resolve();
        }

        const wrap = document.getElementById(WRAP_ID);
        if (!wrap) return resolve();
        const threadChip = wrap.querySelector('.ocp-tokapprox-chip[data-kind="thread"]');
        if (!threadChip) return resolve();

        // Create dedicated worker for thread estimation
        const threadWorker = createEstimatorWorker();
        
        threadWorker.onmessage = (ev) => {
          try {
            const currentWrap = document.getElementById(WRAP_ID);
            if (!currentWrap) return resolve();
            const currentThreadChip = currentWrap.querySelector('.ocp-tokapprox-chip[data-kind="thread"]');
            if (!currentThreadChip) return resolve();

            const { ok, estimates, modelUsed, error } = ev.data || {};
            
            if (!ok) {
              log(`Thread estimation failed: ${error || 'Unknown error'}`);
              currentThreadChip.querySelector('.val').textContent = '-------';
              setTooltip(currentThreadChip, 'thread', 'error', effectiveSettings);
              return resolve();
            }
            
            if (!estimates || !estimates.threadText) {
              log('Thread estimation returned no data');
              currentThreadChip.querySelector('.val').textContent = '-------';
              setTooltip(currentThreadChip, 'thread', 'error', effectiveSettings);
              return resolve();
            }

            log(`Thread estimation success: ${modelUsed}`);
            const tokens = estimates.threadText;
            currentThreadChip.querySelector('.val').textContent = formatTokens(tokens);
            markFreshThenStale(currentThreadChip, 'thread', effectiveSettings);
            
          } catch (err) {
            log(`Thread estimation error: ${err.message}`);
          } finally {
            threadWorker.terminate();
            resolve();
          }
        };

        threadWorker.onerror = () => {
          log('Thread worker error');
          threadWorker.terminate();
          resolve();
        };

        // Set loading state
        markLoading(threadChip, 'thread', effectiveSettings);

        try {
          // Get thread text with error isolation
          const rootTxt = getThreadText(effectiveSettings.threadMode === 'ignoreEditors');
          const edTxt = editorsText();
          
          let threadText = '';
          if (effectiveSettings.threadMode === 'ignoreEditors') {
            threadText = rootTxt;
          } else {
            threadText = `${rootTxt}\n${edTxt}`.trim();
          }

          if (!threadText) {
            log('No thread text found');
            threadChip.querySelector('.val').textContent = '-------';
            setTooltip(threadChip, 'thread', 'error', effectiveSettings);
            threadWorker.terminate();
            return resolve();
          }

          threadWorker.postMessage({
            texts: { threadText },
            scale: settings.calibration,
            countingMethod: settings.countingMethod
          });
          
        } catch (err) {
          log(`Thread text extraction failed: ${err.message}`);
          threadChip.querySelector('.val').textContent = '-------';
          setTooltip(threadChip, 'thread', 'error', effectiveSettings);
          threadWorker.terminate();
          resolve();
        }
      });
    }

    function estimateEditorTokens() {
      return new Promise((resolve) => {
        // Skip if editor counter is disabled
        if (!effectiveSettings.showEditorCounter) {
          return resolve();
        }

        const wrap = document.getElementById(WRAP_ID);
        if (!wrap) return resolve();
        const editorChip = wrap.querySelector('.ocp-tokapprox-chip[data-kind="editor"]');
        if (!editorChip) return resolve();

        // Create dedicated worker for editor estimation
        const editorWorker = createEstimatorWorker();
        
        editorWorker.onmessage = (ev) => {
          try {
            const currentWrap = document.getElementById(WRAP_ID);
            if (!currentWrap) return resolve();
            const currentEditorChip = currentWrap.querySelector('.ocp-tokapprox-chip[data-kind="editor"]');
            if (!currentEditorChip) return resolve();

            const { ok, estimates, modelUsed, error } = ev.data || {};
            
            if (!ok) {
              log(`Editor estimation failed: ${error || 'Unknown error'}`);
              currentEditorChip.querySelector('.val').textContent = '-------';
              setTooltip(currentEditorChip, 'editor', 'error', effectiveSettings);
              return resolve();
            }
            
            if (!estimates || !Number.isFinite(estimates.editorText)) {
              log('Editor estimation returned invalid data');
              currentEditorChip.querySelector('.val').textContent = '-------';
              setTooltip(currentEditorChip, 'editor', 'error', effectiveSettings);
              return resolve();
            }

            log(`Editor estimation success: ${modelUsed}`);
            const tokens = estimates.editorText;
            currentEditorChip.querySelector('.val').textContent = formatTokens(tokens);
            markFreshThenStale(currentEditorChip, 'editor', effectiveSettings);
            
          } catch (err) {
            log(`Editor estimation error: ${err.message}`);
          } finally {
            editorWorker.terminate();
            resolve();
          }
        };

        editorWorker.onerror = () => {
          log('Editor worker error');
          editorWorker.terminate();
          resolve();
        };

        // Set loading state
        markLoading(editorChip, 'editor', effectiveSettings);

        try {
          // Get editor text - completely independent of thread
          const edTxt = editorsText();
          
          if (!edTxt.trim()) {
            // Empty editor is valid - show 0 tokens
            editorChip.querySelector('.val').textContent = formatTokens(0);
            markFreshThenStale(editorChip, 'editor', effectiveSettings);
            editorWorker.terminate();
            return resolve();
          }

          editorWorker.postMessage({
            texts: { editorText: edTxt },
            scale: settings.calibration,
            countingMethod: settings.countingMethod
          });
          
        } catch (err) {
          log(`Editor text extraction failed: ${err.message}`);
          editorChip.querySelector('.val').textContent = '-------';
          setTooltip(editorChip, 'editor', 'error', effectiveSettings);
          editorWorker.terminate();
          resolve();
        }
      });
    }

    // INDEPENDENT SCHEDULERS - Thread and Editor are now completely separate
    const threadScheduler = makeScheduler({
      minCooldown: 15000,
      runFn: () => estimateThreadTokens()
    });
    
    const editorScheduler = makeScheduler({
      minCooldown: 600, // faster editor updates
      runFn: () => estimateEditorTokens()
    });
    
    // Replace the simple observer with one that can re-create the UI
    const keepInRow = new MutationObserver(() => {
      const container = document.getElementById(BUTTONS_CONTAINER_ID);
      if (!container) return; // Not an error, page might be changing

      const wrap = document.getElementById(WRAP_ID);

      if (!wrap) {
        // UI is missing, re-create and place it.
        log('Token Approximator UI is missing, re-injecting.');
        placeUi(settings.placement, BUTTONS_CONTAINER_ID);
        showHideBySettings(effectiveSettings);
        // Force independent calculations - they won't affect each other
        if (effectiveSettings.threadMode !== 'hide' && THREAD_SELECTOR) {
          threadScheduler.forceNow();
        }
        if (effectiveSettings.showEditorCounter) {
          editorScheduler.forceNow();
        }
      } else if (!container.contains(wrap)) {
        // UI exists but is detached, just move it back.
        log('Token Approximator UI is misplaced, re-attaching.');
        placeUi(settings.placement, BUTTONS_CONTAINER_ID);
      }
    });
    keepInRow.observe(document.documentElement, { childList: true, subtree: true });

    // Event wiring (now keeps thread and editor completely separate)
    const threadRoot = getThreadRoot();
    if (threadRoot) {
      // Only attach thread observer if there's actually a thread root
      const mo = new MutationObserver(() => {
        // Only mark thread dirty, editors have their own observer
        threadScheduler.markDirty();
      });
      mo.observe(threadRoot, { childList: true, characterData: true, subtree: true });
      
      // Scroll on container & window (virtualization) - thread only
      const scrollTarget = threadRoot.closest('[class*="overflow"],[class*="scroll"],main,body') || window;
      (scrollTarget === window ? window : scrollTarget).addEventListener('scroll', () => {
        threadScheduler.markDirty();
      }, { passive: true });
    }

    // Editors lifecycle is completely independent from thread
    const moAll = new MutationObserver(() => {
      // Only mark editor dirty on DOM changes
      editorScheduler.markDirty();
    });
    moAll.observe(document.documentElement, { childList: true, subtree: true });

    // Typing
    document.addEventListener('input', (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      if (t.matches(EDITOR_SELECTOR)) editorScheduler.markDirty();
    }, true);

    // Visibility control - keeps thread and editor separate
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Thread refresh is optional and depends on selector existence
        if (effectiveSettings.threadMode !== 'hide' && THREAD_SELECTOR) {
          const threadChip = document.querySelector('.ocp-tokapprox-chip[data-kind="thread"]');
          if (threadChip) {
            markLoading(threadChip, 'thread', effectiveSettings);
            threadScheduler.runNow(); // respects cooldown
          }
        }
        
        // Editor refresh happens independently
        if (effectiveSettings.showEditorCounter) {
          const editorChip = document.querySelector('.ocp-tokapprox-chip[data-kind="editor"]');
          if (editorChip) {
            markLoading(editorChip, 'editor', effectiveSettings);
            editorScheduler.runNow(); // respects cooldown
          }
        }
      } else {
        // Pause UI for inactive tab
        const threadChip = document.querySelector('.ocp-tokapprox-chip[data-kind="thread"]');
        const editorChip = document.querySelector('.ocp-tokapprox-chip[data-kind="editor"]');
        
        if (threadChip && effectiveSettings.threadMode !== 'hide') {
          markPaused(threadChip, 'thread', effectiveSettings);
        }
        
        if (editorChip && effectiveSettings.showEditorCounter) {
          markPaused(editorChip, 'editor', effectiveSettings);
        }
      }
    });

    // Safety ticks (cooldown-aware) - separate for thread and editor
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      
      // Only trigger thread estimation if selector exists
      if (effectiveSettings.threadMode !== 'hide' && THREAD_SELECTOR) {
        threadScheduler.markDirty();
      }
      
      // Editor estimation is independent
      if (effectiveSettings.showEditorCounter) {
        editorScheduler.markDirty();
      }
    }, 45000);

    // Click-to-refresh - now with more error protection
    // Use a delegated listener on document for resilience against UI re-creation
    document.addEventListener('click', (e) => {
      const el = e.target.closest(`#${WRAP_ID} .ocp-tokapprox-chip`);
      if (!el) return; // Click was not on one of our chips

      try {
        // Thread chip click with additional safety checks
        if (el.dataset.kind === 'thread' && effectiveSettings.threadMode !== 'hide') {
          if (THREAD_SELECTOR) {
            markLoading(el, 'thread', effectiveSettings);
            threadScheduler.forceNow();
          } else {
            // If there's no thread selector, just show a message
            el.querySelector('.val').textContent = '---';
            setTooltip(el, 'thread', 'error', effectiveSettings);
          }
        }
        // Editor chip click is completely independent
        else if (el.dataset.kind === 'editor' && effectiveSettings.showEditorCounter) {
          markLoading(el, 'editor', effectiveSettings);
          editorScheduler.forceNow();
        }
      } catch (err) {
        log(`Click handler error: ${err.message}`);
      }
    }, true); // Use capture phase to handle click before other listeners

    // First run - completely independent schedulers
    // Only start thread estimation if selector exists
    if (effectiveSettings.threadMode !== 'hide' && THREAD_SELECTOR) {
      threadScheduler.runNow();
    }
    
    // Always try to start editor estimation if enabled
    if (effectiveSettings.showEditorCounter) {
      editorScheduler.runNow();
    }

    // React to settings changes live
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || msg.type !== 'tokenApproximatorSettingsChanged' || !msg.settings) return;
        
        // Store old enabled state for comparison
        const wasEnabled = settings.enabled &&
                          settings.enabledSites &&
                          settings.enabledSites[Site];
        
        Object.assign(settings, {
          enabled: !!msg.settings.enabled,
          calibration: Number.isFinite(msg.settings.calibration) && msg.settings.calibration > 0 ? Number(msg.settings.calibration) : settings.calibration,
          threadMode: (msg.settings.threadMode === 'ignoreEditors' || msg.settings.threadMode === 'hide') ? msg.settings.threadMode : 'withEditors',
          showEditorCounter: typeof msg.settings.showEditorCounter === 'boolean' ? msg.settings.showEditorCounter : settings.showEditorCounter,
          placement: msg.settings.placement === 'before' ? 'before' : 'after',
          countingMethod: msg.settings.countingMethod || 'ultralight-state-machine',
          enabledSites: msg.settings.enabledSites || settings.enabledSites
        });
        
        // Check if this site is no longer enabled (either globally or for this site specifically)
        const nowEnabled = settings.enabled &&
                          settings.enabledSites &&
                          settings.enabledSites[Site];
                          
        if (wasEnabled && !nowEnabled) {
          // Remove the UI if this site was disabled
          log(`Token Approximator was disabled for site: ${Site}, removing UI.`);
          const wrap = document.getElementById(WRAP_ID);
          if (wrap) wrap.remove();
          return;
        }
        
        // Update effectiveSettings for this site
        Object.assign(effectiveSettings, settings);
        
        // Check if threadRoot selector is defined for this site
        if (!THREAD_SELECTOR && effectiveSettings.threadMode !== 'hide') {
          log(`Thread selector not defined for ${Site}, hiding thread counter`);
          effectiveSettings.threadMode = 'hide';
        }
        
        placeUi(settings.placement, BUTTONS_CONTAINER_ID);
        showHideBySettings(effectiveSettings);
        
        // Refresh tooltip prefixes (thread mode may have changed)
        try {
          setTooltip(threadChip, 'thread', threadChip.__tooltipStatus || 'stale', effectiveSettings);
          setTooltip(editorChip, 'editor', editorChip.__tooltipStatus || 'stale', effectiveSettings);
        } catch {}
        
        // Refresh on change - independent schedulers
        if (effectiveSettings.threadMode !== 'hide' && THREAD_SELECTOR) {
          threadScheduler.runNow();
        }
        
        if (effectiveSettings.showEditorCounter) {
          editorScheduler.runNow();
        }
      });
    } catch { /* noop */ }
  })();
})();