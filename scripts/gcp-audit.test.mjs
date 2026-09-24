/**
 * Tests de lo que decide `pnpm gcp:audit` sin red: qué entra al bucket de 400
 * días y qué lectura dispara la alerta (D-016).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  RETENTION_DAYS,
  SINK_FILTER,
  UNEXPECTED_ACCESS_METRIC,
  alertPolicy,
  expectedAccessors,
  unexpectedAccessFilter,
} from "./gcp-audit.mjs";

const PROJECT = "yacco-v2-prod";

describe("retención", () => {
  test("400 días: una filtración se descubre semanas después (D-016)", () => {
    assert.equal(RETENTION_DAYS, 400);
  });

  test("el sink se queda sólo con Secret Manager, no con todo _Default", () => {
    assert.equal(SINK_FILTER, 'protoPayload.serviceName="secretmanager.googleapis.com"');
  });
});

describe("expectedAccessors", () => {
  test("las dos identidades de runtime y el deployer, y nadie más", () => {
    assert.deepEqual(expectedAccessors(PROJECT).sort(), [
      "yacco-api-demo-run@yacco-v2-prod.iam.gserviceaccount.com",
      "yacco-api-run@yacco-v2-prod.iam.gserviceaccount.com",
      "yacco-deployer@yacco-v2-prod.iam.gserviceaccount.com",
    ]);
  });
});

describe("unexpectedAccessFilter", () => {
  const filter = unexpectedAccessFilter(PROJECT);

  test("cuenta lecturas de valores, no listados ni metadatos", () => {
    assert.match(
      filter,
      /methodName="google\.cloud\.secretmanager\.v1\.SecretManagerService\.AccessSecretVersion"/,
    );
  });

  test("excluye a los esperados DENTRO de un NOT, no como condición positiva", () => {
    // Sin el NOT, la métrica contaría justo las lecturas normales y callaría
    // las inesperadas.
    const not = /NOT protoPayload\.authenticationInfo\.principalEmail=\(([^)]*)\)/.exec(filter);
    assert.ok(not, filter);
    for (const email of expectedAccessors(PROJECT)) assert.ok(not[1].includes(`"${email}"`), email);
  });

  test("el dueño NO está excluido: una lectura a mano también avisa", () => {
    // Lo único excluido son service accounts: ninguna persona, ni el dueño.
    const not = /NOT protoPayload\.authenticationInfo\.principalEmail=\(([^)]*)\)/.exec(filter);
    const excluded = not[1].split(" OR ").map((quoted) => quoted.replaceAll('"', ""));
    assert.equal(excluded.length, 3);
    for (const email of excluded) assert.ok(email.endsWith(".iam.gserviceaccount.com"), email);
  });
});

describe("alertPolicy", () => {
  const policy = alertPolicy(PROJECT, "projects/yacco-v2-prod/notificationChannels/1");

  test("mira la métrica de lecturas inesperadas", () => {
    const condition = policy.conditions[0].conditionThreshold;
    assert.match(condition.filter, new RegExp(`user/${UNEXPECTED_ACCESS_METRIC}"`));
  });

  test("una sola lectura alcanza para avisar", () => {
    const condition = policy.conditions[0].conditionThreshold;
    assert.equal(condition.comparison, "COMPARISON_GT");
    assert.equal(condition.thresholdValue, 0);
    assert.equal(condition.duration, "0s");
  });

  test("avisa por el canal que se le pasa", () => {
    assert.deepEqual(policy.notificationChannels, [
      "projects/yacco-v2-prod/notificationChannels/1",
    ]);
    assert.equal(policy.enabled, true);
  });
});
