import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectNoSubstitutedMarkup } from "../support/nuxt-ui-guard";

const APP_DIR = new URL("../../app/", import.meta.url);

/** Cada .vue de app/, también los que se agreguen después de 9b. */
const TEMPLATES = readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".vue"))
  .map((path) => path.replaceAll("\\", "/"))
  .sort();

describe("Toda la web con Nuxt UI nativo", () => {
  it("encuentra las plantillas de app/", () => {
    expect(TEMPLATES).toContain("layouts/default.vue");
    expect(TEMPLATES).toContain("pages/sales.vue");
  });

  it.each(TEMPLATES)(
    "%s no maqueta con tabla, formulario ni lista de definiciones a mano, ni pisa estilos",
    (path) => {
      expectNoSubstitutedMarkup(new URL(path, APP_DIR));
    },
  );
});
