const { Platform } = require('react-native');
const ortReactNative = require('onnxruntime-react-native');
const EXPO_FETCH_MODULE_ID = 'expo/fetch';

const REACT_NATIVE_EXECUTION_PROVIDER_ONLY_DEVICES = new Set([
  'cpu',
  'coreml',
  'xnnpack',
  'nnapi',
  'qnn',
]);
const TRANSFORMERS_REACT_NATIVE_METADATA = Symbol.for(
  '@automatalabs/react-native-transformers.metadata',
);
const TRANSFORMERS_DEVICE_SURROGATE = 'auto';
const DEFAULT_MODEL_CACHE_SYMBOL = Symbol.for(
  '@automatalabs/react-native-transformers.default-expo-file-system-cache',
);

const DEFAULT_FEATURE_SET = Object.freeze({
  has() {
    return false;
  },
});

function getNavigatorUserAgent(platform) {
  switch (platform) {
    case 'ios':
      return '@automatalabs/react-native-transformers (iOS)';
    case 'android':
      return '@automatalabs/react-native-transformers (Android)';
    default:
      return '@automatalabs/react-native-transformers';
  }
}

function installTransformersReactNativeGlobals(options = {}) {
  const { installNavigatorGpuShim = true } = options;
  const result = {
    installedSelfAlias: false,
    installedWindowAlias: false,
    installedNavigatorGpuShim: false,
  };

  if (typeof globalThis.self === 'undefined') {
    globalThis.self = globalThis;
    result.installedSelfAlias = true;
  }

  if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
    result.installedWindowAlias = true;
  }

  if (!installNavigatorGpuShim) {
    return result;
  }

  if (typeof globalThis.navigator === 'undefined') {
    globalThis.navigator = {};
  }

  globalThis.navigator.userAgent ??= getNavigatorUserAgent(Platform.OS);
  globalThis.navigator.vendor ??= '';
  globalThis.navigator.product ??= 'ReactNative';

  if (!globalThis.navigator.gpu) {
    globalThis.navigator.gpu = {
      async requestAdapter() {
        return {
          features: DEFAULT_FEATURE_SET,
        };
      },
    };
    result.installedNavigatorGpuShim = true;
  }

  return result;
}

function getOptionalExpoFileSystemCacheModule() {
  try {
    return require('./expoFileSystemCache');
  } catch (error) {
    const message = String(error?.message ?? '');

    if (error?.code === 'MODULE_NOT_FOUND' && message.includes('expo-file-system')) {
      return null;
    }

    throw error;
  }
}

function createExpoFileSystemCache(options = {}) {
  const cacheModule = getOptionalExpoFileSystemCacheModule();

  if (!cacheModule) {
    throw new Error(
      'expo-file-system is not installed. Install it with `npx expo install expo-file-system` to enable persistent model caching.',
    );
  }

  return cacheModule.createExpoFileSystemCache(options);
}

function getDefaultExpoFileSystemModelCacheDirectory() {
  const cacheModule = getOptionalExpoFileSystemCacheModule();

  if (!cacheModule) {
    throw new Error(
      'expo-file-system is not installed. Install it with `npx expo install expo-file-system` to inspect the default cache directory.',
    );
  }

  return cacheModule.getDefaultExpoFileSystemModelCacheDirectory();
}

function getDefaultExpoFileSystemCache() {
  const cacheModule = getOptionalExpoFileSystemCacheModule();

  if (!cacheModule) {
    return null;
  }

  if (!globalThis[DEFAULT_MODEL_CACHE_SYMBOL]) {
    globalThis[DEFAULT_MODEL_CACHE_SYMBOL] = cacheModule.createExpoFileSystemCache({
      directory: cacheModule.getDefaultExpoFileSystemModelCacheDirectory(),
    });
  }

  return globalThis[DEFAULT_MODEL_CACHE_SYMBOL];
}

function configureTransformersEnvironment(transformers, options = {}) {
  const targetEnv = transformers?.env;

  if (!targetEnv || typeof targetEnv !== 'object') {
    return null;
  }

  const {
    allowLocalModels,
    allowRemoteModels,
    localModelPath,
    customCache,
    enableCustomCache = true,
    fetch,
  } = options;

  targetEnv.useFS = false;
  targetEnv.useFSCache = false;
  targetEnv.useBrowserCache = false;
  targetEnv.useWasmCache = false;

  if (allowLocalModels !== undefined) {
    targetEnv.allowLocalModels = allowLocalModels;
  }

  if (allowRemoteModels !== undefined) {
    targetEnv.allowRemoteModels = allowRemoteModels;
  }

  if (localModelPath !== undefined) {
    targetEnv.localModelPath = localModelPath;
  }

  if (customCache) {
    targetEnv.customCache = customCache;
    targetEnv.useCustomCache = true;
  } else if (enableCustomCache) {
    const defaultCache = getDefaultExpoFileSystemCache();

    targetEnv.customCache = defaultCache;
    targetEnv.useCustomCache = !!defaultCache;
  } else {
    targetEnv.customCache = null;
    targetEnv.useCustomCache = false;
  }

  ensureTransformersFetch(transformers, { fetch });

  return targetEnv;
}

