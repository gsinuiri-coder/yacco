import { eventHandler, setResponseStatus } from "h3";
import { defineNuxtConfig } from "nuxt/config";
import {
  DEMO_API_ORIGIN,
  LOCAL_API_ORIGIN,
  apiRouteRules,
  vercelProxyRoutes,
} from "./config/api-proxy";
import { createLocalApiGuard, foreignApiResponse } from "./config/local-api-guard";

/**
 * Solo en `nuxt dev`: antes del proxy a LOCAL_API_ORIGIN, comprobar que ahí
 * conteste la API de Yacco y no la de otro proyecto (config/local-api-guard.ts).
 * Un devHandler corre antes que la app de Nitro y sus routeRules; si no
 * responde nada, el pedido sigue al proxy de siempre.
 */
const localApiGuard = createLocalApiGuard(LOCAL_API_ORIGIN, (url) => fetch(url));
const localApiGuardHandler = eventHandler(async (event) => {
  const response = await foreignApiResponse(event.path, localApiGuard);
  if (response === null) return;
  console.error(`[yacco] ${response.message}`);
  setResponseStatus(event, response.statusCode);
  return response;
});

export default defineNuxtConfig({
  compatibilityDate: "2026-09-17",
  modules: ["@nuxt/ui"],
  css: ["~/assets/css/main.css"],

  // SSR sirve el shell, el login y lo público. Los datos autenticados se piden
  // desde el cliente porque la sesión vive en el cliente (D-022).
  ssr: true,

  app: {
    head: {
      htmlAttrs: { lang: "es-PE" },
      title: "Yacco",
    },
  },

  // Tema claro único: es una decisión de producto, no un límite técnico. No
  // hay ningún toggle en la app que pueda escribir "dark" o "system" en el
  // storage — pero `nuxt-color-mode` (la clave por defecto) es la MISMA en
  // cualquier proyecto Nuxt, así que en localhost, compartido entre proyectos
  // por el mismo puerto, un valor viejo de OTRO proyecto se cuela y el html
  // termina en `class="dark"` con el fondo claro fijo de acá: texto blanco
  // sobre fondo blanco. `storageKey` propio cierra esa colisión.
  colorMode: { preference: "light", fallback: "light", storageKey: "yacco-color-mode" },

  // El endpoint de íconos de @nuxt/icon vive por defecto en /api/_nuxt_icon, y
  // /api/* entero se reenvía a la API: fuera de ese prefijo, o Cloud Run
  // contestaría 404 por cada ícono.
  icon: { localApiEndpoint: "/_nuxt_icon" },

  routeRules: {
    ...apiRouteRules(DEMO_API_ORIGIN),
    // Lo mismo que A6 en el web React: nadie enmarca la app.
    "/**": {
      headers: {
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "frame-ancestors 'none'",
      },
    },
  },

  $development: {
    routeRules: apiRouteRules(LOCAL_API_ORIGIN),
    nitro: { devHandlers: [{ route: "/", handler: localApiGuardHandler }] },
  },

  nitro: {
    vercel: {
      config: {
        routes: vercelProxyRoutes(),
      },
    },
  },
});
