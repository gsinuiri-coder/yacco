import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AccessoryMovementType, Prisma, ProductType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { MONEY_MESSAGE, MONEY_PATTERN } from "../customers/dto/create-customer.dto.js";
import { SalesService } from "../sales/sales.service.js";
import type {
  AccessoryCountResponseDto,
  AccessoryMovementResponseDto,
  AccessoryReconciliationResponseDto,
  AccessoryStockDiscrepancyDto,
  AccessorySummaryResponseDto,
  BorrowedAccessoryResponseDto,
  CustomerAccessoryBalanceDiscrepancyDto,
  CustomerAccessoryBalanceResponseDto,
  PaginatedAccessoryMovementsDto,
} from "./dto/accessory-response.dto.js";
import type { ChargeAccessoryDto } from "./dto/charge-accessory.dto.js";
import type { CountAccessoryDto } from "./dto/count-accessory.dto.js";
import type { CreateAccessoryEntryDto } from "./dto/create-accessory-entry.dto.js";
import type { CreateAccessoryWriteOffDto } from "./dto/create-accessory-write-off.dto.js";
import type { ListAccessoryMovementsQueryDto } from "./dto/list-accessory-movements-query.dto.js";
import type { LoanAccessoryDto } from "./dto/loan-accessory.dto.js";
import type { ReturnAccessoryDto } from "./dto/return-accessory.dto.js";
import type { VoidAccessoryChargeDto } from "./dto/void-accessory-charge.dto.js";

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
  product: { select: { name: true } },
  location: { select: { name: true, customer: { select: { name: true } } } },
  recordedBy: { select: { name: true } },
} satisfies Prisma.AccessoryMovementInclude;

type MovementWithRelations = Prisma.AccessoryMovementGetPayload<{
  include: typeof MOVEMENT_INCLUDE;
}>;

