import { BadRequestException } from "@nestjs/common";
import { ContainerState, Prisma } from "@prisma/client";

export interface ContainerTypeReference {
  id: string;
  name: string;
  active: boolean;
}

/**
 * Shared by every writer that needs a friendly 400 instead of a raw FK
 * violation when a caller references a container type or location that
 * doesn't exist — ContainerMovementsService and ContainerCountsService alike.
 * Takes a `Prisma.TransactionClient` rather than a service's own
 * `PrismaService`: the check must run inside the caller's own transaction,
 * against the same client that will do the insert.
 */
export async function assertContainerTypeExists(
  client: Prisma.TransactionClient,
  containerTypeId: string,
): Promise<ContainerTypeReference> {
  const containerType = await client.containerType.findUnique({
    where: { id: containerTypeId },
    select: { id: true, name: true, active: true },
  });
  if (containerType === null) {
    throw new BadRequestException(`El tipo de envase "${containerTypeId}" no existe`);
  }
  return containerType;
}

/**
 * Withdrawing a container type means "stop putting more of these on the
 * street", NOT "pretend they never existed". If every movement of a
 * withdrawn type were blocked, the ones already in customers' hands could
 * never come back: the driver could not register the return, the balance
 * would lie forever, and withdrawing a type would become impossible in
 * practice — the only way to empty it is for them to return. Twelve (V)
 * out with customers the day the office withdraws (V) must still be able
 * to come back one by one until the balance reads zero.
 *
 * So the rule is asymmetric, and it is derived from the SHAPE of the
 * transition, not from a list of movement types:
 *
 *   block  <=>  toState === WITH_CUSTOMER && fromState !== null
 *
 * - `toState === WITH_CUSTOMER` is what puts more of the type in customers'
 *   hands. Everything else — pickups, losses, damage, route loads and
 *   unloads — either takes them out of circulation or moves them inside the
 *   operation, and that is exactly how a withdrawn container comes home.
 *   (FILLING puts more into the fleet, and production-batches already
 *   refuses a withdrawn type there.)
 * - `fromState !== null` is the fleet boundary. In the transition matrix, a
 *   null `from` means the container crosses INTO the fleet's books from
 *   outside, and the two transitions that enter WITH_CUSTOMER that way —
 *   OPENING_BALANCE and COUNT_ADJUSTMENT — are RECORDS: they write down
 *   something that was already true in the world (the customer had them at
 *   cutover; the count found more than the books said). The only transition
 *   that physically HANDS OVER containers from the fleet to a customer is
 *   LOAN_DELIVERY, from FULL_ON_ROUTE. Blocking a record prevents nothing
 *   real; it only prevents finding out.
 *
 * Why the shape and not a list: a movement type added tomorrow that
 * delivers from the fleet is blocked by itself, and one that records from
 * outside passes by itself, with nobody having to remember to update
 * anything. A parallel list drifts the day someone forgets — it took three
 * repeats of exactly that with the migration test's list to learn it.
 *
 * Physical counts are never blocked, in either direction: a count is an
 * observation, and the office withdrawing a type does not take three
 * containers off a customer's counter.
 */
export function assertContainerTypeDeliverable(
  containerType: ContainerTypeReference,
  fromState: ContainerState | null,
  toState: ContainerState | null,
): void {
  const delivers = toState === ContainerState.WITH_CUSTOMER && fromState !== null;
  if (delivers && !containerType.active) {
    throw new BadRequestException(
      `El tipo de envase "${containerType.name}" está retirado: la oficina decidió no entregar más envases de este tipo. Los que ya están en poder de clientes sí pueden devolverse.`,
    );
  }
}

export async function assertLocationExists(
  client: Prisma.TransactionClient,
  locationId: string,
): Promise<void> {
  const location = await client.customerLocation.findUnique({
    where: { id: locationId },
    select: { id: true },
  });
  if (location === null) {
    throw new BadRequestException(`La locación "${locationId}" no existe`);
  }
}
