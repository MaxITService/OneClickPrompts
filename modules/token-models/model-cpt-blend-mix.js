// modules/token-models/model-cpt-blend-mix.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// CPT Blend/Mix token counting model (DeepSeek R1)

'use strict';

/**
 * CPT Blend/Mix Token Counting Model
 * Sometimes best accuracy, sometimes off. 70% slower than Ultralight state machine.
 * It first normalizes the text and gets a word-based count via Intl.Segmenter (with a Unicode regex fallback),
 * then computes a character-per-token estimate weighted by content type (CJK, code, other).
 */
class CptBlendMixTokenModel {
  getMetadata() {
    return {
      id: 'cpt-blend-mix',
      name: 'CPT Blend/Mix',
      shortName: 'Blend/Mix',
      description: 'Sometimes best accuracy, sometimes off. 70% slower than Ultralight state machine. Blend/CPT mix. It first normalizes the text and gets a word-based count via Intl.Segmenter (with a Unicode regex fallback), then computes a character-per-token estimate weighted by content type (CJK, code, other). Code-ish text and CJK are detected with targeted regexes to adjust CPT (e.g., ~3.0 for code, ~1.0 for CJK) and to derive ratios. The final estimate blends the word and char counts with scenario-specific weights and clamps divergence to ±12% before rounding.',
      performance: {
        speed: 2, // Slow (1-5 scale)
        accuracy: 3, // Variable accuracy (1-5 scale)
        cpuUsage: 4 // High CPU usage (1-5 scale)
      },
      isDefault: false,
      benchmarkUrl: 'https://github.com/NVIDIA/RULER'
    };
  }

  estimate(rawInput, calibration = 1.0) {
    const text = this.normalizeText(rawInput);
    if (!text.length) return 0;

    const CFG = {
      wordsDivisor: 0.75,
      cptBase: 4.0,
      cjkCPT: 1.0,
      codeCPT: 3.0,
      weights: { default: [2, 1], code: [2, 1], cjk: [1, 3] },
      capPct: 0.12
    };

    const normChars = text.length;

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

    // Code & CJK features
    const codeSymbols = (text.match(/[{}\[\]();:.,=+\-*\/<>|&]/g) || []).length;
    const codeWords = (text.match(/\b[A-Za-z]*[A-Z][a-z]+[A-Za-z]*\b|[_$][A-Za-z0-9_$]*|[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+/g) || []).length;
    let codeRatio = Math.min(1, (codeSymbols + 0.5 * codeWords) / Math.max(1, wordsOnly + codeSymbols));

    const cjkCount = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
    let cjkRatio = cjkCount / Math.max(1, normChars);

    let otherRatio = 1 - cjkRatio - codeRatio;
    if (otherRatio < 0) {
      const total = cjkRatio + codeRatio;
      if (total > 0) {
        cjkRatio /= total;
        codeRatio /= total;
      } else {
        cjkRatio = 0;
        codeRatio = 0;
      }
      otherRatio = 0;
    }

    const tokens_by_words_raw = Math.round(wordsOnly / CFG.wordsDivisor);
    const cpt = CFG.cptBase * otherRatio + CFG.cjkCPT * cjkRatio + CFG.codeCPT * codeRatio;
    const tokens_by_chars_raw = Math.round(normChars / Math.max(1e-9, cpt));

    // Choose weights
    let [wW, wC] = CFG.weights.default;
    if (cjkRatio > 0.15) [wW, wC] = CFG.weights.cjk;
    else if (codeRatio > 0.30) [wW, wC] = CFG.weights.code;

    // Cap divergence
    const hiCap = Math.round(tokens_by_chars_raw * (1 + CFG.capPct));
    const loCap = Math.round(tokens_by_chars_raw * (1 - CFG.capPct));
    const words_capped = Math.max(loCap, Math.min(hiCap, tokens_by_words_raw));

    const tokens_raw = (words_capped * wW + tokens_by_chars_raw * wC) / (wW + wC);
    const finalTokens = Math.round(tokens_raw);

    return this.applyCalibration(finalTokens, calibration);
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
  module.exports = CptBlendMixTokenModel;
} else if (typeof window !== 'undefined') {
  window.CptBlendMixTokenModel = CptBlendMixTokenModel;
}