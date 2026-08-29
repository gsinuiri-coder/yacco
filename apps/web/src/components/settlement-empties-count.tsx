import type { ContainerQuantityLine } from "../api/route-settlement";
import { formatDifference } from "../lib/difference";

/** Un tipo de envase que se puede contar en la puerta. */
export interface EmptiesCountType {
  id: string;
  name: string;
}

export interface SettlementEmptiesCountProps {
  /** Los tipos que se ofrecen, ya resueltos por la página. */
  types: EmptiesCountType[];
  /** Lo que el libro dice que se recogió, por tipo. */
  pickedUpByType: ContainerQuantityLine[];
  /** Lo escrito hasta ahora, en crudo, indexado por tipo de envase. */
  counted: Record<string, string>;
  onChange: (containerTypeId: string, value: string) => void;
  disabled: boolean;
}

/** Lo que el libro dice de este tipo; 0 si nunca se recogió ninguno. */
function pickedUpOf(pickedUpByType: ContainerQuantityLine[], containerTypeId: string): number {
  return pickedUpByType.find((line) => line.containerTypeId === containerTypeId)?.quantity ?? 0;
}

/**
 * La hoja de conteo de vacíos al descargar el camión, una línea por tipo de
 * envase, con lo que dice el libro al lado y la diferencia mientras se
 * escribe. Es la única forma de contarlos: la liquidación emite un movimiento
 * de envases por línea, y un movimiento nombra siempre su tipo.
 *
 * **Un campo vacío es cero**, y es a propósito distinto de
 * `container-count-form.tsx`, donde vacío significa «no contado». Allá se
 * cuenta lo que un cliente tiene en la mano, y se puede contar solo una parte;
 * acá el camión se vacía entero al volver, así que un tipo sin escribir es un
 * tipo del que no bajó ninguno. Si esto se «unifica» con el otro formulario,
 * descargar el camión pasa a exigir escribir un 0 por cada tipo que no volvió.
 */
export function SettlementEmptiesCount({
  types,
  pickedUpByType,
  counted,
  onChange,
  disabled,
}: SettlementEmptiesCountProps) {
  return (
    <div className="table-scroll">
      <table className="table">
        <caption className="visually-hidden">
          Vacíos contados al descargar el camión, por tipo de envase
        </caption>
        <thead>
          <tr>
            <th scope="col">Tipo de envase</th>
            <th scope="col">Según el libro</th>
            <th scope="col">Contados</th>
            <th scope="col">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {types.map((type) => {
            const pickedUp = pickedUpOf(pickedUpByType, type.id);
            const raw = (counted[type.id] ?? "").trim();
            const parsed = /^\d+$/.test(raw) ? Number(raw) : null;
            // Un campo vacío cuenta como 0, así que la diferencia se muestra
            // desde el arranque: es lo que el libro dice que falta bajar.
            const difference = parsed === null ? pickedUp - 0 : pickedUp - parsed;

            return (
              <tr key={type.id}>
                <td>{type.name}</td>
                <td>{pickedUp}</td>
                <td>
                  <input
                    id={`empties-${type.id}`}
                    type="number"
                    min={0}
                    step={1}
                    aria-label={`Vacíos contados de ${type.name}`}
                    value={counted[type.id] ?? ""}
                    disabled={disabled}
                    onChange={(event) => onChange(type.id, event.target.value)}
                  />
                </td>
                <td className={difference === 0 ? "money--clear" : "money--owed"}>
                  {difference === 0 ? "Cuadra" : formatDifference(difference)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
