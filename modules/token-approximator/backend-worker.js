// modules/token-approximator/backend-worker.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// Worker and estimation helpers for the Token Approximator backend script.

(() => {
  'use strict';

  if (window.OCPTokenApproxWorker) {
    return;
  }

  const helpers = window.OCPTokenApproxHelpers;
  if (!helpers) {
    return;
  }

  function getRegistryOrThrow() {
    const registry = helpers.getRegistry();
    if (!registry) {
      throw new Error('Token model registry is not available');
    }
    helpers.ensureDefaultModel(registry);
    return registry;
  }

  function runEstimation(payload) {
    try {
      const registry = getRegistryOrThrow();
      const data = payload || {};
      const texts = data.texts || {};
      const scale = data.scale;
      const resolvedModelId = helpers.resolveModelId(data.countingMethod);
      const model = (typeof registry.getModel === 'function' ? registry.getModel(resolvedModelId) : null)
        || (typeof registry.getDefaultModel === 'function' ? registry.getDefaultModel() : null);

      if (!model) {
        throw new Error('No token counting model available');
      }

      const result = {};
      for (const key of Object.keys(texts)) {
        result[key] = model.estimate(texts[key] || '', scale);
      }

      let modelId = resolvedModelId;
      try {
        const metadata = model.getMetadata && model.getMetadata();
        if (metadata && metadata.id) {
          modelId = metadata.id;
        }
      } catch {
        /* ignore metadata lookup issues */
      }

      return { ok: true, estimates: result, modelUsed: modelId, requestId: data.requestId ?? null };
    } catch (err) {
      return {
        ok: false,
        requestId: payload?.requestId ?? null,
        error: err && err.message ? err.message : String(err)
      };
    }
  }

  function createEstimatorWorker(site) {
    const currentSite = site || helpers.getActiveSite();
    if (currentSite === 'Gemini' || currentSite === 'AIStudio') {
      helpers.log(`Using synchronous on-thread estimator for ${currentSite} due to CSP.`);
      const mockWorker = {
        onmessage: null,
        postMessage(data) {
          if (typeof mockWorker.onmessage === 'function') {
            setTimeout(() => {
              if (!mockWorker.onmessage) return;
              try {
                mockWorker.onmessage({ data: runEstimation(data) });
              } catch {
                /* ignore listener errors */
              }
            }, 0);
          }
        },
        terminate() { mockWorker.onmessage = null; }
      };
      return mockWorker;
    }

    const constructors = helpers.getModelConstructors();
    if (!constructors.length) {
      throw new Error('No model constructors found for worker bootstrap');
    }

    const catalog = helpers.getCatalog() || {};
    const defaultModelId = (catalog.defaultModelId || 'ultralight-state-machine').replace(/'/g, '\\\'');

    const constructorsCode = constructors.map((ctor) => {
      try {
        return ctor.toString();
      } catch {
        return '';
      }
    }).filter(Boolean).join('\n\n');

    const modelNames = constructors
      .map((ctor) => ctor && ctor.name)
      .filter((name) => name && name !== 'TokenCountingModelBase' && name !== 'TokenModelRegistry');

    const factoryListCode = modelNames
      .map((name) => `    () => new ${name}()`)
      .join(',\n');

    const workerBootstrap = `
      (() => {
        'use strict';
        const registry = new TokenModelRegistry();
        const modelFactories = [
${factoryListCode}
        ];
        modelFactories.forEach((factory) => {
          try {
            registry.register(factory());
          } catch {
            /* ignore registration failure */
          }
        });
        try {
          registry.setDefaultModel('${defaultModelId}');
        } catch {
          /* ignore default model failure */
        }
        function run(payload) {
          const data = payload || {};
          const texts = data.texts || {};
          const scale = data.scale;
          const modelId = registry.resolveModelId(data.countingMethod);
          const model = registry.getModel(modelId) || registry.getDefaultModel();
          if (!model) {
            throw new Error('Model unavailable inside worker');
          }
          const estimates = {};
          for (const key of Object.keys(texts)) {
            estimates[key] = model.estimate(texts[key] || '', scale);
          }
          return {
            ok: true,
            estimates,
            modelUsed: (model.getMetadata && model.getMetadata().id) || modelId,
            requestId: data.requestId ?? null
          };
        }
        self.onmessage = (event) => {
          try {
            self.postMessage(run(event.data));
          } catch (err) {
            const message = err && err.message ? err.message : String(err);
            self.postMessage({ ok: false, error: message, requestId: event.data?.requestId ?? null });
          }
        };
      })();
    `;

    const blob = new Blob([constructorsCode, '\n', workerBootstrap], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      const worker = new Worker(url);
      let released = false;
      const releaseUrl = () => {
        if (released) return;
        released = true;
        URL.revokeObjectURL(url);
      };
      worker.addEventListener('message', releaseUrl, { once: true });
      worker.addEventListener('error', releaseUrl, { once: true });
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => { try { terminate(); } finally { releaseUrl(); } };
      return worker;
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  window.OCPTokenApproxWorker = Object.freeze({
    createEstimatorWorker,
    runEstimation
  });
})();
