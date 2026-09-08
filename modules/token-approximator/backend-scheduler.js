(() => {
  'use strict';

  // One pending wake-up per counter, including its cooldown and idle wait.
  window.OCPTokenApproxScheduler = {
    makeScheduler({ runFn, minCooldown = 1000, isEnabled = () => true }) {
      let dirty = false;
      let running = false;
      let disposed = false;
      let lastRun = -Infinity;
      let scheduled = false;
      let timer = null;
      let idle = null;
      let frame = null;
      const canRun = () => !disposed && isEnabled() && document.visibilityState === 'visible';

      function cancelPending() {
        clearTimeout(timer);
        if (idle !== null) window.cancelIdleCallback?.(idle);
        if (frame !== null) cancelAnimationFrame(frame);
        timer = idle = frame = null;
        scheduled = false;
      }

      async function tick(deadline) {
        scheduled = false;
        timer = idle = frame = null;
        if (running || !dirty || !canRun()) return;
        running = true;
        dirty = false;
        lastRun = Date.now();
        try {
          await runFn(deadline);
        } catch (error) {
          window.logConCgp?.('[tok-approx] Counter update failed:', error?.message || error);
        } finally {
          running = false;
          if (dirty) schedule();
        }
      }

      function schedule(leading = false) {
        if (scheduled || running || !dirty || !canRun()) return;
        const delay = Math.max(0, minCooldown - (Date.now() - lastRun));
        if (leading && delay === 0) { void tick(); return; }
        scheduled = true;
        timer = setTimeout(() => {
          timer = null;
          if (!canRun()) { scheduled = false; return; }
          if (typeof window.requestIdleCallback === 'function') {
            idle = window.requestIdleCallback(tick, { timeout: minCooldown + 200 });
          } else {
            frame = requestAnimationFrame(() => { void tick(); });
          }
        }, delay);
      }

      return {
        markDirty() { if (!disposed) { dirty = true; schedule(); } },
        runNow() { if (!disposed) { dirty = true; schedule(true); } },
        // Explicit user refresh may bypass the cooldown; ordinary mutations cannot.
        forceNow() {
          if (disposed) return;
          dirty = true;
          lastRun = -Infinity;
          cancelPending();
          schedule(true);
        },
        pauseInfo() { return { running }; },
        dispose() { disposed = true; dirty = false; cancelPending(); }
      };
    }
  };
})();
