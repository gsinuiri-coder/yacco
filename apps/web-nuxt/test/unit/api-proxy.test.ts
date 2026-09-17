import { describe, expect, it } from "vitest";
import nuxtConfig from "../../nuxt.config";
import {
  DEMO_API_ORIGIN,
  LOCAL_API_ORIGIN,
  PRODUCTION_API_ORIGIN,
  PRODUCTION_WEB_HOST,
  vercelProxyRoutes,
} from "../../config/api-proxy";

describe("proxy de la API por host", () => {
  const routes = vercelProxyRoutes();

  it("sólo el dominio de producción, escrito literal, llega a producción", () => {
    const toProduction = routes.filter((route) => route.dest.startsWith(PRODUCTION_API_ORIGIN));

    expect(toProduction).toHaveLength(2);
    for (const route of toProduction) {
      expect(route.has).toEqual([{ type: "host", value: "yacco-web.vercel.app" }]);
    }
    expect(PRODUCTION_WEB_HOST).toBe("yacco-web.vercel.app");
  });

  it("cualquier otro host va a demo, y el literal se evalúa antes que el default", () => {
    const toDemo = routes.filter((route) => route.dest.startsWith(DEMO_API_ORIGIN));

    expect(toDemo).toHaveLength(2);
    for (const route of toDemo) {
      expect(route.has).toBeUndefined();
    }
    const firstDemo = routes.findIndex((route) => route.dest.startsWith(DEMO_API_ORIGIN));
    const lastProduction = routes.findLastIndex((route) =>
      route.dest.startsWith(PRODUCTION_API_ORIGIN),
    );
    expect(lastProduction).toBeLessThan(firstDemo);
  });

  it("/health viaja por el mismo destino que /api/* en cada host", () => {
    const [prodApi, prodHealth, demoApi, demoHealth] = routes;

    expect(prodApi).toMatchObject({ src: "^/api/(.*)$", dest: `${PRODUCTION_API_ORIGIN}/api/$1` });
    expect(prodHealth).toMatchObject({ src: "^/health$", dest: `${PRODUCTION_API_ORIGIN}/health` });
    expect(prodHealth?.has).toEqual(prodApi?.has);
    expect(demoApi).toMatchObject({ src: "^/api/(.*)$", dest: `${DEMO_API_ORIGIN}/api/$1` });
    expect(demoHealth).toMatchObject({ src: "^/health$", dest: `${DEMO_API_ORIGIN}/health` });
  });

  it("nuxt.config publica esas rutas en Vercel y deja el default a demo fuera de Vercel", () => {
    expect(nuxtConfig.nitro?.vercel?.config?.routes).toEqual(routes);
    expect(nuxtConfig.routeRules?.["/api/**"]).toEqual({ proxy: `${DEMO_API_ORIGIN}/api/**` });
    expect(nuxtConfig.routeRules?.["/health"]).toEqual({ proxy: `${DEMO_API_ORIGIN}/health` });
    expect(nuxtConfig.$development?.routeRules?.["/api/**"]).toEqual({
      proxy: `${LOCAL_API_ORIGIN}/api/**`,
    });
  });

  it("los íconos no quedan debajo de /api, que se reenvía entero a Cloud Run", () => {
    expect(nuxtConfig.icon?.localApiEndpoint?.startsWith("/api/")).toBe(false);
  });

  it("nadie puede enmarcar la app", () => {
    expect(nuxtConfig.routeRules?.["/**"]?.headers).toEqual({
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
    });
  });
});
