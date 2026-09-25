/**
 * `pnpm roster:zones -- --tags <tags.json> [--commit]` — paso MANUAL: les pone
 * zona a los clientes del padrón a partir de sus etiquetas del sistema viejo.
 *
 * Por qué no `pnpm load:roster`: su `upsert` vuelve a escribir el nombre y el
 * teléfono de cada cliente desde el CSV, y pisaría lo que la oficina corrigió
 * en la app desde la carga. Este script solo toca `zoneId`, y solo a quien no
 * tiene zona: una asignada a mano no se pisa nunca.
 *
 * Las etiquetas vienen de `tags.json`, que arma `pnpm export:tags` en
 * tools/firestore-export (solo id y etiquetas, sin nombres ni teléfonos): en
 * `main` no están, porque el cargador del padrón no guarda las notas. El
 * mapeo etiqueta → zona está en `roster-zones-labels.json` (supuesto 16).
 *
 * Por defecto es DRY-RUN: lee e imprime el informe (solo conteos y códigos
 * externos, nunca un nombre, un teléfono ni un monto). `--commit` escribe por
 * la API como admin, con la contraseña tecleada sin eco — el mismo camino y la
 * misma validación que la oficina — y después verifica, de solo lectura, que
 * ningún cliente cambió en otra cosa que la zona.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { apiClient, loginAdmin, promptHidden } from "./admin-api.mjs";
import { REPO_ROOT, registerSecret } from "./lib.mjs";
import { TARGETS } from "./smoke.mjs";

const PAGE_SIZE = 100;
export const LABELS_FILE = join(REPO_ROOT, "scripts", "roster-zones-labels.json");

/** Clave de comparación de una etiqueta: sin tildes, en mayúsculas, sin espacios de más. */
export function labelKey(label) {
  return label.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** `{ zones: {etiqueta: zona}, notZones: [...] }` → un clasificador de etiquetas. */
export function labelClassifier(labelMap) {
  const zones = new Map(Object.entries(labelMap.zones).map(([key, zone]) => [labelKey(key), zone]));
  const notZones = new Set(labelMap.notZones.map(labelKey));
  return (label) => {
    const key = labelKey(label);
    if (zones.has(key)) return { kind: "zone", zoneName: zones.get(key) };
    if (notZones.has(key)) return { kind: "notZone" };
    return { kind: "unknown" };
  };
}

/** Las etiquetas distintas con cuántos clientes tiene cada una, y cuántos tienen más de una. */
export function labelCensus(customerTags) {
  const counts = new Map();
  let withSeveral = 0;
  for (const { tags } of customerTags) {
    const distinct = [...new Set(tags.map(labelKey))];
    if (distinct.length > 1) withSeveral += 1;
    for (const key of distinct) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const labels = [...counts]
    .map(([label, customers]) => ({ label, customers }))
    .sort((a, b) => b.customers - a.customers || a.label.localeCompare(b.label));
  return { labels, withSeveral };
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

/**
 * Qué haría la corrida, sin escribir nada. `customers` es lo que devuelve la
 * API (id, externalCode, zoneId); `existingZones`, los nombres de las zonas
 * que ya existen (activas o retiradas: un nombre repetido lo rechaza la API).
 */
export function planZones({ customers, customerTags, classify, existingZones }) {
  const tagsByCode = new Map(customerTags.map(({ externalCode, tags }) => [externalCode, tags]));
  const plan = {
    assignments: [],
    byZone: {},
    ambiguous: [],
    withoutPlaceLabel: 0,
    alreadyZoned: 0,
    notInExport: 0,
    unknownLabels: {},
  };
  for (const customer of customers) {
    const tags = customer.externalCode === null ? undefined : tagsByCode.get(customer.externalCode);
    if (tags === undefined) {
      plan.notInExport += 1;
      continue;
    }
    const places = [];
    for (const tag of tags) {
      const verdict = classify(tag);
      if (verdict.kind === "unknown") increment(plan.unknownLabels, labelKey(tag));
      if (verdict.kind === "zone" && !places.includes(verdict.zoneName))
        places.push(verdict.zoneName);
    }
    if (customer.zoneId !== null) {
      plan.alreadyZoned += 1;
      continue;
    }
    if (places.length === 0) {
      plan.withoutPlaceLabel += 1;
      continue;
    }
    if (places.length > 1) plan.ambiguous.push({ externalCode: customer.externalCode, places });
    plan.assignments.push({ customerId: customer.id, zoneName: places[0] });
    increment(plan.byZone, places[0]);
  }
  const existing = new Set(existingZones.map(labelKey));
  plan.zonesToCreate = Object.keys(plan.byZone)
    .filter((name) => !existing.has(labelKey(name)))
    .sort((a, b) => a.localeCompare(b));
  return plan;
}

/** El informe, en líneas. Solo conteos, nombres de zona y códigos externos. */
export function formatReport(plan, census) {
  const lines = ["Etiquetas del sistema viejo (clientes con cada una):"];
  for (const { label, customers } of census.labels) lines.push(`  ${label}: ${customers}`);
  lines.push(`Clientes con más de una etiqueta: ${census.withSeveral}`);
  lines.push(`Zonas a crear: ${plan.zonesToCreate.length}`);
  for (const name of plan.zonesToCreate) lines.push(`  ${name}`);
  lines.push(`Clientes a los que se les pone zona: ${plan.assignments.length}`);
  for (const [zone, total] of Object.entries(plan.byZone).sort(([a], [b]) => a.localeCompare(b)))
    lines.push(`  ${zone}: ${total}`);
  lines.push(`Con dos o más etiquetas de lugar (toman la primera): ${plan.ambiguous.length}`);
  for (const { externalCode, places } of plan.ambiguous)
    lines.push(`  ${externalCode}: ${places.join(" > ")}`);
  lines.push(`Sin etiqueta de lugar (quedan sin zona): ${plan.withoutPlaceLabel}`);
  lines.push(`Ya tenían zona (no se tocan): ${plan.alreadyZoned}`);
  lines.push(`No están en el export (creados desde la app): ${plan.notInExport}`);
  const unknown = Object.entries(plan.unknownLabels);
  if (unknown.length > 0) {
    lines.push(`Etiquetas SIN CLASIFICAR en roster-zones-labels.json: ${unknown.length}`);
    for (const [label, total] of unknown) lines.push(`  ${label}: ${total}`);
  }
  return lines;
}

/**
 * Huella de todo lo que el script NO debe tocar de un cliente. Se compara
 * antes y después del --commit; nunca se imprime el contenido, solo si cambió.
 */
export function fingerprint(customer) {
  const fields = [
    customer.name,
    customer.phone,
    customer.address,
    customer.addressReference,
    customer.creditLimit,
    customer.debtBalance,
    customer.active,
    customer.externalCode,
  ];
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

/** Cuántos clientes cambiaron algo que no es la zona, y cuántos faltan. */
export function compareFingerprints(before, after) {
  let changed = 0;
  let missing = 0;
  for (const [id, hash] of before) {
    if (!after.has(id)) missing += 1;
    else if (after.get(id) !== hash) changed += 1;
  }
  return { changed, missing };
}

async function fetchAllCustomers(api, token) {
  const customers = [];
  for (let page = 1; ; page += 1) {
    // Sin filtro `active`: entran los activos y los desactivados.
    const response = await api(`/customers?page=${page}&limit=${PAGE_SIZE}`, { token });
    if (response.status !== 200) throw new Error(`GET /customers devolvió ${response.status}.`);
    customers.push(...response.body.data);
    if (page >= response.body.totalPages) return customers;
  }
}

async function fetchAllZones(api, token) {
  const zones = [];
  for (const active of ["true", "false"]) {
    const response = await api(`/zones?active=${active}`, { token });
    if (response.status !== 200) throw new Error(`GET /zones devolvió ${response.status}.`);
    zones.push(...response.body);
  }
  return zones;
}

async function createZones(api, token, names, zoneIdByKey) {
  for (const name of names) {
    // Días de reparto vacíos: los decide el dueño (CreateZoneDto).
    const response = await api("/zones", { token, method: "POST", body: { name } });
    if (response.status !== 201) throw new Error(`POST /zones devolvió ${response.status}.`);
    zoneIdByKey.set(labelKey(name), response.body.id);
  }
}

async function assignZones(api, token, assignments, zoneIdByKey) {
  let assigned = 0;
  let zonedMeanwhile = 0;
  for (const { customerId, zoneName } of assignments) {
    // Se relee justo antes: si alguien le puso zona desde la app mientras
    // corría el script, esa gana.
    const current = await api(`/customers/${customerId}`, { token });
    if (current.status !== 200) throw new Error(`GET /customers/:id devolvió ${current.status}.`);
    if (current.body.zoneId !== null) {
      zonedMeanwhile += 1;
      continue;
    }
    const zoneId = zoneIdByKey.get(labelKey(zoneName));
    const response = await api(`/customers/${customerId}`, {
      token,
      method: "PATCH",
      body: { zoneId },
    });
    if (response.status !== 200)
      throw new Error(`PATCH /customers/:id devolvió ${response.status}.`);
    assigned += 1;
  }
  return { assigned, zonedMeanwhile };
}

/** La corrida entera, con sus dependencias inyectables para el test. */
export async function rosterZones({
  adminPassword,
  customerTags,
  labelMap,
  commit = false,
  baseUrl = TARGETS.apis.production,
  fetch: fetchImpl = fetch,
  log = console.log,
}) {
  registerSecret(adminPassword);
  const api = apiClient(baseUrl, fetchImpl);
  const token = await loginAdmin(api, adminPassword);

  const customers = await fetchAllCustomers(api, token);
  const zones = await fetchAllZones(api, token);
  const plan = planZones({
    customers,
    customerTags,
    classify: labelClassifier(labelMap),
    existingZones: zones.map((zone) => zone.name),
  });
  for (const line of formatReport(plan, labelCensus(customerTags))) log(line);

  if (!commit) {
    log("Dry-run: no se escribió nada. Con --commit se aplica.");
    return { plan };
  }
  if (Object.keys(plan.unknownLabels).length > 0) {
    throw new Error(
      "Hay etiquetas sin clasificar: se agregan a roster-zones-labels.json antes del --commit.",
    );
  }

  const before = new Map(customers.map((customer) => [customer.id, fingerprint(customer)]));
  const zonedBefore = customers.filter((customer) => customer.zoneId !== null).length;
  const zoneIdByKey = new Map(zones.map((zone) => [labelKey(zone.name), zone.id]));
  await createZones(api, token, plan.zonesToCreate, zoneIdByKey);
  const { assigned, zonedMeanwhile } = await assignZones(api, token, plan.assignments, zoneIdByKey);
  log(`Zonas creadas: ${plan.zonesToCreate.length}. Clientes con zona nueva: ${assigned}.`);
  if (zonedMeanwhile > 0) log(`Con zona puesta desde la app mientras corría: ${zonedMeanwhile}.`);

  // Verificación, solo lectura.
  const after = await fetchAllCustomers(api, token);
  const zonedAfter = after.filter((customer) => customer.zoneId !== null).length;
  const { changed, missing } = compareFingerprints(
    before,
    new Map(after.map((customer) => [customer.id, fingerprint(customer)])),
  );
  log(`Verificación: clientes con zona ${zonedBefore} → ${zonedAfter}.`);
  log(
    `Verificación: clientes con otro dato distinto al de antes: ${changed}; faltantes: ${missing}.`,
  );
  const expected = zonedBefore + assigned + zonedMeanwhile;
  if (changed > 0 || missing > 0 || zonedAfter !== expected) {
    throw new Error(`La verificación NO cierra (se esperaban ${expected} clientes con zona).`);
  }
  log("Verificación OK. Ningún valor personal se imprimió.");
  return { plan, assigned };
}

export function parseArgs(argv) {
  const tagsIndex = argv.indexOf("--tags");
  const tagsFile = tagsIndex === -1 ? undefined : argv[tagsIndex + 1];
  if (tagsFile === undefined || tagsFile.startsWith("--")) {
    throw new Error("Uso: pnpm roster:zones -- --tags <tags.json> [--commit]");
  }
  return { tagsFile, commit: argv.includes("--commit") };
}

async function main() {
  const { tagsFile, commit } = parseArgs(process.argv.slice(2));
  const customerTags = JSON.parse(readFileSync(tagsFile, "utf8"));
  const labelMap = JSON.parse(readFileSync(LABELS_FILE, "utf8"));
  const adminPassword = await promptHidden(
    "Contraseña ACTUAL del usuario admin de producción (no se muestra): ",
  );
  await rosterZones({ adminPassword, customerTags, labelMap, commit });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
