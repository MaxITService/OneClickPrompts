// modules/token-models/model-registry-global.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// Ensures token counting models are registered once globally and exposes helpers.

'use strict';

(() => {
  const target = typeof globalThis !== 'undefined'
    ? globalThis
    : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : undefined));

  if (!target || target.__OCP_tokenModelsInitialized) {
    return;
  }

  const DEFAULT_MODEL_ID = 'ultralight-state-machine';
  const SUPPORTED_SITES = Object.freeze([
    'ChatGPT',
    'Claude',
    'Copilot',
    'DeepSeek',
    'AIStudio',
    'Grok',
    'Gemini',
    'Perplexity',
  ]);

  const RAW_MODEL_DEFINITIONS = [
    {
      id: 'ultralight-state-machine',
      className: 'UltralightStateMachineTokenModel',
      metadata: {
        id: 'ultralight-state-machine',
        name: 'Ultralight state machine',
        shortName: 'Ultralight SM',
        description: 'Fastest. Good accuracy. Ultralight state machine. This scanner walks the string character by character, toggling an inWord flag to start a new token when word-like characters begin. Each CJK character and each separator symbol (like .,;:=-+*/<>|&(){}[]) increments the token count, while spaces only reset the state. It aims for portability and speed without big regexes, sacrificing some nuance versus the blended model.',
        performance: {
          speed: 5,
          accuracy: 4,
          cpuUsage: 1,
        },
        isDefault: true,
        benchmarkUrl: 'https://github.com/NVIDIA/RULER',
      },
    },
    {
      id: 'single-regex-pass',
      className: 'SingleRegexPassTokenModel',
      metadata: {
        id: 'single-regex-pass',
        name: 'Single regex model',
        shortName: 'Single Regex',
        description: 'Seems to be most accurate. single-regex model. 30% slower than Ultralight state machine. A single Unicode regex matches letter sequences, numbers, individual CJK characters, or any non-whitespace symbol and returns the total matches as the token estimate. It''s extremely fast and simple because it''s one pass with no extra state. The trade-off is coarse granularity-punctuation and symbols count as their own tokens, and there''s no adjustment for code-heavy or CJK-heavy text.',
        performance: {
          speed: 4,
          accuracy: 5,
          cpuUsage: 2,
        },
        isDefault: false,
        benchmarkUrl: 'https://github.com/NVIDIA/RULER',
      },
    },
    {
      id: 'simple',
      className: 'SimpleTokenModel',
      metadata: {
        id: 'simple',
        name: '1 word is 4 tokens',
        shortName: 'Simple (1:4)',
        description: 'Simple approximation: 1 token � 4 characters. Much faster and uses minimal CPU, but less accurate especially with code or non-English text. Good for modest machines or extremely long chats where speed matters more than precision.',
        performance: {
          speed: 5,
          accuracy: 2,
          cpuUsage: 1,
        },
        isDefault: false,
        benchmarkUrl: 'https://github.com/NVIDIA/RULER',
      },
    },
    {
      id: 'advanced',
      className: 'AdvancedTokenModel',
      metadata: {
        id: 'advanced',
        name: 'Advanced heuristics',
        shortName: 'Advanced',
        description: 'Uses intelligent heuristics that adapt to different content types (code, CJK text, etc.) for better accuracy. Slower but more precise - can use significant CPU on very long conversations. Blends word-based and character-based estimates.',
        performance: {
          speed: 3,
          accuracy: 4,
          cpuUsage: 4,
        },
        isDefault: false,
        benchmarkUrl: 'https://github.com/NVIDIA/RULER',
      },
    },
    {
      id: 'cpt-blend-mix',
      className: 'CptBlendMixTokenModel',
      metadata: {
        id: 'cpt-blend-mix',
        name: 'CPT Blend/Mix',
        shortName: 'Blend/Mix',
        description: 'Sometimes best accuracy, sometimes off. 70% slower than Ultralight state machine. Blend/CPT mix. It first normalizes the text and gets a word-based count via Intl.Segmenter (with a Unicode regex fallback), then computes a character-per-token estimate weighted by content type (CJK, code, other). Code-ish text and CJK are detected with targeted regexes to adjust CPT (e.g., ~3.0 for code, ~1.0 for CJK) and to derive ratios. The final estimate blends the word and char counts with scenario-specific weights and clamps divergence to �12% before rounding.',
        performance: {
          speed: 2,
          accuracy: 3,
          cpuUsage: 4,
        },
        isDefault: false,
        benchmarkUrl: 'https://github.com/NVIDIA/RULER',
      },
    },
  ];

  const MODEL_DEFINITIONS = Object.freeze(RAW_MODEL_DEFINITIONS.map((def) => Object.freeze({
    id: def.id,
    className: def.className,
    metadata: Object.freeze({ ...def.metadata, isDefault: def.metadata.id === DEFAULT_MODEL_ID }),
  })));

  const metadataById = MODEL_DEFINITIONS.reduce((acc, def) => {
    acc[def.id] = def.metadata;
    return acc;
  }, Object.create(null));

  const modelIds = Object.freeze(MODEL_DEFINITIONS.map((def) => def.id));
  const metadataList = Object.freeze(modelIds.map((id) => metadataById[id]));
  const legacyMethodMap = Object.freeze({
    simple: 'simple',
    advanced: 'advanced',
  });

  function createRegistryInstance() {
    const RegistryCtor = target.TokenModelRegistry;
    if (typeof RegistryCtor !== 'function') {
      return null;
    }
    const registry = new RegistryCtor();
    MODEL_DEFINITIONS.forEach((def) => {
      const ctor = target[def.className];
      if (typeof ctor === 'function') {
        try {
          registry.register(new ctor());
        } catch (err) {
          /* silent */
        }
      }
    });

    if (typeof registry.setDefaultModel === 'function' && registry.hasModel && registry.hasModel(DEFAULT_MODEL_ID)) {
      try {
        registry.setDefaultModel(DEFAULT_MODEL_ID);
      } catch (err) {
        /* ignore */
      }
    }

    return registry;
  }

  const catalog = Object.freeze({
    defaultModelId: DEFAULT_MODEL_ID,
    supportedSites: SUPPORTED_SITES,
    modelIds,
    metadataById,
    metadataList,
    legacyMethodMap,
    definitions: MODEL_DEFINITIONS,
    createRegistryInstance,
    getModelMetadata(modelId) {
      return metadataById[modelId] || null;
    },
    getModelClassName(modelId) {
      const def = MODEL_DEFINITIONS.find((item) => item.id === modelId);
      return def ? def.className : null;
    },
  });

  Object.defineProperty(target, 'OCP_TOKEN_MODEL_CATALOG', {
    value: catalog,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  if (!target.OCP_createTokenModelRegistry) {
    target.OCP_createTokenModelRegistry = () => createRegistryInstance();
  }

  if (!target.OCP_TOKEN_MODEL_IDS) {
    target.OCP_TOKEN_MODEL_IDS = modelIds;
  }

  if (!target.OCP_TOKEN_MODEL_DEFAULT_ID) {
    target.OCP_TOKEN_MODEL_DEFAULT_ID = DEFAULT_MODEL_ID;
  }

  if (!target.OCP_TOKEN_MODEL_SUPPORTED_SITES) {
    target.OCP_TOKEN_MODEL_SUPPORTED_SITES = SUPPORTED_SITES;
  }

  target.__OCP_tokenModelsInitialized = true;
})();
