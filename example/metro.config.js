const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withTransformersReactNativeMetro } = require('@automatalabs/react-native-transformers/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');
const appNodeModulesPath = path.resolve(projectRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);
config.resolver.nodeModulesPaths = [
  appNodeModulesPath,
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = withTransformersReactNativeMetro(config, {
  watchFolders: [workspaceRoot],
  aliases: {
    'onnxruntime-react-native': path.resolve(appNodeModulesPath, 'onnxruntime-react-native'),
    'react-native': path.resolve(appNodeModulesPath, 'react-native'),
  },
});
