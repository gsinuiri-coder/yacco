/**
 * A7: lo que entra a la imagen de la API no cambia sin un commit que lo diga.
 * Lee los archivos reales del repo, no una copia.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { REPO_ROOT } from "./lib.mjs";

const DOCKERFILE = readFileSync(join(REPO_ROOT, "apps", "api", "Dockerfile"), "utf8");
const LOCKFILE = readFileSync(join(REPO_ROOT, "pnpm-lock.yaml"), "utf8");

/**
 * Las imágenes externas de los FROM (no las etapas propias como `base`, ni
 * `scratch`, que es la imagen vacía: no se descarga de ningún lado).
 */
function externalImages(dockerfile) {
  const stages = new Set();
  const images = [];
  for (const match of dockerfile.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gim)) {
    if (!stages.has(match[1]) && match[1] !== "scratch") images.push(match[1]);
    if (match[2] !== undefined) stages.add(match[2]);
  }
  return images;
}

describe("imagen base de la API", () => {
  test("hay al menos una imagen externa (si no, el test no mira nada)", () => {
    assert.ok(externalImages(DOCKERFILE).length > 0);
  });

  test("cada imagen externa va fijada por digest, no sólo por etiqueta", () => {
    for (const image of externalImages(DOCKERFILE)) {
      assert.match(image, /@sha256:[0-9a-f]{64}$/, image);
    }
  });
});

describe("qs", () => {
  // GHSA-x5fp-wj9c-mxmx y GHSA-4mjr-xmp4-gh2g (DoS), corregidos en 6.16.0. Llega
  // por express y body-parser: un override en package.json lo sostiene.
  test("ninguna versión de qs en el lockfile es anterior a 6.16.0", () => {
    const versions = [...LOCKFILE.matchAll(/^ {2}qs@(\d+)\.(\d+)\.(\d+):/gm)];
    assert.ok(versions.length > 0, "qs no aparece en el lockfile");
    for (const [line, major, minor] of versions) {
      const tooOld = Number(major) === 6 && Number(minor) < 16;
      assert.equal(tooOld, false, line.trim());
    }
  });
});
