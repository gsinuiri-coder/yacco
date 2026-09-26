/**
 * Tests de `pnpm roster:zones` sin red: el mapeo etiqueta → zona, el informe
 * del dry-run (que no escribe nada) y el --commit contra una API de mentira.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { URLSearchParams } from "node:url";

import {
  LABELS_FILE,
  compareFingerprints,
  fingerprint,
  formatReport,
  labelCensus,
  labelClassifier,
  labelKey,
  parseArgs,
  planZones,
  rosterZones,
} from "./roster-zones.mjs";

const LABEL_MAP = {
  zones: { PARQUE: "Parque", SURCO: "Surco", "Av. Los Álamos": "Av. Los Álamos" },
  notZones: ["EMPRESAS", "DISTRIBUIDOR"],
};
const classify = labelClassifier(LABEL_MAP);

describe("labelClassifier", () => {
  test("una etiqueta de lugar es zona, con el nombre del mapeo", () => {
    assert.deepEqual(classify("SURCO"), { kind: "zone", zoneName: "Surco" });
  });

  test("compara sin tildes, sin mayúsculas y sin espacios de más", () => {
    assert.equal(labelKey("  av. los  alamos "), "AV. LOS ALAMOS");
    assert.deepEqual(classify("av. los  alamos"), { kind: "zone", zoneName: "Av. Los Álamos" });
  });

  test("un tipo de cliente no es zona", () => {
    assert.deepEqual(classify("Empresas"), { kind: "notZone" });
  });

  test("lo que no está en ninguna lista queda sin clasificar", () => {
    assert.deepEqual(classify("VIP"), { kind: "unknown" });
  });

  test("el mapeo del repo se carga y separa las dos listas", () => {
    const map = JSON.parse(readFileSync(LABELS_FILE, "utf8"));
    const fromRepo = labelClassifier(map);
    for (const label of map.notZones) assert.equal(fromRepo(label).kind, "notZone");
    for (const label of Object.keys(map.zones)) assert.equal(fromRepo(label).kind, "zone");
  });
});

describe("labelClassifier, mapeo inválido", () => {
  test("dos zonas que solo difieren en mayúsculas o tildes se rechazan al cargar", () => {
    assert.throws(
      () =>
        labelClassifier({ zones: { SURCO: "Surco", "SANTIAGO DE SURCO": "SURCO" }, notZones: [] }),
      /solo difieren/,
    );
  });
});

describe("labelCensus", () => {
  test("cuenta clientes por etiqueta, una vez por cliente, y los de más de una", () => {
    const census = labelCensus([
      { externalCode: "a", tags: ["SURCO", "EMPRESAS"] },
      { externalCode: "b", tags: ["surco", "SURCO"] },
      { externalCode: "c", tags: [] },
    ]);
    assert.deepEqual(census.labels, [
      { label: "SURCO", customers: 2 },
      { label: "EMPRESAS", customers: 1 },
    ]);
    assert.equal(census.withSeveral, 1);
  });
});

const customer = (id, externalCode, zoneId = null) => ({ id, externalCode, zoneId });

describe("planZones", () => {
  const plan = planZones({
    customers: [
      customer("1", "a"),
      customer("2", "b"),
      customer("3", "c"),
      customer("4", "d", "zona-puesta-a-mano"),
      customer("5", null),
      customer("6", "e"),
    ],
    customerTags: [
      { externalCode: "a", tags: ["EMPRESAS", "SURCO"] },
      { externalCode: "b", tags: ["PARQUE", "SURCO"] },
      { externalCode: "c", tags: ["DISTRIBUIDOR"] },
      { externalCode: "d", tags: ["SURCO"] },
      { externalCode: "e", tags: ["VIP", "PARQUE"] },
    ],
    classify,
    existingZones: [
      { name: "surco", active: true },
      { name: "Vieja", active: false },
    ],
  });

  test("toma la etiqueta de lugar aunque venga después de un tipo de cliente", () => {
    assert.deepEqual(plan.assignments[0], { customerId: "1", zoneName: "Surco" });
  });

  test("con dos de lugar toma la primera y lo lista como ambiguo", () => {
    assert.deepEqual(plan.assignments[1], { customerId: "2", zoneName: "Parque" });
    assert.deepEqual(plan.ambiguous, [{ externalCode: "b", places: ["Parque", "Surco"] }]);
  });

  test("sin etiqueta de lugar queda sin zona", () => {
    assert.equal(plan.withoutPlaceLabel, 1);
    assert.ok(!plan.assignments.some((a) => a.customerId === "3"));
  });

  test("nunca pisa una zona puesta a mano", () => {
    assert.equal(plan.alreadyZoned, 1);
    assert.ok(!plan.assignments.some((a) => a.customerId === "4"));
  });

  test("un cliente creado desde la app no está en el export", () => {
    assert.equal(plan.notInExport, 1);
  });

  test("crea solo las zonas que no existen, comparando sin mayúsculas", () => {
    assert.deepEqual(plan.zonesToCreate, ["Parque"]);
    assert.deepEqual(plan.byZone, { Surco: 1, Parque: 2 });
  });

  test("una zona retirada que recibiría clientes queda marcada", () => {
    const withdrawn = planZones({
      customers: [customer("1", "a")],
      customerTags: [{ externalCode: "a", tags: ["VIEJA"] }],
      classify: labelClassifier({ zones: { VIEJA: "Vieja" }, notZones: [] }),
      existingZones: [{ name: "Vieja", active: false }],
    });
    assert.deepEqual(withdrawn.withdrawnTargets, ["Vieja"]);
    assert.deepEqual(withdrawn.zonesToCreate, []);
    assert.deepEqual(plan.withdrawnTargets, []);
  });

  test("junta las etiquetas sin clasificar", () => {
    assert.deepEqual(plan.unknownLabels, { VIP: 1 });
  });

  test("el informe dice conteos y códigos, y avisa lo sin clasificar", () => {
    const lines = formatReport(plan, labelCensus([{ externalCode: "b", tags: ["PARQUE"] }]));
    assert.ok(lines.includes("Zonas a crear: 1"));
    assert.ok(lines.includes("  b: Parque > Surco"));
    assert.ok(lines.includes("Etiquetas SIN CLASIFICAR en roster-zones-labels.json: 1"));
  });
});

describe("fingerprint", () => {
  const base = {
    id: "1",
    name: "N",
    phone: "9",
    address: "A",
    addressReference: "R",
    creditLimit: null,
    debtBalance: "0.00",
    active: true,
    externalCode: "a",
    zoneId: null,
  };

  test("cambiar la zona no cambia la huella; cambiar el nombre sí", () => {
    assert.equal(fingerprint(base), fingerprint({ ...base, zoneId: "z", zone: { id: "z" } }));
    assert.notEqual(fingerprint(base), fingerprint({ ...base, name: "Otro" }));
  });

  test("compareFingerprints cuenta cambiados y faltantes", () => {
    const before = new Map([
      ["1", "h1"],
      ["2", "h2"],
      ["3", "h3"],
    ]);
    const after = new Map([
      ["1", "h1"],
      ["2", "otro"],
    ]);
    assert.deepEqual(compareFingerprints(before, after), { changed: 1, missing: 1 });
  });
});

describe("parseArgs", () => {
  test("dry-run por defecto; --commit lo pide explícito", () => {
    assert.deepEqual(parseArgs(["--tags", "t.json"]), { tagsFile: "t.json", commit: false });
    assert.equal(parseArgs(["--tags", "t.json", "--commit"]).commit, true);
  });

  test("sin --tags no corre", () => {
    assert.throws(() => parseArgs(["--commit"]), /Uso/);
  });
});

/**
 * Producción de mentira: 3 clientes del padrón (uno ya con zona), una zona
 * existente, y un registro de cada escritura. `mutate` deja cambiar un dato
 * a mitad de camino para probar la verificación.
 */
