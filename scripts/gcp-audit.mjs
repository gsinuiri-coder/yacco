/**
 * `pnpm gcp:audit` — D-016: los accesos a Secret Manager se guardan 400 días
 * y una lectura de una identidad inesperada avisa por email. Idempotente.
 *
 *   GCP_PROJECT_ID=yacco-v2-prod ALERT_EMAIL=<email> pnpm gcp:audit
 *
 * Lo que deja armado:
 *   1. Bucket de logs `secret-manager-audit` (global), retención 400 días. No
 *      se toca `_Default` (30 días), que arrastra los logs de request de Cloud
 *      Run.
 *   2. Sink `secret-manager-audit` a ese bucket, filtrado por el servicio de
 *      Secret Manager. Copia: `_Default` sigue recibiendo lo suyo.
 *   3. Métrica de logs `unexpected-secret-access`: cada `AccessSecretVersion`
 *      cuyo principal NO sea una de EXPECTED_ACCESSORS.
 *   4. Canal de email (ALERT_EMAIL) y una política de alerta sobre esa
 *      métrica: una sola lectura inesperada ya avisa.
 *
 * Nada de esto lee el valor de un secreto. El token de acceso de gcloud se
 * pide con `quiet: true` y viaja sólo en el header de las llamadas REST de
 * Monitoring (`gcloud beta monitoring` no está en todas las instalaciones).
 */
import { pathToFileURL } from "node:url";

import { RUNTIME_SERVICE_ACCOUNTS, resolveGcpProject, run } from "./lib.mjs";

export const AUDIT_BUCKET = "secret-manager-audit";
export const AUDIT_SINK = "secret-manager-audit";
export const RETENTION_DAYS = 400;
export const UNEXPECTED_ACCESS_METRIC = "unexpected-secret-access";
const POLICY_DISPLAY_NAME = "Lectura de un secreto por una identidad inesperada";
const DEPLOYER_SERVICE_ACCOUNT = "yacco-deployer";

/**
 * Quiénes leen secretos en la operación normal (D-016, D-025): las dos
 * identidades de runtime al arrancar cada instancia y el deployer en cada
 * deploy. Cualquier otro principal —incluido el dueño a mano— avisa: una
 * lectura legítima llega como un email que se confirma, y una laptop
 * comprometida no se distingue de su dueño de ninguna otra forma.
 */
export function expectedAccessors(projectId) {
  return [...Object.values(RUNTIME_SERVICE_ACCOUNTS), DEPLOYER_SERVICE_ACCOUNT].map(
    (name) => `${name}@${projectId}.iam.gserviceaccount.com`,
  );
}

export const SINK_FILTER = 'protoPayload.serviceName="secretmanager.googleapis.com"';

export function unexpectedAccessFilter(projectId) {
  const expected = expectedAccessors(projectId)
    .map((email) => `"${email}"`)
    .join(" OR ");
  return [
    SINK_FILTER,
    'protoPayload.methodName="google.cloud.secretmanager.v1.SecretManagerService.AccessSecretVersion"',
    `NOT protoPayload.authenticationInfo.principalEmail=(${expected})`,
  ].join(" AND ");
}

/** La política de alerta, en la forma de la API de Monitoring v3. */
export function alertPolicy(projectId, channelName) {
  return {
    displayName: POLICY_DISPLAY_NAME,
    documentation: {
      mimeType: "text/markdown",
      content:
        "Un principal que no es `yacco-api-run`, `yacco-api-demo-run` ni `yacco-deployer` " +
        "leyó un secreto (D-016). Si fue una lectura a mano, confirmarla; si no, tratarla " +
        `como filtración. El detalle está en el bucket de logs \`${AUDIT_BUCKET}\`.`,
    },
    combiner: "OR",
    conditions: [
      {
        displayName: "AccessSecretVersion de una identidad inesperada",
        conditionThreshold: {
          // Los audit logs de Secret Manager llegan como `audited_resource` (leído de
          // una entrada real); la API exige nombrar el tipo de recurso.
          filter:
            `resource.type="audited_resource" AND ` +
            `metric.type="logging.googleapis.com/user/${UNEXPECTED_ACCESS_METRIC}"`,
          comparison: "COMPARISON_GT",
          thresholdValue: 0,
          duration: "0s",
          aggregations: [{ alignmentPeriod: "60s", perSeriesAligner: "ALIGN_COUNT" }],
          trigger: { count: 1 },
        },
      },
    ],
    alertStrategy: { autoClose: "604800s" },
    notificationChannels: [channelName],
    enabled: true,
  };
}

