import { randomBytes } from "node:crypto";
import { setResponseHeader } from "h3";
import { contentSecurityPolicy, stampNonce } from "../../config/csp";

/**
 * La CSP con un nonce nuevo en cada página renderizada (config/csp.ts). En
 * desarrollo no: Vite inyecta sus propios scripts para el recargado en
 * caliente, y la política que importa es la que sirve el build.
 */
export default defineNitroPlugin((nitroApp) => {
  if (import.meta.dev) return;
  nitroApp.hooks.hook("render:html", (html, { event }) => {
    const nonce = randomBytes(16).toString("base64");
    stampNonce(html, nonce);
    setResponseHeader(event, "Content-Security-Policy", contentSecurityPolicy(nonce));
  });
});
