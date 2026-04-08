import { NativeModules } from 'react-native';
import * as ortReactNative from 'onnxruntime-react-native';

import { sanitizeSessionOptions } from '../runtime';

import type {
  InferenceSession as OrtInferenceSessionApi,
  InferenceSessionHandler,
  SessionHandler,
  Tensor as OrtTensor,
} from 'onnxruntime-react-native';
import type { RunOptions, SessionOptions, ValueMetadata } from '../types';

interface SupportedBackend {
  name: string;
}

interface NativeValueMetadata {
  name: string;
  isTensor: boolean;
  type: number;
  shape: number[];
  symbolicDimensions: string[];
}

interface NativeSessionOptions extends SessionOptions {
  ortExtLibPath?: string | undefined;
}

interface NativeInferenceSessionImpl {
  loadModel(modelPath: string, options: NativeSessionOptions): Promise<void>;
  loadModel(
    buffer: ArrayBuffer,
    byteOffset: number,
    byteLength: number,
    options: NativeSessionOptions,
  ): Promise<void>;
  readonly inputMetadata: NativeValueMetadata[];
  readonly outputMetadata: NativeValueMetadata[];
  run(
    feeds: SessionHandler.FeedsType,
    fetches: SessionHandler.FetchesType,
    options: RunOptions,
  ): Promise<SessionHandler.ReturnType>;
  endProfiling(): void;
  dispose(): void;
}

interface OrtApiLike {
  createInferenceSession(): NativeInferenceSessionImpl;
  listSupportedBackends?(): SupportedBackend[];
  initOrtOnce(logLevel: number, tensorConstructor: typeof ortReactNative.Tensor): void;
}

interface OnnxruntimeNativeModule {
  install?(): void;
  ORT_EXTENSIONS_PATH?: string;
}

interface NormalizedCreateArguments {
  modelPath: string | null;
  modelBytes: Uint8Array | null;
  options: NativeSessionOptions;
}

declare global {
  var OrtApi: OrtApiLike | undefined;
}

const Module = (NativeModules as { Onnxruntime?: OnnxruntimeNativeModule }).Onnxruntime;

if (typeof globalThis.OrtApi === 'undefined' && typeof Module?.install === 'function') {
  Module.install();
}

const OrtApi: OrtApiLike =
  globalThis.OrtApi ??
  (new Proxy(
    {},
    {
      get() {
        throw new Error(
          'OrtApi is not initialized. Please make sure Onnxruntime installation is successful.',
        );
      },
    },
  ) as OrtApiLike);

