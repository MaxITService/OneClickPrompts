// modules/token-models/model-simple.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// Simple token counting model: 1 token ≈ 4 characters

'use strict';

/**
 * Simple Token Counting Model
 * Uses the basic heuristic: 1 token ≈ 4 characters
 * Very fast but less accurate, especially for code and non-English text
 */
class SimpleTokenModel {
  getMetadata() {
    return {
      id: 'simple',
      name: '1 word is 4 tokens',
      shortName: 'Simple (1:4)',
      description: 'Simple approximation: 1 token ≈ 4 characters. Much faster and uses minimal CPU, but less accurate especially with code or non-English text. Good for modest machines or extremely long chats where speed matters more than precision.',
      performance: {
        speed: 5, // Very fast (1-5 scale)
        accuracy: 2, // Low accuracy (1-5 scale)
        cpuUsage: 1 // Very low CPU usage (1-5 scale)
      },
      isDefault: false,
      benchmarkUrl: 'https://github.com/NVIDIA/RULER'
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
    const text = String(rawInput || '').replace(/\s+/g, ' ').trim();
    return text;
  }

  applyCalibration(tokens, calibration) {
    const scale = Number.isFinite(calibration) && calibration > 0 ? calibration : 1.0;
    return Math.round(tokens * scale);
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SimpleTokenModel;
} else if (typeof window !== 'undefined') {
  window.SimpleTokenModel = SimpleTokenModel;
}