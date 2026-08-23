import { describe, expect, it } from "vitest";
import {
  ALLOWED_MOVEMENT_TYPES,
  destinationFor,
  originsFor,
} from "./container-movement-transitions";

// This mirror cannot import the backend's real CONTAINER_MOVEMENT_TRANSITIONS
// (apps/api/src/modules/container-movements/container-movement-transitions.ts):
// it imports `@prisma/client`, which is not a dependency of apps/web, and
// pulling it in would mean adding one just for a test. Instead this locks in
// the documented pairs for the three operations this screen offers — if
// someone edits the mirror to offer a fourth type or a pair the backend
// doesn't accept, this test is the one that catches it.
describe("container-movement-transitions mirror", () => {
  it("offers exactly the three operations this screen registers, nothing from another process", () => {
    expect([...ALLOWED_MOVEMENT_TYPES].sort()).toEqual(
      ["DAMAGE_WRITE_OFF", "FLEET_ENTRY", "LOSS_WRITE_OFF"].sort(),
    );
  });

  it("FLEET_ENTRY: no origin, single destination EMPTY_AT_PLANT", () => {
    expect(originsFor("FLEET_ENTRY")).toEqual([null]);
    expect(destinationFor("FLEET_ENTRY")).toBe("EMPTY_AT_PLANT");
  });

  it("DAMAGE_WRITE_OFF: any of the five states as origin, no destination", () => {
    expect([...originsFor("DAMAGE_WRITE_OFF")].sort()).toEqual(
      [
        "EMPTY_AT_PLANT",
        "FULL_AT_PLANT",
        "FULL_ON_ROUTE",
        "EMPTY_ON_ROUTE",
        "WITH_CUSTOMER",
      ].sort(),
    );
    expect(destinationFor("DAMAGE_WRITE_OFF")).toBeNull();
  });

  it("LOSS_WRITE_OFF: only WITH_CUSTOMER as origin, no destination", () => {
    expect(originsFor("LOSS_WRITE_OFF")).toEqual(["WITH_CUSTOMER"]);
    expect(destinationFor("LOSS_WRITE_OFF")).toBeNull();
  });
});