function describe(args) {
  return run("gcloud", args, { allowFailure: true });
}

function ensureBucket(projectId) {
  const common = [`--location=global`, `--project=${projectId}`];
  const existing = describe([
    "logging",
    "buckets",
    "describe",
    AUDIT_BUCKET,
    ...common,
    "--format=value(retentionDays)",
  ]);
  if (!existing.ok) {
    run("gcloud", [
      "logging",
      "buckets",
      "create",
      AUDIT_BUCKET,
      ...common,
      `--retention-days=${RETENTION_DAYS}`,
      "--description=Accesos a Secret Manager, 400 días (D-016)",
    ]);
    console.log(`bucket ${AUDIT_BUCKET}: creado, ${RETENTION_DAYS} días`);
  } else if (existing.stdout !== String(RETENTION_DAYS)) {
    run("gcloud", [
      "logging",
      "buckets",
      "update",
      AUDIT_BUCKET,
      ...common,
      `--retention-days=${RETENTION_DAYS}`,
    ]);
    console.log(`bucket ${AUDIT_BUCKET}: retención llevada a ${RETENTION_DAYS} días`);
  } else {
    console.log(`bucket ${AUDIT_BUCKET}: sin cambios`);
  }
}

function ensureSink(projectId) {
  const destination = `logging.googleapis.com/projects/${projectId}/locations/global/buckets/${AUDIT_BUCKET}`;
  const verb = describe(["logging", "sinks", "describe", AUDIT_SINK, `--project=${projectId}`]).ok
    ? "update"
    : "create";
  run("gcloud", [
    "logging",
    "sinks",
    verb,
    AUDIT_SINK,
    destination,
    `--log-filter=${SINK_FILTER}`,
    `--project=${projectId}`,
  ]);
  console.log(`sink ${AUDIT_SINK}: ${verb === "create" ? "creado" : "al día"}`);
}

function ensureMetric(projectId) {
  const verb = describe([
    "logging",
    "metrics",
    "describe",
    UNEXPECTED_ACCESS_METRIC,
    `--project=${projectId}`,
  ]).ok
    ? "update"
    : "create";
  run("gcloud", [
    "logging",
    "metrics",
    verb,
    UNEXPECTED_ACCESS_METRIC,
    "--description=AccessSecretVersion de un principal inesperado (D-016)",
    `--log-filter=${unexpectedAccessFilter(projectId)}`,
    `--project=${projectId}`,
  ]);
  console.log(`métrica ${UNEXPECTED_ACCESS_METRIC}: ${verb === "create" ? "creada" : "al día"}`);
}

async function monitoring(token, method, path, body) {
  const response = await fetch(`https://monitoring.googleapis.com/v3/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Monitoring ${method} ${path}: ${response.status} ${json.error?.message ?? ""}`,
    );
  }
  return json;
}

async function ensureAlert(projectId, email) {
  const token = run("gcloud", ["auth", "print-access-token"], { quiet: true });
  const parent = `projects/${projectId}`;

  const channels = await monitoring(token, "GET", `${parent}/notificationChannels`);
  let channel = (channels.notificationChannels ?? []).find(
    (candidate) => candidate.type === "email" && candidate.labels?.email_address === email,
  );
  if (channel === undefined) {
    channel = await monitoring(token, "POST", `${parent}/notificationChannels`, {
      type: "email",
      displayName: "Dueño de Yacco",
      labels: { email_address: email },
    });
    console.log("canal de email: creado");
  } else {
    console.log("canal de email: ya existía");
  }

  const policy = alertPolicy(projectId, channel.name);
  const policies = await monitoring(token, "GET", `${parent}/alertPolicies`);
  const existing = (policies.alertPolicies ?? []).find(
    (candidate) => candidate.displayName === policy.displayName,
  );
  if (existing === undefined) {
    await monitoring(token, "POST", `${parent}/alertPolicies`, policy);
    console.log("política de alerta: creada");
  } else {
    await monitoring(token, "PATCH", existing.name, policy);
    console.log("política de alerta: al día");
  }
}

async function main() {
  const email = (process.env.ALERT_EMAIL ?? "").trim();
  if (email.length === 0) {
    console.error("Falta ALERT_EMAIL.");
    process.exit(1);
  }
  const projectId = resolveGcpProject(process.env);
  ensureBucket(projectId);
  ensureSink(projectId);
  ensureMetric(projectId);
  await ensureAlert(projectId, email);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
