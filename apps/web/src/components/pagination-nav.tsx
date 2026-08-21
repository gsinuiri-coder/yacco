export interface PaginationNavProps {
  /** What the "Página X de Y" status shows — may lag `page` while a fetch is in flight. */
  displayPage: number;
  /** The requested page: drives which buttons are disabled. */
  page: number;
  totalPages: number;
  onPrevious: () => void;
  onNext: () => void;
}

/** Prev/next pager shared by every paginated list screen. */
export function PaginationNav({
  displayPage,
  page,
  totalPages,
  onPrevious,
  onNext,
}: PaginationNavProps) {
  return (
    <nav className="pagination" aria-label="Paginación">
      <span className="pagination__status">
        Página {displayPage} de {totalPages}
      </span>
      <div className="pagination__controls">
        <button
          type="button"
          className="button button--secondary"
          onClick={onPrevious}
          disabled={page <= 1}
        >
          Anterior
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={onNext}
          disabled={page >= totalPages}
        >
          Siguiente
        </button>
      </div>
    </nav>
  );
}
