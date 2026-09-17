import { describe, expect, it } from "vitest";
import { cutoverTarget } from "./cutover";

describe("cutoverTarget", () => {
  it("manda el web viejo de Render a la raíz de producción en Vercel", () => {
    expect(cutoverTarget("yacco-web.onrender.com")).toBe("https://yacco-web.vercel.app/");
  });

  it("no arrastra nada de la dirección vieja: el destino es fijo, no un open redirect", () => {
    // La ruta, la query y el hash los controla quien arma el enlace. Si se
    // copiaran al destino, un enlace a Render podría terminar fuera de Yacco.
    expect(new URL(cutoverTarget("yacco-web.onrender.com") ?? "").pathname).toBe("/");
  });

  it("no redirige en el dominio de producción de Vercel (sin esto, un bucle)", () => {
    expect(cutoverTarget("yacco-web.vercel.app")).toBeNull();
  });

  it("no redirige un preview ni el dev local: esos van a demo o a la API local", () => {
    expect(cutoverTarget("yacco-abc123-gsinuiricoders-projects.vercel.app")).toBeNull();
    expect(cutoverTarget("localhost")).toBeNull();
  });
});
