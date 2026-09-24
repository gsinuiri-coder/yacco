import { registerEndpoint } from "@nuxt/test-utils/runtime";
import { readBody, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import type { Route } from "@yacco/shared";

/**
 * Lo que el detalle de ruta pide al montar además de la ruta: la carga del
 * camión, los lotes y los tipos de envase. Cada test de la pantalla lo necesita
 * aunque no mire esa sección.
 */
export function stubRouteDetail(
  cleanups: Array<() => void>,
  routes: Route | Route[],
): { gets: () => number } {
  const sequence = Array.isArray(routes) ? routes : [routes];
  const id = sequence[0]!.id;
  let gets = 0;
  cleanups.push(
    registerEndpoint(`/api/v1/routes/${id}`, {
      method: "GET",
      handler: () => sequence[Math.min(gets++, sequence.length - 1)],
    }),
    registerEndpoint(`/api/v1/routes/${id}/loads`, { method: "GET", handler: () => [] }),
    registerEndpoint(`/api/v1/routes/${id}/truck-stock`, { method: "GET", handler: () => [] }),
    registerEndpoint("/api/v1/production-batches", () => ({
      data: [],
      total: 0,
      page: 1,
      limit: 100,
      totalPages: 0,
    })),
    registerEndpoint("/api/v1/container-types", () => []),
  );
  return { gets: () => gets };
}

/** Registra una escritura, guarda cada cuerpo y responde con `respond`. */
export function stubWrite(
  cleanups: Array<() => void>,
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  respond: (event: H3Event) => unknown = () => ({}),
): unknown[] {
  const bodies: unknown[] = [];
  cleanups.push(
    registerEndpoint(path, {
      method,
      handler: async (event: H3Event) => {
        bodies.push(method === "DELETE" ? null : await readBody(event));
        return respond(event);
      },
    }),
  );
  return bodies;
}

export function failWith(status: number, message: string) {
  return (event: H3Event) => {
    setResponseStatus(event, status);
    return { message };
  };
}
