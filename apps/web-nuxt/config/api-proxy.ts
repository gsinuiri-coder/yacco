/**
 * A qué API le habla el web, decidido por HOST (D-011, D-012 y D-021 en
 * docs/ARQUITECTURA.md).
 *
 * El navegador le pide `/api/*` y `/health` SIEMPRE a su propio origen; el
 * reenvío a Cloud Run lo hace Vercel en su CDN, igual que hacía el `vercel.json`
 * del web React. Nitro no sabe condicionar un `routeRules` por host, y el
 * Nitro 2.13 que trae Nuxt 4.5 tampoco convierte un `proxy` en rewrite de CDN
 * (eso llega con Nitro 3): lo dejaría corriendo dentro de la función. Por eso
 * las reglas van como rutas del Build Output API (`nitro.vercel.config.routes`),
 * que Vercel evalúa antes que el filesystem y que las rutas de Nitro:
 *
 * 1. host == dominio de producción (literal) -> producción.
 * 2. cualquier otro host                      -> demo.
 *
 * `routeRules` repite el default a demo para cualquier servidor que no sea
 * Vercel (`nuxt preview`), y apunta a la API local en `nuxt dev`.
 *
 * El sentido del error es el mismo que eligió D-011: un literal de menos sirve
 * demo; nunca un preview escribe en la base real.
 */

/** El único host que cuenta como producción. Literal, sin regex. */
export const PRODUCTION_WEB_HOST = "yacco-web.vercel.app";

export const PRODUCTION_API_ORIGIN = "https://yacco-api-297699663114.us-east4.run.app";
export const DEMO_API_ORIGIN = "https://yacco-api-demo-297699663114.us-east4.run.app";

/**
 * `nuxt dev` le pega a la API local (PORT de .env.example). Es sólo el
 * servidor de desarrollo: en build esta regla no existe.
 */
export const LOCAL_API_ORIGIN = "http://localhost:3100";

/**
 * `/health` está fuera del prefijo `api/v1` en la API (configure-app.ts), así
 * que necesita su propia regla. Viaja con el MISMO origen que `/api/*`: es el
 * testigo con el que se verifica a qué backend pega el front, y un testigo por
 * otro camino probaría ese otro camino.
 */
export function apiRouteRules(origin: string) {
  return {
    "/api/**": { proxy: `${origin}/api/**` },
    "/health": { proxy: `${origin}/health` },
  } as const;
}

export interface ProxyRoute {
  src: string;
  dest: string;
  has?: [{ type: "host"; value: string }];
}

function proxyRoutes(origin: string, has?: ProxyRoute["has"]): ProxyRoute[] {
  const condition = has === undefined ? {} : { has };
  return [
    { src: "^/api/(.*)$", dest: `${origin}/api/$1`, ...condition },
    { src: "^/health$", dest: `${origin}/health`, ...condition },
  ];
}

/**
 * Las rutas de CDN, en el orden en que Vercel las evalúa: primero el literal,
 * después el default. `src` anclado y grupo de captura: el Build Output API no
 * agrega parámetros al destino (el `?host=` de D-012 era cosa de la conversión
 * de `vercel.json`, que acá no interviene).
 */
export function vercelProxyRoutes(): ProxyRoute[] {
  return [
    ...proxyRoutes(PRODUCTION_API_ORIGIN, [{ type: "host", value: PRODUCTION_WEB_HOST }]),
    ...proxyRoutes(DEMO_API_ORIGIN),
  ];
}
