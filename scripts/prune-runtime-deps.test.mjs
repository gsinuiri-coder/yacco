/**
 * Tests de la poda de la imagen de la API, contra un `node_modules` armado
 * como lo deja `pnpm deploy`: paquetes reales en `.pnpm/<entrada>/node_modules`
 * y enlaces entre ellos (junctions, que en Windows no piden permisos).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { runtimeDependencyNames, unreachableStoreEntries } from "./prune-runtime-deps.mjs";

const workdir = mkdtempSync(join(tmpdir(), "yacco-prune-test-"));
after(() => rmSync(workdir, { recursive: true, force: true }));

function writeManifest(dir, manifest) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
}

/**
 * Un deploy con la forma del de la API:
 *   app → client → (peer obligatorio) engine
 *                → (peer OPCIONAL) cli → config → deepmerge
 *                                       → shared
 *   app → shared        (también la usa cli: tiene que quedar)
 *   client → hoisted    (sin enlace propio: sólo en .pnpm/node_modules)
 *   client → (opcional, no instalada) native-other-platform
 */
function fakeDeploy() {
  const root = mkdtempSync(join(workdir, "app-"));
  const store = join(root, "node_modules", ".pnpm");
  const entries = {
    client: "client@1.0.0_cli@1.0.0",
    engine: "engine@1.0.0",
    cli: "cli@1.0.0",
    config: "config@1.0.0",
    deepmerge: "deepmerge@7.1.5",
    shared: "shared@2.0.0",
    hoisted: "hoisted@1.0.0",
  };
  const realDir = (name) => join(store, entries[name], "node_modules", name);
  const link = (fromEntry, name) =>
    symlinkSync(realDir(name), join(store, entries[fromEntry], "node_modules", name), "junction");

  writeManifest(root, { name: "api", dependencies: { client: "1", shared: "2" } });
  writeManifest(realDir("client"), {
    name: "client",
    dependencies: { hoisted: "1" },
    optionalDependencies: { "native-other-platform": "1" },
    peerDependencies: { cli: "*", engine: "*" },
    peerDependenciesMeta: { cli: { optional: true } },
  });
  writeManifest(realDir("engine"), { name: "engine" });
  writeManifest(realDir("cli"), { name: "cli", dependencies: { config: "1", shared: "2" } });
  writeManifest(realDir("config"), { name: "config", dependencies: { deepmerge: "7" } });
  writeManifest(realDir("deepmerge"), { name: "deepmerge" });
  writeManifest(realDir("shared"), { name: "shared" });
  writeManifest(realDir("hoisted"), { name: "hoisted" });

  link("client", "engine");
  link("client", "cli");
  link("cli", "config");
  link("cli", "shared");
  link("config", "deepmerge");
  for (const name of ["client", "shared"]) {
    symlinkSync(realDir(name), join(root, "node_modules", name), "junction");
  }
  mkdirSync(join(store, "node_modules"));
  symlinkSync(realDir("hoisted"), join(store, "node_modules", "hoisted"), "junction");
  writeFileSync(join(store, "lock.yaml"), "lockfileVersion: '9.0'\n");
  return root;
}

describe("runtimeDependencyNames", () => {
  test("cuenta dependencias, opcionales y peers obligatorios; no los peers opcionales", () => {
    assert.deepEqual(
      runtimeDependencyNames({
        dependencies: { a: "1" },
        optionalDependencies: { b: "1" },
        peerDependencies: { c: "1", d: "1" },
        peerDependenciesMeta: { d: { optional: true } },
      }),
      ["a", "b", "c"],
    );
  });
});

describe("unreachableStoreEntries", () => {
  test("poda el peer opcional y lo que sólo él trae, y nada más", () => {
    // `shared` también cuelga de `cli`: si la poda borrara todo lo que está
    // debajo del CLI, se la llevaría y la API no arrancaría.
    assert.deepEqual(unreachableStoreEntries(fakeDeploy()), [
      "cli@1.0.0",
      "config@1.0.0",
      "deepmerge@7.1.5",
    ]);
  });
});
