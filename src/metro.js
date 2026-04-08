const path = require('node:path');

function mergeUnique(existing = [], additions = []) {
  return Array.from(new Set([...(existing ?? []), ...additions]));
}

function getTransformersReactNativeAliases(overrides = {}) {
  const packageRoot = path.resolve(__dirname, '..');
  const adapterPath = path.join(packageRoot, 'src/adapter/onnxruntime-web-webgpu.js');
  const wrapperPath = path.join(packageRoot, 'src/transformers.js');
  const transformersNodeEntryPath = require.resolve('@huggingface/transformers', {
    paths: [process.cwd(), packageRoot],
  });
  const transformersWebEntryPath = path.join(path.dirname(transformersNodeEntryPath), 'transformers.web.js');
  const onnxruntimePackagePath = require.resolve('onnxruntime-react-native/package.json', {
    paths: [process.cwd(), packageRoot],
  });
  const onnxruntimeCommonPath = require.resolve('onnxruntime-common', {
    paths: [process.cwd(), path.dirname(onnxruntimePackagePath), packageRoot],
  });

  return {
    '@huggingface/transformers': wrapperPath,
    '@automatalabs/react-native-transformers/internal-transformers-web': transformersWebEntryPath,
    'onnxruntime-node': adapterPath,
    'onnxruntime-web': adapterPath,
    'onnxruntime-web/webgpu': adapterPath,
    'onnxruntime-common': onnxruntimeCommonPath,
    ...overrides,
  };
}

function withTransformersReactNativeMetro(config, options = {}) {
  const { aliases: aliasOverrides, watchFolders = [] } = options;
  const aliases = getTransformersReactNativeAliases(aliasOverrides);
  const previousResolveRequest = config?.resolver?.resolveRequest;

  return {
    ...config,
    watchFolders: mergeUnique(config?.watchFolders, watchFolders),
    resolver: {
      ...config.resolver,
      assetExts: mergeUnique(config?.resolver?.assetExts, ['onnx', 'ort']),
      resolveRequest(context, moduleName, platform) {
        const alias =
          aliases[moduleName] ??
          (moduleName.startsWith('onnxruntime-web/') ? aliases['onnxruntime-web'] : undefined);

        if (alias) {
          return context.resolveRequest(context, alias, platform);
        }

        if (previousResolveRequest) {
          return previousResolveRequest(context, moduleName, platform);
        }

        return context.resolveRequest(context, moduleName, platform);
      },
    },
  };
}

module.exports = {
  getTransformersReactNativeAliases,
  withTransformersReactNativeMetro,
};
