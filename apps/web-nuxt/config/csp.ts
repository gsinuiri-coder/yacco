/**
 * La Content-Security-Policy del web (ítem 7c de docs/plan-cierre-piloto.md).
 * La escribe `server/plugins/csp.ts` en cada página que renderiza Nitro, con un
 * nonce nuevo por respuesta; acá vive lo que se puede probar sin servidor.
 *
 * Todo lo que el web carga sale de su propio origen: los bundles de `/_nuxt/`,
 * las fuentes que `@nuxt/fonts` descarga en el build, los íconos de
 * `/_nuxt_icon` y la API por el proxy de `/api` (D-021). Por eso `'self'` alcanza
 * en todo, y un origen externo que alguien agregue sin tocar esto se bloquea
 * en vez de pasar en silencio.
 *
 * - `script-src` exige el nonce: los scripts en línea que escribe Nuxt (la
 *   configuración, el modo de color) lo reciben en el plugin; un script que
 *   inyecte un XSS, no.
 * - `style-src` permite `'unsafe-inline'`: Nuxt UI y Vue escriben estilos en
 *   atributos, y un estilo no ejecuta código.
 * - `frame-ancestors 'none'` repite la mitad de A6 que ya manda `routeRules`
 *   (nuxt.config.ts), que se queda: la guarda de `scripts/deploy-web.mjs` y el
 *   smoke la exigen ahí. En una página renderizada, esta cabecera reemplaza a
 *   aquella (mismo nombre); en un asset estático queda sola la de `routeRules`.
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Los fragmentos de HTML que Nitro deja tocar en `render:html`. */
export interface RenderedHtml {
  head: string[];
  bodyPrepend: string[];
  body: string[];
  bodyAppend: string[];
}

const SCRIPT_WITHOUT_NONCE = /<script\b(?![^>]*\bnonce=)/g;

/** Le pone el nonce a cada `<script>` que todavía no lo tenga. */
export function stampNonce(html: RenderedHtml, nonce: string): void {
  const stamp = (chunk: string) => chunk.replace(SCRIPT_WITHOUT_NONCE, `<script nonce="${nonce}"`);
  html.head = html.head.map(stamp);
  html.bodyPrepend = html.bodyPrepend.map(stamp);
  html.body = html.body.map(stamp);
  html.bodyAppend = html.bodyAppend.map(stamp);
}
