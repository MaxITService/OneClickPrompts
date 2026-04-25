// modules/token-approximator/backend-chatgpt-thread-cache.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// ChatGPT-specific thread text accumulator for virtualized conversations.

(() => {
  'use strict';

  if (window.OCPTokenApproxChatGptThread) {
    return;
  }

  const helpers = window.OCPTokenApproxHelpers || null;
  const log = helpers && typeof helpers.log === 'function'
    ? (...args) => helpers.log(...args)
    : (...args) => {
      try {
        if (typeof window.logConCgp === 'function') {
          window.logConCgp('[tok-approx][chatgpt]', ...args);
        }
      } catch {
        /* noop */
      }
    };

  const MESSAGE_SELECTOR = '[data-message-author-role]';
  const CACHE_PREFIX = 'ocpTokenApprox.chatgptThread.';
  const CACHE_VERSION = 3;
  const UPDATED_EVENT = 'ocp-token-approx-chatgpt-cache-updated';
  const MAX_MESSAGES = 900;
  const MAX_TEXT_CHARS = 1500000;
  const BUCKET_COUNT = 24;
  const LARGE_THREAD_SCROLL_PX = 20000;
  const RECENT_CAPTURE_MS = 1700;
  const INITIAL_UNKNOWN_SCROLL_DEFER_MS = 9500;
  const DEFAULT_WARMUP_BUDGET_MS = 8000;
  const DEFAULT_WARMUP_WAIT_MS = 90;

  const state = {
    startedAt: Date.now(),
    conversationId: '',
    hydrated: false,
    loadStarted: false,
    pendingSave: false,
    lastCaptureChanged: false,
    lastChangedAt: 0,
    messages: new Map(),
    saveTimer: null,
    scroller: null,
    scrollTop: 0,
    maxScrollTop: 0,
    visitedBuckets: new Set(),
    warmupActive: false,
    warmupPromise: null,
    warmupStartedAt: 0,
    lastWarmupAt: 0,
    warmupProgress: null,
    warmupProgrammaticScrollUntil: 0,
    warmupUserInteracted: false
  };

  function readNodeText(el) {
    try { return el.innerText || el.textContent || ''; } catch { return ''; }
  }

  function getConversationId() {
    const match = String(location.pathname || '').match(/\/c\/([^/?#]+)/);
    return match ? match[1] : '';
  }

  function getCacheKey(conversationId) {
    return `${CACHE_PREFIX}${conversationId}`;
  }

  function hashText(text) {
    let hash = 2166136261;
    const input = String(text || '');
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function resetIfNeeded(conversationId) {
    if (state.conversationId === conversationId) return;
    if (state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }
    state.conversationId = conversationId;
    state.hydrated = false;
    state.loadStarted = false;
    state.pendingSave = false;
    state.lastCaptureChanged = false;
    state.startedAt = Date.now();
    state.lastChangedAt = 0;
    state.messages = new Map();
    state.scroller = null;
    state.scrollTop = 0;
    state.maxScrollTop = 0;
    state.visitedBuckets = new Set();
    state.warmupActive = false;
    state.warmupPromise = null;
    state.warmupStartedAt = 0;
    state.lastWarmupAt = 0;
    state.warmupProgress = null;
    state.warmupProgrammaticScrollUntil = 0;
    state.warmupUserInteracted = false;
  }

  function hydrate(conversationId) {
    if (!conversationId || state.loadStarted) return;
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    state.loadStarted = true;

    try {
      chrome.storage.local.get([getCacheKey(conversationId)], (result) => {
        try {
          if (state.conversationId !== conversationId) return;

          const stored = result && result[getCacheKey(conversationId)];
          const storedMessages = stored?.version === CACHE_VERSION && Array.isArray(stored?.messages)
            ? stored.messages
            : [];

          for (const item of storedMessages) {
            if (!item || typeof item.key !== 'string' || typeof item.text !== 'string') continue;
            if (!item.text.trim()) continue;
            state.messages.set(item.key, {
              role: typeof item.role === 'string' ? item.role : '',
              text: item.text,
              updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0
            });
          }

          state.hydrated = true;
          if (state.pendingSave) {
            state.pendingSave = false;
            scheduleSave(conversationId);
          }

          dispatchUpdated();
        } catch (err) {
          log(`ChatGPT token cache hydration failed: ${err?.message || err}`);
        }
      });
    } catch (err) {
      state.hydrated = true;
      state.pendingSave = false;
      log(`ChatGPT token cache load failed: ${err?.message || err}`);
    }
  }

  function prune() {
    if (state.messages.size <= MAX_MESSAGES) return;
    const entries = Array.from(state.messages.entries())
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, MAX_MESSAGES);
    state.messages = new Map(entries);
  }

  function scheduleSave(conversationId) {
    if (!conversationId) return;
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    if (state.saveTimer) clearTimeout(state.saveTimer);

    state.saveTimer = setTimeout(() => {
      state.saveTimer = null;
      if (state.conversationId !== conversationId) return;

      try {
        prune();
        const messages = [];
        let savedChars = 0;

        for (const [key, value] of state.messages) {
          const text = value.text || '';
          if (!text) continue;
          if (savedChars + text.length > MAX_TEXT_CHARS) break;
          messages.push({
            key,
            role: value.role || '',
            text,
            updatedAt: value.updatedAt || 0
          });
          savedChars += text.length;
        }

        chrome.storage.local.set({
          [getCacheKey(conversationId)]: {
            version: CACHE_VERSION,
            conversationId,
            updatedAt: Date.now(),
            messages
          }
        });
      } catch (err) {
        log(`ChatGPT token cache save failed: ${err?.message || err}`);
      }
    }, 900);
  }

  function getMessageKey(el, text) {
    const messageHolder = el.closest('[data-message-id]') || el;
    const explicitId =
      messageHolder.getAttribute('data-message-id') ||
      messageHolder.id ||
      el.getAttribute('data-testid') ||
      '';
    const role = el.getAttribute('data-message-author-role') || '';

    if (explicitId) return `${role}:${explicitId}`;
    return `${role}:hash:${hashText(text)}:${text.length}`;
  }

  function detectScroller() {
    const candidates = [
      state.scroller,
      document.scrollingElement,
      document.documentElement,
      document.body,
      ...document.querySelectorAll('main,#thread,[class*="scroll"],[class*="overflow"],[role="main"]')
    ].filter(Boolean);

    const ranked = Array.from(new Set(candidates))
      .map((el) => ({
        el,
        score: Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0))
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (best?.el) {
      state.scroller = best.el;
    } else if (!state.scroller || !state.scroller.isConnected) {
      state.scroller = document.scrollingElement || document.documentElement;
    }

    return state.scroller;
  }

  function recordScrollPosition() {
    const scroller = detectScroller();
    const maxScrollTop = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || window.innerHeight || 0));
    const scrollTop = Math.max(0, scroller.scrollTop || 0);
    const previousMaxScrollTop = state.maxScrollTop;
    const previousVisitedBuckets = state.visitedBuckets.size;
    state.scrollTop = scrollTop;
    state.maxScrollTop = Math.max(state.maxScrollTop, maxScrollTop);

    if (maxScrollTop > 0) {
      const bucket = Math.max(0, Math.min(BUCKET_COUNT - 1, Math.round((scrollTop / maxScrollTop) * (BUCKET_COUNT - 1))));
      state.visitedBuckets.add(bucket);
    }

    return {
      scrollTop,
      maxScrollTop,
      metricsChanged: state.maxScrollTop !== previousMaxScrollTop || state.visitedBuckets.size !== previousVisitedBuckets
    };
  }

  function getScrollerMetrics() {
    const scroller = detectScroller();
    const maxScrollTop = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || window.innerHeight || 0));
    return {
      scrollTop: Math.max(0, scroller.scrollTop || 0),
      maxScrollTop,
      clientHeight: Math.max(0, scroller.clientHeight || window.innerHeight || 0),
      scrollHeight: Math.max(0, scroller.scrollHeight || 0)
    };
  }

  function getActiveScrollerPosition() {
    const scroller = detectScroller();
    const maxScrollTop = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || window.innerHeight || 0));
    return {
      scroller,
      scrollTop: Math.max(0, scroller.scrollTop || 0),
      maxScrollTop,
      clientHeight: Math.max(0, scroller.clientHeight || window.innerHeight || 0)
    };
  }

  function dispatchUpdated() {
    try {
      const root = document.documentElement;
      root.dataset.ocpChatgptThreadMessages = String(state.messages.size);
      root.dataset.ocpChatgptThreadChars = String(getCachedCharCount());
      root.dataset.ocpChatgptThreadMaxScroll = String(Math.round(state.maxScrollTop));
      root.dataset.ocpChatgptThreadVisitedBuckets = String(state.visitedBuckets.size);
      root.dataset.ocpChatgptThreadWarmup = state.warmupActive ? '1' : '0';
    } catch {
      /* noop */
    }

    document.dispatchEvent(new CustomEvent(UPDATED_EVENT, {
      detail: {
        conversationId: state.conversationId,
        count: state.messages.size,
        chars: getCachedCharCount(),
        visitedBuckets: state.visitedBuckets.size,
        maxScrollTop: state.maxScrollTop
      }
    }));
  }

  function captureFromDom() {
    const conversationId = getConversationId();
    if (!conversationId) return { text: '', changed: false };

    resetIfNeeded(conversationId);
    hydrate(conversationId);
    const scroll = recordScrollPosition();

    const messages = Array.from(document.querySelectorAll(MESSAGE_SELECTOR));
    let changed = false;
    const now = Date.now();

    messages.forEach((el, index) => {
      const text = readNodeText(el).trim();
      if (!text) return;

      const key = getMessageKey(el, text);
      const existing = state.messages.get(key);
      if (!existing || existing.text !== text) {
        changed = true;
        state.messages.set(key, {
          role: el.getAttribute('data-message-author-role') || '',
          text,
          updatedAt: now + index
        });
      }
    });

    state.lastCaptureChanged = changed;
    if (changed) {
      state.lastChangedAt = now;
      if (state.hydrated) {
        scheduleSave(conversationId);
      } else {
        state.pendingSave = true;
      }
    }

    if (changed || scroll?.metricsChanged) {
      dispatchUpdated();
    }

    return { text: getThreadText(), changed, metricsChanged: !!scroll?.metricsChanged };
  }

  function getThreadText() {
    const parts = [];
    let totalChars = 0;

    for (const item of state.messages.values()) {
      if (!item.text) continue;
      if (totalChars + item.text.length > MAX_TEXT_CHARS) break;
      parts.push(item.text);
      totalChars += item.text.length;
    }

    return parts.join('\n\n');
  }

  function getCachedCharCount() {
    let chars = 0;
    for (const item of state.messages.values()) {
      chars += (item.text || '').length;
    }
    return chars;
  }

  function shouldDeferEstimate() {
    recordScrollPosition();

    const chars = getCachedCharCount();
    const metrics = getScrollerMetrics();
    const maxScrollTop = Math.max(state.maxScrollTop, metrics.maxScrollTop);
    const visitedBuckets = state.visitedBuckets.size;
    const recentlyChanged = Date.now() - state.lastChangedAt < RECENT_CAPTURE_MS;

    if (state.warmupActive) return true;
    if (recentlyChanged) return true;
    if (maxScrollTop < LARGE_THREAD_SCROLL_PX &&
      chars > 8000 &&
      chars < 90000 &&
      Date.now() - state.startedAt < INITIAL_UNKNOWN_SCROLL_DEFER_MS) {
      return true;
    }
    if (maxScrollTop < LARGE_THREAD_SCROLL_PX) return false;

    const mountedMessageCount = document.querySelectorAll(MESSAGE_SELECTOR).length;
    if (mountedMessageCount > 0 && mountedMessageCount < 12 && chars < 25000) return true;

    const minCharsForLargeThread = Math.min(90000, Math.max(22000, Math.round(maxScrollTop * 0.9)));
    if (chars < minCharsForLargeThread) return true;
    if (visitedBuckets < 7 && chars < 90000) return true;

    return false;
  }

  function shouldWarmUpByScrolling() {
    captureFromDom();
    const chars = getCachedCharCount();
    const metrics = getScrollerMetrics();
    const maxScrollTop = Math.max(state.maxScrollTop, metrics.maxScrollTop);
    if (state.warmupActive) return true;
    if (maxScrollTop < LARGE_THREAD_SCROLL_PX) return false;
    if (chars < 90000) return true;
    if (state.visitedBuckets.size < 7 && chars < 90000) return true;
    return false;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function moveScroller(top, waitMs) {
    const scroller = detectScroller();
    const maxScrollTop = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || window.innerHeight || 0));
    const nextTop = Math.max(0, Math.min(maxScrollTop, Math.round(top)));
    state.warmupProgrammaticScrollUntil = Date.now() + waitMs + 180;
    scroller.scrollTop = nextTop;
    try {
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      window.dispatchEvent(new Event('scroll'));
    } catch {
      /* noop */
    }
    await wait(waitMs);
    return captureFromDom();
  }

  async function restoreScrollerPosition(intent, originalRatio, waitMs) {
    for (let i = 0; i < 3; i++) {
      const pos = getActiveScrollerPosition();
      const top = intent === 'bottom'
        ? pos.maxScrollTop
        : (intent === 'top' ? 0 : Math.round(pos.maxScrollTop * originalRatio));
      await moveScroller(top, waitMs);

      const after = getActiveScrollerPosition();
      const closeEnough = intent === 'bottom'
        ? after.maxScrollTop - after.scrollTop < Math.max(180, after.clientHeight * 0.25)
        : (intent === 'top'
          ? after.scrollTop < 80
          : Math.abs(after.scrollTop - Math.round(after.maxScrollTop * originalRatio)) < Math.max(180, after.clientHeight * 0.25));
      if (closeEnough) break;
    }
  }

  async function runWarmUp(options) {
    const opts = options || {};
    const budgetMs = Number.isFinite(opts.timeBudgetMs) && opts.timeBudgetMs > 0
      ? opts.timeBudgetMs
      : DEFAULT_WARMUP_BUDGET_MS;
    const waitMs = Number.isFinite(opts.waitMs) && opts.waitMs >= 80
      ? opts.waitMs
      : DEFAULT_WARMUP_WAIT_MS;
    const startedAt = Date.now();
    const deadline = startedAt + budgetMs;

    captureFromDom();
    let initialPosition = getActiveScrollerPosition();
    if (initialPosition.maxScrollTop <= 0) {
      await wait(180);
      captureFromDom();
      initialPosition = getActiveScrollerPosition();
    }
    const currentTop = () => getActiveScrollerPosition().scrollTop;
    const currentMax = () => getActiveScrollerPosition().maxScrollTop;
    const originalTop = initialPosition.scrollTop;
    const viewport = Math.max(320, initialPosition.clientHeight || window.innerHeight || 800);
    const initialMax = initialPosition.maxScrollTop;
    const originalRatio = initialMax > 0 ? originalTop / initialMax : 1;
    const originalNearTop = originalTop < Math.max(500, viewport * 0.8);
    const originalNearBottom = initialMax > 0 && initialMax - originalTop < Math.max(900, viewport * 1.8);
    const sampleCount = Math.max(12, Math.min(BUCKET_COUNT, Math.ceil(initialMax / Math.max(900, viewport * 1.45))));
    const targets = [];
    for (let i = sampleCount - 2; i >= 0; i--) {
      targets.push(Math.round((initialMax * i) / Math.max(1, sampleCount - 1)));
    }

    const updateProgress = (phase, steps) => {
      state.warmupProgress = {
        phase,
        steps,
        scrollTop: Math.round(currentTop()),
        maxScrollTop: Math.round(currentMax()),
        chars: getCachedCharCount(),
        messageCount: state.messages.size
      };
      dispatchUpdated();
    };

    let steps = 0;

    try {
      updateProgress('starting', steps);

      await moveScroller(currentMax(), waitMs + 130);
      steps++;
      updateProgress('bottom', steps);

      // A bounded bucket scan is quicker and less visually annoying than crawling
      // viewport-by-viewport, while still visiting enough virtualized slices for a
      // useful ChatGPT cache warm-up.
      for (const target of targets) {
        if (Date.now() >= deadline) break;
        await moveScroller(Math.min(target, currentMax()), waitMs);
        steps++;
        updateProgress('scanning-up', steps);
      }

      await moveScroller(0, waitMs + 260);
      steps++;
      updateProgress('top', steps);
    } finally {
      if (!state.warmupUserInteracted) {
        const restoreIntent = originalNearBottom ? 'bottom' : (originalNearTop ? 'top' : 'ratio');
        await restoreScrollerPosition(restoreIntent, originalRatio, Math.max(90, Math.round(waitMs * 0.75)));
      }
      state.lastWarmupAt = Date.now();
      state.warmupProgress = {
        phase: 'done',
        steps,
        scrollTop: Math.round(currentTop()),
        maxScrollTop: Math.round(currentMax()),
        chars: getCachedCharCount(),
        messageCount: state.messages.size
      };
      dispatchUpdated();
    }

    return getState();
  }

  function warmUpByScrolling(options) {
    const conversationId = getConversationId();
    if (!conversationId) return Promise.resolve(getState());

    resetIfNeeded(conversationId);
    if (state.warmupPromise) return state.warmupPromise;

    state.warmupActive = true;
    state.warmupStartedAt = Date.now();
    state.warmupProgrammaticScrollUntil = 0;
    state.warmupUserInteracted = false;
    state.warmupProgress = {
      phase: 'queued',
      steps: 0,
      scrollTop: state.scrollTop,
      maxScrollTop: state.maxScrollTop,
      chars: getCachedCharCount(),
      messageCount: state.messages.size
    };
    dispatchUpdated();

    state.warmupPromise = runWarmUp(options)
      .catch((err) => {
        log(`ChatGPT token cache warm-up failed: ${err?.message || err}`);
        return getState();
      })
      .finally(() => {
        state.warmupActive = false;
        state.warmupPromise = null;
        state.warmupProgrammaticScrollUntil = 0;
        dispatchUpdated();
      });

    return state.warmupPromise;
  }

  function installCaptureListeners(options) {
    const opts = options || {};
    const threadScheduler = opts.threadScheduler || null;
    const effectiveSettings = opts.effectiveSettings || {};
    const threadSelector = opts.threadSelector || '';
    const debounce = typeof opts.debounce === 'function'
      ? opts.debounce
      : (fn, delay) => {
        let timer;
        return (...args) => {
          clearTimeout(timer);
          timer = setTimeout(() => fn(...args), delay);
        };
      };

    const captureAndSchedule = () => {
      const beforeCount = state.messages.size;
      const result = captureFromDom();
      const grew = result.changed || state.messages.size !== beforeCount;
      if ((grew || result.metricsChanged) && effectiveSettings.threadMode !== 'hide' && threadSelector && threadScheduler) {
        threadScheduler.markDirty();
      }
    };

    const captureSoon = debounce(captureAndSchedule, 90);
    let delayedTimers = [];
    const captureLater = () => {
      captureSoon();
      delayedTimers.forEach((timer) => clearTimeout(timer));
      delayedTimers = [
        setTimeout(captureAndSchedule, 220),
        setTimeout(captureAndSchedule, 750),
        setTimeout(captureAndSchedule, 1600)
      ];
    };

    captureAndSchedule();
    [250, 900, 1800, 3200, 5200, 8500].forEach((delay) => {
      setTimeout(captureAndSchedule, delay);
    });

    document.addEventListener('scroll', captureLater, true);
    window.addEventListener('scroll', captureLater, { passive: true });
    ['wheel', 'touchstart', 'touchmove', 'keydown'].forEach((eventName) => {
      document.addEventListener(eventName, () => {
        if (state.warmupActive && Date.now() > state.warmupProgrammaticScrollUntil) {
          state.warmupUserInteracted = true;
        }
      }, { capture: true, passive: true });
    });

    const observer = new MutationObserver(captureSoon);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener(UPDATED_EVENT, () => {
      if (effectiveSettings.threadMode !== 'hide' && threadSelector && threadScheduler) {
        threadScheduler.forceNow();
      }
    });
  }

  function getState() {
    return {
      conversationId: state.conversationId,
      hydrated: state.hydrated,
      loadStarted: state.loadStarted,
      messageCount: state.messages.size,
      chars: getCachedCharCount(),
      maxScrollTop: state.maxScrollTop,
      visitedBuckets: state.visitedBuckets.size,
      lastCaptureChanged: state.lastCaptureChanged,
      lastChangedAt: state.lastChangedAt,
      warmupActive: state.warmupActive,
      warmupStartedAt: state.warmupStartedAt,
      lastWarmupAt: state.lastWarmupAt,
      warmupUserInteracted: state.warmupUserInteracted,
      warmupProgress: state.warmupProgress ? { ...state.warmupProgress } : null,
      scroller: getScrollerMetrics()
    };
  }

  window.OCPTokenApproxChatGptThread = Object.freeze({
    UPDATED_EVENT,
    captureFromDom,
    getThreadText,
    shouldDeferEstimate,
    shouldWarmUpByScrolling,
    warmUpByScrolling,
    installCaptureListeners,
    getState
  });
})();
