import type { ExportedDocument } from "./convert.js";

/**
 * `pnpm export:tags`: SOLO el id de cada cliente y sus etiquetas del sistema
 * viejo, para que `pnpm roster:zones` (scripts/roster-zones.mjs) les asigne
 * zona en producción. Existe porque las etiquetas no llegaron a `main`: el
 * cargador del padrón no guarda la columna `notes` (backlog, «El cargador del
 * padrón descarta las notas del cliente»).
 *
 * A diferencia de `export:customers`, el archivo no lleva nombre, teléfono,
 * dirección ni deuda: el id del documento es el `externalCode` con el que el
 * cliente entró a `main`, y alcanza para encontrarlo por la API.
 */
export interface CustomerTags {
  externalCode: string;
  tags: string[];
}

export function toCustomerTags(docs: readonly ExportedDocument[]): CustomerTags[] {
  return docs.map((doc) => {
    const raw = doc.data.tags;
    const tags = Array.isArray(raw)
      ? raw.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "")
      : [];
    return { externalCode: doc.id, tags: tags.map((tag) => tag.trim()) };
  });
}
