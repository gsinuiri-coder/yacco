/**
 * Tests del chequeo del token de Vercel en el preflight: de dónde sale la
 * fecha de vencimiento y qué dice el mensaje cuando el token no sirve. El
 * `vercel whoami` en sí se verificó a mano contra la CLI (ver el script).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { invalidTokenMessage, readTokenExpiry } from "./check-vercel-token.mjs";
import { REPO_ROOT } from "./lib.mjs";

describe("readTokenExpiry", () => {
  test("lee la fecha de la fila del token en el PROGRESO.md real", () => {
    // Contra el archivo de verdad: si alguien cambia el formato de la tabla,
    // esto falla acá y no el día que el token venza.
    const progreso = readFileSync(join(REPO_ROOT, "docs", "PROGRESO.md"), "utf8");
    assert.match(readTokenExpiry(progreso), /^(\d{4}-\d{2}-\d{2}|sin vencimiento)$/);
  });

  test("un token sin vencimiento se reconoce como tal y el mensaje lo dice", () => {
    const row =
      "| Token de Vercel (`yacco-ci-vercel-token`) | versión 2 creada 2026-09-24, **sin vencimiento** | Rotarlo al cerrar |";
    assert.equal(readTokenExpiry(`# Progreso\n\n${row}\n`), "sin vencimiento");
    assert.match(invalidTokenMessage("sin vencimiento"), /No tiene vencimiento registrado/);
  });

  test("toma la fecha de vencimiento, no la de creación", () => {
    const row =
      "| Token de Vercel (`yacco-ci-vercel-token`) | creado 2026-09-16, **vence 2026-10-16** | Rotarlo antes |";
    assert.equal(readTokenExpiry(`# Progreso\n\n${row}\n`), "2026-10-16");
  });

  test("ignora menciones del token que no son la fila de la tabla", () => {
    const text = "El token `yacco-ci-vercel-token` vence 2099-01-01 según un texto suelto.\n";
    assert.equal(readTokenExpiry(text), null);
  });

  test("sin fila, null", () => {
    assert.equal(readTokenExpiry("# nada\n"), null);
  });
});

describe("invalidTokenMessage", () => {
  test("nombra el secreto y la fecha de vencimiento registrada", () => {
    const message = invalidTokenMessage("2026-10-16");
    assert.match(message, /yacco-ci-vercel-token/);
    assert.match(message, /2026-10-16/);
    assert.match(message, /antes de tocar ninguna base/);
  });

  test("sin fecha, lo dice en vez de inventar una", () => {
    const message = invalidTokenMessage(null);
    assert.match(message, /No encontré su fecha de vencimiento/);
    assert.doesNotMatch(message, /\d{4}-\d{2}-\d{2}/);
  });
});
