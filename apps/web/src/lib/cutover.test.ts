import { describe, expect, it } from "vitest";
import { cutoverTarget } from "./cutover";

const at = (href: string) => {
  const url = new URL(href);
  return { hostname: url.hostname, pathname: url.pathname, search: url.search, hash: url.hash };
};

describe("cutoverTarget", () => {
  it("manda el web viejo de Render al dominio de producción de Vercel, conservando ruta, query y hash", () => {
    expect(
      cutoverTarget(at("https://yacco-web.onrender.com/routes/42?date=2026-09-17#stops")),
    ).toBe("https://yacco-web.vercel.app/routes/42?date=2026-09-17#stops");
  });

  it("manda la raíz de Render a la raíz de Vercel", () => {
    expect(cutoverTarget(at("https://yacco-web.onrender.com/"))).toBe(
      "https://yacco-web.vercel.app/",
    );
  });

  it("no redirige en el dominio de producción de Vercel (sin esto, un bucle)", () => {
    expect(cutoverTarget(at("https://yacco-web.vercel.app/customers"))).toBeNull();
  });

  it("no redirige un preview ni el dev local: esos van a demo o a la API local", () => {
    expect(
      cutoverTarget(at("https://yacco-abc123-gsinuiricoders-projects.vercel.app/")),
    ).toBeNull();
    expect(cutoverTarget(at("http://localhost:5173/login"))).toBeNull();
  });
});
