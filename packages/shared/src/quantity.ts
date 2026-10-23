/**
 * Una cantidad entera mayor que cero; `null` si no lo es.
 *
 * Acepta número además de texto a propósito: `UInput type="number"` con
 * `v-model` entrega un `number` en cuanto se escribe, aunque el borrador la
 * haya empezado como texto.
 */
export function positiveWhole(value: string | number): number | null {
  const trimmed = String(value).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const whole = Number(trimmed);
  return whole > 0 ? whole : null;
}