function resolveExpoFetch() {
  try {
    return require(EXPO_FETCH_MODULE_ID).fetch;
  } catch {
    return undefined;
  }
}

function ensureTransformersFetch(transformers, options = {}) {
  const targetEnv = transformers?.env;

  if (!targetEnv || typeof targetEnv !== 'object') {
    return undefined;
  }

  if (typeof options.fetch === 'function') {
    targetEnv.fetch = options.fetch;
    return targetEnv.fetch;
  }

  const expoFetch = resolveExpoFetch();
  if (typeof expoFetch === 'function') {
    targetEnv.fetch = expoFetch;
  }

  return targetEnv.fetch;
}

function getSupportedExecutionProviderNames() {
  try {
    return (ortReactNative.listSupportedBackends?.() ?? []).map((backend) => backend.name);
  } catch {
    return [];
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isReactNativeExecutionProviderDevice(device) {
  return typeof device === 'string' && REACT_NATIVE_EXECUTION_PROVIDER_ONLY_DEVICES.has(device);
}

function normalizeTransformersDeviceValue(device) {
  if (isReactNativeExecutionProviderDevice(device)) {
    return TRANSFORMERS_DEVICE_SURROGATE;
  }

  if (isPlainObject(device)) {
    return Object.fromEntries(
      Object.entries(device).map(([key, value]) => [key, normalizeTransformersDeviceValue(value)]),
    );
  }

  return device;
}

function inferExecutionProvidersFromDeviceValue(device) {
  if (isReactNativeExecutionProviderDevice(device)) {
    return rewriteExecutionProviders([device]);
  }

  if (!isPlainObject(device)) {
    return null;
  }

  const executionProviderKeys = new Set();
  let preferredExecutionProviders = null;

  for (const value of Object.values(device)) {
    const nextExecutionProviders = inferExecutionProvidersFromDeviceValue(value);

    if (!nextExecutionProviders) {
      return null;
    }

    const key = JSON.stringify(nextExecutionProviders);
    executionProviderKeys.add(key);
    preferredExecutionProviders = nextExecutionProviders;

    if (executionProviderKeys.size > 1) {
      return null;
    }
  }

  return preferredExecutionProviders;
}

function getTransformersReactNativeMetadata(value) {
  return value?.[TRANSFORMERS_REACT_NATIVE_METADATA] ?? null;
}

function setTransformersReactNativeMetadata(value, metadata) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return value;
  }

  Object.defineProperty(value, TRANSFORMERS_REACT_NATIVE_METADATA, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: {
      ...(getTransformersReactNativeMetadata(value) ?? {}),
      ...metadata,
    },
  });

  return value;
}

function getDefaultExecutionProviders(options = {}) {
  const platform = options.platform ?? Platform.OS;
  const availableNames = new Set(options.availableNames ?? getSupportedExecutionProviderNames());
  const providers = [];

  if (platform === 'ios') {
    providers.push('coreml');
  } else if (platform === 'android') {
    providers.push('qnn', 'nnapi');
  }

  providers.push('xnnpack', 'cpu');

  if (availableNames.size === 0) {
    return providers;
  }

  return providers.filter((name) => availableNames.has(name));
}

function dedupeExecutionProviders(executionProviders) {
  const seen = new Set();
  const deduped = [];

  for (const provider of executionProviders) {
    const key =
      typeof provider === 'string'
        ? provider
        : `${provider.name}:${JSON.stringify(provider, Object.keys(provider).sort())}`;

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(provider);
    }
  }

  return deduped;
}

function fallbackProviderList(primaryName, primaryValue, fallbackNames, availableNames) {
  const providers = [];

  if (!availableNames || availableNames.size === 0 || availableNames.has(primaryName)) {
    providers.push(primaryValue);
  }

  for (const fallbackName of fallbackNames) {
    if (!availableNames || availableNames.size === 0 || availableNames.has(fallbackName)) {
      providers.push(fallbackName);
    }
  }

  return providers;
}

