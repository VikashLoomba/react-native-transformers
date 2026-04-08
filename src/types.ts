import type { InferenceSession } from 'onnxruntime-react-native';

export type FetchImplementation = typeof fetch;
export type RequestLike = string | URL | Request;
export type ExecutionProviderLike = InferenceSession.ExecutionProviderConfig;
export type SessionOptions = InferenceSession.SessionOptions;
export type RunOptions = InferenceSession.RunOptions;
export type ValueMetadata = InferenceSession.ValueMetadata;
export type FeedsType = InferenceSession.FeedsType;
export type FetchesType = InferenceSession.FetchesType;
export type InferenceReturnType = InferenceSession.ReturnType;

export type ReactNativeExecutionProviderName = 'cpu' | 'coreml' | 'xnnpack' | 'nnapi' | 'qnn';

export interface CacheProgressInfo {
  progress: number;
  loaded: number;
  total: number;
}

export type CacheProgressCallback = (info: CacheProgressInfo) => void;

export interface CacheLike {
  match(request: RequestLike): Promise<Response | undefined>;
  put(
    request: RequestLike,
    response: Response,
    progressCallback?: CacheProgressCallback,
  ): Promise<void>;
  delete(request: RequestLike): Promise<boolean>;
}

export interface TransformersEnvironmentLike {
  useFS: boolean;
  useFSCache: boolean;
  useBrowserCache: boolean;
  useWasmCache: boolean;
  allowLocalModels?: boolean;
  allowRemoteModels?: boolean;
  localModelPath?: string;
  customCache?: CacheLike | null;
  useCustomCache?: boolean;
  fetch?: FetchImplementation;
  [key: string]: unknown;
}

export interface TransformersJsConfig {
  device?: unknown;
  device_config?: Record<string, Record<string, unknown> | undefined>;
  [key: string]: unknown;
}

export interface TransformersConfig {
  'transformers.js_config'?: TransformersJsConfig;
  [key: string]: unknown;
}

export interface TransformersOptions {
  config?: TransformersConfig;
  device?: unknown;
  dtype?: string | Record<string, string>;
  session_options?: SessionOptions;
  [key: string]: unknown;
}

export interface InstallGlobalsOptions {
  installNavigatorGpuShim?: boolean;
}

export interface InstallGlobalsResult {
  installedSelfAlias: boolean;
  installedWindowAlias: boolean;
  installedNavigatorGpuShim: boolean;
}

export interface ConfigureTransformersEnvironmentOptions {
  allowLocalModels?: boolean | undefined;
  allowRemoteModels?: boolean | undefined;
  localModelPath?: string | undefined;
  customCache?: CacheLike | null | undefined;
  enableCustomCache?: boolean | undefined;
  fetch?: FetchImplementation | undefined;
}

export interface EnsureTransformersFetchOptions {
  fetch?: FetchImplementation | undefined;
}

export interface GetDefaultExecutionProvidersOptions {
  platform?: string | undefined;
  availableNames?: Iterable<string> | undefined;
}

export type RewriteExecutionProviderOptions = GetDefaultExecutionProvidersOptions;

export interface TransformersReactNativeMetadata {
  preferredExecutionProviders?: ExecutionProviderLike[];
  originalDevice?: unknown;
}

export interface PipelineFunctionLike {
  (task: string, model?: string, options?: TransformersOptions, ...rest: unknown[]): unknown;
}

export interface ModelRegistryLike {
  [key: string]: unknown;
}

export interface TransformersModuleLike {
  env?: TransformersEnvironmentLike;
  pipeline?: PipelineFunctionLike;
  ModelRegistry?: ModelRegistryLike;
  [key: string]: unknown;
}

export interface PatchTransformersReactNativeOptions {
  globals?: InstallGlobalsOptions | undefined;
  environment?: ConfigureTransformersEnvironmentOptions | undefined;
}
