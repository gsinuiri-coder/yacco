import { defineVitestProject } from "@nuxt/test-utils/config";
import { defineConfig } from "vitest/config";

// Dos proyectos, como recomienda la guía de testing de Nuxt: `unit` corre en
// Node lo que no necesita a Nuxt (configuración, formato de dinero y fechas);
// `nuxt` monta componentes y páginas dentro de una app Nuxt real.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // lcov alimenta a SonarCloud; text deja el resumen en el log de CI.
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["app/**/*.{ts,vue}", "config/**/*.ts", "nuxt.config.ts"],
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      await defineVitestProject({
        test: {
          name: "nuxt",
          include: ["test/nuxt/**/*.test.ts"],
          environment: "nuxt",
          setupFiles: ["./vitest.setup.nuxt.ts"],
          // Montar una app Nuxt entera y compilar sus componentes en frío tarda
          // varios segundos la primera vez en cada archivo.
          testTimeout: 30_000,
          hookTimeout: 60_000,
          environmentOptions: {
            nuxt: { domEnvironment: "happy-dom" },
          },
        },
      }),
    ],
  },
});
