import { assertLocalDatabaseUrl, limaToday } from "./test-data-plan.js";

describe("assertLocalDatabaseUrl", () => {
  test.each([
    "postgresql://yacco:secret@localhost:5433/yacco",
    "postgresql://yacco:secret@127.0.0.1:5433/yacco",
    "postgresql://yacco:secret@[::1]:5433/yacco",
  ])("deja pasar una base en esta máquina: %s", (url) => {
    expect(() => assertLocalDatabaseUrl(url)).not.toThrow();
  });

  test("rechaza Neon sin repetir la URL, que lleva la contraseña", () => {
    const url = "postgresql://owner:s3cr3t@ep-quiet-sky-123.sa-east-1.aws.neon.tech/neondb";

    expect(() => assertLocalDatabaseUrl(url)).toThrow(/nunca en Neon ni en producción/);
    expect(() => assertLocalDatabaseUrl(url)).not.toThrow(/s3cr3t/);
  });

  test("rechaza una base sin DATABASE_URL o con una URL rota", () => {
    expect(() => assertLocalDatabaseUrl(undefined)).toThrow(/Falta DATABASE_URL/);
    expect(() => assertLocalDatabaseUrl("")).toThrow(/Falta DATABASE_URL/);
    expect(() => assertLocalDatabaseUrl("no es una url")).toThrow(/no es una URL válida/);
  });

  test("un host que solo empieza como local no pasa", () => {
    expect(() =>
      assertLocalDatabaseUrl("postgresql://u:p@localhost.attacker.example:5432/db"),
    ).toThrow(/no apunta a esta máquina/);
  });
});

describe("limaToday", () => {
  test("lee el día de Lima, no el de UTC", () => {
    // 03:00 UTC del 10 son las 22:00 del 9 en Lima.
    expect(limaToday(new Date("2026-10-10T03:00:00Z"))).toBe("2026-10-09");
  });
});
