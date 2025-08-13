// modules/token-models/registry.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// Registry for token counting models

'use strict';

/**
 * Registry for managing token counting models
 */
class TokenModelRegistry {
  constructor() {
    this.models = new Map();
    this.defaultModelId = 'ultralight-state-machine';
  }

  /**
   * Register a model with the registry
   * @param {TokenCountingModelBase} modelInstance - Instance of a token counting model
   */
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

  /**
   * Get a model by ID
   * @param {string} modelId - Model identifier
   * @returns {TokenCountingModelBase|null} Model instance or null if not found
   */
  getModel(modelId) {
    return this.models.get(modelId) || null;
  }

  /**
   * Get the default model
   * @returns {TokenCountingModelBase} Default model instance
   */
  getDefaultModel() {
    return this.getModel(this.defaultModelId) || this.models.values().next().value;
  }

  /**
   * Get all registered models
   * @returns {Array} Array of model instances
   */
  getAllModels() {
    return Array.from(this.models.values());
  }

  /**
   * Get all model metadata
   * @returns {Array} Array of model metadata objects
   */
  getAllMetadata() {
    return this.getAllModels().map(model => model.getMetadata());
  }

  /**
   * Check if a model is registered
   * @param {string} modelId - Model identifier
   * @returns {boolean} True if model is registered
   */
  hasModel(modelId) {
    return this.models.has(modelId);
  }

  /**
   * Map legacy counting method to new model ID
   * @param {string} legacyMethod - Legacy method ('simple', 'advanced')
   * @returns {string} Corresponding model ID
   */
  mapLegacyMethod(legacyMethod) {
    const mapping = {
      'simple': 'simple',
      'advanced': 'advanced'
    };
    return mapping[legacyMethod] || this.defaultModelId;
  }

  /**
   * Get model ID from legacy or new format
   * @param {string} countingMethod - Could be legacy ('simple', 'advanced') or new model ID
   * @returns {string} Valid model ID
   */
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

  /**
   * Set the default model
   * @param {string} modelId - Model identifier to set as default
   */
  setDefaultModel(modelId) {
    if (!this.hasModel(modelId)) {
      throw new Error(`Model '${modelId}' is not registered`);
    }
    this.defaultModelId = modelId;
  }
}

// Create global registry instance
const registry = new TokenModelRegistry();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TokenModelRegistry, registry };
} else if (typeof window !== 'undefined') {
  window.TokenModelRegistry = TokenModelRegistry;
  window.tokenModelRegistry = registry;
}