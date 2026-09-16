// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/.expo/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Los scripts de infraestructura corren en Node directamente (`node
    // scripts/*.mjs`), no dentro de ninguna app, así que ninguna config de
    // paquete los alcanza y sin esto `process` y `console` son variables no
    // declaradas.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      // fetch, AbortSignal y URL son globales de Node desde la 18: el smoke y el
      // deploy los usan sin importar nada.
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
        URL: "readonly",
      },
    },
  },
);
