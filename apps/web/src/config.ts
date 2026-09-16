/**
 * Base de la API. Relativa a propósito: bajo el rewrite de Vercel
 * (`vercel.json`, D-011/D-012 en docs/ARQUITECTURA.md) el navegador le habla
 * SIEMPRE a su propio origen — nunca hace una petición cross-origin a Cloud
 * Run — y es Vercel quien reenvía `/api/*` al servicio correcto por detrás
 * según el host. Vite reemplaza import.meta.env en build, así que esto es
 * una constante en el bundle, no una lectura en runtime.
 *
 * En local, `pnpm env:local` escribe un VITE_API_BASE_URL explícito en
 * apps/web/.env, apuntando a la API local (puerto 3100 por defecto, ver
 * PORT en .env.example). Sin ese paso, el fallback relativo no tiene a quién
 * pegarle desde el dev server de Vite en :5173 — no hay proxy configurado.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
