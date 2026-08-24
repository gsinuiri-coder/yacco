import { ContainerMovementType, ContainerState } from "@prisma/client";
import {
  CONTAINER_MOVEMENT_TRANSITIONS,
  isValidContainerTransition,
} from "./container-movement-transitions.js";

const ALL_STATES = Object.values(ContainerState);
const ALL_TYPES = Object.values(ContainerMovementType);

describe("isValidContainerTransition", () => {
  // Every pair the matrix itself declares valid must round-trip as valid —
  // this is the "accepts its valid pairs" half of the coverage the task asks
  // for, generated from the matrix so a future edit to it can't silently
  // desync from what this test actually exercises.
  it.each(
    ALL_TYPES.flatMap((type) =>
      CONTAINER_MOVEMENT_TRANSITIONS[type].map((pair) => ({ type, ...pair })),
    ),
  )("accepts $type: $from -> $to", ({ type, from, to }) => {
    expect(isValidContainerTransition(type, from, to)).toBe(true);
  });

  // Every (type, from, to) combination NOT declared above must be rejected —
  // the "rejects invalid pairs" half, as one table rather than one test per
  // line.
  it.each(
    ALL_TYPES.flatMap((type) => {
      const allowed = CONTAINER_MOVEMENT_TRANSITIONS[type];
      const candidates: { from: ContainerState | null; to: ContainerState | null }[] = [
        { from: null, to: null },
        ...ALL_STATES.map((from) => ({ from, to: null })),
        ...ALL_STATES.map((to) => ({ from: null, to })),
        ...ALL_STATES.flatMap((from) => ALL_STATES.map((to) => ({ from, to }))),
      ];
      return candidates
        .filter(
          (pair) => !allowed.some((valid) => valid.from === pair.from && valid.to === pair.to),
        )
        .map((pair) => ({ type, ...pair }));
    }),
  )("rejects $type: $from -> $to", ({ type, from, to }) => {
    expect(isValidContainerTransition(type, from, to)).toBe(false);
  });

  it("rejects both states null for every type — that is not a movement", () => {
    for (const type of ALL_TYPES) {
      expect(isValidContainerTransition(type, null, null)).toBe(false);
    }
  });

  it("DAMAGE_WRITE_OFF accepts every state as its origin", () => {
    for (const state of ALL_STATES) {
      expect(isValidContainerTransition(ContainerMovementType.DAMAGE_WRITE_OFF, state, null)).toBe(
        true,
      );
    }
  });

  it("FULL_SALE accepts leaving from the truck or straight from the plant, nothing else", () => {
    expect(
      isValidContainerTransition(
        ContainerMovementType.FULL_SALE,
        ContainerState.FULL_ON_ROUTE,
        null,
      ),
    ).toBe(true);
    expect(
      isValidContainerTransition(
        ContainerMovementType.FULL_SALE,
        ContainerState.FULL_AT_PLANT,
        null,
      ),
    ).toBe(true);
    expect(
      isValidContainerTransition(
        ContainerMovementType.FULL_SALE,
        ContainerState.EMPTY_AT_PLANT,
        null,
      ),
    ).toBe(false);
  });

  it("OPENING_BALANCE accepts only null -> WITH_CUSTOMER, nothing else", () => {
    expect(
      isValidContainerTransition(
        ContainerMovementType.OPENING_BALANCE,
        null,
        ContainerState.WITH_CUSTOMER,
      ),
    ).toBe(true);
    for (const state of ALL_STATES) {
      if (state === ContainerState.WITH_CUSTOMER) continue;
      expect(isValidContainerTransition(ContainerMovementType.OPENING_BALANCE, null, state)).toBe(
        false,
      );
      expect(isValidContainerTransition(ContainerMovementType.OPENING_BALANCE, state, null)).toBe(
        false,
      );
    }
  });

  it("COUNT_ADJUSTMENT accepts both directions across the fleet boundary, nothing else", () => {
    expect(
      isValidContainerTransition(
        ContainerMovementType.COUNT_ADJUSTMENT,
        null,
        ContainerState.WITH_CUSTOMER,
      ),
    ).toBe(true);
    expect(
      isValidContainerTransition(
        ContainerMovementType.COUNT_ADJUSTMENT,
        ContainerState.WITH_CUSTOMER,
        null,
      ),
    ).toBe(true);
    for (const state of ALL_STATES) {
      if (state === ContainerState.WITH_CUSTOMER) continue;
      expect(isValidContainerTransition(ContainerMovementType.COUNT_ADJUSTMENT, null, state)).toBe(
        false,
      );
      expect(isValidContainerTransition(ContainerMovementType.COUNT_ADJUSTMENT, state, null)).toBe(
        false,
      );
    }
  });
});
