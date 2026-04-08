const {
  configureTransformersEnvironment,
  ensureTransformersFetch,
  installTransformersReactNativeGlobals,
  normalizeTransformersOptions,
} = require('./runtime');

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
]);

function getErrorMessage(error) {
  return String(error?.stack ?? error?.message ?? error ?? '');
}

function isLikelyMissingOnnxAssetError(error) {
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

function getRetryDtypes(initialDtype) {
  const triedDtypes = new Set();

  if (typeof initialDtype === 'string') {
    triedDtypes.add(initialDtype);
  }

  return ONNX_DTYPE_RETRY_ORDER.filter((dtype) => !triedDtypes.has(dtype));
}

function wrapPipeline(fn) {
  if (typeof fn !== 'function' || fn[TRANSFORMERS_REACT_NATIVE_WRAPPED]) {
    return fn;
  }

  const wrapped = function wrappedPipeline(task, model, options, ...rest) {
    ensureTransformersFetch(transformers, options);
    return fn.call(this, task, model, normalizeTransformersOptions(options ?? {}), ...rest);
  };

  Object.defineProperty(wrapped, TRANSFORMERS_REACT_NATIVE_WRAPPED, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });

  return wrapped;
}

function wrapOptionsMethod(target, methodName, optionsIndex) {
  if (!target || (typeof target !== 'function' && typeof target !== 'object')) {
    return;
  }

  const original = target[methodName];
  if (typeof original !== 'function') {
    return;
  }

  if (original[TRANSFORMERS_REACT_NATIVE_WRAPPED]) {
    return;
  }

  target[methodName] = function wrappedMethod(...args) {
    const normalizedArgs = [...args];
    while (normalizedArgs.length <= optionsIndex) {
      normalizedArgs.push(undefined);
    }

    normalizedArgs[optionsIndex] = normalizeTransformersOptions(normalizedArgs[optionsIndex] ?? {});
    return original.apply(this, normalizedArgs);
  };

  Object.defineProperty(target[methodName], TRANSFORMERS_REACT_NATIVE_WRAPPED, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });
}

function wrapFromPretrained(target) {
  if (typeof target !== 'function') {
    return;
  }

  const original = target.from_pretrained;
  if (typeof original !== 'function' || original[TRANSFORMERS_REACT_NATIVE_WRAPPED]) {
    return;
  }

  target.from_pretrained = async function wrappedFromPretrained(...args) {
    const normalizedArgs = [...args];
    while (normalizedArgs.length <= 1) {
      normalizedArgs.push(undefined);
    }

    const rawOptions = normalizedArgs[1] ?? {};
    ensureTransformersFetch(transformers, rawOptions);
    const normalizedOptions = normalizeTransformersOptions(rawOptions);
    normalizedArgs[1] = normalizedOptions;

    try {
      return await original.apply(this, normalizedArgs);
    } catch (error) {
      if (rawOptions?.dtype != null || !isLikelyMissingOnnxAssetError(error)) {
        throw error;
      }

      let lastError = error;

      for (const dtype of getRetryDtypes(normalizedOptions.dtype)) {
        try {
          normalizedArgs[1] = {
            ...normalizedOptions,
            dtype,
          };

          return await original.apply(this, normalizedArgs);
        } catch (retryError) {
          if (!isLikelyMissingOnnxAssetError(retryError)) {
            throw retryError;
          }

          lastError = retryError;
        }
      }

      throw lastError;
    }
  };

  Object.defineProperty(target.from_pretrained, TRANSFORMERS_REACT_NATIVE_WRAPPED, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });
}

function wrapModelRegistry(modelRegistry) {
  wrapOptionsMethod(modelRegistry, 'get_files', 1);
  wrapOptionsMethod(modelRegistry, 'get_model_files', 1);
  wrapOptionsMethod(modelRegistry, 'get_pipeline_files', 2);
  wrapOptionsMethod(modelRegistry, 'is_cached', 1);
  wrapOptionsMethod(modelRegistry, 'is_cached_files', 1);
  wrapOptionsMethod(modelRegistry, 'is_pipeline_cached', 2);
  wrapOptionsMethod(modelRegistry, 'is_pipeline_cached_files', 2);
  wrapOptionsMethod(modelRegistry, 'clear_cache', 1);
  wrapOptionsMethod(modelRegistry, 'clear_pipeline_cache', 2);
}

function patchTransformersReactNative(transformers, options = {}) {
  if (!transformers || typeof transformers !== 'object') {
    return transformers;
  }

  if (transformers[TRANSFORMERS_REACT_NATIVE_PATCHED]) {
    return transformers;
  }

  installTransformersReactNativeGlobals(options.globals);
  configureTransformersEnvironment(transformers, options.environment);
  ensureTransformersFetch(transformers, options.environment);

  if (typeof transformers.pipeline === 'function') {
    transformers.pipeline = wrapPipeline(transformers.pipeline);
  }

  for (const value of Object.values(transformers)) {
    wrapFromPretrained(value);
  }

  wrapModelRegistry(transformers.ModelRegistry);

  Object.assign(transformers, {
    configureTransformersEnvironment,
    ensureTransformersFetch,
    installTransformersReactNativeGlobals,
    normalizeTransformersOptions,
    patchTransformersReactNative,
    rawTransformers: transformers,
  });

  Object.defineProperty(transformers, TRANSFORMERS_REACT_NATIVE_PATCHED, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });

  return transformers;
}

installTransformersReactNativeGlobals();

const transformers = patchTransformersReactNative(require(TRANSFORMERS_MODULE_ID));

module.exports = transformers;
