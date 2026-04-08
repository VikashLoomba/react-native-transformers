const { NativeModules } = require('react-native');
const ortReactNative = require('onnxruntime-react-native');
const { sanitizeSessionOptions } = require('../runtime');

const Module = NativeModules?.Onnxruntime;

if (typeof globalThis.OrtApi === 'undefined' && typeof Module?.install === 'function') {
  Module.install();
}

const OrtApi =
  globalThis.OrtApi ??
  new Proxy(
    {},
    {
      get() {
        throw new Error(
          'OrtApi is not initialized. Please make sure Onnxruntime installation is successful.',
        );
      },
    },
  );

const dataTypeStrings = [
  undefined,
  'float32',
  'uint8',
  'int8',
  'uint16',
  'int16',
  'int32',
  'int64',
  'string',
  'bool',
  'float16',
  'float64',
  'uint32',
  'uint64',
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  'uint4',
  'int4',
];

function fillNamesAndMetadata(rawMetadata = []) {
  const names = [];
  const metadata = [];

  for (const item of rawMetadata) {
    names.push(item.name);

    if (!item.isTensor) {
      metadata.push({
        name: item.name,
        isTensor: false,
      });
      continue;
    }

    const type = dataTypeStrings[item.type];
    if (type === undefined) {
      throw new Error(`Unsupported data type: ${item.type}`);
    }

    const shape = [];
    for (let index = 0; index < item.shape.length; index += 1) {
      const dim = item.shape[index];
      if (dim === -1) {
        shape.push(item.symbolicDimensions[index]);
      } else if (dim >= 0) {
        shape.push(dim);
      } else {
        throw new Error(`Invalid dimension: ${dim}`);
      }
    }

    metadata.push({
      name: item.name,
      isTensor: true,
      type,
      shape,
    });
  }

  return [names, metadata];
}

function getLogLevelValue(logLevel) {
  switch (logLevel) {
    case 'verbose':
      return 0;
    case 'info':
      return 1;
    case 'warning':
    case undefined:
      return 2;
    case 'error':
      return 3;
    case 'fatal':
      return 4;
    default:
      throw new Error(`Unsupported log level: ${logLevel}`);
  }
}

function normalizeCreateArguments(args) {
  const [arg0, arg1, arg2, arg3] = args;

  if (typeof arg0 === 'string') {
    if (arg1 !== undefined && (typeof arg1 !== 'object' || arg1 === null || Array.isArray(arg1))) {
      throw new TypeError("'options' must be an object.");
    }

    return {
      modelPath: arg0,
      modelBytes: null,
      options: arg1 ?? {},
    };
  }

  if (arg0 instanceof Uint8Array) {
    if (arg1 !== undefined && (typeof arg1 !== 'object' || arg1 === null || Array.isArray(arg1))) {
      throw new TypeError("'options' must be an object.");
    }

    return {
      modelPath: null,
      modelBytes: arg0,
      options: arg1 ?? {},
    };
  }

  if (
    arg0 instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer !== 'undefined' && arg0 instanceof SharedArrayBuffer)
  ) {
    let byteOffset = 0;
    let byteLength = arg0.byteLength;
    let options = {};

    if (typeof arg1 === 'object' && arg1 !== null) {
      options = arg1;
    } else if (typeof arg1 === 'number') {
      byteOffset = arg1;
      byteLength = typeof arg2 === 'number' ? arg2 : arg0.byteLength - byteOffset;
      options = typeof arg3 === 'object' && arg3 !== null ? arg3 : {};
    } else if (arg1 !== undefined) {
      throw new TypeError("'options' must be an object.");
    }

    return {
      modelPath: null,
      modelBytes: new Uint8Array(arg0, byteOffset, byteLength),
      options,
    };
  }

  throw new TypeError("Unexpected argument[0]: must be 'path' or 'buffer'.");
}

function toExactArrayBuffer(uint8Array) {
  if (uint8Array.byteOffset === 0 && uint8Array.byteLength === uint8Array.buffer.byteLength) {
    return uint8Array.buffer;
  }

  return uint8Array.buffer.slice(
    uint8Array.byteOffset,
    uint8Array.byteOffset + uint8Array.byteLength,
  );
}

class ReactNativeSessionHandler {
  #inferenceSession;

  constructor(session) {
    this.#inferenceSession = session;

    const [inputNames, inputMetadata] = fillNamesAndMetadata(session.inputMetadata);
    const [outputNames, outputMetadata] = fillNamesAndMetadata(session.outputMetadata);

    this.inputNames = inputNames;
    this.outputNames = outputNames;
    this.inputMetadata = inputMetadata;
    this.outputMetadata = outputMetadata;
  }

  async run(feeds, fetches, options) {
    return this.#inferenceSession.run(feeds, fetches, options);
  }

  async dispose() {
    this.#inferenceSession.dispose();
  }

  async release() {
    this.#inferenceSession.dispose();
  }

  startProfiling() {
    // no-op; profiling is enabled at load time by session options if requested
  }

  endProfiling() {
    return this.#inferenceSession.endProfiling();
  }
}

class PatchedInferenceSession extends ortReactNative.InferenceSession {
  static #initialized = false;

  static async create(...args) {
    const { modelPath, modelBytes, options } = normalizeCreateArguments(args);
    const sessionOptions = sanitizeSessionOptions({
      ...options,
      ortExtLibPath: options?.ortExtLibPath ?? Module?.ORT_EXTENSIONS_PATH,
    });

    if (!PatchedInferenceSession.#initialized) {
      PatchedInferenceSession.#initialized = true;
      OrtApi.initOrtOnce(getLogLevelValue(ortReactNative.env.logLevel), ortReactNative.Tensor);
    }

    const session = OrtApi.createInferenceSession();

    if (typeof modelPath === 'string') {
      await session.loadModel(modelPath, sessionOptions);
    } else {
      await session.loadModel(toExactArrayBuffer(modelBytes), sessionOptions);
    }

    return new PatchedInferenceSession(new ReactNativeSessionHandler(session));
  }
}

module.exports = {
  ...ortReactNative,
  InferenceSession: PatchedInferenceSession,
  Tensor: ortReactNative.Tensor,
  env: ortReactNative.env,
  listSupportedBackends: OrtApi.listSupportedBackends ?? ortReactNative.listSupportedBackends,
};
