/**
 * "+2" / "-3": el signo es la información. Un faltante y un sobrante son dos
 * hallazgos distintos y la pantalla nunca los mezcla en un valor absoluto.
 *
 * Vive acá y no dentro de una pantalla porque la liquidación lo usa desde dos
 * archivos —la página y la tabla de vacíos por tipo—, y un helper importado de
 * un componente a otro ata dos piezas que no tienen por qué conocerse.
 */
export function formatDifference(value: number): string {
  return value > 0 ? `+${String(value)}` : String(value);
}
