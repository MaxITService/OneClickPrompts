(() => {
  'use strict';

  // A counter owns one worker and at most one request. Failed workers are recreated lazily.
  window.OCPTokenApproxWorkerClient = {
    create({ createWorker, timeoutMs = 10000 }) {
      let worker = null;
      let pending = null;
      let sequence = 0;
      let disposed = false;

      function reset(error = new DOMException('Counter request cancelled.', 'AbortError')) {
        const request = pending;
        pending = null;
        if (request) clearTimeout(request.timer);
        const previousWorker = worker;
        worker = null;
        if (previousWorker) {
          previousWorker.onmessage = previousWorker.onerror = previousWorker.onmessageerror = null;
          try { previousWorker.terminate(); } catch (_) { /* The worker may already be gone. */ }
        }
        request?.reject(error);
      }

      return {
        request(payload) {
          if (disposed) return Promise.reject(new DOMException('Counter is disposed.', 'AbortError'));
          if (pending) return Promise.reject(new Error('A counter request is already running.'));
          return new Promise((resolve, reject) => {
            const requestId = ++sequence;
            pending = { requestId, resolve, reject, timer: null };
            try {
              if (!worker) worker = createWorker();
              const currentWorker = worker;
              worker.onmessage = event => {
                if (!pending || worker !== currentWorker || event.data?.requestId !== pending.requestId) return;
                const request = pending;
                pending = null;
                clearTimeout(request.timer);
                request.resolve(event.data);
              };
              worker.onerror = () => {
                if (worker === currentWorker) reset(new Error('Token-counting worker failed.'));
              };
              worker.onmessageerror = () => {
                if (worker === currentWorker) reset(new Error('Token-counting worker returned an unreadable response.'));
              };
              pending.timer = setTimeout(() => reset(new DOMException('Token counting timed out. Retry the counter.', 'TimeoutError')), timeoutMs);
              worker.postMessage({ ...payload, requestId });
            } catch (error) {
              reset(error);
            }
          });
        },
        reset,
        dispose() { disposed = true; reset(); }
      };
    }
  };
})();
