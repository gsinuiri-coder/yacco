import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTAINER_MOVEMENT_TYPE_VALUES,
  CONTAINER_STATE_VALUES,
} from "../src/container-movements.js";

const schema = readFileSync(
  fileURLToPath(new URL("../../../apps/api/prisma/schema.prisma", import.meta.url)),
  "utf8",
);

/** Los valores de un enum de Prisma, en el orden en que están declarados. */
function prismaEnum(name: string): string[] {
  const body = new RegExp(`enum ${name} {([^}]*)}`).exec(schema)?.[1] ?? "";
  return body
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => /^[A-Z_]+$/.test(line));
}

describe("enums de envases en sintonía con schema.prisma", () => {
  it("ContainerMovementType tiene exactamente los valores del enum, sin que falte ni sobre ninguno", () => {
    expect([...CONTAINER_MOVEMENT_TYPE_VALUES].sort()).toEqual(
      prismaEnum("ContainerMovementType").sort(),
    );
  });

  it("ContainerState tiene exactamente los valores del enum", () => {
    expect([...CONTAINER_STATE_VALUES].sort()).toEqual(prismaEnum("ContainerState").sort());
  });
});