function rewriteExecutionProvider(provider, options = {}) {
  const availableNames = new Set(options.availableNames ?? getSupportedExecutionProviderNames());
  const defaultProviders = getDefaultExecutionProviders({
    platform: options.platform,
    availableNames,
  });

  const providerName = typeof provider === 'string' ? provider : provider?.name;

  switch (providerName) {
    case 'wasm':
      return fallbackProviderList('xnnpack', 'xnnpack', ['cpu'], availableNames);

    case 'webgpu':
    case 'gpu':
    case 'webnn':
    case 'webnn-gpu':
    case 'webnn-cpu':
    case 'webnn-npu':
    case 'cuda':
    case 'dml':
      return defaultProviders;

    case 'coreml':
    case 'nnapi':
    case 'qnn':
    case 'xnnpack':
      return fallbackProviderList(providerName, provider, ['cpu'], availableNames);

    case 'cpu':
      return availableNames.size > 0 && !availableNames.has('cpu') ? [] : [provider];

    default:
      if (!providerName) {
        return [];
      }
      if (availableNames.size > 0 && !availableNames.has(providerName)) {
        return [];
      }
      return [provider];
  }
}

function rewriteExecutionProviders(executionProviders, options = {}) {
  if (!Array.isArray(executionProviders)) {
    return executionProviders;
  }

  const availableNames = new Set(options.availableNames ?? getSupportedExecutionProviderNames());
  const rewritten = executionProviders.flatMap((provider) =>
    rewriteExecutionProvider(provider, {
      ...options,
      availableNames,
    }),
  );

  return dedupeExecutionProviders(rewritten);
}

function sanitizeSessionOptions(sessionOptions, options = {}) {
  if (!sessionOptions || typeof sessionOptions !== 'object') {
    return sessionOptions;
  }

  const sanitized = {
    ...sessionOptions,
  };

  if (Array.isArray(sessionOptions.executionProviders)) {
    sanitized.executionProviders = rewriteExecutionProviders(sessionOptions.executionProviders, options);
  }

  delete sanitized.preferredOutputLocation;
  delete sanitized.enableGraphCapture;

  return sanitized;
}

function normalizeTransformersConfig(config) {
  if (!config || typeof config !== 'object') {
    return config;
  }

  const transformersJsConfig = config['transformers.js_config'];

  if (!isPlainObject(transformersJsConfig)) {
    return config;
  }

  const originalDevice = transformersJsConfig.device;
  const normalizedDevice = normalizeTransformersDeviceValue(originalDevice);
  const preferredExecutionProviders = inferExecutionProvidersFromDeviceValue(originalDevice);
  const metadata = {};
  let didChangeConfig = false;

  if (normalizedDevice !== originalDevice) {
    const nextTransformersJsConfig = {
      ...transformersJsConfig,
      device: normalizedDevice,
    };

    if (
      isReactNativeExecutionProviderDevice(originalDevice) &&
      isPlainObject(transformersJsConfig.device_config) &&
      transformersJsConfig.device_config[originalDevice]
    ) {
      nextTransformersJsConfig.device_config = {
        ...transformersJsConfig.device_config,
        [normalizedDevice]: {
          ...(transformersJsConfig.device_config[normalizedDevice] ?? {}),
          ...transformersJsConfig.device_config[originalDevice],
        },
      };
    }

    config['transformers.js_config'] = nextTransformersJsConfig;
    didChangeConfig = true;
  }

  if (preferredExecutionProviders) {
    metadata.preferredExecutionProviders = preferredExecutionProviders;
  }

  if (originalDevice !== undefined) {
    metadata.originalDevice = originalDevice;
  }

  if (didChangeConfig || Object.keys(metadata).length > 0) {
    setTransformersReactNativeMetadata(config, metadata);
  }

  return config;
}

function normalizeTransformersOptions(options = {}) {
  const normalized = {
    ...options,
  };
  const normalizedConfig = normalizeTransformersConfig(options.config);
  const originalDevice = options.device;
  const normalizedDevice = normalizeTransformersDeviceValue(originalDevice);
  const sessionOptions = sanitizeSessionOptions(options.session_options ?? {});
  const configMetadata = getTransformersReactNativeMetadata(normalizedConfig);
  const preferredExecutionProviders =
    inferExecutionProvidersFromDeviceValue(originalDevice) ??
    configMetadata?.preferredExecutionProviders ??
    null;

  if (normalizedConfig !== undefined) {
    normalized.config = normalizedConfig;
  }

  if (normalizedDevice !== originalDevice) {
    normalized.device = normalizedDevice;
  }

  if (preferredExecutionProviders && sessionOptions.executionProviders == null) {
    sessionOptions.executionProviders = preferredExecutionProviders;
  }

  if (normalized.device == null) {
    normalized.device = 'auto';
  }

  if (Object.keys(sessionOptions).length > 0) {
    normalized.session_options = sessionOptions;
  }

  return normalized;
}

module.exports = {
  installTransformersReactNativeGlobals,
  configureTransformersEnvironment,
  ensureTransformersFetch,
  getSupportedExecutionProviderNames,
  getDefaultExecutionProviders,
  rewriteExecutionProviders,
  sanitizeSessionOptions,
  normalizeTransformersConfig,
  normalizeTransformersOptions,
  createExpoFileSystemCache,
  getDefaultExpoFileSystemModelCacheDirectory,
};
