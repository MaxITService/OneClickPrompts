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
        try {
          result[key] = model.estimate(texts[key] || '', scale);
        } catch {
          result[key] = 0;
        }
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

      return { ok: true, estimates: result, modelUsed: modelId };
    } catch (err) {
      return {
        ok: false,
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
          const response = runEstimation(data);
          if (typeof mockWorker.onmessage === 'function') {
            setTimeout(() => {
              try {
                mockWorker.onmessage({ data: response });
              } catch {
                /* ignore listener errors */
              }
            }, 0);
          }
        },
        terminate() { /* noop */ }
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
            modelUsed: (model.getMetadata && model.getMetadata().id) || modelId
          };
        }
        self.onmessage = (event) => {
          try {
            self.postMessage(run(event.data));
          } catch (err) {
            const message = err && err.message ? err.message : String(err);
            self.postMessage({ ok: false, error: message });
          }
        };
      })();
    `;

    const blob = new Blob([constructorsCode, '\n', workerBootstrap], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }

  window.OCPTokenApproxWorker = Object.freeze({
    createEstimatorWorker,
    runEstimation
  });
})();

