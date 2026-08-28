import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { listCustomers } from "../api/customers";
import type { Customer } from "../api/customers";
import { useAuth } from "../auth/use-auth";
import { useOutsideClick } from "../hooks/use-outside-click";

const SEARCH_DEBOUNCE_MS = 300;
const RESULTS_LIMIT = 10;
const RESULTS_ID = "customer-quick-search-results";

/**
 * The Panel's whole job: type a name or phone, land on that customer's
 * ficha. Unlike CustomerSelect (a controlled form picker that retains its
 * value for a filter/order line), a pick here navigates immediately and
 * nothing stays selected — so this omits the `active` filter CustomerSelect
 * applies for its own reason: an inactive customer who still owes money is
 * exactly who the owner comes here to find.
 */
export function CustomerQuickSearch() {
  const { apiClient } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [reloadToken, setReloadToken] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery === "") {
      setResults([]);
      setHighlightedIndex(-1);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    setErrorMessage(null);
    listCustomers(apiClient, { search: debouncedQuery, limit: RESULTS_LIMIT })
      .then((response) => {
        if (cancelled) return;
        setResults(response.data);
        setHighlightedIndex(-1);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // SessionExpiredError is handled by the api client + ProtectedRoute;
        // anything else is the office's problem to see and retry.
        setResults([]);
        setErrorMessage(error instanceof Error ? error.message : "No se pudo buscar clientes.");
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, debouncedQuery, reloadToken]);

  useOutsideClick(containerRef, () => setIsOpen(false));

  function handlePick(customer: Customer) {
    void navigate(`/customers/${customer.id}`);
  }

  function retry() {
    setReloadToken((token) => token + 1);
  }

  return (
    <div className="field">
      <label className="field__label visually-hidden" htmlFor="customer-quick-search">
        Buscar cliente
      </label>
      <div className="combobox" ref={containerRef}>
        <input
          id="customer-quick-search"
          type="search"
          placeholder="Nombre o teléfono del cliente"
          value={query}
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(event) => {
            if (!isOpen || results.length === 0) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlightedIndex((index) => (index + 1) % results.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlightedIndex((index) => (index - 1 + results.length) % results.length);
            } else if (event.key === "Enter") {
              const highlighted = results[highlightedIndex];
              if (highlighted) {
                event.preventDefault();
                handlePick(highlighted);
              }
            } else if (event.key === "Escape") {
              setIsOpen(false);
              setHighlightedIndex(-1);
            }
          }}
          role="combobox"
          aria-expanded={isOpen && debouncedQuery !== ""}
          aria-controls={RESULTS_ID}
          aria-activedescendant={
            highlightedIndex >= 0 ? `${RESULTS_ID}-option-${highlightedIndex}` : undefined
          }
          autoComplete="off"
        />
        {isOpen && debouncedQuery !== "" && (
          <div className="combobox__results" id={RESULTS_ID} role="listbox">
            {isSearching ? (
              <p className="combobox__empty">Buscando…</p>
            ) : errorMessage ? (
              <div className="notice notice--error" role="alert">
                <p>{errorMessage}</p>
                <button type="button" className="button button--secondary" onClick={retry}>
                  Reintentar
                </button>
              </div>
            ) : results.length === 0 ? (
              <p className="combobox__empty">Sin resultados</p>
            ) : (
              results.map((customer, index) => (
                <button
                  key={customer.id}
                  id={`${RESULTS_ID}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === highlightedIndex}
                  className="combobox__result"
                  onClick={() => handlePick(customer)}
                >
                  <div className="cell-primary">
                    {customer.name}
                    {!customer.active && <span className="badge badge--inactive">Inactivo</span>}
                  </div>
                  <div className="cell-secondary">{customer.phone}</div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
