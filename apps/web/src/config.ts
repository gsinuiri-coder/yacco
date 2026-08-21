/**
 * Base de la API. En producción la inyecta Render (VITE_API_BASE_URL en
 * render.yaml); en local cae al puerto por defecto de `pnpm dev:api`.
 * Vite reemplaza import.meta.env en build, así que esto es una constante
 * en el bundle, no una lectura en runtime.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";
