/**
 * `node scripts/check-vercel-token.mjs` — comprueba que el token de Vercel
 * SIRVE, no sólo que exista. Lo corre el preflight del deploy
 * (.github/workflows/deploy.yml), antes de tocar ninguna base.
 *
 * Por qué hace falta: el preflight comprobaba presencia. Un token vencido o
 * revocado tiene valor, así que pasaba; el deploy migraba las dos bases,
 * desplegaba las dos APIs y fallaba recién en «5 · Web a Vercel». Hoy eso
 * cuesta poco. Desde el corte (fase 7) deja la API nueva con el web viejo
 * sirviendo a usuarios reales.
 *
 * Usa `vercel whoami`, que no escribe nada: sólo identifica la cuenta. El token
 * llega por la variable VERCEL_TOKEN, nunca por `--token`. Verificado a mano
 * contra la CLI 59.11.2: con el token de CI sale con 0, con uno inválido sale
 * con 1 (`invalid-token-value`) y no cae a ninguna sesión local.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, run } from "./lib.mjs";

export const TOKEN_SECRET = "yacco-ci-vercel-token";

/**
 * La fecha de vencimiento registrada en la fila del token de la tabla
 * «Credenciales y recursos con fecha» de docs/PROGRESO.md, o null.
 *
 * Se lee de PROGRESO.md y no de una constante acá, a propósito: al rotar el
 * token se actualiza ESA fila (así lo indica D-015), y un segundo lugar con la
 * fecha quedaría desactualizado justo el día que alguien lo necesite.
 */
export const NO_EXPIRY = "sin vencimiento";

export function readTokenExpiry(progreso) {
  const row = progreso
    .split(/\r?\n/)
    .find((line) => line.includes(TOKEN_SECRET) && line.startsWith("|"));
  if (row === undefined) return null;
  // Un token creado sin vencimiento (el de 2026-09-24) se anota así, a
  // propósito: es un dato, no una fila mal escrita.
  if (/sin vencimiento/i.test(row)) return NO_EXPIRY;
  const match = /vence\D*(\d{4}-\d{2}-\d{2})/.exec(row);
  return match === null ? null : match[1];
}

/** El mensaje cuando el token no sirve: nombra el secreto y el vencimiento. */
export function invalidTokenMessage(expiry) {
  const when =
    expiry === NO_EXPIRY
      ? "No tiene vencimiento registrado en docs/PROGRESO.md: si dejó de servir, lo revocaron o le cambiaron el alcance en Vercel."
      : expiry === null
        ? "No encontré su fecha de vencimiento en docs/PROGRESO.md: revisá la fila del token."
        : `Su vencimiento registrado en docs/PROGRESO.md es ${expiry}: si ya pasó, esa es la causa.`;
  return (
    `El token de Vercel (${TOKEN_SECRET}) no es válido: \`vercel whoami\` lo rechazó. ${when} ` +
    "Para rotarlo: token nuevo en .env.setup, `pnpm secrets:gcp --upload=VERCEL_TOKEN`, y " +
    "actualizar la fecha en PROGRESO.md y en D-015. El deploy se detuvo antes de tocar ninguna base."
  );
}

function main() {
  const token = (process.env.VERCEL_TOKEN ?? "").trim();
  if (token.length === 0) {
    console.error(`::error::VERCEL_TOKEN vacío: ${TOKEN_SECRET} no llegó al preflight.`);
    process.exit(1);
  }

  const result = run("vercel", ["whoami"], { env: { VERCEL_TOKEN: token }, allowFailure: true });
  if (!result.ok) {
    let expiry = null;
    try {
      expiry = readTokenExpiry(readFileSync(join(REPO_ROOT, "docs", "PROGRESO.md"), "utf8"));
    } catch {
      // Sin PROGRESO.md el mensaje lo dice; no es motivo para ocultar el error real.
    }
    console.error(`::error::${invalidTokenMessage(expiry)}`);
    process.exit(1);
  }

  console.log(`Token de Vercel válido (cuenta ${result.stdout.split(/\r?\n/).pop()}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
