function requireFromProject(moduleId) {
  return require(require.resolve(moduleId, { paths: [process.cwd(), __dirname] }));
}

function withReactNativeTransformers(config) {
  const onnxruntimeReactNativePlugin = requireFromProject('onnxruntime-react-native/app.plugin');
  const withOnnxruntimeReactNative =
    onnxruntimeReactNativePlugin.default ?? onnxruntimeReactNativePlugin;

  return withOnnxruntimeReactNative(config);
}

module.exports = withReactNativeTransformers;
