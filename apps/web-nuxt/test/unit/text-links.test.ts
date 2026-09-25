import { describe, expect, it } from "vitest";
import { splitLinks } from "../../app/utils/text-links";

describe("splitLinks", () => {
  it("un texto sin enlaces queda como un solo trozo de texto", () => {
    expect(splitLinks("Portón azul frente al parque")).toEqual([
      { kind: "text", text: "Portón azul frente al parque" },
    ]);
  });

  it("separa el texto de un enlace de Google Maps, sin perder nada de ninguno", () => {
    const maps = "https://maps.app.goo.gl/AbC123xYz";
    expect(splitLinks(`Portón azul, ver ${maps} y tocar el timbre`)).toEqual([
      { kind: "text", text: "Portón azul, ver " },
      { kind: "link", href: maps },
      { kind: "text", text: " y tocar el timbre" },
    ]);
  });

  it("la puntuación que cierra la frase no es parte del enlace", () => {
    expect(splitLinks("Mapa: http://x.pe/a?b=1.")).toEqual([
      { kind: "text", text: "Mapa: " },
      { kind: "link", href: "http://x.pe/a?b=1" },
      { kind: "text", text: "." },
    ]);
    expect(splitLinks("(https://x.pe/ruta)")).toEqual([
      { kind: "text", text: "(" },
      { kind: "link", href: "https://x.pe/ruta" },
      { kind: "text", text: ")" },
    ]);
  });

  it("solo http y https: cualquier otro esquema queda como texto", () => {
    expect(splitLinks("javascript:alert(1) ftp://x.pe www.x.pe")).toEqual([
      { kind: "text", text: "javascript:alert(1) ftp://x.pe www.x.pe" },
    ]);
  });

  it("un intento de HTML no corta un enlace ni se vuelve marca: sigue siendo texto", () => {
    expect(splitLinks('<a href="https://x.pe">x</a>')).toEqual([
      { kind: "text", text: '<a href="' },
      { kind: "link", href: "https://x.pe" },
      { kind: "text", text: '">x</a>' },
    ]);
  });

  it("dos enlaces seguidos y un texto vacío", () => {
    expect(splitLinks("https://a.pe https://b.pe")).toEqual([
      { kind: "link", href: "https://a.pe" },
      { kind: "text", text: " " },
      { kind: "link", href: "https://b.pe" },
    ]);
    expect(splitLinks("")).toEqual([]);
  });
});
