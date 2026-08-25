import { useState } from "react";
import type { FormEvent } from "react";
import type { ContainerBalanceRow } from "../api/container-balances";
import { createContainerCount } from "../api/container-counts";
import type { ContainerType } from "../api/container-types";
import { useAuth } from "../auth/use-auth";

export interface ContainerCountFormProps {
  row: ContainerBalanceRow;
  /** Active catalog, so the office can count a type the location "did not have". */
  containerTypes: ContainerType[];
  onCancel: () => void;
  /** Every count was registered; the caller reloads the row from the report. */
  onRegistered: () => void;
}

/** One line of the count sheet: what the system believes, next to what was counted. */
interface CountLine {
  containerType: { id: string; name: string };
  expectedQuantity: number;
  /** Raw input; "" means "not counted", which is different from "0". */
  counted: string;
}

interface ReviewedLine {
  containerType: { id: string; name: string };
  expectedQuantity: number;
  countedQuantity: number;
}

function parseCounted(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** "+3" / "-2": the sign is the information. */
export function formatDifference(counted: number, expected: number): string {
  const difference = counted - expected;
  return difference > 0 ? `+${difference}` : String(difference);
}

/**
 * The count sheet for one location. The report's own figure sits beside the
 * field for what was counted, per container type: seeing both is the point.
 * A blank field is "not counted" and is skipped; "0" is a real count. When
 * something differs, the difference is shown before confirming — it is
 * information, not an error. The API emits the adjustment and stamps the
 * date; nothing is computed here beyond the preview. Balances shown after
 * registering come from reloading the report, never from local arithmetic.
 */
export function ContainerCountForm({
  row,
  containerTypes,
  onCancel,
  onRegistered,
}: ContainerCountFormProps) {
  const { apiClient } = useAuth();

  const [lines, setLines] = useState<CountLine[]>(() =>
    row.containers.map((container) => ({
      containerType: container.containerType,
      expectedQuantity: container.quantity,
      counted: "",
    })),
  );
  const [extraTypeId, setExtraTypeId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewedLine[] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const availableExtraTypes = containerTypes.filter(
    (type) => !lines.some((line) => line.containerType.id === type.id),
  );

  function updateCounted(containerTypeId: string, value: string) {
    setLines((current) =>
      current.map((line) =>
        line.containerType.id === containerTypeId ? { ...line, counted: value } : line,
      ),
    );
    setValidationError(null);
  }

  function addExtraType() {
    const type = containerTypes.find((candidate) => candidate.id === extraTypeId);
    if (!type) return;
    // A type the system did not list at this location: the report would have
    // shown it if it had any balance, so it starts from zero.
    setLines((current) => [
      ...current,
      { containerType: { id: type.id, name: type.name }, expectedQuantity: 0, counted: "" },
    ]);
    setExtraTypeId("");
  }

  function reviewLines(): ReviewedLine[] | null {
    const reviewed: ReviewedLine[] = [];
    for (const line of lines) {
      if (line.counted.trim() === "") continue;
      const countedQuantity = parseCounted(line.counted);
      if (countedQuantity === null) {
        setValidationError(
          `Lo contado de ${line.containerType.name} debe ser un número entero, 0 o más`,
        );
        return null;
      }
      reviewed.push({
        containerType: line.containerType,
        expectedQuantity: line.expectedQuantity,
        countedQuantity,
      });
    }
    if (reviewed.length === 0) {
      setValidationError("Escribe lo contado de al menos un tipo de envase");
      return null;
    }
    return reviewed;
  }

  async function register(reviewed: ReviewedLine[]) {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      // One count per type, in order: each is its own append-only entry.
      for (const line of reviewed) {
        await createContainerCount(apiClient, {
          locationId: row.location.id,
          containerTypeId: line.containerType.id,
          countedQuantity: line.countedQuantity,
        });
      }
      onRegistered();
    } catch (error: unknown) {
      // The API's message names the concrete problem; shown verbatim.
      setSubmitError(error instanceof Error ? error.message : "No se pudo registrar el conteo.");
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    const reviewed = reviewLines();
    if (reviewed === null) return;

    const hasDifference = reviewed.some((line) => line.countedQuantity !== line.expectedQuantity);
    if (hasDifference) {
      setReview(reviewed);
      return;
    }
    void register(reviewed);
  }

  const fieldId = (containerTypeId: string) => `count-${row.location.id}-${containerTypeId}`;

  if (review !== null) {
    return (
      <div role="group" aria-label={`Revisar conteo de ${row.location.name}`}>
        <p>Hay diferencias con lo que dice el sistema. Revisa antes de confirmar:</p>
        <ul>
          {review.map((line) => (
            <li key={line.containerType.id}>
              {line.containerType.name}: según el sistema {line.expectedQuantity}, contado{" "}
              {line.countedQuantity}
              {line.countedQuantity !== line.expectedQuantity && (
                <> (diferencia {formatDifference(line.countedQuantity, line.expectedQuantity)})</>
              )}
            </li>
          ))}
        </ul>
        {submitError && (
          <div className="notice notice--error" role="alert">
            {submitError}
          </div>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setReview(null)}
            disabled={isSubmitting}
          >
            Volver a contar
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void register(review)}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Registrando…" : "Confirmar conteo"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={`Contar envases de ${row.location.name}`}>
      {lines.length === 0 && (
        <p className="cell-secondary">
          El sistema no tiene envases de ningún tipo en esta ubicación. Agrega el tipo que
          encontraste, o registra 0 si no hay ninguno.
        </p>
      )}
      <div className="form-grid">
        {lines.map((line) => (
          <div className="field" key={line.containerType.id}>
            <label className="field__label" htmlFor={fieldId(line.containerType.id)}>
              {line.containerType.name}
            </label>
            <span className="field__hint">Según el sistema: {line.expectedQuantity}</span>
            <input
              id={fieldId(line.containerType.id)}
              type="number"
              min={0}
              step={1}
              placeholder="Contado"
              aria-label={`Contado de ${line.containerType.name}`}
              value={line.counted}
              disabled={isSubmitting}
              onChange={(event) => updateCounted(line.containerType.id, event.target.value)}
            />
          </div>
        ))}
        {availableExtraTypes.length > 0 && (
          <div className="field">
            <label className="field__label" htmlFor={fieldId("extra")}>
              Otro tipo de envase encontrado
            </label>
            <select
              id={fieldId("extra")}
              value={extraTypeId}
              disabled={isSubmitting}
              onChange={(event) => setExtraTypeId(event.target.value)}
            >
              <option value="">Selecciona un tipo</option>
              {availableExtraTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button button--secondary"
              onClick={addExtraType}
              disabled={isSubmitting || extraTypeId === ""}
            >
              Agregar tipo
            </button>
          </div>
        )}
      </div>
      {validationError && (
        <div className="notice notice--error" role="alert">
          {validationError}
        </div>
      )}
      {submitError && (
        <div className="notice notice--error" role="alert">
          {submitError}
        </div>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancelar
        </button>
        <button type="submit" className="button button--primary" disabled={isSubmitting}>
          {isSubmitting ? "Registrando…" : "Registrar conteo"}
        </button>
      </div>
    </form>
  );
}
