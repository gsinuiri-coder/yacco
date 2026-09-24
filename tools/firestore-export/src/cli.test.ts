import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { CliArgs } from "./args.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { vi } from "vitest";
import { REAL_DEPS, isEntryPoint, run } from "./cli.js";
import type { CliDeps } from "./cli.js";
import type { FirestoreLike } from "./export.js";
import { CREDENTIALS_ENV } from "./firestore.js";

function firestoreWith(collections: Record<string, Array<Record<string, unknown>>>): FirestoreLike {
  const collection = (docs: Array<Record<string, unknown>>) => ({
    get: () =>
      Promise.resolve({
        docs: docs.map((fields, index) => ({
          id: `d${index}`,
          data: () => fields,
          ref: { collection: () => collection([]) },
        })),
      }),
  });
  return { collection: (name) => collection(collections[name] ?? []) };
}

function recordingDeps(
  firestore: FirestoreLike,
  overrides: Partial<CliDeps> = {},
): CliDeps & { files: Map<string, string>; logs: string[]; errors: string[]; seen: CliArgs[] } {
  const files = new Map<string, string>();
  const logs: string[] = [];
  const errors: string[] = [];
  const seen: CliArgs[] = [];
  return {
    files,
    logs,
    errors,
    seen,
    connect: (args) => {
      seen.push(args);
      return firestore;
    },
    mkdir: () => undefined,
    writeFile: (file, contents) => files.set(file, contents),
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
    env: {},
    ...overrides,
  };
}

describe("run", () => {
  it("customers: escribe el archivo y la consola muestra solo la cuenta", async () => {
    const deps = recordingDeps(
      firestoreWith({ customers: [{ name: "Bodega Real" }, { name: "Otra" }] }),
    );

    const code = await run(["customers", "--out", "foto", "--project", "otro"], deps);

    expect(code).toBe(0);
    expect(deps.seen[0]).toMatchObject({ projectId: "otro" });
    const file = join("foto", "customers.json");
    expect(JSON.parse(deps.files.get(file)!)).toHaveLength(2);
    expect(deps.logs).toEqual([`customers: 2 documentos exportados -> ${file}`]);
    // Nunca contenido en la consola.
    expect(deps.logs.join("\n")).not.toContain("Bodega Real");
  });

  it("vouchers: por defecto solo los pendientes, y dice cuántos leyó", async () => {
    const deps = recordingDeps(
      firestoreWith({
        vouchers: [
          { total: 10, debtPaid: 4 },
          { total: 10, debtPaid: 10 },
        ],
      }),
    );

    expect(await run(["vouchers"], deps)).toBe(0);
    expect(deps.logs[0]).toMatch(/1 documentos exportados \(con deuda pendiente\) de 2 leídos/);

    expect(await run(["vouchers", "--all"], deps)).toBe(0);
    expect(deps.logs[1]).toMatch(/2 documentos exportados \(todos\) de 2 leídos, con 0 debtPays/);
  });

  it("un uso mal escrito muestra la ayuda y sale con 1, sin conectarse", async () => {
    const deps = recordingDeps(firestoreWith({}));

    expect(await run(["pedidos"], deps)).toBe(1);
    expect(deps.errors[0]).toMatch(/Comando desconocido[\s\S]*Uso:/);
    expect(deps.seen).toEqual([]);
  });

  it("un error del SDK sale sin stack y con la ruta de credenciales tachada", async () => {
    const deps = recordingDeps(firestoreWith({}), {
      env: { [CREDENTIALS_ENV]: "C:/privado/llave.json" },
      connect: () => {
        throw new Error("Could not read C:/privado/llave.json");
      },
    });

    expect(await run(["customers"], deps)).toBe(1);
    expect(deps.errors).toEqual([`Error: Could not read <${CREDENTIALS_ENV}>`]);
  });

  it("algo lanzado que no es un Error también se informa", async () => {
    const deps = recordingDeps(firestoreWith({}), {
      connect: () => {
        throw "sin red";
      },
    });

    expect(await run(["customers"], deps)).toBe(1);
    expect(deps.errors).toEqual(["Error: sin red"]);
  });
});

describe("isEntryPoint", () => {
  it("solo cuando el archivo ejecutado es este módulo", () => {
    const file = join(process.cwd(), "src", "cli.ts");
    expect(isEntryPoint(pathToFileURL(file).href, file)).toBe(true);
    expect(isEntryPoint(pathToFileURL(file).href, join(process.cwd(), "otro.ts"))).toBe(false);
    expect(isEntryPoint(pathToFileURL(file).href, undefined)).toBe(false);
  });
});

describe("REAL_DEPS", () => {
  it("crea el directorio, escribe en UTF-8 y habla por la consola", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "firestore-export-")), "foto", "anidada");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      REAL_DEPS.mkdir(dir);
      REAL_DEPS.writeFile(join(dir, "a.json"), '{"nombre":"Begoña"}');
      REAL_DEPS.log("hola");
      REAL_DEPS.error("chau");

      expect(readFileSync(join(dir, "a.json"), "utf8")).toBe('{"nombre":"Begoña"}');
      expect(log).toHaveBeenCalledWith("hola");
      expect(error).toHaveBeenCalledWith("chau");
    } finally {
      log.mockRestore();
      error.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
