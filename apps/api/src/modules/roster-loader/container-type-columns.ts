/**
 * Which ContainerType (by name, matching the catalog — see prisma/seed.ts)
 * each `opening_containers.csv` quantity column maps onto. `qty_spout` and
 * `qty_no_spout` are two distinct container types, not two counts of the
 * same one.
 *
 * Configurable: if the source's column names or the catalog's names ever
 * change, this is the one place to update. The loader fails loudly in
 * validation (before any write) if either name below isn't found among the
 * container types already in the database — it never creates one.
 */
export const CONTAINER_TYPE_COLUMNS = {
  qtySpout: "Con caño",
  qtyNoSpout: "Sin caño",
} as const;

export type ContainerTypeColumn = keyof typeof CONTAINER_TYPE_COLUMNS;

/**
 * Cómo se ENCUENTRA cada tipo en la base: por su recarga. Los nombres de arriba
 * son solo las etiquetas del resumen: en main y en demo los tipos se llaman
 * «BIDON 20L CAÑO» y «BIDON 20L NORMAL», no como en seed.ts, mientras que las
 * recargas se llaman igual en todas las bases. El cargador sigue sin crear
 * nada: si falta la recarga, falla en la validación, antes de escribir.
 */
export const CONTAINER_TYPE_REFILL: Record<ContainerTypeColumn, string> = {
  qtySpout: "Recarga 20L con caño",
  qtyNoSpout: "Recarga 20L sin caño",
};
