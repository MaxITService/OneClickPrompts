// modules/token-approximator/backend-helpers.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// Shared helpers for the Token Approximator backend script.

(() => {
  'use strict';

  if (window.OCPTokenApproxHelpers) {
    return;
  }

  const helpers = {};

  helpers.debounce = function debounce(func, delay) {
    let timeout;
    return function debounced(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), delay);
    };
  };

  helpers.getActiveSite = function getActiveSite() {
    return (window.InjectionTargetsOnWebsite && window.InjectionTargetsOnWebsite.activeSite) || 'Unknown';
  };

  helpers.log = function log(...args) {
    try {
      if (typeof window.logConCgp === 'function') {
        window.logConCgp('[tok-approx]', ...args);
      }
    } catch {
      /* noop per project policy */
    }
  };

  function getCatalog() {
    return window.OCP_TOKEN_MODEL_CATALOG || null;
  }

  helpers.getCatalog = getCatalog;

  let registrySingleton = null;

  helpers.getRegistry = function getRegistry() {
    if (registrySingleton) {
      return registrySingleton;
    }
    const factory = typeof window.OCP_createTokenModelRegistry === 'function'
      ? window.OCP_createTokenModelRegistry
      : null;
    if (!factory) {
      return null;
    }
    try {
      registrySingleton = factory();
      helpers.ensureDefaultModel(registrySingleton);
      return registrySingleton;
    } catch (err) {
      helpers.log('Failed to create token model registry', err && err.message ? err.message : err);
      return null;
    }
  };

  helpers.getSupportedSites = function getSupportedSites() {
    const catalog = getCatalog();
    return (catalog && catalog.supportedSites) ? catalog.supportedSites.slice() : [];
  };

  helpers.resolveModelId = function resolveModelId(countingMethod) {
    const registry = helpers.getRegistry();
    if (registry && typeof registry.resolveModelId === 'function') {
      return registry.resolveModelId(countingMethod);
    }
    const catalog = getCatalog();
    if (!catalog) {
      return countingMethod;
    }
    const mapping = catalog.legacyMethodMap || {};
    const mapped = mapping[countingMethod];
    return mapped || (catalog.defaultModelId || countingMethod);
  };

  helpers.getModelConstructors = function getModelConstructors() {
    return [
      window.TokenCountingModelBase,
      window.TokenModelRegistry,
      window.SimpleTokenModel,
      window.AdvancedTokenModel,
      window.CptBlendMixTokenModel,
      window.SingleRegexPassTokenModel,
      window.UltralightStateMachineTokenModel
    ].filter((ctor) => typeof ctor === 'function');
  };

  helpers.ensureDefaultModel = function ensureDefaultModel(registry) {
    const catalog = getCatalog();
    if (!registry || !catalog) {
      return;
    }
    const defaultId = catalog.defaultModelId || 'ultralight-state-machine';
    if (typeof registry.setDefaultModel === 'function') {
      try {
        registry.setDefaultModel(defaultId);
      } catch {
        /* ignore */
      }
    }
  };

  window.OCPTokenApproxHelpers = Object.freeze(helpers);
})();
