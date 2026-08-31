import { BadRequestException } from "@nestjs/common";
import { ContainerMovementType, ContainerState } from "@prisma/client";
import { CONTAINER_MOVEMENT_TRANSITIONS } from "./container-movement-transitions.js";
import { assertContainerTypeDeliverable } from "./container-reference-guards.js";

const WITHDRAWN = { id: "11111111-1111-4111-8111-111111111111", name: "Bidón (V)", active: false };
const ACTIVE = { ...WITHDRAWN, active: true };

describe("assertContainerTypeDeliverable", () => {
  it("blocks handing a withdrawn type over to a customer from the fleet, with a message that says why", () => {
    expect(() =>
      assertContainerTypeDeliverable(
        WITHDRAWN,
        ContainerState.FULL_ON_ROUTE,
        ContainerState.WITH_CUSTOMER,
      ),
    ).toThrow(
      new BadRequestException(
        'El tipo de envase "Bidón (V)" está retirado: la oficina decidió no entregar más envases de este tipo. Los que ya están en poder de clientes sí pueden devolverse.',
      ),
    );
  });

  it("never blocks an active type", () => {
    expect(() =>
      assertContainerTypeDeliverable(
        ACTIVE,
        ContainerState.FULL_ON_ROUTE,
        ContainerState.WITH_CUSTOMER,
      ),
    ).not.toThrow();
  });

  // A record crossing the fleet boundary (from null) is not a delivery: it
  // writes down something already true in the world.
  it("lets a withdrawn type enter WITH_CUSTOMER from outside the fleet — a record, not a delivery", () => {
    expect(() =>
      assertContainerTypeDeliverable(WITHDRAWN, null, ContainerState.WITH_CUSTOMER),
    ).not.toThrow();
  });

  it("lets a withdrawn type leave a customer, move inside the operation, or exit the fleet", () => {
    const passing: [ContainerState | null, ContainerState | null][] = [
      [ContainerState.WITH_CUSTOMER, ContainerState.EMPTY_ON_ROUTE],
      [ContainerState.WITH_CUSTOMER, null],
      [ContainerState.FULL_AT_PLANT, ContainerState.FULL_ON_ROUTE],
      [ContainerState.EMPTY_ON_ROUTE, ContainerState.EMPTY_AT_PLANT],
      [ContainerState.FULL_ON_ROUTE, null],
    ];
    for (const [from, to] of passing) {
      expect(() => assertContainerTypeDeliverable(WITHDRAWN, from, to)).not.toThrow();
    }
  });

  // Derived from the matrix itself, so a new movement type is classified
  // by its shape: this pins down that, TODAY, LOAN_DELIVERY is the only
  // transition the guard blocks. If this test starts failing after a new
  // type is added, that is the guard doing its job — read the new type's
  // transition and decide whether it really delivers from the fleet.
  it("blocks exactly the transitions that hand containers over from the fleet: only LOAN_DELIVERY today", () => {
    const blocked: string[] = [];
    for (const [type, transitions] of Object.entries(CONTAINER_MOVEMENT_TRANSITIONS)) {
      for (const { from, to } of transitions) {
        try {
          assertContainerTypeDeliverable(WITHDRAWN, from, to);
        } catch {
          blocked.push(`${type}:${from}->${to}`);
        }
      }
    }
    expect(blocked).toEqual([
      `${ContainerMovementType.LOAN_DELIVERY}:${ContainerState.FULL_ON_ROUTE}->${ContainerState.WITH_CUSTOMER}`,
    ]);
  });

  // La razón por la que el predicado dejó de ser `fromState !== null`.
  // Anular una recogida dice que esos vacíos nunca se fueron del mostrador
  // del cliente: no se entrega nada. Bloquearlo dejaría el saldo del cliente
  // mintiendo para siempre en el único tipo que más urge vaciar.
  it("no bloquea anular una recogida de un tipo retirado: nada se entrega, se corrige el libro", () => {
    expect(() =>
      assertContainerTypeDeliverable(
        WITHDRAWN,
        ContainerState.EMPTY_ON_ROUTE,
        ContainerState.WITH_CUSTOMER,
      ),
    ).not.toThrow();
  });

  // Ningún tipo emite todavía este par, y por eso la tabla derivada de la
  // matriz no puede afirmarlo: entregar un lleno DESDE LA PLANTA —un préstamo
  // en el mostrador— es una entrega igual que hacerlo desde el camión, y el
  // predicado tiene que bloquearla el día que exista, sin que nadie se acuerde
  // de volver acá. FULL_SALE ya trata FULL_AT_PLANT como origen real, así que
  // no es un caso inventado.
  it("bloquea entregar un lleno desde la planta, aunque hoy ningún tipo lo emita", () => {
    expect(() =>
      assertContainerTypeDeliverable(
        WITHDRAWN,
        ContainerState.FULL_AT_PLANT,
        ContainerState.WITH_CUSTOMER,
      ),
    ).toThrow(BadRequestException);
  });
});
