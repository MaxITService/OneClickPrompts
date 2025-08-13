// modules/token-models/model-ultralight-state-machine.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// Ultralight State Machine token counting model

'use strict';

/**
 * Ultralight State Machine Token Counting Model
 * This scanner walks the string character by character, toggling an inWord flag
 * to start a new token when word-like characters begin. Very fast and efficient.
 */
class UltralightStateMachineTokenModel {
  constructor() {
    // RegExp patterns for character classification
    this.RE_WORDLIKE = /[\p{L}\p{N}_']/u;
    this.RE_CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
    this.RE_SEP = /[.,;:=\-+*/<>|&(){}\[\]]/u;
  }

  getMetadata() {
    return {
      id: 'ultralight-state-machine',
      name: 'Ultralight state machine',
      shortName: 'Ultralight SM',
      description: 'Fastest. Good accuracy. Ultralight state machine. This scanner walks the string character by character, toggling an inWord flag to start a new token when word-like characters begin. Each CJK character and each separator symbol (like .,;:=-+*/<>|&(){}[]) increments the token count, while spaces only reset the state. It aims for portability and speed without big regexes, sacrificing some nuance versus the blended model.',
      performance: {
        speed: 5, // Very fast (1-5 scale) 
        accuracy: 4, // Good accuracy (1-5 scale)
        cpuUsage: 1 // Very low CPU usage (1-5 scale)
      },
      isDefault: true,
      benchmarkUrl: 'https://github.com/NVIDIA/RULER'
    };
  }

  estimate(rawInput, calibration = 1.0) {
    const text = this.normalizeText(rawInput);
    const len = text.length;
    if (!len) return 0;

    let tokens = 0, inWord = false;

    // Character-by-character state machine
    for (let i = 0; i < len; i++) {
      const ch = text[i];
      
      // CJK character handling
      if (this.RE_CJK.test(ch)) {
        tokens++;
        inWord = false;
        continue;
      }
      
      // Space handling (reset word state)
      if (ch === ' ') {
        inWord = false;
        continue;
      }
      
      // Separator handling (count as tokens)
      if (this.RE_SEP.test(ch)) {
        tokens++;
        inWord = false;
        continue;
      }
      
      // Word-like character handling
      if (this.RE_WORDLIKE.test(ch)) {
        // Only increment token count when starting a new word
        if (!inWord) {
          tokens++;
          inWord = true;
        }
      } else {
        // Other characters (not word-like, spaces, or separators)
        tokens++;
        inWord = false;
      }
    }

    return this.applyCalibration(tokens, calibration);
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
  module.exports = UltralightStateMachineTokenModel;
} else if (typeof window !== 'undefined') {
  window.UltralightStateMachineTokenModel = UltralightStateMachineTokenModel;
}