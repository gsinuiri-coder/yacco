import type { LoadSummary } from "./roster-loader.types.js";

/**
 * Renders the aggregate-only summary to lines of text. This is the ENTIRE
 * surface of what the loader ever prints: no name, phone, address or
 * per-customer amount ever reaches `LoadSummary`, so there is nothing here
 * that could leak one even by accident — see roster-loader.service.ts for
 * where that boundary is actually enforced.
 */
export function formatSummary(summary: LoadSummary): string[] {
  const lines: string[] = [];
  lines.push(
    summary.committed
      ? "Carga del padrón: ESCRITO en la base de datos."
      : "Carga del padrón: DRY-RUN — no se escribió nada. Repite con --commit para aplicar.",
  );
  lines.push("");
  lines.push(
    `Clientes: ${summary.customers.total} (${summary.customers.active} activos, ${summary.customers.inactive} inactivos)`,
  );
  lines.push(`Ubicaciones: ${summary.locations.total}`);
  lines.push("Por zona:");
  const zoneNames = [...summary.customersByZone.keys()].sort((a, b) => a.localeCompare(b));
  if (zoneNames.length === 0) {
    lines.push("  (ninguna)");
  } else {
    for (const zone of zoneNames) {
      lines.push(`  ${zone}: ${summary.customersByZone.get(zone)}`);
    }
  }
  lines.push("");
  lines.push(
    `Movimientos de apertura (envases): ${summary.containerMovements.created} creados, ` +
      `${summary.containerMovements.alreadyLoaded} ya existían`,
  );
  lines.push("Total de envases por tipo:");
  const typeNames = [...summary.containerTotalsByType.keys()].sort((a, b) => a.localeCompare(b));
  if (typeNames.length === 0) {
    lines.push("  (ninguno)");
  } else {
    for (const type of typeNames) {
      lines.push(`  ${type}: ${summary.containerTotalsByType.get(type)}`);
    }
  }
  lines.push(
    `Conteos confirmatorios (confianza alta): ${summary.confirmatoryCounts.created} creados, ` +
      `${summary.confirmatoryCounts.alreadyLoaded} ya existían`,
  );
  lines.push(`Pendientes de contar (confianza estimada): ${summary.pendingToCount}`);
  lines.push("");
  lines.push(
    `Cargos de apertura (deuda): ${summary.openingCharges.created} creados, ` +
      `${summary.openingCharges.alreadyLoaded} ya existían`,
  );
  lines.push(
    `Créditos de apertura (saldo a favor): ${summary.openingCredits.created} creados, ` +
      `${summary.openingCredits.alreadyLoaded} ya existían`,
  );
  lines.push(`Deuda neta total: S/ ${summary.netDebtTotal}`);
  return lines;
}
