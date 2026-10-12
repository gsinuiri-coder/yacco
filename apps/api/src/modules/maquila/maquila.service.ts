import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MaquilaMovementType, PaymentStatus, Prisma, ProductType, UserRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { MONEY_MESSAGE, MONEY_PATTERN } from "../customers/dto/create-customer.dto.js";
import type { FillMaquilaDto } from "./dto/fill-maquila.dto.js";
import type { ListMaquilaMovementsQueryDto } from "./dto/list-maquila-movements-query.dto.js";
import type {
  MaquilaBalanceResponseDto,
  MaquilaCustomerSummaryResponseDto,
  MaquilaDiscrepancyResponseDto,
  MaquilaMovementResponseDto,
  MaquilaReconciliationResponseDto,
  PaginatedMaquilaMovementsResponseDto,
} from "./dto/maquila-response.dto.js";
import type { ReceiveMaquilaDto } from "./dto/receive-maquila.dto.js";
import type { ReturnMaquilaDto } from "./dto/return-maquila.dto.js";
import type { VoidMaquilaMovementDto } from "./dto/void-maquila-movement.dto.js";

function assertPositiveAmount(amount: string): Prisma.Decimal {
  if (!MONEY_PATTERN.test(amount)) {
    throw new BadRequestException(`El monto ${MONEY_MESSAGE}`);
  }
  const parsed = new Prisma.Decimal(amount);
  if (parsed.lte(0)) {
    throw new BadRequestException("El monto debe ser mayor que 0");
  }
  return parsed;
}

const MOVEMENT_INCLUDE = {
  customer: { select: { id: true, name: true } },
  containerType: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, name: true } },
  sale: { select: { id: true, total: true } },
} satisfies Prisma.MaquilaContainerMovementInclude;

type MovementWithRelations = Prisma.MaquilaContainerMovementGetPayload<{
  include: typeof MOVEMENT_INCLUDE;
}>;

@Injectable()
export class MaquilaService {
  constructor(private readonly prisma: PrismaService) {}

  private toMovementResponse(movement: MovementWithRelations): MaquilaMovementResponseDto {
    return {
      id: movement.id,
      customerId: movement.customerId,
      customerName: movement.customer.name,
      containerTypeId: movement.containerTypeId,
      containerTypeName: movement.containerType.name,
      type: movement.type,
      quantity: movement.quantity,
      saleId: movement.saleId,
      saleTotal: movement.sale ? movement.sale.total.toFixed(2) : null,
      reversesMovementId: movement.reversesMovementId,
      reason: movement.reason,
      recordedById: movement.recordedById,
      recordedByName: movement.recordedBy.name,
      occurredAt: movement.occurredAt.toISOString(),
      createdAt: movement.createdAt.toISOString(),
    };
  }

