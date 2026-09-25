/**
 * Parte un texto libre (una dirección, una referencia) en trozos de texto y
 * enlaces http(s), para que la pantalla los pinte como nodos: nunca como HTML.
 * Lo que no es un enlace http(s) queda como texto, incluido cualquier
 * intento de marca («<b>», «<img …>») y cualquier otro esquema
 * («javascript:», «ftp:»): el enlace solo nace de este patrón.
 */
export type TextSegment = { kind: "text"; text: string } | { kind: "link"; href: string };

// Hasta el primer espacio, comilla o signo de marca: un enlace pegado en una
// referencia termina ahí.
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
// La puntuación que cierra la frase no es del enlace: «…/mapa.», «(…/mapa)»,
// «“…/mapa”», ««…/mapa»».
const CLOSERS = new Set([".", ",", ";", ":", "!", "?", ")", "]", "»", "”", "’", "…"]);

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

/**
 * Saca del final lo que cierra la frase. Un «)» se queda si abre dentro del
 * enlace («…/wiki/Foo_(bar)»): solo sobra el que no tiene pareja.
 */
function trimClosers(url: string): string {
  let end = url.length;
  while (end > 0) {
    const last = url[end - 1]!;
    if (!CLOSERS.has(last)) break;
    const kept = url.slice(0, end);
    if (last === ")" && count(kept, "(") >= count(kept, ")")) break;
    end -= 1;
  }
  return url.slice(0, end);
}

export function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  const pushText = (value: string) => {
    if (value === "") return;
    const previous = segments.at(-1);
    if (previous?.kind === "text") previous.text += value;
    else segments.push({ kind: "text", text: value });
  };
  for (const match of text.matchAll(URL_PATTERN)) {
    const href = trimClosers(match[0]);
    pushText(text.slice(cursor, match.index));
    // Un «https://» sin nada después no lleva a ningún lado: queda como texto.
    if (/^https?:\/\/$/.test(href)) {
      pushText(href);
    } else {
      segments.push({ kind: "link", href });
    }
    cursor = match.index + href.length;
  }
  pushText(text.slice(cursor));
  return segments;
}
