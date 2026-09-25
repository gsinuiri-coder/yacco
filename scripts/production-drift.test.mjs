/**
 * Tests de `production-drift.mjs` sin red: cuándo producción cuenta como al
 * día y cuándo hay que avisar.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { GRACE_MINUTES, driftVerdict } from "./production-drift.mjs";

const NOW = new Date("2026-09-25T15:00:00Z");
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const ahead = (files) => async () => ({ status: "ahead", files });

describe("driftVerdict", () => {
  test("producción en la punta de main: al día", async () => {
    const verdict = await driftVerdict({
      tip: { sha: "tip", committedAt: minutesAgo(600) },
      deployedCommit: "tip",
      compare: ahead(["apps/api/src/main.ts"]),
      now: NOW,
    });
    assert.equal(verdict.ok, true);
  });

  test("atrás solo en documentación, hace horas: al día", async () => {
    const verdict = await driftVerdict({
      tip: { sha: "tip", committedAt: minutesAgo(600) },
      deployedCommit: "old",
      compare: ahead(["docs/PROGRESO.md"]),
      now: NOW,
    });
    assert.equal(verdict.ok, true);
  });

  test("atrás en código hace menos que el margen: puede estar desplegando", async () => {
    const verdict = await driftVerdict({
      tip: { sha: "tip", committedAt: minutesAgo(GRACE_MINUTES - 1) },
      deployedCommit: "old",
      compare: ahead(["apps/api/src/main.ts"]),
      now: NOW,
    });
    assert.equal(verdict.ok, true);
  });

  test("atrás en código pasado el margen: avisa, con los dos commits", async () => {
    const verdict = await driftVerdict({
      tip: { sha: "tip", committedAt: minutesAgo(GRACE_MINUTES + 30) },
      deployedCommit: "old",
      compare: ahead(["apps/api/src/main.ts"]),
      now: NOW,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, /Producción corre old y main está en tip/);
  });

  test("con /health caído y main viejo, avisa", async () => {
    const verdict = await driftVerdict({
      tip: { sha: "tip", committedAt: minutesAgo(600) },
      deployedCommit: null,
      compare: ahead(["docs/a.md"]),
      now: NOW,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, /commit desconocido/);
  });
});