  async receive(dto: ReceiveMaquilaDto, recordedById: string): Promise<MaquilaMovementResponseDto> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
      select: { id: true, active: true },
    });
    if (!customer) {
      throw new BadRequestException(`El cliente "${dto.customerId}" no existe`);
    }
    if (!customer.active) {
      throw new BadRequestException(`El cliente "${dto.customerId}" no está activo`);
    }

    const containerType = await this.prisma.containerType.findUnique({
      where: { id: dto.containerTypeId },
      select: { id: true, active: true },
    });
    if (!containerType) {
      throw new BadRequestException(`El tipo de envase "${dto.containerTypeId}" no existe`);
    }
    if (!containerType.active) {
      throw new BadRequestException(`El tipo de envase "${dto.containerTypeId}" no está activo`);
    }

    const occurredAt = new Date();
    const movement = await this.prisma.$transaction(async (tx) => {
      await tx.maquilaBalance.upsert({
        where: {
          customerId_containerTypeId: {
            customerId: dto.customerId,
            containerTypeId: dto.containerTypeId,
          },
        },
        update: { emptyAtPlant: { increment: dto.quantity } },
        create: {
          customerId: dto.customerId,
          containerTypeId: dto.containerTypeId,
          emptyAtPlant: dto.quantity,
          fullToReturn: 0,
        },
      });

      return tx.maquilaContainerMovement.create({
        data: {
          customerId: dto.customerId,
          containerTypeId: dto.containerTypeId,
          type: MaquilaMovementType.RECEIVED,
          quantity: dto.quantity,
          recordedById,
          occurredAt,
        },
        include: MOVEMENT_INCLUDE,
      });
    });

    return this.toMovementResponse(movement);
  }

  async fill(dto: FillMaquilaDto, recordedById: string): Promise<MaquilaMovementResponseDto> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
      select: { id: true, active: true },
    });
    if (!customer) {
      throw new BadRequestException(`El cliente "${dto.customerId}" no existe`);
    }
    if (!customer.active) {
      throw new BadRequestException(`El cliente "${dto.customerId}" no está activo`);
    }

    const containerType = await this.prisma.containerType.findUnique({
      where: { id: dto.containerTypeId },
      select: { id: true, active: true },
    });
    if (!containerType) {
      throw new BadRequestException(`El tipo de envase "${dto.containerTypeId}" no existe`);
    }
    if (!containerType.active) {
      throw new BadRequestException(`El tipo de envase "${dto.containerTypeId}" no está activo`);
    }

    const balance = await this.prisma.maquilaBalance.findUnique({
      where: {
        customerId_containerTypeId: {
          customerId: dto.customerId,
          containerTypeId: dto.containerTypeId,
        },
      },
      select: { emptyAtPlant: true },
    });

    const emptyAtPlant = balance?.emptyAtPlant ?? 0;
    if (emptyAtPlant < dto.quantity) {
      throw new BadRequestException(
        `No hay suficientes vacíos en planta para llenar (hay ${emptyAtPlant}, se intentó llenar ${dto.quantity})`,
      );
    }

    const occurredAt = new Date();
    const movement = await this.prisma.$transaction(async (tx) => {
      await tx.maquilaBalance.update({
        where: {
          customerId_containerTypeId: {
            customerId: dto.customerId,
            containerTypeId: dto.containerTypeId,
          },
        },
        data: {
          emptyAtPlant: { decrement: dto.quantity },
          fullToReturn: { increment: dto.quantity },
        },
      });

      return tx.maquilaContainerMovement.create({
        data: {
          customerId: dto.customerId,
          containerTypeId: dto.containerTypeId,
          type: MaquilaMovementType.FILLED,
          quantity: dto.quantity,
          recordedById,
          occurredAt,
        },
        include: MOVEMENT_INCLUDE,
      });
    });

    return this.toMovementResponse(movement);
  }

  async return(dto: ReturnMaquilaDto, recordedById: string): Promise<MaquilaMovementResponseDto> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
      select: { id: true, active: true, debtBalance: true, creditLimit: true },
    });
    if (!customer) {
      throw new BadRequestException(`El cliente "${dto.customerId}" no existe`);
    }
    if (!customer.active) {
      throw new BadRequestException(`El cliente "${dto.customerId}" no está activo`);
    }

    const containerType = await this.prisma.containerType.findUnique({
      where: { id: dto.containerTypeId },
      select: { id: true, active: true },
    });
    if (!containerType) {
      throw new BadRequestException(`El tipo de envase "${dto.containerTypeId}" no existe`);
    }
    if (!containerType.active) {
      throw new BadRequestException(`El tipo de envase "${dto.containerTypeId}" no está activo`);
    }

    const balance = await this.prisma.maquilaBalance.findUnique({
      where: {
        customerId_containerTypeId: {
          customerId: dto.customerId,
          containerTypeId: dto.containerTypeId,
        },
      },
      select: { fullToReturn: true },
    });

    const fullToReturn = balance?.fullToReturn ?? 0;
    if (fullToReturn < dto.quantity) {
      throw new BadRequestException(
        `No hay suficientes llenos para devolver (hay ${fullToReturn}, se intentó devolver ${dto.quantity})`,
      );
    }

    // Buscar producto del servicio de maquila para este tipo de envase
    const maquilaProduct = await this.prisma.product.findFirst({
      where: {
        type: ProductType.MAQUILA_SERVICE,
        containerTypeId: dto.containerTypeId,
        active: true,
      },
      select: { id: true, listPrice: true },
    });

    if (!maquilaProduct) {
      throw new BadRequestException("Falta el precio de maquila de este cliente");
    }

    // Ubicación del cliente
    let locationId = dto.locationId;
    if (!locationId) {
      const primaryLoc = await this.prisma.customerLocation.findFirst({
        where: { customerId: dto.customerId, isPrimary: true },
        select: { id: true },
      });
      if (!primaryLoc) {
        throw new BadRequestException(
          `El cliente "${dto.customerId}" no tiene una ubicación principal`,
        );
      }
      locationId = primaryLoc.id;
    }

    // Resolver precio: precio pactado > precio de lista
    const customerPrices = await this.prisma.customerPrice.findMany({
      where: {
        customerId: dto.customerId,
        productId: maquilaProduct.id,
        OR: [{ locationId: null }, { locationId }],
      },
    });

    const locationPrice = customerPrices.find((p) => p.locationId === locationId);
    const generalPrice = customerPrices.find((p) => p.locationId === null);
    const agreedPrice = locationPrice ?? generalPrice;
    const unitPrice = agreedPrice ? agreedPrice.price : maquilaProduct.listPrice;

    if (unitPrice.lte(0)) {
      throw new BadRequestException("Falta el precio de maquila de este cliente");
    }

    const total = unitPrice.times(dto.quantity);

    // Pago (si se proporciona)
    let resolvedPayment: {
      amount: Prisma.Decimal;
      status: PaymentStatus;
      paymentMethodId: string;
    } | null = null;

    if (dto.payment) {
      const amount = assertPositiveAmount(dto.payment.amount);
      const paymentMethod = await this.prisma.paymentMethod.findUnique({
        where: { id: dto.payment.paymentMethodId },
        select: { id: true, active: true, requiresConfirmation: true },
      });
      if (!paymentMethod) {
        throw new BadRequestException(
          `El método de pago "${dto.payment.paymentMethodId}" no existe`,
        );
      }
      if (!paymentMethod.active) {
        throw new BadRequestException(
          `El método de pago "${dto.payment.paymentMethodId}" no está activo`,
        );
      }
      resolvedPayment = {
        amount,
        status: paymentMethod.requiresConfirmation
          ? PaymentStatus.PENDING
          : PaymentStatus.CONFIRMED,
        paymentMethodId: paymentMethod.id,
      };
    }

    const debtDelta =
      resolvedPayment !== null && resolvedPayment.status === PaymentStatus.CONFIRMED
        ? total.minus(resolvedPayment.amount)
        : total;

    const creditLimitExceeded =
      customer.creditLimit !== null &&
      customer.debtBalance.plus(debtDelta).gt(customer.creditLimit);

    const occurredAt = new Date();

    const movement = await this.prisma.$transaction(async (tx) => {
      // 1. Descontar llenos por devolver
      await tx.maquilaBalance.update({
        where: {
          customerId_containerTypeId: {
            customerId: dto.customerId,
            containerTypeId: dto.containerTypeId,
          },
        },
        data: { fullToReturn: { decrement: dto.quantity } },
      });

      // 2. Incrementar deuda del cliente
      await tx.customer.update({
        where: { id: dto.customerId },
        data: { debtBalance: { increment: debtDelta } },
      });

      // 3. Crear venta
      const sale = await tx.sale.create({
        data: {
          locationId: locationId!,
          soldAt: occurredAt,
          total,
          creditLimitExceeded,
          recordedById,
          items: {
            create: [
              {
                productId: maquilaProduct.id,
                quantity: dto.quantity,
                unitPrice,
              },
            ],
          },
        },
      });

      // 4. Crear pago si se especificó
      if (resolvedPayment !== null) {
        const confirmed = resolvedPayment.status === PaymentStatus.CONFIRMED;
        await tx.payment.create({
          data: {
            customerId: dto.customerId,
            locationId: locationId!,
            saleId: sale.id,
            paymentMethodId: resolvedPayment.paymentMethodId,
            paidAt: occurredAt,
            amount: resolvedPayment.amount,
            status: resolvedPayment.status,
            confirmedAt: confirmed ? occurredAt : null,
            confirmedById: confirmed ? recordedById : null,
            recordedById,
          },
        });
      }

      // 5. Crear movimiento RETURNED
      return tx.maquilaContainerMovement.create({
        data: {
          customerId: dto.customerId,
          containerTypeId: dto.containerTypeId,
          type: MaquilaMovementType.RETURNED,
          quantity: dto.quantity,
          saleId: sale.id,
          recordedById,
          occurredAt,
        },
        include: MOVEMENT_INCLUDE,
      });
    });

    return this.toMovementResponse(movement);
  }

  async voidMovement(
    id: string,
    dto: VoidMaquilaMovementDto,
    actor: { id: string; roles: UserRole[] },
  ): Promise<MaquilaMovementResponseDto> {
    const reason = dto.reason.trim();
    if (reason.length === 0) {
      throw new BadRequestException("El motivo de la anulación no puede estar vacío");
    }

    const movement = await this.prisma.maquilaContainerMovement.findUnique({
      where: { id },
      include: {
        sale: {
          include: {
            payments: true,
            location: { select: { customerId: true } },
          },
        },
        reversedBy: { select: { id: true } },
      },
    });

    if (!movement) {
      throw new NotFoundException(`El movimiento "${id}" no existe`);
    }

    if (movement.reversedBy !== null) {
      throw new BadRequestException("El movimiento ya ha sido anulado previamente");
    }

    if (
      movement.type === MaquilaMovementType.RECEIVED_VOID ||
      movement.type === MaquilaMovementType.FILLED_VOID ||
      movement.type === MaquilaMovementType.RETURNED_VOID
    ) {
      throw new BadRequestException("No se puede anular un movimiento de anulación");
    }

    const isAdmin = actor.roles.includes(UserRole.ADMIN);
    const isSupervisor = actor.roles.includes(UserRole.PLANT_SUPERVISOR);

    if (movement.type === MaquilaMovementType.RECEIVED) {
      if (!isAdmin) {
        throw new ForbiddenException("Solo el administrador puede anular un recibido de maquila");
      }

      const balance = await this.prisma.maquilaBalance.findUnique({
        where: {
          customerId_containerTypeId: {
            customerId: movement.customerId,
            containerTypeId: movement.containerTypeId,
          },
        },
        select: { emptyAtPlant: true },
      });

      const emptyAtPlant = balance?.emptyAtPlant ?? 0;
      if (emptyAtPlant < movement.quantity) {
        throw new BadRequestException(
          "No se puede anular el recibido: los vacíos en planta quedarían en negativo",
        );
      }

      const occurredAt = new Date();
      const voidedMovement = await this.prisma.$transaction(async (tx) => {
        await tx.maquilaBalance.update({
          where: {
            customerId_containerTypeId: {
              customerId: movement.customerId,
              containerTypeId: movement.containerTypeId,
            },
          },
          data: { emptyAtPlant: { decrement: movement.quantity } },
        });

        return tx.maquilaContainerMovement.create({
          data: {
            customerId: movement.customerId,
            containerTypeId: movement.containerTypeId,
            type: MaquilaMovementType.RECEIVED_VOID,
            quantity: movement.quantity,
            reversesMovementId: movement.id,
            reason,
            recordedById: actor.id,
            occurredAt,
          },
          include: MOVEMENT_INCLUDE,
        });
      });

      return this.toMovementResponse(voidedMovement);
    }

    if (movement.type === MaquilaMovementType.FILLED) {
      if (!isAdmin && !isSupervisor) {
        throw new ForbiddenException(
          "Solo el supervisor o administrador pueden anular un llenado de maquila",
        );
      }

      const balance = await this.prisma.maquilaBalance.findUnique({
        where: {
          customerId_containerTypeId: {
            customerId: movement.customerId,
            containerTypeId: movement.containerTypeId,
          },
        },
        select: { fullToReturn: true },
      });

      const fullToReturn = balance?.fullToReturn ?? 0;
      if (fullToReturn < movement.quantity) {
        throw new BadRequestException(
          "No se puede anular el llenado: los llenos por devolver quedarían en negativo",
        );
      }

      const occurredAt = new Date();
      const voidedMovement = await this.prisma.$transaction(async (tx) => {
        await tx.maquilaBalance.update({
          where: {
            customerId_containerTypeId: {
              customerId: movement.customerId,
              containerTypeId: movement.containerTypeId,
            },
          },
          data: {
            fullToReturn: { decrement: movement.quantity },
            emptyAtPlant: { increment: movement.quantity },
          },
        });

        return tx.maquilaContainerMovement.create({
          data: {
            customerId: movement.customerId,
            containerTypeId: movement.containerTypeId,
            type: MaquilaMovementType.FILLED_VOID,
            quantity: movement.quantity,
            reversesMovementId: movement.id,
            reason,
            recordedById: actor.id,
            occurredAt,
          },
          include: MOVEMENT_INCLUDE,
        });
      });

      return this.toMovementResponse(voidedMovement);
    }

    if (movement.type === MaquilaMovementType.RETURNED) {
      if (!isAdmin) {
        throw new ForbiddenException(
          "Solo el administrador puede anular una devolución de maquila",
        );
      }

      const sale = movement.sale;
      if (!sale) {
        throw new BadRequestException("El movimiento no tiene una venta asociada");
      }
      if (sale.voidedAt !== null) {
        throw new BadRequestException("La venta asociada ya está anulada");
      }

      const occurredAt = new Date();
      const voidedMovement = await this.prisma.$transaction(async (tx) => {
        // 1. Restaurar llenos por devolver
        await tx.maquilaBalance.update({
          where: {
            customerId_containerTypeId: {
              customerId: movement.customerId,
              containerTypeId: movement.containerTypeId,
            },
          },
          data: { fullToReturn: { increment: movement.quantity } },
        });

        // 2. Anular cobros y pagos
        await tx.sale.update({
          where: { id: sale.id },
          data: {
            voidedAt: occurredAt,
            voidedById: actor.id,
            voidReason: reason,
          },
        });

        if (sale.payments.length > 0) {
          await tx.payment.updateMany({
            where: {
              id: { in: sale.payments.map((p) => p.id) },
              voidedAt: null,
            },
            data: {
              voidedAt: occurredAt,
              voidedById: actor.id,
              voidReason: reason,
            },
          });
        }

        let debtDelta = sale.total.negated();
        for (const payment of sale.payments) {
          if (payment.status === PaymentStatus.CONFIRMED) {
            debtDelta = debtDelta.plus(payment.amount);
          }
        }

        await tx.customer.update({
          where: { id: movement.customerId },
          data: { debtBalance: { increment: debtDelta } },
        });

        // 3. Crear movimiento RETURNED_VOID
        return tx.maquilaContainerMovement.create({
          data: {
            customerId: movement.customerId,
            containerTypeId: movement.containerTypeId,
            type: MaquilaMovementType.RETURNED_VOID,
            quantity: movement.quantity,
            saleId: movement.saleId,
            reversesMovementId: movement.id,
            reason,
            recordedById: actor.id,
            occurredAt,
          },
          include: MOVEMENT_INCLUDE,
        });
      });

      return this.toMovementResponse(voidedMovement);
    }

    throw new BadRequestException("Tipo de movimiento no soportado");
  }

  async listBalances(customerId?: string): Promise<MaquilaBalanceResponseDto[]> {
    const where: Prisma.MaquilaBalanceWhereInput = customerId ? { customerId } : {};

    const balances = await this.prisma.maquilaBalance.findMany({
      where,
      include: {
        containerType: { select: { id: true, name: true } },
      },
      orderBy: [{ customerId: "asc" }, { containerTypeId: "asc" }],
    });

    // Obtener los productos MAQUILA_SERVICE para los tipos de envase
    const containerTypeIds = [...new Set(balances.map((b) => b.containerTypeId))];
    const maquilaProducts = await this.prisma.product.findMany({
      where: {
        type: ProductType.MAQUILA_SERVICE,
        containerTypeId: { in: containerTypeIds },
        active: true,
      },
      select: { id: true, containerTypeId: true, listPrice: true },
    });

    const productMap = new Map<string, { id: string; listPrice: Prisma.Decimal }>();
    for (const p of maquilaProducts) {
      if (p.containerTypeId) {
        productMap.set(p.containerTypeId, { id: p.id, listPrice: p.listPrice });
      }
    }

    const customerIds = [...new Set(balances.map((b) => b.customerId))];
    const productIds = maquilaProducts.map((p) => p.id);

    const customerPrices = await this.prisma.customerPrice.findMany({
      where: {
        customerId: { in: customerIds },
        productId: { in: productIds },
        locationId: null,
      },
    });

    return balances.map((b) => {
      const prod = productMap.get(b.containerTypeId);
      let unitPriceStr: string | null = null;
      let productId: string | null = null;

      if (prod) {
        productId = prod.id;
        const cp = customerPrices.find(
          (p) => p.customerId === b.customerId && p.productId === prod.id,
        );
        const resolved = cp ? cp.price : prod.listPrice;
        unitPriceStr = resolved.toFixed(2);
      }

      return {
        customerId: b.customerId,
        containerTypeId: b.containerTypeId,
        containerTypeName: b.containerType.name,
        emptyAtPlant: b.emptyAtPlant,
        fullToReturn: b.fullToReturn,
        unitPrice: unitPriceStr,
        productId,
      };
    });
  }

  async listCustomersWithBalances(): Promise<MaquilaCustomerSummaryResponseDto[]> {
    const balances = await this.prisma.maquilaBalance.findMany({
      where: {
        OR: [{ emptyAtPlant: { gt: 0 } }, { fullToReturn: { gt: 0 } }],
      },
      include: {
        customer: { select: { id: true, name: true } },
        containerType: { select: { id: true, name: true } },
      },
      orderBy: [{ customer: { name: "asc" } }, { containerTypeId: "asc" }],
    });

    const containerTypeIds = [...new Set(balances.map((b) => b.containerTypeId))];
    const maquilaProducts = await this.prisma.product.findMany({
      where: {
        type: ProductType.MAQUILA_SERVICE,
        containerTypeId: { in: containerTypeIds },
        active: true,
      },
      select: { id: true, containerTypeId: true, listPrice: true },
    });

    const productMap = new Map<string, { id: string; listPrice: Prisma.Decimal }>();
    for (const p of maquilaProducts) {
      if (p.containerTypeId) {
        productMap.set(p.containerTypeId, { id: p.id, listPrice: p.listPrice });
      }
    }

    const customerIds = [...new Set(balances.map((b) => b.customerId))];
    const productIds = maquilaProducts.map((p) => p.id);

    const customerPrices = await this.prisma.customerPrice.findMany({
      where: {
        customerId: { in: customerIds },
        productId: { in: productIds },
        locationId: null,
      },
    });

    const byCustomer = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        emptyAtPlantTotal: number;
        fullToReturnTotal: number;
        balances: MaquilaBalanceResponseDto[];
      }
    >();

    for (const b of balances) {
      const prod = productMap.get(b.containerTypeId);
      let unitPriceStr: string | null = null;
      let productId: string | null = null;

      if (prod) {
        productId = prod.id;
        const cp = customerPrices.find(
          (p) => p.customerId === b.customerId && p.productId === prod.id,
        );
        const resolved = cp ? cp.price : prod.listPrice;
        unitPriceStr = resolved.toFixed(2);
      }

      const balanceItem: MaquilaBalanceResponseDto = {
        customerId: b.customerId,
        containerTypeId: b.containerTypeId,
        containerTypeName: b.containerType.name,
        emptyAtPlant: b.emptyAtPlant,
        fullToReturn: b.fullToReturn,
        unitPrice: unitPriceStr,
        productId,
      };

      const existing = byCustomer.get(b.customerId) ?? {
        customerId: b.customerId,
        customerName: b.customer.name,
        emptyAtPlantTotal: 0,
        fullToReturnTotal: 0,
        balances: [],
      };

      existing.emptyAtPlantTotal += b.emptyAtPlant;
      existing.fullToReturnTotal += b.fullToReturn;
      existing.balances.push(balanceItem);
      byCustomer.set(b.customerId, existing);
    }

    return [...byCustomer.values()];
  }

  async listMovements(
    query: ListMaquilaMovementsQueryDto,
    actor: { id: string; roles: UserRole[] },
  ): Promise<PaginatedMaquilaMovementsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.MaquilaContainerMovementWhereInput = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    // Operador de planta ve solo sus llenados
    const isOperator = actor.roles.includes(UserRole.PLANT_OPERATOR);
    const isAdmin = actor.roles.includes(UserRole.ADMIN);
    const isSupervisor = actor.roles.includes(UserRole.PLANT_SUPERVISOR);

    if (isOperator && !isAdmin && !isSupervisor) {
      where.recordedById = actor.id;
      where.type = MaquilaMovementType.FILLED;
    }

    if (query.startDate || query.endDate) {
      where.occurredAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(`${query.endDate}T23:59:59.999Z`) } : {}),
      };
    }

    const [total, movements] = await this.prisma.$transaction([
      this.prisma.maquilaContainerMovement.count({ where }),
      this.prisma.maquilaContainerMovement.findMany({
        where,
        include: MOVEMENT_INCLUDE,
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: movements.map((m) => this.toMovementResponse(m)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async reconcile(): Promise<MaquilaReconciliationResponseDto> {
    const balances = await this.prisma.maquilaBalance.findMany({
      include: {
        customer: { select: { name: true } },
        containerType: { select: { name: true } },
      },
    });

    const movements = await this.prisma.maquilaContainerMovement.findMany({
      include: {
        customer: { select: { name: true } },
        containerType: { select: { name: true } },
      },
    });

    // Sumar movimientos por cliente y tipo de envase
    const ledger = new Map<
      string,
      {
        empty: number;
        full: number;
        customerName: string;
        containerTypeName: string;
        customerId: string;
        containerTypeId: string;
      }
    >();

    for (const m of movements) {
      const key = `${m.customerId}:${m.containerTypeId}`;
      const current = ledger.get(key) ?? {
        empty: 0,
        full: 0,
        customerName: m.customer.name,
        containerTypeName: m.containerType.name,
        customerId: m.customerId,
        containerTypeId: m.containerTypeId,
      };

      switch (m.type) {
        case MaquilaMovementType.RECEIVED:
          current.empty += m.quantity;
          break;
        case MaquilaMovementType.FILLED:
          current.empty -= m.quantity;
          current.full += m.quantity;
          break;
        case MaquilaMovementType.RETURNED:
          current.full -= m.quantity;
          break;
        case MaquilaMovementType.RECEIVED_VOID:
          current.empty -= m.quantity;
          break;
        case MaquilaMovementType.FILLED_VOID:
          current.empty += m.quantity;
          current.full -= m.quantity;
          break;
        case MaquilaMovementType.RETURNED_VOID:
          current.full += m.quantity;
          break;
      }

      ledger.set(key, current);
    }

    const discrepancies: MaquilaDiscrepancyResponseDto[] = [];
    const checkedKeys = new Set<string>();

    // Validar cada saldo materializado contra el ledger
    for (const b of balances) {
      const key = `${b.customerId}:${b.containerTypeId}`;
      checkedKeys.add(key);
      const expected = ledger.get(key) ?? { empty: 0, full: 0 };

      if (b.emptyAtPlant !== expected.empty || b.fullToReturn !== expected.full) {
        discrepancies.push({
          customerId: b.customerId,
          customerName: b.customer.name,
          containerTypeId: b.containerTypeId,
          containerTypeName: b.containerType.name,
          bookEmpty: b.emptyAtPlant,
          bookFull: b.fullToReturn,
          ledgerEmpty: expected.empty,
          ledgerFull: expected.full,
        });
      }
    }

    // Validar pares en ledger con saldo distinto de cero que no tienen fila materializada
    for (const [key, l] of ledger.entries()) {
      if (!checkedKeys.has(key) && (l.empty !== 0 || l.full !== 0)) {
        discrepancies.push({
          customerId: l.customerId,
          customerName: l.customerName,
          containerTypeId: l.containerTypeId,
          containerTypeName: l.containerTypeName,
          bookEmpty: 0,
          bookFull: 0,
          ledgerEmpty: l.empty,
          ledgerFull: l.full,
        });
      }
    }

    return {
      isBalanced: discrepancies.length === 0,
      discrepancies,
    };
  }
}