function fakeApi({ mutate, beforeRead, shufflePages = false, zones: extraZones = [] } = {}) {
  const writes = [];
  const zones = [{ id: "z-surco", name: "Surco", active: true }, ...extraZones];
  const customers = [
    { ...baseCustomer("1", "a"), zoneId: null },
    { ...baseCustomer("2", "b"), zoneId: null },
    { ...baseCustomer("3", "c"), zoneId: "z-surco" },
  ];
  const fetch = async (url, init) => {
    const path = url.slice(url.indexOf("/api/v1") + "/api/v1".length);
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    const reply = (status, json) => ({ status, text: async () => JSON.stringify(json) });
    if (init.method === "POST" && path === "/auth/login")
      return body.password === "clave" ? reply(200, { accessToken: "t" }) : reply(401, {});
    if (init.method === "GET" && path.startsWith("/customers?")) {
      const query = new URLSearchParams(path.slice(path.indexOf("?") + 1));
      const page = Number(query.get("page"));
      const limit = 2;
      assert.equal(query.get("limit"), "100");
      // shufflePages: el orden cambia entre páginas (nombres empatados), así
      // que la página 2 repite a uno de la 1 y otro no aparece nunca.
      const order = shufflePages && page > 1 ? [...customers].reverse() : customers;
      return reply(200, {
        data: order.slice((page - 1) * limit, page * limit),
        total: customers.length,
        totalPages: Math.ceil(customers.length / limit),
      });
    }
    if (init.method === "GET" && path.startsWith("/zones?active=true"))
      return reply(
        200,
        zones.filter((zone) => zone.active),
      );
    if (init.method === "GET" && path.startsWith("/zones?active=false"))
      return reply(
        200,
        zones.filter((zone) => !zone.active),
      );
    if (init.method === "POST" && path === "/zones") {
      writes.push(`POST /zones ${body.name}`);
      const zone = { id: `z-${body.name.toLowerCase()}`, name: body.name, active: true };
      zones.push(zone);
      return reply(201, zone);
    }
    const id = path.split("/")[2];
    const row = customers.find((c) => c.id === id);
    if (init.method === "GET") {
      beforeRead?.(row);
      return reply(200, row);
    }
    if (init.method === "PATCH") {
      writes.push(`PATCH /customers/${id} ${JSON.stringify(body)}`);
      row.zoneId = body.zoneId;
      mutate?.(row);
      return reply(200, row);
    }
    throw new Error(`ruta inesperada ${init.method} ${path}`);
  };
  return { fetch, writes, customers };
}

