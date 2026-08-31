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
  // Las tres anulaciones deshacen su movimiento: el par es el de su tipo,
  // leído al revés.
  //
  // FULL_RETURN es el precedente más cercano y NO es lo mismo, aunque el par
  // se parezca. FULL_RETURN registra algo que pasó físicamente: los llenos
  // que el camión no vendió volvieron al galpón y hay que contarlos ahí.
  // Estos tres registran que algo que se anotó NO pasó — el chofer no dejó
  // esos bidones, o los dejó en otra puerta. Nada se movió el día que se
  // emiten; lo que se corrige es el libro, no el parque. De ahí que sean
  // tipos propios y no un par nuevo sobre LOAN_DELIVERY, EMPTY_PICKUP o
  // FULL_SALE: `RouteSettlementService.computeExpected` agrega por `type`, no
  // por estados, así que una reversa tipada LOAN_DELIVERY sumaría a
  // fullDelivered en vez de restarle.
  //
  // La consecuencia práctica de la distinción está en la liquidación: los
  // llenos de un FULL_RETURN se cuentan en la puerta, los de un
  // LOAN_DELIVERY_VOID ya estaban contados en el camión y solo vuelven a
  // estar disponibles para otra parada.
  [ContainerMovementType.LOAN_DELIVERY_VOID]: [
    { from: ContainerState.WITH_CUSTOMER, to: ContainerState.FULL_ON_ROUTE },
  ],
  [ContainerMovementType.EMPTY_PICKUP_VOID]: [
    { from: ContainerState.EMPTY_ON_ROUTE, to: ContainerState.WITH_CUSTOMER },
  ],
  // Sin `from`, como toda entrada al parque: la venta sacó esos bidones de la
  // flota y anularla los devuelve, pero devolverlos "desde" donde salieron no
  // se puede escribir — FULL_SALE tiene DOS orígenes válidos (el camión y la
  // planta) y el libro no dice cuál fue. Vuelven al camión, que es de donde
  // sale toda venta de una parada, la única que esta feature corrige.
  [ContainerMovementType.FULL_SALE_VOID]: [{ from: null, to: ContainerState.FULL_ON_ROUTE }],
};

export function isValidContainerTransition(
  type: ContainerMovementType,
  from: ContainerState | null,
  to: ContainerState | null,
): boolean {
  return CONTAINER_MOVEMENT_TRANSITIONS[type].some((pair) => pair.from === from && pair.to === to);
}
