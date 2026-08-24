import { ContainerMovementType, ContainerState } from "@prisma/client";

export interface StateTransition {
  from: ContainerState | null;
  to: ContainerState | null;
}

const ALL_STATES: ContainerState[] = Object.values(ContainerState);

/**
 * Every (fromState, toState) pair each movement type may record — the single
 * source of truth the service validates against. `type` alone no longer
 * determines direction: damage happens both at the plant and on the route,
 * and a sale can leave from either place too (spec, decided with the
 * client). Null on one side means the container crosses the fleet's
 * boundary: no `from` is a fleet entry, no `to` is an exit (sale, damage,
 * loss) — never reachable for both sides at once, so "both null" is
 * rejected simply by never appearing here.
 */
export const CONTAINER_MOVEMENT_TRANSITIONS: Record<ContainerMovementType, StateTransition[]> = {
  [ContainerMovementType.FLEET_ENTRY]: [{ from: null, to: ContainerState.EMPTY_AT_PLANT }],
  [ContainerMovementType.FILLING]: [
    { from: ContainerState.EMPTY_AT_PLANT, to: ContainerState.FULL_AT_PLANT },
  ],
  [ContainerMovementType.ROUTE_LOAD]: [
    { from: ContainerState.FULL_AT_PLANT, to: ContainerState.FULL_ON_ROUTE },
  ],
  [ContainerMovementType.LOAN_DELIVERY]: [
    { from: ContainerState.FULL_ON_ROUTE, to: ContainerState.WITH_CUSTOMER },
  ],
  [ContainerMovementType.EMPTY_PICKUP]: [
    { from: ContainerState.WITH_CUSTOMER, to: ContainerState.EMPTY_ON_ROUTE },
  ],
  [ContainerMovementType.EMPTY_UNLOAD]: [
    { from: ContainerState.EMPTY_ON_ROUTE, to: ContainerState.EMPTY_AT_PLANT },
  ],
  [ContainerMovementType.FULL_RETURN]: [
    { from: ContainerState.FULL_ON_ROUTE, to: ContainerState.FULL_AT_PLANT },
  ],
  // A sale leaves the fleet from the truck (a stop) or straight from the
  // plant (an office/counter sale) — either is valid, nothing else is.
  [ContainerMovementType.FULL_SALE]: [
    { from: ContainerState.FULL_ON_ROUTE, to: null },
    { from: ContainerState.FULL_AT_PLANT, to: null },
  ],
  // Damage can be found in any state the container was already in.
  [ContainerMovementType.DAMAGE_WRITE_OFF]: ALL_STATES.map((from) => ({ from, to: null })),
  [ContainerMovementType.LOSS_WRITE_OFF]: [{ from: ContainerState.WITH_CUSTOMER, to: null }],
  // These containers were already in the customer's hands when the system
  // went live: they entered the fleet on a date nobody recorded, so crossing
  // the boundary straight into WITH_CUSTOMER is the only honest way to say
  // it. The alternative — chaining fake FILLING + ROUTE_LOAD + LOAN_DELIVERY
  // movements — would invent production batches that never existed.
  [ContainerMovementType.OPENING_BALANCE]: [{ from: null, to: ContainerState.WITH_CUSTOMER }],
  // Both directions, unlike LOSS_WRITE_OFF: a loss is the customer's fault
  // and is reclaimable — they had them and lost them. A count adjustment
  // says the opposite: OUR number was wrong, and these containers were
  // never really there (or there were more than we thought) — nothing to
  // reclaim either way. Conflating the two would make it impossible, months
  // later, to tell a real customer debt from a bookkeeping error. Whoever
  // records the count picks which one applies; this matrix only says both
  // directions are structurally valid for COUNT_ADJUSTMENT.
  [ContainerMovementType.COUNT_ADJUSTMENT]: [
    { from: null, to: ContainerState.WITH_CUSTOMER },
    { from: ContainerState.WITH_CUSTOMER, to: null },
  ],
};

export function isValidContainerTransition(
  type: ContainerMovementType,
  from: ContainerState | null,
  to: ContainerState | null,
): boolean {
  return CONTAINER_MOVEMENT_TRANSITIONS[type].some((pair) => pair.from === from && pair.to === to);
}
