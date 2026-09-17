// @ts-check
// Las reglas del monorepo más las de Vue: ESLint toma la config más cercana al
// directorio donde corre, así que sin este archivo los .vue no se lintean.
import pluginVue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import rootConfig from "../../eslint.config.js";

export default tseslint.config(
  { ignores: [".nuxt/**", ".output/**", ".vercel/**", "coverage/**"] },
  ...rootConfig,
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    rules: {
      // Las páginas de Nuxt se llaman por su ruta (index.vue, [id].vue).
      "vue/multi-word-component-names": "off",
      // Nuxt auto-importa composables y utils; que un nombre exista lo
      // comprueba `nuxt typecheck`, que sí ve esas declaraciones. Es lo que
      // recomienda typescript-eslint para código TypeScript.
      "no-undef": "off",
    },
  },
  eslintConfigPrettier,
);
