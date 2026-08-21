/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // WEB_ORIGIN en Render apunta a este puerto; no cambiar sin actualizarlo.
    port: 5173,
    strictPort: true,
  },
  test: {
    globals: true,
    // happy-dom en vez de jsdom: jsdom sobrescribe globalThis.AbortSignal con su
    // propia clase, y el fetch de Node (undici) rechaza esa señal con
    // "Expected signal to be an instance of AbortSignal". Como el cliente HTTP
    // sí usa AbortController para el timeout de 75s, bajo jsdom fallaría toda
    // petición de los tests por un artefacto del entorno, no del código.
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      // lcov alimenta a SonarCloud; text deja el resumen en el log de CI.
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // Plumbing sin lógica propia: el bootstrap de React, los tipos
        // ambientales de Vite y los helpers de test (MSW, render con
        // providers). Excluirlos evita inflar el denominador con archivos
        // que ningún test debería estar ejercitando directamente.
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/test/**",
        "src/**/*.test.{ts,tsx}",
      ],
    },
  },
});
