/** The page envelope every paginated list endpoint returns (Paginated*Dto). */
export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