const dataTypeStrings: readonly (OrtTensor.Type | undefined)[] = [
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fillNamesAndMetadata(
  rawMetadata: readonly NativeValueMetadata[] = [],
): [string[], ValueMetadata[]] {
  const names: string[] = [];
  const metadata: ValueMetadata[] = [];

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

    const shape: Array<number | string> = [];
    for (let index = 0; index < item.shape.length; index += 1) {
      const dim = item.shape[index];
      if (dim === undefined) {
        throw new Error(`Missing dimension at index ${index}.`);
      }

      if (dim === -1) {
        const symbolicDimension = item.symbolicDimensions[index];
        if (typeof symbolicDimension !== 'string') {
          throw new Error(`Missing symbolic dimension at index ${index}.`);
        }

        shape.push(symbolicDimension);
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

function getLogLevelValue(logLevel: unknown): 0 | 1 | 2 | 3 | 4 {
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
      throw new Error(`Unsupported log level: ${String(logLevel)}`);
  }
}

function normalizeCreateArguments(args: readonly unknown[]): NormalizedCreateArguments {
  const [arg0, arg1, arg2, arg3] = args;

  if (typeof arg0 === 'string') {
    if (arg1 !== undefined && !isPlainObject(arg1)) {
      throw new TypeError("'options' must be an object.");
    }

    return {
      modelPath: arg0,
      modelBytes: null,
      options: (arg1 as NativeSessionOptions | undefined) ?? {},
    };
  }

  if (arg0 instanceof Uint8Array) {
    if (arg1 !== undefined && !isPlainObject(arg1)) {
      throw new TypeError("'options' must be an object.");
    }

    return {
      modelPath: null,
      modelBytes: arg0,
      options: (arg1 as NativeSessionOptions | undefined) ?? {},
    };
  }

  if (
    arg0 instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer !== 'undefined' && arg0 instanceof SharedArrayBuffer)
  ) {
    let byteOffset = 0;
    let byteLength = arg0.byteLength;
    let options: NativeSessionOptions = {};

    if (isPlainObject(arg1)) {
      options = arg1 as NativeSessionOptions;
    } else if (typeof arg1 === 'number') {
      byteOffset = arg1;
      byteLength = typeof arg2 === 'number' ? arg2 : arg0.byteLength - byteOffset;
      options = isPlainObject(arg3) ? (arg3 as NativeSessionOptions) : {};
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

function toExactArrayBuffer(uint8Array: Uint8Array): ArrayBuffer {
  if (
    uint8Array.byteOffset === 0 &&
    uint8Array.byteLength === uint8Array.buffer.byteLength &&
    uint8Array.buffer instanceof ArrayBuffer
  ) {
    return uint8Array.buffer;
  }

  return uint8Array.slice().buffer;
}

class ReactNativeSessionHandler implements InferenceSessionHandler {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  readonly inputMetadata: readonly ValueMetadata[];
  readonly outputMetadata: readonly ValueMetadata[];

  readonly #inferenceSession: NativeInferenceSessionImpl;

  constructor(session: NativeInferenceSessionImpl) {
    this.#inferenceSession = session;

    const [inputNames, inputMetadata] = fillNamesAndMetadata(session.inputMetadata);
    const [outputNames, outputMetadata] = fillNamesAndMetadata(session.outputMetadata);

    this.inputNames = inputNames;
    this.outputNames = outputNames;
    this.inputMetadata = inputMetadata;
    this.outputMetadata = outputMetadata;
  }

  async run(
    feeds: SessionHandler.FeedsType,
    fetches: SessionHandler.FetchesType,
    options: RunOptions,
  ): Promise<SessionHandler.ReturnType> {
    return this.#inferenceSession.run(feeds, fetches, options);
  }

  async dispose(): Promise<void> {
    this.#inferenceSession.dispose();
  }

  startProfiling(): void {
    // no-op; profiling is enabled at load time by session options if requested
  }

  endProfiling(): void {
    this.#inferenceSession.endProfiling();
  }
}

type InferenceSessionConstructor = new (handler: InferenceSessionHandler) => OrtInferenceSessionApi;
const BaseInferenceSession =
  ortReactNative.InferenceSession as unknown as InferenceSessionConstructor;

class PatchedInferenceSession extends BaseInferenceSession {
  static #initialized = false;

  static async create(
    uri: string,
    options?: NativeSessionOptions,
  ): Promise<OrtInferenceSessionApi>;
  static async create(
    buffer: ArrayBufferLike,
    options?: NativeSessionOptions,
  ): Promise<OrtInferenceSessionApi>;
  static async create(
    buffer: ArrayBufferLike,
    byteOffset: number,
    byteLength?: number,
    options?: NativeSessionOptions,
  ): Promise<OrtInferenceSessionApi>;
  static async create(
    buffer: Uint8Array,
    options?: NativeSessionOptions,
  ): Promise<OrtInferenceSessionApi>;
  static async create(...args: unknown[]): Promise<OrtInferenceSessionApi> {
    const { modelPath, modelBytes, options } = normalizeCreateArguments(args);
    const sessionOptionsInput: NativeSessionOptions = {
      ...options,
      ortExtLibPath: options.ortExtLibPath ?? Module?.ORT_EXTENSIONS_PATH,
    };
    const sessionOptions = sanitizeSessionOptions(sessionOptionsInput) as NativeSessionOptions;

    if (!PatchedInferenceSession.#initialized) {
      PatchedInferenceSession.#initialized = true;
      OrtApi.initOrtOnce(getLogLevelValue(ortReactNative.env.logLevel), ortReactNative.Tensor);
    }

    const session = OrtApi.createInferenceSession();

    if (typeof modelPath === 'string') {
      await session.loadModel(modelPath, sessionOptions);
    } else if (modelBytes) {
      const modelBuffer = toExactArrayBuffer(modelBytes);
      await session.loadModel(modelBuffer, 0, modelBuffer.byteLength, sessionOptions);
    } else {
      throw new TypeError('Model bytes were not provided.');
    }

    return new PatchedInferenceSession(new ReactNativeSessionHandler(session));
  }
}

const adapterModule = {
  ...ortReactNative,
  InferenceSession: PatchedInferenceSession as unknown as typeof ortReactNative.InferenceSession,
  Tensor: ortReactNative.Tensor,
  env: ortReactNative.env,
  listSupportedBackends: OrtApi.listSupportedBackends ?? ortReactNative.listSupportedBackends,
} satisfies typeof ortReactNative;

export = adapterModule;
