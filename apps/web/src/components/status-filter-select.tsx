export interface StatusFilterOption<T extends string> {
  value: T;
  label: string;
}

export interface StatusFilterSelectProps<T extends string> {
  id: string;
  value: T;
  options: StatusFilterOption<T>[];
  onChange: (value: T) => void;
}

/** The "Estado" filter shared by every paginated list toolbar (orders, payments, …). */
export function StatusFilterSelect<T extends string>({
  id,
  value,
  options,
  onChange,
}: StatusFilterSelectProps<T>) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        Estado
      </label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
