import { ApiError, RequestTimeoutError } from "./api-errors";

/**
 * Base de la API, relativa a propósito: el navegador le habla SIEMPRE a su
 * propio origen y el reenvío a Cloud Run lo hace Vercel por host (D-021).
 */
export const API_BASE_PATH = "/api/v1";

/**
 * Demo corre con `--min-instances=0` (D-008): la primera petición después de
 * un rato despierta el contenedor. Un timeout corto mataría justo esa.
 */
export const REQUEST_TIMEOUT_MS = 75_000;

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface TransportRequest {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Bearer que viaja en Authorization: el access token, o el refresh en /auth/refresh. */
  bearer?: string | null;
}

export interface TransportResponse {
  status: number;
  data: unknown;
}

function isTimeout(error: unknown): boolean {
  const cause = (error as { cause?: { name?: string } } | null)?.cause;
  return cause?.name === "TimeoutError" || cause?.name === "AbortError";
}

/**
 * Un único viaje de ida y vuelta, sin reintentos ni sesión: eso lo decide
 * useApi. Nunca lanza por el status —lo devuelve— salvo timeout o red caída.
 */
export async function sendToApi(
  path: string,
  request: TransportRequest = {},
): Promise<TransportResponse> {
  const headers: Record<string, string> = {};
  if (request.bearer) {
    headers.Authorization = `Bearer ${request.bearer}`;
  }
  try {
    const response = await $fetch.raw(`${API_BASE_PATH}${path}`, {
      method: request.method ?? "GET",
      headers,
      body: request.body as Record<string, unknown> | undefined,
      query: request.query,
      timeout: REQUEST_TIMEOUT_MS,
      retry: 0,
      ignoreResponseError: true,
    });
    return { status: response.status, data: response._data };
  } catch (error) {
    if (isTimeout(error)) {
      throw new RequestTimeoutError();
    }
    throw error;
  }
}

/** Nest devuelve `{ message }` como texto o como lista de errores de validación. */
export function errorFromResponse(response: TransportResponse): ApiError {
  const message = (response.data as { message?: unknown } | null | undefined)?.message;
  if (Array.isArray(message)) {
    return new ApiError(response.status, message.join(", "));
  }
  if (typeof message === "string" && message.length > 0) {
    return new ApiError(response.status, message);
  }
  return new ApiError(response.status, `La API respondió ${response.status}.`);
}

export function isSuccess(response: TransportResponse): boolean {
  return response.status >= 200 && response.status < 300;
}
