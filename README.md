# @automatalabs/react-native-transformers

Use [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers) in Expo / React Native apps through [`onnxruntime-react-native`](https://www.npmjs.com/package/onnxruntime-react-native), without forking Transformers.js.

## What this package does

- adds an Expo config plugin that composes `onnxruntime-react-native`
- adds a Metro helper that aliases Transformers.js onto a React Native wrapper
- routes `onnxruntime-node` and `onnxruntime-web` imports to a React Native adapter
- normalizes React Native-friendly device options like `coreml`, `xnnpack`, `nnapi`, and `qnn`
- prefers `expo/fetch` automatically when available for streamed model downloads
- caches downloaded model files with `expo-file-system` so they survive app restarts
- supports ONNX models that use external data files (for example `*.onnx_data`)

The package keeps the public app-facing API centered on:

```js
import { pipeline, AutoTokenizer, AutoModelForSequenceClassification } from '@huggingface/transformers';
```

## Requirements

- Node `>= 18`
- `@huggingface/transformers` `^4`
- `onnxruntime-react-native` `>= 1.24.3 < 2`
- `react`
- `react-native`
- `expo` is optional, but this package is primarily aimed at Expo / Expo dev-client workflows
- `expo-file-system` is optional, but recommended if you want persistent model caching across app restarts

## Install

In an Expo app, install your native/runtime dependencies with Expo and then install this package plus Transformers.js. Include `expo-file-system` if you want automatic persistent model caching:

```sh
npx expo install expo react react-native onnxruntime-react-native expo-file-system
npm install @huggingface/transformers @automatalabs/react-native-transformers
```

If your app already has Expo / React Native set up, you only need to add the missing packages.

## Expo config plugin

Add the plugin in your app config:

```js
// app.config.js
module.exports = {
  expo: {
    plugins: ['@automatalabs/react-native-transformers'],
  },
};
```

For local development against this repository's bundled `example/` app, a relative plugin path is more reliable:

```json
{
  "expo": {
    "plugins": ["../app.plugin.js"]
  }
}
```

### ONNX Runtime Extensions

You **do not** need ONNX Runtime Extensions just to use the `coreml`, `xnnpack`, `cpu`, `nnapi`, or `qnn` execution providers.

Only enable extensions if the model itself requires ONNX Runtime Extensions custom ops. When needed, add this top-level field to your app's root `package.json`:

```json
{
  "onnxruntimeExtensionsEnabled": "true"
}
```

Then rebuild native code.

## Metro

Install the Metro helper so React Native resolves Transformers.js through the wrapper and adds `onnx` / `ort` asset extensions:

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withTransformersReactNativeMetro } = require('@automatalabs/react-native-transformers/metro');

module.exports = withTransformersReactNativeMetro(getDefaultConfig(__dirname));
```

### Monorepos / local `file:..` development

If you are developing the library and the app side by side, you may also want `watchFolders` and explicit singleton aliases for packages like `react-native` and `onnxruntime-react-native`.

See [`example/metro.config.js`](./example/metro.config.js) for a working local-dev setup.

## Babel

The published `@huggingface/transformers` web bundle uses `import.meta`, so Expo apps need Babel's import-meta transform enabled:

```js
// babel.config.js
module.exports = function babelConfig(api) {
  api.cache(true);

  return {
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
  };
};
```

## Basic usage

Once Metro is configured, import from `@huggingface/transformers` as usual.

### Example: sentiment analysis pipeline

```js
import { pipeline } from '@huggingface/transformers';

const classifier = await pipeline(
  'sentiment-analysis',
  'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
  {
    device: 'coreml', // iOS: coreml -> cpu, Android users would typically use nnapi/qnn/xnnpack/cpu
    dtype: 'q8',
  },
);

const result = await classifier('Running Transformers.js in Expo feels great.');
console.log(result);
```

### Example: direct model helpers

```js
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
} from '@huggingface/transformers';

const MODEL_ID = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';

const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, {
  device: 'coreml',
});

const model = await AutoModelForSequenceClassification.from_pretrained(MODEL_ID, {
  device: 'coreml',
  dtype: 'q8',
});

const inputs = await tokenizer('React Native inference on device is useful.');
const output = await model(inputs);
console.log(output.logits.dims);
```

### Example: chat generation with `onnx-community/LFM2.5-350M-ONNX`

This model card explicitly documents chat-style usage with Transformers.js, and this package supports its ONNX external-data layout on React Native.

```js
import { pipeline } from '@huggingface/transformers';

const generator = await pipeline(
  'text-generation',
  'onnx-community/LFM2.5-350M-ONNX',
  {
    device: 'coreml',
    dtype: 'q4',
  },
);

