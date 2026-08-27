/**
 * Base de la API. En producción la inyecta Render (VITE_API_BASE_URL en
 * render.yaml); en local cae a 3100, el puerto por defecto de la API local
 * (ver PORT en .env.example — el 3000 suele estar ocupado por otros
 * proyectos en la máquina del desarrollador). Vite reemplaza
 * import.meta.env en build, así que esto es una constante en el bundle, no
 * una lectura en runtime.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3100/api/v1";
