export interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

/** "Could not load the list" state shared by every paginated list screen. */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="state">
      <p className="state__title">No se pudo cargar la lista</p>
      <p role="alert">{message}</p>
      <div className="state__actions">
        <button type="button" className="button button--secondary" onClick={onRetry}>
          Reintentar
        </button>
      </div>
    </div>
  );
}
