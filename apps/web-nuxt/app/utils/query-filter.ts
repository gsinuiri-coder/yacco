/**
 * El valor inicial de un filtro de lista, leído de la URL: así un número del
 * Panel abre su pantalla ya filtrada. Solo texto plano; lo que no sea texto
 * (ausente, repetido) vuelve como `fallback`.
 */
export function queryText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Como `queryText`, pero solo acepta uno de `allowed`: un estado que no existe no filtra. */
export function queryChoice<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}
