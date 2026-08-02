// modules/token-models/base.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// Base interface for token counting models

'use strict';

/**
 * Base class for token counting models
 * All token counting models should extend this class
 */
class TokenCountingModelBase {
  constructor() {
    if (this.constructor === TokenCountingModelBase) {
      throw new Error('TokenCountingModelBase is abstract and cannot be instantiated directly');
    }
  }

  /**
   * Get model metadata
   * @returns {Object} Model metadata with id, name, description, etc.
   */
  getMetadata() {
    throw new Error('getMetadata() must be implemented by subclass');
  }

  /**
   * Estimate token count for given text
   * @param {string} text - The text to count tokens for
   * @param {number} calibration - Calibration multiplier (default 1.0)
   * @returns {number} Estimated token count
   */
  estimate(text, calibration = 1.0) {
    throw new Error('estimate() must be implemented by subclass');
  }

  /**
   * Validate text input
   * @param {*} rawInput - Input to validate
   * @returns {string} Normalized text string
   */
  normalizeText(rawInput) {
    const text = String(rawInput || '').replace(/\s+/g, ' ').trim();
    return text;
  }

  /**
   * Apply calibration to token count
   * @param {number} tokens - Raw token count
   * @param {number} calibration - Calibration multiplier
   * @returns {number} Calibrated token count
   */
  applyCalibration(tokens, calibration) {
    const scale = Number.isFinite(calibration) && calibration > 0 ? calibration : 1.0;
    return Math.round(tokens * scale);
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TokenCountingModelBase;
} else if (typeof window !== 'undefined') {
  window.TokenCountingModelBase = TokenCountingModelBase;
}