// @yacco/shared es TypeScript ESM: importa sus archivos como `./x.js`, que en
// el disco son `./x.ts`. Metro no hace esa traducción (jest la hace con el
// moduleNameMapper de package.json), así que probamos el `.ts` primero.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    try {
      return context.resolveRequest(context, moduleName.replace(/\.js$/, ".ts"), platform);
    } catch {
      // No hay `.ts`: es un `.js` de verdad.
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
