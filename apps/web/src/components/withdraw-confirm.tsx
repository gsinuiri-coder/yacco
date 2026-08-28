export interface WithdrawConfirmProps {
  itemLabel: string;
  explanation: string;
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Withdraw confirmation shared by the manageable catalogs (container types,
 * zones, …): withdrawing changes how other records group or resolve, so it
 * gets an explicit "¿Retirar «X»?" step with its consequence spelled out —
 * unlike reactivating, which those same screens do as a single click.
 */
export function WithdrawConfirm({
  itemLabel,
  explanation,
  isSaving,
  onCancel,
  onConfirm,
}: WithdrawConfirmProps) {
  return (
    <span role="group" aria-label={`Confirmar retiro de ${itemLabel}`}>
      ¿Retirar «{itemLabel}»? {explanation}{" "}
      <button
        type="button"
        className="button button--secondary"
        onClick={onCancel}
        disabled={isSaving}
      >
        No
      </button>{" "}
      <button
        type="button"
        className="button button--primary"
        onClick={onConfirm}
        disabled={isSaving}
      >
        {isSaving ? "Retirando…" : "Sí, retirar"}
      </button>
    </span>
  );
}
