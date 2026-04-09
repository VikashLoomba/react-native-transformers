import {
  configureTransformersEnvironment,
  ensureTransformersFetch,
  installTransformersReactNativeGlobals,
  normalizeTransformersOptions,
} from './runtime';

import type {
  EnsureTransformersFetchOptions,
  FetchImplementation,
  PatchTransformersReactNativeOptions,
  PipelineFunctionLike,
  TransformersModuleLike,
  TransformersOptions,
} from './types';

const TRANSFORMERS_MODULE_ID = '@automatalabs/react-native-transformers/internal-transformers-web';
const TRANSFORMERS_REACT_NATIVE_PATCHED = Symbol.for(
  '@automatalabs/react-native-transformers.patched-transformers',
);
const TRANSFORMERS_REACT_NATIVE_WRAPPED = Symbol.for(
  '@automatalabs/react-native-transformers.wrapped-from-pretrained',
);
const ONNX_DTYPE_RETRY_ORDER = Object.freeze([
  'fp32',
  'q8',
  'q4',
  'q4f16',
  'fp16',
  'int8',
  'uint8',
  'bnb4',
] as const);

type UnknownFunction = (this: unknown, ...args: unknown[]) => unknown;
type AsyncUnknownFunction = (this: unknown, ...args: unknown[]) => Promise<unknown>;
type PatchableTarget = Record<string, unknown>;
type PatchableLoader = Function & {
  from_pretrained?: AsyncUnknownFunction;
};
type PatchableTransformersModule = TransformersModuleLike & {
  [TRANSFORMERS_REACT_NATIVE_PATCHED]?: boolean;
  rawTransformers?: TransformersModuleLike;
};
type PatchedTransformersModule = PatchableTransformersModule & {
  configureTransformersEnvironment: typeof configureTransformersEnvironment;
  ensureTransformersFetch: typeof ensureTransformersFetch;
  installTransformersReactNativeGlobals: typeof installTransformersReactNativeGlobals;
  normalizeTransformersOptions: typeof normalizeTransformersOptions;
  patchTransformersReactNative: typeof patchTransformersReactNative;
  rawTransformers: TransformersModuleLike;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
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

function isLikelyMissingOnnxAssetError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();

  if (!message.includes('.onnx') && !message.includes('external data')) {
    return false;
  }

  return (
    message.includes('404') ||
    message.includes('not found') ||
    message.includes('missing') ||
    message.includes('could not locate file') ||
    message.includes('local file missing')
  );
}

function getRetryDtypes(initialDtype: unknown): string[] {
  const triedDtypes = new Set<string>();

  if (typeof initialDtype === 'string') {
    triedDtypes.add(initialDtype);
  }

  return ONNX_DTYPE_RETRY_ORDER.filter((dtype) => !triedDtypes.has(dtype));
}

function hasWrappedMarker(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    (value as unknown as Record<PropertyKey, unknown>)[TRANSFORMERS_REACT_NATIVE_WRAPPED] === true
  );
}

function markWrapped<T extends Function>(fn: T): T {
  Object.defineProperty(fn, TRANSFORMERS_REACT_NATIVE_WRAPPED, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });

  return fn;
}

function isFetchImplementation(value: unknown): value is FetchImplementation {
  return typeof value === 'function';
}

function getEnsureFetchOptions(options: unknown): EnsureTransformersFetchOptions | undefined {
  if (isPlainObject(options) && isFetchImplementation(options.fetch)) {
    return {
      fetch: options.fetch,
    };
  }

  return undefined;
}

function wrapPipeline(
  transformersModule: PatchableTransformersModule,
  fn: PipelineFunctionLike,
): PipelineFunctionLike {
  if (hasWrappedMarker(fn)) {
    return fn;
  }

  return markWrapped(function wrappedPipeline(
    this: unknown,
    task: string,
    model?: string,
    options?: TransformersOptions,
    ...rest: unknown[]
  ): unknown {
    const fetchOptions = getEnsureFetchOptions(options);

    if (fetchOptions) {
      ensureTransformersFetch(transformersModule, fetchOptions);
    } else {
      ensureTransformersFetch(transformersModule);
    }

    return fn.call(
      this,
      task,
      model,
      normalizeTransformersOptions(isPlainObject(options) ? options : {}),
      ...rest,
    );
  });
}

function wrapOptionsMethod(target: PatchableTarget | Function | undefined, methodName: string, optionsIndex: number): void {
  if (!target || (typeof target !== 'function' && typeof target !== 'object')) {
    return;
  }

  const patchableTarget = target as PatchableTarget;
  const original = patchableTarget[methodName];
  if (typeof original !== 'function' || hasWrappedMarker(original)) {
    return;
  }

  const originalMethod = original as UnknownFunction;
  patchableTarget[methodName] = markWrapped(function wrappedMethod(
    this: unknown,
    ...args: unknown[]
  ): unknown {
    const normalizedArgs = [...args];
    while (normalizedArgs.length <= optionsIndex) {
      normalizedArgs.push(undefined);
    }

    const rawOptions = normalizedArgs[optionsIndex];
    normalizedArgs[optionsIndex] = normalizeTransformersOptions(
      isPlainObject(rawOptions) ? rawOptions : {},
    );

    return originalMethod.apply(this, normalizedArgs);
  });
}

