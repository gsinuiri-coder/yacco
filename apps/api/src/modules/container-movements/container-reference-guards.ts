import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

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
): Promise<void> {
  const containerType = await client.containerType.findUnique({
    where: { id: containerTypeId },
    select: { id: true },
  });
  if (containerType === null) {
    throw new BadRequestException(`El tipo de envase "${containerTypeId}" no existe`);
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
