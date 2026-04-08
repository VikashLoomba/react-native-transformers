type ExpoConfig = Record<string, unknown>;
type ExpoConfigPlugin<TConfig extends ExpoConfig = ExpoConfig> = (config: TConfig) => TConfig;
type ExpoConfigPluginModule<TConfig extends ExpoConfig = ExpoConfig> =
  | ExpoConfigPlugin<TConfig>
  | {
      default?: ExpoConfigPlugin<TConfig>;
    };

function requireFromProject(moduleId: string): unknown {
  return require(require.resolve(moduleId, { paths: [process.cwd(), __dirname] }));
}

function withReactNativeTransformers<TConfig extends ExpoConfig>(config: TConfig): TConfig {
  const onnxruntimeReactNativePlugin = requireFromProject(
    'onnxruntime-react-native/app.plugin',
  ) as ExpoConfigPluginModule<TConfig>;
  const withOnnxruntimeReactNative =
    typeof onnxruntimeReactNativePlugin === 'function'
      ? onnxruntimeReactNativePlugin
      : onnxruntimeReactNativePlugin.default;

  if (typeof withOnnxruntimeReactNative !== 'function') {
    throw new TypeError('onnxruntime-react-native/app.plugin did not export a config plugin.');
  }

  return withOnnxruntimeReactNative(config);
}

export = withReactNativeTransformers;
