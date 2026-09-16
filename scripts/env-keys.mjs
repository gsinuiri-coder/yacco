/**
 * El contrato de `.env.setup`, en un solo lugar.
 *
 * `env:check` lo usa para decir qué falta, `env:local` para saber qué copiar a
 * los `.env` de cada app, y `secrets:gcp` para saber qué
 * subir. Tener la lista acá y no repartida por los scripts es lo que evita
 * que una clave nueva quede validada en un lado y olvidada en otro.
 *
 * `required: "cli"` significa: hace falta un valor, PERO en una máquina donde
 * el CLI correspondiente ya está autenticado de forma interactiva el script
 * cae a esa sesión y sigue. `env:check` lo reporta como aviso, no como falta.
 */
export const ENV_KEYS = [
  {
    key: "GCP_PROJECT_ID",
    required: true,
    description: "Proyecto de GCP donde vive Cloud Run",
  },
  {
    key: "GCP_BILLING_ACCOUNT_ID",
    required: true,
    description: "Cuenta de facturación (XXXXXX-XXXXXX-XXXXXX)",
    pattern: /^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$/,
  },
  {
    key: "GCP_REGION",
    required: true,
    description: "Región de Cloud Run (ver D-002 en docs/ARQUITECTURA.md)",
  },
  {
    key: "VERCEL_TOKEN",
    required: true,
    description: "Token de Vercel; `pnpm secrets:gcp --upload=VERCEL_TOKEN` lo sube para CI",
  },
  {
    key: "VERCEL_TEAM_ID",
    required: false,
    description: "Sólo si el proyecto vive en un team de Vercel",
  },
  {
    key: "NEON_API_KEY",
    required: "cli",
    cli: "neonctl auth",
    description: "API key de Neon",
  },
  {
    key: "NEON_PROJECT_ID",
    required: true,
    description: "Proyecto Neon existente",
  },
  {
    key: "NEON_ORG_ID",
    required: true,
    description: "Organización dueña del proyecto Neon (sin esto neonctl abre un prompt)",
  },
  {
    key: "GH_TOKEN",
    required: "cli",
    cli: "gh auth login",
    description: "Token fine-grained de GitHub (Secrets, Actions, Administration)",
  },
  {
    key: "RENDER_API_KEY",
    required: false,
    description: "Sólo para suspender Render en la fase 7",
  },
  {
    key: "RENDER_SERVICE_ID",
    required: false,
    description: "Id srv-... del servicio actual en Render",
  },
  {
    key: "JWT_ACCESS_SECRET",
    required: true,
    generated: true,
    description: "Lo genera `pnpm secrets:generate`",
  },
  {
    key: "JWT_REFRESH_SECRET",
    required: true,
    generated: true,
    description: "Lo genera `pnpm secrets:generate`",
  },
  {
    key: "JWT_ACCESS_EXPIRES_IN",
    required: true,
    description: "Duración del access token (configuración, no secreto)",
  },
  {
    key: "JWT_REFRESH_EXPIRES_IN",
    required: true,
    description: "Duración del refresh token (configuración, no secreto)",
  },
];

/** Las dos claves que `secrets:generate` escribe, y con cuántos bytes. */
export const GENERATED_SECRETS = ENV_KEYS.filter((entry) => entry.generated === true).map(
  (entry) => entry.key,
);
