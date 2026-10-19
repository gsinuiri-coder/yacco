import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MAIN_CSS = fileURLToPath(new URL("../../app/assets/css/main.css", import.meta.url));

/** Cada sentencia de primer nivel: `prelude;` o `prelude { cuerpo }`, sin comentarios. */
function statementsOf(css: string): Array<{ prelude: string; body?: string }> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{};]+)(?:;|\{([^{}]*)\})/g)].map((match) => ({
    prelude: match[1]!.trim(),
    body: match[2],
  }));
}

function declarationsOf(body: string): string[] {
  return body
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean);
}

/**
 * Lo único que `main.css` puede tener: lo que Nuxt UI y Tailwind necesitan
 * para arrancar (sus imports) y el tema (`@theme` de Tailwind y las variables
 * `--ui-*` de Nuxt UI en `:root`). Una regla con selector propio —`body`,
 * `h1`, una clase— es aspecto puesto a mano, y va en un componente, una prop
 * o `app.config.ts`.
 */
function isThemeOrImport({ prelude, body }: { prelude: string; body?: string }): boolean {
  if (body === undefined) return /^@import\s/.test(prelude);
  const declarations = declarationsOf(body);
  if (/^@theme(\s+static)?$/.test(prelude)) {
    return declarations.every((declaration) => /^--[\w-]+\s*:/.test(declaration));
  }
  if (prelude === ":root") {
    return declarations.every((declaration) => /^--ui-[\w-]+\s*:/.test(declaration));
  }
  return false;
}

describe("main.css", () => {
  it("solo trae los imports de Tailwind y Nuxt UI y el tema, sin reglas propias", () => {
    const statements = statementsOf(readFileSync(MAIN_CSS, "utf8"));

    expect(statements.map((statement) => statement.prelude)).toEqual(
      expect.arrayContaining(['@import "tailwindcss"', '@import "@nuxt/ui"']),
    );
    expect(statements.filter((statement) => !isThemeOrImport(statement))).toEqual([]);
  });
});