function baseCustomer(id, externalCode) {
  return {
    id,
    externalCode,
    name: `Cliente ${id}`,
    phone: "900000000",
    address: "x",
    addressReference: "",
    creditLimit: null,
    debtBalance: "0.00",
    active: true,
  };
}

const TAGS = [
  { externalCode: "a", tags: ["PARQUE"] },
  { externalCode: "b", tags: ["SURCO", "EMPRESAS"] },
  { externalCode: "c", tags: ["PARQUE"] },
];

describe("rosterZones", () => {
  const run = (api, overrides = {}) =>
    rosterZones({
      adminPassword: "clave",
      customerTags: TAGS,
      labelMap: LABEL_MAP,
      baseUrl: "https://api.invalid",
      fetch: api.fetch,
      log: () => {},
      ...overrides,
    });

  test("dry-run: informa y no escribe nada", async () => {
    const api = fakeApi();
    const logs = [];
    const { plan } = await run(api, { log: (line) => logs.push(line) });
    assert.deepEqual(api.writes, []);
    assert.equal(plan.assignments.length, 2);
    assert.ok(logs.some((line) => line.startsWith("Dry-run")));
    assert.ok(!logs.join("\n").includes("Cliente 1"));
  });

  test("--commit: crea la zona que falta y le pone zona solo a quien no tenía", async () => {
    const api = fakeApi();
    const { assigned } = await run(api, { commit: true });
    assert.equal(assigned, 2);
    assert.deepEqual(api.writes, [
      "POST /zones Parque",
      'PATCH /customers/1 {"zoneId":"z-parque"}',
      'PATCH /customers/2 {"zoneId":"z-surco"}',
    ]);
    assert.equal(api.customers[2].zoneId, "z-surco");
  });

  test("--commit imprime el avance cada tantos clientes, y el total al final", async () => {
    const api = fakeApi();
    const logs = [];
    await run(api, { commit: true, progressEvery: 1, log: (line) => logs.push(line) });
    assert.deepEqual(
      logs.filter((line) => line.startsWith("Asignados")),
      ["Asignados 1 de 2", "Asignados 2 de 2"],
    );
    assert.ok(!logs.join("\n").includes("Cliente 1"));
  });

  test("--commit con una etiqueta sin clasificar no escribe nada", async () => {
    const api = fakeApi();
    const tags = [...TAGS, { externalCode: "a", tags: ["VIP"] }];
    await assert.rejects(run(api, { commit: true, customerTags: tags }), /sin clasificar/);
    assert.deepEqual(api.writes, []);
  });

  test("si otro dato del cliente cambió, la verificación falla", async () => {
    const api = fakeApi({
      mutate: (row) => {
        row.name = "Pisado";
      },
    });
    await assert.rejects(run(api, { commit: true }), /verificación NO cierra/);
  });

  test("una zona puesta desde la app durante la corrida no se pisa, y la verificación la cuenta", async () => {
    const api = fakeApi({
      beforeRead: (row) => {
        if (row.id === "2") row.zoneId = "z-surco";
      },
    });
    const logs = [];
    const { assigned } = await run(api, { commit: true, log: (line) => logs.push(line) });
    assert.equal(assigned, 1);
    assert.ok(!api.writes.some((write) => write.startsWith("PATCH /customers/2")));
    assert.ok(logs.includes("Con zona puesta desde la app mientras corría: 1."));
    assert.ok(logs.includes("Verificación OK. Ningún valor personal se imprimió."));
  });

  test("si las páginas repiten a un cliente y saltean a otro, corta antes de escribir", async () => {
    const api = fakeApi({ shufflePages: true });
    await assert.rejects(run(api, { commit: true }), /clientes distintos de 3/);
    assert.deepEqual(api.writes, []);
  });

  test("una zona retirada que recibiría clientes frena el --commit", async () => {
    const api = fakeApi({ zones: [{ id: "z-parque", name: "Parque", active: false }] });
    await assert.rejects(run(api, { commit: true }), /zonas retiradas/);
    assert.deepEqual(api.writes, []);
  });

  test("con la contraseña equivocada no escribe nada", async () => {
    const api = fakeApi();
    await assert.rejects(run(api, { adminPassword: "otra" }), /401/);
    assert.deepEqual(api.writes, []);
  });
});
