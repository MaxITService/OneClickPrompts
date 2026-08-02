// modules/token-models/model-single-regex-pass.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// Single Regex Pass token counting model

'use strict';

/**
 * Single Regex Pass Token Counting Model
 * A single Unicode regex matches letter sequences, numbers, individual CJK characters, 
 * or any non-whitespace symbol and returns the total matches as the token estimate.
 * Extremely fast and simple because it's one pass with no extra state.
 */
class SingleRegexPassTokenModel {
  constructor() {
    // Single regex to match all token-like patterns
    this.TOKEN_REGEX = /\p{L}+|\p{N}+|\p{sc=Han}|\p{sc=Hiragana}|\p{sc=Katakana}|\p{sc=Hangul}|[^\s\p{L}\p{N}]/gu;
  }

  getMetadata() {
    return {
      id: 'single-regex-pass',
      name: 'Single regex model',
      shortName: 'Single Regex',
      description: 'Seems to be most accurate. single-regex model. 30% slower than Ultralight state machine. A single Unicode regex matches letter sequences, numbers, individual CJK characters, or any non-whitespace symbol and returns the total matches as the token estimate. It\'s extremely fast and simple because it\'s one pass with no extra state. The trade-off is coarse granularity—punctuation and symbols count as their own tokens, and there\'s no adjustment for code-heavy or CJK-heavy text.',
      performance: {
        speed: 4, // Fast (1-5 scale)
        accuracy: 5, // Most accurate according to description (1-5 scale)
        cpuUsage: 2 // Low CPU usage (1-5 scale)
      },
      isDefault: false,
      benchmarkUrl: 'https://github.com/NVIDIA/RULER'
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
  module.exports = SingleRegexPassTokenModel;
} else if (typeof window !== 'undefined') {
  window.SingleRegexPassTokenModel = SingleRegexPassTokenModel;
}