/**
 * El corte de la fase 7 (D-019 en docs/ARQUITECTURA.md).
 *
 * No hay dominio propio: la dirección que usa la planta es la del sitio
 * estático de Render. Ese sitio se construye desde `main`, igual que el de
 * Vercel, así que este mismo bundle corre en los dos hosts. En el de Render,
 * lo primero que hace es mandar al navegador a producción en Vercel, con la
 * misma ruta. La vuelta atrás es revertir el commit que agregó esto.
 *
 * Sólo el host EXACTO de Render redirige: nunca un preview (que va a demo) ni
 * el dev local, y nunca el propio dominio de producción, que sería un bucle.
 */
export const RETIRED_WEB_HOST = "yacco-web.onrender.com";
export const PRODUCTION_WEB_ORIGIN = "https://yacco-web.vercel.app";

type CurrentLocation = Pick<Location, "hostname" | "pathname" | "search" | "hash">;

export function cutoverTarget(location: CurrentLocation): string | null {
  if (location.hostname !== RETIRED_WEB_HOST) return null;
  return `${PRODUCTION_WEB_ORIGIN}${location.pathname}${location.search}${location.hash}`;
}
