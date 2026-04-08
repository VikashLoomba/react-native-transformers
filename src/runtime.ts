import { Platform } from 'react-native';
import * as ortReactNative from 'onnxruntime-react-native';

import type {
  CacheLike,
  ConfigureTransformersEnvironmentOptions,
  EnsureTransformersFetchOptions,
  ExecutionProviderLike,
  FetchImplementation,
  GetDefaultExecutionProvidersOptions,
  InstallGlobalsOptions,
  InstallGlobalsResult,
  ReactNativeExecutionProviderName,
  RewriteExecutionProviderOptions,
  SessionOptions,
  TransformersConfig,
  TransformersEnvironmentLike,
  TransformersModuleLike,
  TransformersOptions,
  TransformersReactNativeMetadata,
} from './types';
import type * as ExpoFileSystemCacheModule from './expoFileSystemCache';
import type {
  ExpoFileSystemCache,
  ExpoFileSystemCacheOptions,
} from './expoFileSystemCache';

const EXPO_FETCH_MODULE_ID = 'expo/fetch';
const REACT_NATIVE_EXECUTION_PROVIDER_ONLY_DEVICES = new Set<ReactNativeExecutionProviderName>([
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

interface NavigatorGpuShim {
  requestAdapter(): Promise<{
    features: {
      has(feature: string): boolean;
    };
  }>;
}

interface MutableNavigator {
  userAgent?: string;
  vendor?: string;
  product?: string;
  gpu?: NavigatorGpuShim;
}

interface MutableGlobalScope {
  self?: typeof globalThis;
  window?: typeof globalThis;
  navigator?: MutableNavigator;
  [DEFAULT_MODEL_CACHE_SYMBOL]?: CacheLike | null;
}

type MetadataCarrier = Record<PropertyKey, unknown> | ((...args: never[]) => unknown);

type OptionalExpoFileSystemCacheModule = typeof ExpoFileSystemCacheModule;

const DEFAULT_FEATURE_SET = Object.freeze({
  has(): boolean {
    return false;
  },
});

const globalScope = globalThis as unknown as MutableGlobalScope;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getTransformersEnvironment(
  transformers: TransformersModuleLike | null | undefined,
): TransformersEnvironmentLike | null {
  const targetEnv = transformers?.env;
  return isObjectRecord(targetEnv) ? (targetEnv as TransformersEnvironmentLike) : null;
}

function getNavigatorUserAgent(platform: string): string {
  switch (platform) {
    case 'ios':
      return '@automatalabs/react-native-transformers (iOS)';
    case 'android':
      return '@automatalabs/react-native-transformers (Android)';
    default:
      return '@automatalabs/react-native-transformers';
  }
}

function isModuleNotFoundError(error: unknown): boolean {
  return isObjectRecord(error) && error.code === 'MODULE_NOT_FOUND';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (
    typeof error === 'number' ||
    typeof error === 'boolean' ||
    typeof error === 'bigint' ||
    typeof error === 'symbol'
  ) {
    return String(error);
  }

  if (error === null || error === undefined) {
    return '';
  }

  if (isPlainObject(error)) {
    try {
      return JSON.stringify(error);
    } catch {
      return '[object Object]';
    }
  }

  return Object.prototype.toString.call(error);
}

function isMetadataCarrier(value: unknown): value is MetadataCarrier {
  return isObjectRecord(value) || typeof value === 'function';
}

export function installTransformersReactNativeGlobals(
  options: InstallGlobalsOptions = {},
): InstallGlobalsResult {
  const { installNavigatorGpuShim = true } = options;
  const result: InstallGlobalsResult = {
    installedSelfAlias: false,
    installedWindowAlias: false,
    installedNavigatorGpuShim: false,
  };

  if (typeof globalScope.self === 'undefined') {
    globalScope.self = globalThis;
    result.installedSelfAlias = true;
  }

  if (typeof globalScope.window === 'undefined') {
    globalScope.window = globalThis;
    result.installedWindowAlias = true;
  }

  if (!installNavigatorGpuShim) {
    return result;
  }

  if (typeof globalScope.navigator === 'undefined') {
    globalScope.navigator = {};
  }

  const navigator = globalScope.navigator ?? (globalScope.navigator = {});

  if (typeof navigator.userAgent !== 'string' || navigator.userAgent.length === 0) {
    navigator.userAgent = getNavigatorUserAgent(Platform.OS);
  }

  if (typeof navigator.vendor !== 'string') {
    navigator.vendor = '';
  }

  if (typeof navigator.product !== 'string') {
    navigator.product = 'ReactNative';
  }

  if (!navigator.gpu) {
    navigator.gpu = {
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

function getOptionalExpoFileSystemCacheModule(): OptionalExpoFileSystemCacheModule | null {
  try {
    return require('./expoFileSystemCache') as OptionalExpoFileSystemCacheModule;
  } catch (error: unknown) {
    if (isModuleNotFoundError(error) && getErrorMessage(error).includes('expo-file-system')) {
      return null;
    }

    throw error;
  }
}

export function createExpoFileSystemCache(
  options: ExpoFileSystemCacheOptions = {},
): ExpoFileSystemCache {
  const cacheModule = getOptionalExpoFileSystemCacheModule();

  if (!cacheModule) {
    throw new Error(
      'expo-file-system is not installed. Install it with `npx expo install expo-file-system` to enable persistent model caching.',
    );
  }

  return cacheModule.createExpoFileSystemCache(options);
}

export function getDefaultExpoFileSystemModelCacheDirectory(): ReturnType<
  OptionalExpoFileSystemCacheModule['getDefaultExpoFileSystemModelCacheDirectory']
> {
  const cacheModule = getOptionalExpoFileSystemCacheModule();

  if (!cacheModule) {
    throw new Error(
      'expo-file-system is not installed. Install it with `npx expo install expo-file-system` to inspect the default cache directory.',
    );
  }

  return cacheModule.getDefaultExpoFileSystemModelCacheDirectory();
}

function getDefaultExpoFileSystemCache(): CacheLike | null {
  const cacheModule = getOptionalExpoFileSystemCacheModule();

  if (!cacheModule) {
    return null;
  }

  if (!globalScope[DEFAULT_MODEL_CACHE_SYMBOL]) {
    globalScope[DEFAULT_MODEL_CACHE_SYMBOL] = cacheModule.createExpoFileSystemCache({
      directory: cacheModule.getDefaultExpoFileSystemModelCacheDirectory(),
    });
  }

  return globalScope[DEFAULT_MODEL_CACHE_SYMBOL] ?? null;
}

export function configureTransformersEnvironment(
  transformers: TransformersModuleLike | null | undefined,
  options: ConfigureTransformersEnvironmentOptions = {},
): TransformersEnvironmentLike | null {
  const targetEnv = getTransformersEnvironment(transformers);

  if (!targetEnv) {
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
    targetEnv.useCustomCache = defaultCache !== null;
  } else {
    targetEnv.customCache = null;
    targetEnv.useCustomCache = false;
  }

  if (fetch !== undefined) {
    ensureTransformersFetch(transformers, { fetch });
  } else {
    ensureTransformersFetch(transformers);
  }

  return targetEnv;
}

function resolveExpoFetch(): FetchImplementation | undefined {
  try {
    const expoFetchModule = require(EXPO_FETCH_MODULE_ID) as unknown;

    if (isObjectRecord(expoFetchModule) && typeof expoFetchModule.fetch === 'function') {
      return expoFetchModule.fetch as FetchImplementation;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function ensureTransformersFetch(
  transformers: TransformersModuleLike | null | undefined,
  options: EnsureTransformersFetchOptions = {},
): FetchImplementation | undefined {
  const targetEnv = getTransformersEnvironment(transformers);

  if (!targetEnv) {
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

export function getSupportedExecutionProviderNames(): string[] {
  try {
    return (ortReactNative.listSupportedBackends?.() ?? []).map((backend) => backend.name);
  } catch {
    return [];
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isObjectRecord(value) && !Array.isArray(value);
}

function isReactNativeExecutionProviderDevice(
  device: unknown,
): device is ReactNativeExecutionProviderName {
  return (
    typeof device === 'string' &&
    REACT_NATIVE_EXECUTION_PROVIDER_ONLY_DEVICES.has(device as ReactNativeExecutionProviderName)
  );
}

function normalizeTransformersDeviceValue(device: unknown): unknown {
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

function inferExecutionProvidersFromDeviceValue(device: unknown): ExecutionProviderLike[] | null {
  if (isReactNativeExecutionProviderDevice(device)) {
    return rewriteExecutionProviders([device]);
  }

  if (!isPlainObject(device)) {
    return null;
  }

  const executionProviderKeys = new Set<string>();
  let preferredExecutionProviders: ExecutionProviderLike[] | null = null;

  for (const value of Object.values(device)) {
    const nextExecutionProviders = inferExecutionProvidersFromDeviceValue(value);

    if (!nextExecutionProviders) {
      return null;
    }

    executionProviderKeys.add(JSON.stringify(nextExecutionProviders));
    preferredExecutionProviders = nextExecutionProviders;

    if (executionProviderKeys.size > 1) {
      return null;
    }
  }

  return preferredExecutionProviders;
}

function getTransformersReactNativeMetadata(value: unknown): TransformersReactNativeMetadata | null {
  if (!isMetadataCarrier(value)) {
    return null;
  }

  const carrier = value as MetadataCarrier & {
    [TRANSFORMERS_REACT_NATIVE_METADATA]?: TransformersReactNativeMetadata;
  };

  return carrier[TRANSFORMERS_REACT_NATIVE_METADATA] ?? null;
}

function setTransformersReactNativeMetadata<T>(
  value: T,
  metadata: TransformersReactNativeMetadata,
): T {
  if (!isMetadataCarrier(value)) {
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

export function getDefaultExecutionProviders(
  options: GetDefaultExecutionProvidersOptions = {},
): string[] {
  const platform = options.platform ?? Platform.OS;
  const availableNames = new Set(options.availableNames ?? getSupportedExecutionProviderNames());
  const providers: string[] = [];

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

function dedupeExecutionProviders(
  executionProviders: readonly ExecutionProviderLike[],
): ExecutionProviderLike[] {
  const seen = new Set<string>();
  const deduped: ExecutionProviderLike[] = [];

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

function fallbackProviderList(
  primaryName: string,
  primaryValue: ExecutionProviderLike,
  fallbackNames: readonly string[],
  availableNames?: ReadonlySet<string>,
): ExecutionProviderLike[] {
  const providers: ExecutionProviderLike[] = [];

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

function rewriteExecutionProvider(
  provider: ExecutionProviderLike,
  options: RewriteExecutionProviderOptions = {},
): ExecutionProviderLike[] {
  const availableNames = new Set(options.availableNames ?? getSupportedExecutionProviderNames());
  const defaultProviders = getDefaultExecutionProviders(
    options.platform !== undefined
      ? {
          platform: options.platform,
          availableNames,
        }
      : {
          availableNames,
        },
  );

  const providerName = typeof provider === 'string' ? provider : provider.name;

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

export function rewriteExecutionProviders(
  executionProviders: readonly ExecutionProviderLike[] | undefined,
  options: RewriteExecutionProviderOptions = {},
): ExecutionProviderLike[] {
  if (!Array.isArray(executionProviders)) {
    return [];
  }

  const availableNames = new Set(options.availableNames ?? getSupportedExecutionProviderNames());
  const rewritten = executionProviders.flatMap((provider: ExecutionProviderLike) =>
    rewriteExecutionProvider(provider, {
      ...options,
      availableNames,
    }),
  );

  return dedupeExecutionProviders(rewritten);
}

export function sanitizeSessionOptions<T extends SessionOptions | null | undefined>(
  sessionOptions: T,
  options: RewriteExecutionProviderOptions = {},
): T {
  if (!isPlainObject(sessionOptions)) {
    return sessionOptions;
  }

  const sanitized: SessionOptions = {
    ...sessionOptions,
  };

  if (Array.isArray(sessionOptions.executionProviders)) {
    sanitized.executionProviders = rewriteExecutionProviders(
      sessionOptions.executionProviders,
      options,
    );
  }

  delete sanitized.preferredOutputLocation;
  delete sanitized.enableGraphCapture;

  return sanitized as T;
}

export function normalizeTransformersConfig<T extends TransformersConfig | null | undefined>(
  config: T,
): T {
  if (!isPlainObject(config)) {
    return config;
  }

  const typedConfig = config as TransformersConfig;
  const transformersJsConfig = typedConfig['transformers.js_config'];

  if (!isPlainObject(transformersJsConfig)) {
    return config;
  }

  const originalDevice = transformersJsConfig.device;
  const normalizedDevice = normalizeTransformersDeviceValue(originalDevice);
  const preferredExecutionProviders = inferExecutionProvidersFromDeviceValue(originalDevice);
  const metadata: TransformersReactNativeMetadata = {};
  let didChangeConfig = false;

  if (normalizedDevice !== originalDevice) {
    const nextTransformersJsConfig: TransformersConfig['transformers.js_config'] = {
      ...transformersJsConfig,
      device: normalizedDevice,
    };

    if (
      isReactNativeExecutionProviderDevice(originalDevice) &&
      isPlainObject(transformersJsConfig.device_config)
    ) {
      const originalDeviceConfig = transformersJsConfig.device_config[originalDevice];
      const surrogateDeviceConfig = transformersJsConfig.device_config[normalizedDevice as string];

      if (isPlainObject(originalDeviceConfig)) {
        nextTransformersJsConfig.device_config = {
          ...transformersJsConfig.device_config,
          [normalizedDevice as string]: {
            ...(isPlainObject(surrogateDeviceConfig) ? surrogateDeviceConfig : {}),
            ...originalDeviceConfig,
          },
        };
      }
    }

    typedConfig['transformers.js_config'] = nextTransformersJsConfig;
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

export function normalizeTransformersOptions(
  options: TransformersOptions = {},
): TransformersOptions {
  const normalized: TransformersOptions = isPlainObject(options) ? { ...options } : {};
  const normalizedConfig = normalizeTransformersConfig(normalized.config);
  const originalDevice = normalized.device;
  const normalizedDevice = normalizeTransformersDeviceValue(originalDevice);
  const sessionOptions = sanitizeSessionOptions(normalized.session_options ?? {}) ?? {};
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
    normalized.device = TRANSFORMERS_DEVICE_SURROGATE;
  }

  if (Object.keys(sessionOptions).length > 0) {
    normalized.session_options = sessionOptions;
  }

  return normalized;
}
