/**
 * El corte de la fase 7 (D-019 en docs/ARQUITECTURA.md).
 *
 * No hay dominio propio: la dirección que usa la planta es la del sitio
 * estático de Render. Ese sitio se construye desde `main`, igual que el de
 * Vercel, así que este mismo bundle corre en los dos hosts. En el de Render,
 * lo primero que hace es mandar al navegador a producción en Vercel. La vuelta
 * atrás es revertir el commit que agregó esto.
 *
 * El destino es FIJO, la raíz: no copia la ruta, la query ni el hash de la
 * dirección vieja. Quien arma un enlace controla esas partes, y copiarlas al
 * destino es la forma de un open redirect (SonarCloud S6105). El costo es que
 * un enlace guardado a una pantalla profunda aterriza en el inicio.
 *
 * Sólo el host EXACTO de Render redirige: nunca un preview (que va a demo) ni
 * el dev local, y nunca el propio dominio de producción, que sería un bucle.
 */
export const RETIRED_WEB_HOST = "yacco-web.onrender.com";
export const PRODUCTION_WEB_HOME = "https://yacco-web.vercel.app/";

export function cutoverTarget(hostname: string): string | null {
  return hostname === RETIRED_WEB_HOST ? PRODUCTION_WEB_HOME : null;
}