const messages = [
  {
    role: 'system',
    content: 'You are a helpful assistant. Reply with one short sentence.',
  },
  {
    role: 'user',
    content: 'Explain one benefit of running AI directly on a phone.',
  },
];

const output = await generator(messages, {
  max_new_tokens: 64,
  do_sample: false,
  repetition_penalty: 1.05,
});

const assistantMessage = output[0].generated_text.at(-1)?.content;
console.log(assistantMessage);
```

## React Native-specific device options

This package accepts React Native-oriented device shorthands and translates them into ONNX Runtime execution providers.

Common values:

- `auto`
- `coreml` (iOS)
- `xnnpack`
- `cpu`
- `nnapi` (Android)
- `qnn` (Android)

Example:

```js
const generator = await pipeline('text-generation', MODEL_ID, {
  device: 'xnnpack',
});
```

Under the hood these are normalized into `session_options.executionProviders` so they work with current Transformers.js expectations.

## Runtime helpers

The package also exports a few helpers from the root entrypoint.

### List supported execution providers

```js
import { getSupportedExecutionProviderNames } from '@automatalabs/react-native-transformers';

console.log(getSupportedExecutionProviderNames());
// e.g. ['cpu', 'xnnpack', 'coreml']
```

### Normalize options explicitly

```js
import { normalizeTransformersOptions } from '@automatalabs/react-native-transformers';

const options = normalizeTransformersOptions({
  device: 'coreml',
});

console.log(options.session_options.executionProviders);
```

## Notes

### `coreml` means CoreML execution provider, not native `.mlmodel` loading

Inference still goes through ONNX Runtime. Using:

```js
{ device: 'coreml' }
```

means “prefer ONNX Runtime's CoreML execution provider on iOS”, not “load a native CoreML model artifact directly”.

### `expo/fetch`

The wrapper automatically prefers `expo/fetch` when available, because the default React Native fetch implementation does not expose the response stream reader that Transformers.js expects for efficient downloads.

You can still override `env.fetch` manually if you want to.

### Model file caching

When `expo-file-system` is installed, downloaded model files are cached automatically under Expo's cache directory at:

- `Paths.cache/automatalabs-react-native-transformers/models`

That cache survives normal app restarts, but because it lives in the cache directory the OS may still evict it under storage pressure.

If you want a different location, you can provide your own cache implementation:

```js
import { env } from '@huggingface/transformers';
import { Paths } from 'expo-file-system';
import { createExpoFileSystemCache } from '@automatalabs/react-native-transformers';

env.customCache = createExpoFileSystemCache({
  directory: Paths.document,
});
env.useCustomCache = true;
```

If `expo-file-system` is not installed, the package still works — it simply skips persistent model caching.

To disable persistent model caching entirely:

```js
env.customCache = null;
env.useCustomCache = false;
```

### Fallback visibility

ONNX Runtime's JavaScript API does not expose exact per-node execution-provider usage for a successful session. You can know:

- what execution-provider order was requested
- whether your app retried on a different device / execution-provider chain

But you generally cannot prove exact per-op fallback from JavaScript alone.

## How it works

This package takes a no-fork approach:

- aliases `@huggingface/transformers` to `src/transformers.js`
- aliases `onnxruntime-node`, `onnxruntime-web`, and `onnxruntime-web/webgpu` to a React Native adapter
- reuses the unified ONNX Runtime JavaScript API shape exposed by `onnxruntime-react-native`
- patches the create-session path for React Native buffer / external-data model loading
- normalizes public `from_pretrained()` and `pipeline()` options for React Native execution providers

## Example app

The repository includes an Expo example in [`example/`](./example).

Run it with:

```sh
npm install
npm run example:ios
```

If you need a clean Metro session:

```sh
cd example
npx expo start --dev-client --clear
```

The current example app validates:

- speech text generation with `onnx-community/granite-4.0-1b-speech-ONNX`
- chat generation with `onnx-community/LFM2.5-350M-ONNX`
- requested execution-provider order and app-level retry / fallback reporting

## Package exports

- `@automatalabs/react-native-transformers`
  - runtime helpers like `getSupportedExecutionProviderNames()`
  - cache helpers like `createExpoFileSystemCache()`
- `@automatalabs/react-native-transformers/metro`
  - Metro helper
- `@automatalabs/react-native-transformers/plugin`
  - Expo config plugin entrypoint
- `@automatalabs/react-native-transformers/transformers`
  - explicit wrapper entrypoint
- `@automatalabs/react-native-transformers/app.plugin`
  - root plugin file
