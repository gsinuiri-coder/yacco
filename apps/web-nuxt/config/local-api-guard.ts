/**
 * Que `nuxt dev` nunca le hable en silencio a la API de otro proyecto.
 *
 * Pasó el 2026-10-09: en la máquina de desarrollo, otro proyecto escuchaba en
 * `127.0.0.1` en el mismo puerto que la API local de Yacco, y el proxy de
 * desarrollo le reenviaba todo. El login contestaba 404 y nada decía por qué.
 *
 * Antes de reenviar, el proxy mira `/health` de LOCAL_API_ORIGIN: la API de
 * Yacco se identifica con `service: "yacco-api"`. Si contesta otra cosa, el
 * pedido termina en un 502 que dice qué pasa. Si no contesta nadie, se deja
 * pasar: ese error ya es ruidoso por sí solo.
 */

/** El valor de `service` en `/health` de la API (health.controller.ts). */
export const YACCO_API_SERVICE = "yacco-api";

/** Cuánto se confía en una verificación buena antes de repetirla. */
export const VERIFIED_FOR_MS = 30_000;

/** Lo que el proxy de desarrollo reenvía a la API (apiRouteRules). */
export function isProxiedPath(path: string): boolean {
  return path.startsWith("/api/") || path === "/health" || path.startsWith("/health?");
}

export function foreignApiMessage(origin: string): string {
  return (
    `En ${origin} contesta otra aplicación, no la API de Yacco (o una compilación vieja ` +
    "de Yacco, sin `service` en /health). Levantá la de Yacco con «pnpm dev:api», que " +
    "escucha en ese puerto, o liberá el puerto. No se reenvía nada hasta que conteste la correcta."
  );
}

type Fetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * `check()` devuelve null si se puede reenviar, o el mensaje del 502. Una
 * respuesta buena se recuerda VERIFIED_FOR_MS; una mala se vuelve a mirar en
 * cada pedido, para que levantar la API correcta se note enseguida.
 */
export function createLocalApiGuard(
  origin: string,
  fetcher: Fetcher,
  now: () => number = Date.now,
): { check: () => Promise<string | null> } {
  let verifiedAt: number | null = null;

  async function check(): Promise<string | null> {
    if (verifiedAt !== null && now() - verifiedAt < VERIFIED_FOR_MS) return null;

    let body: unknown;
    try {
      const response = await fetcher(`${origin}/health`);
      body = response.ok ? await response.json() : null;
    } catch (error) {
      // Nadie escucha: el proxy falla solo y lo dice. Un cuerpo que no es
      // JSON, en cambio, sí es otra aplicación.
      if (error instanceof SyntaxError) return foreignApiMessage(origin);
      return null;
    }

    const isYacco =
      typeof body === "object" &&
      body !== null &&
      (body as { service?: unknown }).service === YACCO_API_SERVICE;
    if (!isYacco) {
      verifiedAt = null;
      return foreignApiMessage(origin);
    }
    verifiedAt = now();
    return null;
  }

  return { check };
}

/**
 * Lo que contesta el servidor de desarrollo por un pedido a `path`: null si
 * sigue al proxy de siempre, o el 502 con el porqué.
 */
export async function foreignApiResponse(
  path: string,
  guard: { check: () => Promise<string | null> },
): Promise<{ statusCode: 502; message: string } | null> {
  if (!isProxiedPath(path)) return null;
  const problem = await guard.check();
  return problem === null ? null : { statusCode: 502, message: problem };
}
