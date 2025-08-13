// modules/token-models/model-advanced.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// Advanced token counting model: Original heuristics algorithm

'use strict';

/**
 * Advanced Token Counting Model
 * Uses intelligent heuristics that adapt to different content types
 * Blends word-based and character-based estimates with content type detection
 */
class AdvancedTokenModel {
  getMetadata() {
    return {
      id: 'advanced',
      name: 'Advanced heuristics',
      shortName: 'Advanced',
      description: 'Uses intelligent heuristics that adapt to different content types (code, CJK text, etc.) for better accuracy. Slower but more precise - can use significant CPU on very long conversations. Blends word-based and character-based estimates.',
      performance: {
        speed: 3, // Medium speed (1-5 scale)
        accuracy: 4, // Good accuracy (1-5 scale)
        cpuUsage: 4 // High CPU usage (1-5 scale)
      },
      isDefault: false,
      benchmarkUrl: 'https://github.com/NVIDIA/RULER'
    };
  }

  estimate(rawInput, calibration = 1.0) {
    const text = this.normalizeText(rawInput);
    const normChars = text.length;
    
    if (!normChars) return 0;

    const CFG = {
      wordsDivisor: 0.75,
      cptBase: 4.9,
      cptCodeBump: 1.0,
      cptCjkBump: 0.7,
      cptSpaceBump: 0.5,
      weights: { default: [2, 1], code: [2, 1], cjk: [1, 3] },
      capPct: 0.12
    };

    // Words count using Intl.Segmenter or regex fallback
    let wordsOnly = 0;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
      for (const s of seg.segment(text)) {
        if (s.isWordLike) wordsOnly++;
      }
    } else {
      const m = text.match(/\p{L}[\p{L}\p{M}\p{N}_'-]*|\p{N}+/gu);
      wordsOnly = m ? m.length : 0;
    }

    // Feature detection
    const codeSymbols = (text.match(/[{}\[\]();:.,=+\-*\/<>|&]/g) || []).length;
    const codeWords = (text.match(/\b[A-Za-z]*[A-Z][a-z]+[A-Za-z]*\b|[_$][A-Za-z0-9_$]*|[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+/g) || []).length;
    const codeRatio = Math.min(1, (codeSymbols + 0.5 * codeWords) / Math.max(1, wordsOnly + codeSymbols));
    
    const spaces = (text.match(/ /g) || []).length;
    const whitespaceRatio = spaces / Math.max(1, normChars);
    
    const cjkCount = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
    const cjkRatio = cjkCount / Math.max(1, normChars);

    // Token estimates
    const tokens_by_words_raw = Math.round(wordsOnly / CFG.wordsDivisor);
    const cpt = CFG.cptBase + CFG.cptCodeBump * codeRatio + CFG.cptCjkBump * cjkRatio + CFG.cptSpaceBump * whitespaceRatio;
    const tokens_by_chars_raw = Math.round(normChars / Math.max(3.8, cpt));

    // Blend weights selection
    let [wW, wC] = CFG.weights.default;
    if (cjkRatio > 0.15) [wW, wC] = CFG.weights.cjk;
    else if (codeRatio > 0.30) [wW, wC] = CFG.weights.code;

    // Cap divergence
    const hiCap = Math.round(tokens_by_chars_raw * (1 + CFG.capPct));
    const loCap = Math.round(tokens_by_chars_raw * (1 - CFG.capPct));
    const words_capped = Math.max(loCap, Math.min(hiCap, tokens_by_words_raw));

    // Final estimate
    const est = Math.round((words_capped * wW + tokens_by_chars_raw * wC) / (wW + wC));
    
    return this.applyCalibration(est, calibration);
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
  module.exports = AdvancedTokenModel;
} else if (typeof window !== 'undefined') {
  window.AdvancedTokenModel = AdvancedTokenModel;
}