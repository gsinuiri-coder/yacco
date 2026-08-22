import { useEffect, useRef, useState } from "react";
import { listCustomers } from "../api/customers";
import type { Customer } from "../api/customers";
import { useAuth } from "../auth/use-auth";

const SEARCH_DEBOUNCE_MS = 300;
const RESULTS_LIMIT = 10;

export interface CustomerSelectProps {
  id: string;
  label: string;
  value: Customer | null;
  onChange: (customer: Customer | null) => void;
  placeholder?: string;
}

/**
 * Reusable customer picker: with ~500 customers this is never a <select>
 * with everything loaded. It debounces against the same search the
 * Customers list uses and shows a bounded set of matches. Controlled
 * (`value`/`onChange`) and standalone on purpose — this screen uses it as an
 * optional filter, order creation will use it as a required field.
 */
export function CustomerSelect({
  id,
  label,
  value,
  onChange,
  placeholder = "Nombre o teléfono",
}: CustomerSelectProps) {
  const { apiClient } = useAuth();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery === "") {
      setResults([]);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    // Only active customers: order creation (the other consumer of this
    // component) may not be taken against a deactivated one.
    listCustomers(apiClient, { search: debouncedQuery, limit: RESULTS_LIMIT, active: true })
      .then((response) => {
        if (!cancelled) setResults(response.data);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, debouncedQuery]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  function handlePick(customer: Customer) {
    onChange(customer);
    setQuery("");
    setDebouncedQuery("");
    setResults([]);
    setIsOpen(false);
  }

  function handleClear() {
    onChange(null);
    setQuery("");
  }

  if (value !== null) {
    return (
      <div className="field">
        <span className="field__label">{label}</span>
        <div className="combobox__selected">
          <div>
            <div className="combobox__selected-name">{value.name}</div>
            <div className="combobox__selected-detail">{value.phone}</div>
          </div>
          <button type="button" className="button button--ghost" onClick={handleClear}>
            Cambiar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="combobox" ref={containerRef}>
        <input
          id={id}
          type="search"
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={`${id}-results`}
          autoComplete="off"
        />
        {isOpen && debouncedQuery !== "" && (
          <div className="combobox__results" id={`${id}-results`} role="listbox">
            {isSearching ? (
              <p className="combobox__empty">Buscando…</p>
            ) : results.length === 0 ? (
              <p className="combobox__empty">Sin resultados</p>
            ) : (
              results.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="combobox__result"
                  onClick={() => handlePick(customer)}
                >
                  <div className="cell-primary">{customer.name}</div>
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