@Injectable()
export class AccessoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesService: SalesService,
  ) {}

  async findAll(includeInactive = false): Promise<AccessorySummaryResponseDto[]> {
    const products = await this.prisma.product.findMany({
      where: {
        type: ProductType.ACCESSORY,
        ...(includeInactive ? {} : { active: true }),
      },
      include: {
        accessoryStock: true,
        customerAccessoryBalances: {
          select: { quantity: true },
        },
      },
      orderBy: { name: "asc" },
    });

    return products.map((product) => {
      const stock = product.accessoryStock?.quantity ?? 0;
      const totalBorrowed = product.customerAccessoryBalances.reduce(
        (sum, b) => sum + b.quantity,
        0,
      );
      return {
        id: product.id,
        name: product.name,
        listPrice: product.listPrice.toFixed(2),
        active: product.active,
        stock,
        totalBorrowed,
      };
    });
  }

  async createEntry(
    productId: string,
    dto: CreateAccessoryEntryDto,
    recordedById: string,
  ): Promise<AccessoryMovementResponseDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, type: true },
    });
    if (product === null || product.type !== ProductType.ACCESSORY) {
      throw new BadRequestException(`El accesorio "${productId}" no existe`);
    }

    const occurredAt = new Date();
    const movement = await this.prisma.$transaction(async (tx) => {
      await tx.accessoryStock.upsert({
        where: { productId },
        update: { quantity: { increment: dto.quantity } },
        create: { productId, quantity: dto.quantity },
      });

      return tx.accessoryMovement.create({
        data: {
          productId,
          type: AccessoryMovementType.ENTRY,
          quantity: dto.quantity,
          recordedById,
          occurredAt,
        },
        include: MOVEMENT_INCLUDE,
      });
    });

    return this.toMovementResponse(movement);
  }

  async createWriteOff(
    productId: string,
    dto: CreateAccessoryWriteOffDto,
    recordedById: string,
  ): Promise<AccessoryMovementResponseDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, type: true },
    });
    if (product === null || product.type !== ProductType.ACCESSORY) {
      throw new BadRequestException(`El accesorio "${productId}" no existe`);
    }
    const reason = dto.reason.trim();
    if (reason.length === 0) {
      throw new BadRequestException("El motivo de la baja no puede estar vacío");
    }

    const occurredAt = new Date();
    const movement = await this.prisma.$transaction(async (tx) => {
      await tx.accessoryStock.upsert({
        where: { productId },
        update: { quantity: { decrement: dto.quantity } },
        create: { productId, quantity: -dto.quantity },
      });

      return tx.accessoryMovement.create({
        data: {
          productId,
          type: AccessoryMovementType.WRITE_OFF,
          quantity: dto.quantity,
          reason,
          recordedById,
          occurredAt,
        },
        include: MOVEMENT_INCLUDE,
      });
    });

    return this.toMovementResponse(movement);
  }

  async count(
    productId: string,
    dto: CountAccessoryDto,
    recordedById: string,
  ): Promise<AccessoryCountResponseDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, type: true },
    });
    if (product === null || product.type !== ProductType.ACCESSORY) {
      throw new BadRequestException(`El accesorio "${productId}" no existe`);
    }

    const countRecord = await this.prisma.$transaction(async (tx) => {
      const stock = await tx.accessoryStock.findUnique({
        where: { productId },
        select: { quantity: true },
      });
      const expectedQty = stock?.quantity ?? 0;
      const delta = dto.countedQuantity - expectedQty;

      let reason: string | null = null;
      if (delta !== 0) {
        reason = dto.reason?.trim() ?? "";
        if (reason.length === 0) {
          throw new BadRequestException(
            "Se requiere un motivo cuando la cantidad contada difiere del stock esperado",
          );
        }
        await tx.accessoryStock.upsert({
          where: { productId },
          update: { quantity: dto.countedQuantity },
          create: { productId, quantity: dto.countedQuantity },
        });

        await tx.accessoryMovement.create({
          data: {
            productId,
            type: AccessoryMovementType.COUNT_ADJUSTMENT,
            quantity: delta,
            reason,
            recordedById,
            occurredAt: new Date(),
          },
        });
      }

      return tx.accessoryCount.create({
        data: {
          productId,
          expectedQty,
          countedQty: dto.countedQuantity,
          reason,
          recordedById,
        },
      });
    });

    return {
      id: countRecord.id,
      productId: countRecord.productId,
      expectedQty: countRecord.expectedQty,
      countedQty: countRecord.countedQty,
      reason: countRecord.reason,
      recordedById: countRecord.recordedById,
      createdAt: countRecord.createdAt,
    };
  }

  async listMovements(
    productId: string,
    query: ListAccessoryMovementsQueryDto,
  ): Promise<PaginatedAccessoryMovementsDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, type: true },
    });
    if (product === null || product.type !== ProductType.ACCESSORY) {
      throw new BadRequestException(`El accesorio "${productId}" no existe`);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.AccessoryMovementWhereInput = {
      productId,
      ...(query.type !== undefined ? { type: query.type } : {}),
      ...(query.locationId !== undefined ? { locationId: query.locationId } : {}),
    };

    if (query.startDate !== undefined || query.endDate !== undefined) {
      where.occurredAt = {
        ...(query.startDate !== undefined ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate !== undefined ? { lte: new Date(`${query.endDate}T23:59:59.999Z`) } : {}),
      };
    }

    const [total, movements] = await this.prisma.$transaction([
      this.prisma.accessoryMovement.count({ where }),
      this.prisma.accessoryMovement.findMany({
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

  async listCustomerBalances(locationId: string): Promise<CustomerAccessoryBalanceResponseDto[]> {
    const location = await this.prisma.customerLocation.findUnique({
      where: { id: locationId },
      select: { id: true, customerId: true },
    });
    if (location === null) {
      throw new NotFoundException(`La ubicación "${locationId}" no existe`);
    }

    const balances = await this.prisma.customerAccessoryBalance.findMany({
      where: { locationId, quantity: { gt: 0 } },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            listPrice: true,
          },
        },
      },
    });

    const productIds = balances.map((b) => b.productId);
    const customerPrices = await this.prisma.customerPrice.findMany({
      where: {
        customerId: location.customerId,
        productId: { in: productIds },
        OR: [{ locationId: null }, { locationId }],
      },
    });

    return balances.map((b) => {
      const locationPrice = customerPrices.find(
        (p) => p.productId === b.productId && p.locationId === locationId,
      );
      const customerPrice = customerPrices.find(
        (p) => p.productId === b.productId && p.locationId === null,
      );
      const agreed = locationPrice ?? customerPrice;

      return {
        locationId,
        productId: b.productId,
        productName: b.product.name,
        quantity: b.quantity,
        listPrice: b.product.listPrice.toFixed(2),
        agreedPrice: agreed !== undefined ? agreed.price.toFixed(2) : null,
      };
    });
  }

  async loan(
    locationId: string,
    dto: LoanAccessoryDto,
    recordedById: string,
  ): Promise<AccessoryMovementResponseDto> {
    const location = await this.prisma.customerLocation.findUnique({
      where: { id: locationId },
      select: { id: true, customerId: true },
    });
    if (location === null) {
      throw new NotFoundException(`La ubicación "${locationId}" no existe`);
    }

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, name: true, type: true },
    });
    if (product === null || product.type !== ProductType.ACCESSORY) {
      throw new BadRequestException(`El accesorio "${dto.productId}" no existe`);
    }

    const occurredAt = new Date();
    const movement = await this.prisma.$transaction(async (tx) => {
      // Stock en planta: descuenta (alerta si negativo, pero no bloquea)
      await tx.accessoryStock.upsert({
        where: { productId: dto.productId },
        update: { quantity: { decrement: dto.quantity } },
        create: { productId: dto.productId, quantity: -dto.quantity },
      });

      await tx.customerAccessoryBalance.upsert({
        where: {
          locationId_productId: {
            locationId,
            productId: dto.productId,
          },
        },
        update: { quantity: { increment: dto.quantity } },
        create: { locationId, productId: dto.productId, quantity: dto.quantity },
      });

      return tx.accessoryMovement.create({
        data: {
          productId: dto.productId,
          type: AccessoryMovementType.LOAN,
          quantity: dto.quantity,
          locationId,
          recordedById,
          occurredAt,
        },
        include: MOVEMENT_INCLUDE,
      });
    });

    return this.toMovementResponse(movement);
  }

  async returnLoan(
    locationId: string,
    dto: ReturnAccessoryDto,
    recordedById: string,
  ): Promise<AccessoryMovementResponseDto> {
    const location = await this.prisma.customerLocation.findUnique({
      where: { id: locationId },
      select: { id: true },
    });
    if (location === null) {
      throw new NotFoundException(`La ubicación "${locationId}" no existe`);
    }

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, name: true, type: true },
    });
    if (product === null || product.type !== ProductType.ACCESSORY) {
      throw new BadRequestException(`El accesorio "${dto.productId}" no existe`);
    }

    const balance = await this.prisma.customerAccessoryBalance.findUnique({
      where: {
        locationId_productId: {
          locationId,
          productId: dto.productId,
        },
      },
      select: { quantity: true },
    });

    const currentQty = balance?.quantity ?? 0;
    if (currentQty < dto.quantity) {
      throw new BadRequestException(
        `No se puede devolver más accesorios de los que la ubicación tiene prestados (prestados: ${currentQty}, a devolver: ${dto.quantity})`,
      );
    }

    const occurredAt = new Date();
    const movement = await this.prisma.$transaction(async (tx) => {
      await tx.customerAccessoryBalance.update({
        where: {
          locationId_productId: {
            locationId,
            productId: dto.productId,
          },
        },
        data: { quantity: { decrement: dto.quantity } },
      });

      await tx.accessoryStock.upsert({
        where: { productId: dto.productId },
        update: { quantity: { increment: dto.quantity } },
        create: { productId: dto.productId, quantity: dto.quantity },
      });

      return tx.accessoryMovement.create({
        data: {
          productId: dto.productId,
          type: AccessoryMovementType.LOAN_RETURN,
          quantity: dto.quantity,
          locationId,
          recordedById,
          occurredAt,
        },
        include: MOVEMENT_INCLUDE,
      });
    });

    return this.toMovementResponse(movement);
  }

  async chargeLoan(
    locationId: string,
    dto: ChargeAccessoryDto,
    recordedById: string,
  ): Promise<AccessoryMovementResponseDto> {
    const reason = dto.reason.trim();
    if (reason.length === 0) {
      throw new BadRequestException("El motivo del cobro no puede estar vacío");
    }

    const location = await this.prisma.customerLocation.findUnique({
      where: { id: locationId },
      select: {
        id: true,
        customerId: true,
        customer: { select: { id: true, debtBalance: true, creditLimit: true } },
      },
    });
    if (location === null) {
      throw new NotFoundException(`La ubicación "${locationId}" no existe`);
    }

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, name: true, type: true, listPrice: true },
    });
    if (product === null || product.type !== ProductType.ACCESSORY) {
      throw new BadRequestException(`El accesorio "${dto.productId}" no existe`);
    }

    const balance = await this.prisma.customerAccessoryBalance.findUnique({
      where: {
        locationId_productId: {
          locationId,
          productId: dto.productId,
        },
      },
      select: { quantity: true },
    });

    const currentQty = balance?.quantity ?? 0;
    if (currentQty < dto.quantity) {
      throw new BadRequestException(
        `No se puede cobrar más accesorios de los que la ubicación tiene prestados (prestados: ${currentQty}, a cobrar: ${dto.quantity})`,
      );
    }

    // Resolve price: override > location price > customer price > list price
    let unitPrice = product.listPrice;
    if (dto.unitPrice !== undefined) {
      unitPrice = assertPositiveAmount(dto.unitPrice);
    } else {
      const customerPrices = await this.prisma.customerPrice.findMany({
        where: {
          customerId: location.customerId,
          productId: dto.productId,
          OR: [{ locationId: null }, { locationId }],
        },
      });
      const locationPrice = customerPrices.find((p) => p.locationId === locationId);
      const generalCustomerPrice = customerPrices.find((p) => p.locationId === null);
      if (locationPrice !== undefined) {
        unitPrice = locationPrice.price;
      } else if (generalCustomerPrice !== undefined) {
        unitPrice = generalCustomerPrice.price;
      }
    }

    const total = unitPrice.times(dto.quantity);
    const occurredAt = new Date();

    const movement = await this.prisma.$transaction(async (tx) => {
      // 1. Decrement location borrowed balance
      await tx.customerAccessoryBalance.update({
        where: {
          locationId_productId: {
            locationId,
            productId: dto.productId,
          },
        },
        data: { quantity: { decrement: dto.quantity } },
      });

      // 2. Customer debt increases by total
      const creditLimitExceeded =
        location.customer.creditLimit !== null &&
        location.customer.debtBalance.plus(total).gt(location.customer.creditLimit);

      await tx.customer.update({
        where: { id: location.customerId },
        data: { debtBalance: { increment: total } },
      });

      // 3. Create Sale + SaleItem
      const sale = await tx.sale.create({
        data: {
          locationId,
          soldAt: occurredAt,
          total,
          creditLimitExceeded,
          recordedById,
          items: {
            create: [
              {
                productId: dto.productId,
                quantity: dto.quantity,
                unitPrice,
              },
            ],
          },
        },
      });

      // 4. Create LOAN_CHARGE movement (does NOT touch plant accessory stock!)
      return tx.accessoryMovement.create({
        data: {
          productId: dto.productId,
          type: AccessoryMovementType.LOAN_CHARGE,
          quantity: dto.quantity,
          locationId,
          saleId: sale.id,
          reason,
          recordedById,
          occurredAt,
        },
        include: MOVEMENT_INCLUDE,
      });
    });

    return this.toMovementResponse(movement);
  }

  async voidCharge(
    movementId: string,
    dto: VoidAccessoryChargeDto,
    voidedById: string,
  ): Promise<AccessoryMovementResponseDto> {
    const reason = dto.reason.trim();
    if (reason.length === 0) {
      throw new BadRequestException("El motivo de la anulación no puede estar vacío");
    }

    const movement = await this.prisma.accessoryMovement.findUnique({
      where: { id: movementId },
      include: {
        sale: { select: { id: true, voidedAt: true } },
        reversedBy: { select: { id: true } },
      },
    });

    if (movement === null) {
      throw new NotFoundException(`El movimiento "${movementId}" no existe`);
    }
    if (movement.type !== AccessoryMovementType.LOAN_CHARGE) {
      throw new BadRequestException("Solo se pueden anular movimientos de cobro (LOAN_CHARGE)");
    }
    if (movement.reversedBy !== null) {
      throw new BadRequestException("El cobro ya ha sido anulado previamente");
    }
    if (movement.sale === null) {
      throw new BadRequestException("El movimiento no tiene una venta asociada");
    }
    if (movement.sale.voidedAt !== null) {
      throw new BadRequestException("La venta asociada ya está anulada");
    }
    if (movement.locationId === null) {
      throw new BadRequestException("El movimiento no tiene una ubicación asociada");
    }

    const occurredAt = movement.occurredAt;
    const voidedMovement = await this.prisma.$transaction(async (tx) => {
      // 1-2. Void the sale through SalesService: it locks the sale, rejects
      // one with an active receipt, voids its payments and returns the debt.
      const voided = await this.salesService.voidSaleWithinTransaction(tx, {
        saleId: movement.sale!.id,
        voidedById,
        voidReason: reason,
      });
      if (voided.sale === null) {
        throw new BadRequestException("La venta asociada ya está anulada");
      }

      // 3. Restore location borrowed balance
      await tx.customerAccessoryBalance.upsert({
        where: {
          locationId_productId: {
            locationId: movement.locationId!,
            productId: movement.productId,
          },
        },
        update: { quantity: { increment: movement.quantity } },
        create: {
          locationId: movement.locationId!,
          productId: movement.productId,
          quantity: movement.quantity,
        },
      });

      // 4. Create LOAN_CHARGE_VOID movement
      return tx.accessoryMovement.create({
        data: {
          productId: movement.productId,
          type: AccessoryMovementType.LOAN_CHARGE_VOID,
          quantity: movement.quantity,
          locationId: movement.locationId,
          saleId: movement.saleId,
          reason,
          reversesMovementId: movement.id,
          recordedById: voidedById,
          occurredAt,
        },
        include: MOVEMENT_INCLUDE,
      });
    });

    return this.toMovementResponse(voidedMovement);
  }

  async getBorrowedReport(): Promise<BorrowedAccessoryResponseDto[]> {
    const balances = await this.prisma.customerAccessoryBalance.findMany({
      where: { quantity: { gt: 0 } },
      include: {
        location: {
          include: {
            customer: { select: { id: true, name: true } },
          },
        },
        product: { select: { id: true, name: true } },
      },
      orderBy: [{ location: { customer: { name: "asc" } } }, { product: { name: "asc" } }],
    });

    const results: BorrowedAccessoryResponseDto[] = [];
    for (const b of balances) {
      const lastMovement = await this.prisma.accessoryMovement.findFirst({
        where: {
          locationId: b.locationId,
          productId: b.productId,
        },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true },
      });

      results.push({
        customerId: b.location.customer.id,
        customerName: b.location.customer.name,
        locationId: b.locationId,
        locationName: b.location.name,
        productId: b.productId,
        productName: b.product.name,
        quantity: b.quantity,
        lastMovementAt: lastMovement?.occurredAt ?? new Date(),
      });
    }

    return results;
  }

  async reconciliation(): Promise<AccessoryReconciliationResponseDto> {
    const products = await this.prisma.product.findMany({
      where: { type: ProductType.ACCESSORY },
      include: { accessoryStock: true },
    });

    const stockDiscrepancies: AccessoryStockDiscrepancyDto[] = [];
    for (const product of products) {
      const materializedStock = product.accessoryStock?.quantity ?? 0;
      const movements = await this.prisma.accessoryMovement.findMany({
        where: { productId: product.id },
        select: { type: true, quantity: true },
      });

      let ledgerStock = 0;
      for (const m of movements) {
        switch (m.type) {
          case AccessoryMovementType.ENTRY:
          case AccessoryMovementType.SALE_VOID:
          case AccessoryMovementType.LOAN_RETURN:
            ledgerStock += m.quantity;
            break;
          case AccessoryMovementType.SALE:
          case AccessoryMovementType.LOAN:
          case AccessoryMovementType.LOAN_RETURN_VOID:
          case AccessoryMovementType.WRITE_OFF:
            ledgerStock -= m.quantity;
            break;
          case AccessoryMovementType.COUNT_ADJUSTMENT:
            ledgerStock += m.quantity;
            break;
          case AccessoryMovementType.LOAN_VOID:
            ledgerStock += m.quantity;
            break;
          case AccessoryMovementType.LOAN_CHARGE:
          case AccessoryMovementType.LOAN_CHARGE_VOID:
            // Charges happen between location and customer debt, plant stock is untouched
            break;
        }
      }

      const diff = materializedStock - ledgerStock;
      if (diff !== 0) {
        stockDiscrepancies.push({
          productId: product.id,
          productName: product.name,
          materializedStock,
          ledgerStock,
          difference: diff,
        });
      }
    }

    // Customer location balances check
    const balances = await this.prisma.customerAccessoryBalance.findMany({
      include: {
        location: { select: { name: true } },
        product: { select: { name: true } },
      },
    });

    const customerBalanceDiscrepancies: CustomerAccessoryBalanceDiscrepancyDto[] = [];
    for (const b of balances) {
      const movements = await this.prisma.accessoryMovement.findMany({
        where: {
          locationId: b.locationId,
          productId: b.productId,
        },
        select: { type: true, quantity: true },
      });

      let ledgerBalance = 0;
      for (const m of movements) {
        switch (m.type) {
          case AccessoryMovementType.LOAN:
          case AccessoryMovementType.LOAN_RETURN_VOID:
          case AccessoryMovementType.LOAN_CHARGE_VOID:
            ledgerBalance += m.quantity;
            break;
          case AccessoryMovementType.LOAN_VOID:
          case AccessoryMovementType.LOAN_RETURN:
          case AccessoryMovementType.LOAN_CHARGE:
            ledgerBalance -= m.quantity;
            break;
          case AccessoryMovementType.ENTRY:
          case AccessoryMovementType.SALE:
          case AccessoryMovementType.SALE_VOID:
          case AccessoryMovementType.WRITE_OFF:
          case AccessoryMovementType.COUNT_ADJUSTMENT:
            break;
        }
      }

      const diff = b.quantity - ledgerBalance;
      if (diff !== 0) {
        customerBalanceDiscrepancies.push({
          locationId: b.locationId,
          locationName: b.location.name,
          productId: b.productId,
          productName: b.product.name,
          materializedBalance: b.quantity,
          ledgerBalance,
          difference: diff,
        });
      }
    }

    return {
      stockDiscrepancies,
      customerBalanceDiscrepancies,
      isBalanced: stockDiscrepancies.length === 0 && customerBalanceDiscrepancies.length === 0,
    };
  }

  private toMovementResponse(m: MovementWithRelations): AccessoryMovementResponseDto {
    return {
      id: m.id,
      productId: m.productId,
      productName: m.product.name,
      type: m.type,
      quantity: m.quantity,
      locationId: m.locationId,
      locationName: m.location?.name ?? null,
      customerName: m.location?.customer?.name ?? null,
      saleId: m.saleId,
      reason: m.reason,
      reversesMovementId: m.reversesMovementId,
      recordedById: m.recordedById,
      recordedByName: m.recordedBy.name,
      occurredAt: m.occurredAt,
      createdAt: m.createdAt,
    };
  }
}