function wrapFromPretrained(
  target: unknown,
  transformersModule: PatchableTransformersModule,
): void {
  if (typeof target !== 'function') {
    return;
  }

  const patchableTarget = target as PatchableLoader;
  const original = patchableTarget.from_pretrained;
  if (typeof original !== 'function' || hasWrappedMarker(original)) {
    return;
  }

  const originalFromPretrained = original;
  patchableTarget.from_pretrained = markWrapped(async function wrappedFromPretrained(
    this: unknown,
    ...args: unknown[]
  ): Promise<unknown> {
    const normalizedArgs = [...args];
    while (normalizedArgs.length <= 1) {
      normalizedArgs.push(undefined);
    }

    const rawOptions = isPlainObject(normalizedArgs[1]) ? normalizedArgs[1] : {};
    const fetchOptions = getEnsureFetchOptions(rawOptions);

    if (fetchOptions) {
      ensureTransformersFetch(transformersModule, fetchOptions);
    } else {
      ensureTransformersFetch(transformersModule);
    }

    const normalizedOptions = normalizeTransformersOptions(rawOptions);
    normalizedArgs[1] = normalizedOptions;

    try {
      return await originalFromPretrained.apply(this, normalizedArgs);
    } catch (error: unknown) {
      if (normalizedOptions.dtype != null || !isLikelyMissingOnnxAssetError(error)) {
        throw error;
      }

      let lastError = error;

      for (const dtype of getRetryDtypes(normalizedOptions.dtype)) {
        try {
          normalizedArgs[1] = {
            ...normalizedOptions,
            dtype,
          };

          return await originalFromPretrained.apply(this, normalizedArgs);
        } catch (retryError: unknown) {
          if (!isLikelyMissingOnnxAssetError(retryError)) {
            throw retryError;
          }

          lastError = retryError;
        }
      }

      throw lastError;
    }
  });
}

function wrapModelRegistry(modelRegistry: unknown): void {
  if (!modelRegistry || (typeof modelRegistry !== 'function' && typeof modelRegistry !== 'object')) {
    return;
  }

  wrapOptionsMethod(modelRegistry as PatchableTarget, 'get_files', 1);
  wrapOptionsMethod(modelRegistry as PatchableTarget, 'get_model_files', 1);
  wrapOptionsMethod(modelRegistry as PatchableTarget, 'get_pipeline_files', 2);
  wrapOptionsMethod(modelRegistry as PatchableTarget, 'is_cached', 1);
  wrapOptionsMethod(modelRegistry as PatchableTarget, 'is_cached_files', 1);
  wrapOptionsMethod(modelRegistry as PatchableTarget, 'is_pipeline_cached', 2);
  wrapOptionsMethod(modelRegistry as PatchableTarget, 'is_pipeline_cached_files', 2);
  wrapOptionsMethod(modelRegistry as PatchableTarget, 'clear_cache', 1);
  wrapOptionsMethod(modelRegistry as PatchableTarget, 'clear_pipeline_cache', 2);
}

function cloneTransformersModule(
  transformers: PatchableTransformersModule,
): PatchableTransformersModule {
  const mutableTransformers = Object.create(
    Object.getPrototypeOf(transformers) as object | null,
  ) as PatchableTransformersModule;

  for (const key of Reflect.ownKeys(transformers)) {
    const descriptor = Object.getOwnPropertyDescriptor(transformers, key);

    if (!descriptor) {
      continue;
    }

    const value: unknown =
      'value' in descriptor
        ? descriptor.value
        : descriptor.get
          ? descriptor.get.call(transformers)
          : undefined;

    Object.defineProperty(mutableTransformers, key, {
      configurable: true,
      enumerable: descriptor.enumerable ?? true,
      writable: true,
      value,
    });
  }

  return mutableTransformers;
}

function patchTransformersReactNative(
  transformers: PatchableTransformersModule,
  options: PatchTransformersReactNativeOptions = {},
): PatchedTransformersModule {
  if (typeof transformers !== 'object' || transformers === null) {
    return transformers as PatchedTransformersModule;
  }

  if (transformers[TRANSFORMERS_REACT_NATIVE_PATCHED]) {
    return transformers as PatchedTransformersModule;
  }

  const mutableTransformers = cloneTransformersModule(transformers);

  installTransformersReactNativeGlobals(options.globals);
  configureTransformersEnvironment(mutableTransformers, options.environment);
  ensureTransformersFetch(mutableTransformers);

  if (typeof mutableTransformers.pipeline === 'function') {
    mutableTransformers.pipeline = wrapPipeline(mutableTransformers, mutableTransformers.pipeline);
  }

  for (const value of Object.values(mutableTransformers)) {
    wrapFromPretrained(value, mutableTransformers);
  }

  wrapModelRegistry(mutableTransformers.ModelRegistry);

  Object.assign(mutableTransformers, {
    configureTransformersEnvironment,
    ensureTransformersFetch,
    installTransformersReactNativeGlobals,
    normalizeTransformersOptions,
    patchTransformersReactNative,
    rawTransformers: transformers,
  });

  Object.defineProperty(mutableTransformers, TRANSFORMERS_REACT_NATIVE_PATCHED, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });

  return mutableTransformers as PatchedTransformersModule;
}

installTransformersReactNativeGlobals();

const transformers = patchTransformersReactNative(
  require(TRANSFORMERS_MODULE_ID) as PatchableTransformersModule,
);

export = transformers;
