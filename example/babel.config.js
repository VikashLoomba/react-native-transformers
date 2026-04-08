module.exports = function babelConfig(api) {
  api.cache(true);
  const expoPreset = require.resolve('babel-preset-expo');

  return {
    presets: [
      [
        expoPreset,
        {
          unstable_transformImportMeta: true,
        },
      ],
    ],
  };
};
