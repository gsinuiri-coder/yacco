export interface FormSubmitFooterProps {
  validationError?: string | null;
  submitError?: string | null;
  onCancel: () => void;
  isSubmitting: boolean;
  submitLabel: string;
  submittingLabel: string;
}

/**
 * Errors-then-actions footer shared by the row-expansion forms (ContainerCountForm's
 * main sheet, RejectPaymentForm): a validation notice, a submit notice, then
 * Cancelar/submit. The review-confirmation steps that follow a form like this
 * one differ enough (different buttons, no `validationError`) to stay their own JSX.
 */
export function FormSubmitFooter({
  validationError,
  submitError,
  onCancel,
  isSubmitting,
  submitLabel,
  submittingLabel,
}: FormSubmitFooterProps) {
  return (
    <>
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
          {isSubmitting ? submittingLabel : submitLabel}
        </button>
      </div>
    </>
  );
}
