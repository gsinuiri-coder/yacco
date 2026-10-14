import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, ReceiptType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { formatBusinessDate, parseBusinessDate } from "../orders/orders.service.js";
import type { CreateReceiptDto } from "./dto/create-receipt.dto.js";
import {
  type ListReceiptSalesQueryDto,
  type ListReceiptsQueryDto,
  ReceiptStatus,
  SaleReceiptStatus,
} from "./dto/list-receipts-query.dto.js";
import type { PreviewReceiptDto, ReceiptPreviewResponseDto } from "./dto/preview-receipt.dto.js";
import type {
  CreateCreditNoteDto,
  MarkReceiptExemptionsDto,
  ReceiptReasonDto,
} from "./dto/receipt-action.dto.js";
import type {
  PaginatedReceiptSalesDto,
  PaginatedReceiptsDto,
  ReleaseExemptionResultDto,
  ReceiptDetailDto,
  ReceiptExemptionResultDto,
  ReceiptResponseDto,
  VoidReceiptResultDto,
} from "./dto/receipt-response.dto.js";

const RECEIPT_SALE_SELECT = {
  id: true,
  total: true,
  voidedAt: true,
  isOpeningBalance: true,
  location: {
    select: {
      customer: {
        select: { id: true, documentType: true, documentNumber: true },
      },
    },
  },
  receiptSales: {
    where: { releasedAt: null },
    select: { receiptId: true },
  },
  receiptExemptions: {
    where: { releasedAt: null },
    select: { id: true },
  },
} satisfies Prisma.SaleSelect;

type ReceiptSale = Prisma.SaleGetPayload<{ select: typeof RECEIPT_SALE_SELECT }>;

interface ReceiptSettings {
  id: string;
  taxRate: Prisma.Decimal;
  receiptDocumentThreshold: Prisma.Decimal;
}

type ReceiptClient = Prisma.TransactionClient | PrismaService;

const RECEIPT_LIST_INCLUDE = {
  customer: { select: { id: true, name: true } },
  createdBy: { select: { id: true, username: true } },
} satisfies Prisma.ReceiptInclude;

const RECEIPT_DETAIL_INCLUDE = {
  ...RECEIPT_LIST_INCLUDE,
  issuerSettingsVersion: {
    select: {
      id: true,
      taxId: true,
      legalName: true,
      fiscalAddress: true,
      taxRate: true,
      receiptDocumentThreshold: true,
    },
  },
  voidedBy: { select: { id: true, username: true } },
  sales: {
    select: {
      saleId: true,
      releasedAt: true,
      sale: {
        select: {
          soldAt: true,
          total: true,
          location: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { sale: { soldAt: "asc" } },
  },
  files: { select: { objectKey: true, contentType: true } },
} satisfies Prisma.ReceiptInclude;

const RECEIPT_STATUS_SALE_SELECT = {
  id: true,
  soldAt: true,
  total: true,
  location: { select: { id: true, name: true } },
  receiptSales: {
    where: { releasedAt: null },
    select: {
      receipt: { select: { id: true, type: true, series: true, number: true } },
    },
  },
  receiptExemptions: {
    where: { releasedAt: null },
    select: { id: true, reason: true },
  },
} satisfies Prisma.SaleSelect;

function isPrismaKnownError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function toReceiptResponse(receipt: {
  id: string;
  type: ReceiptResponseDto["type"];
  medium: ReceiptResponseDto["medium"];
  series: string;
  number: string;
  issuedOn: Date;
  customerId: string;
  issuerSettingsVersionId: string;
  taxableAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  affectedReceiptId: string | null;
  reason: string | null;
  createdById: string;
  createdAt: Date;
  voidedAt: Date | null;
  voidedById: string | null;
  voidReason: string | null;
}): ReceiptResponseDto {
  return {
    ...receipt,
    issuedOn: formatBusinessDate(receipt.issuedOn),
    taxableAmount: receipt.taxableAmount.toFixed(2),
    taxAmount: receipt.taxAmount.toFixed(2),
    total: receipt.total.toFixed(2),
  };
}

@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListReceiptsQueryDto): Promise<PaginatedReceiptsDto> {
    const { page, limit } = query;
    const where = this.buildReceiptFilter(query);
    const [total, receipts] = await this.prisma.$transaction([
      this.prisma.receipt.count({ where }),
      this.prisma.receipt.findMany({
        where,
        include: RECEIPT_LIST_INCLUDE,
        orderBy: [{ issuedOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: receipts.map(({ customer, createdBy, ...receipt }) => ({
        ...toReceiptResponse(receipt),
        status: receipt.voidedAt === null ? ReceiptStatus.ACTIVE : ReceiptStatus.VOIDED,
        customer,
        createdBy,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<ReceiptDetailDto> {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id },
      include: RECEIPT_DETAIL_INCLUDE,
    });
    if (receipt === null) throw new NotFoundException("El comprobante no existe");

    const { customer, createdBy, issuerSettingsVersion, voidedBy, sales, files, ...receiptFields } =
      receipt;
    return {
      ...toReceiptResponse(receiptFields),
      status: receipt.voidedAt === null ? ReceiptStatus.ACTIVE : ReceiptStatus.VOIDED,
      customer,
      createdBy,
      voidedBy,
      issuerSettingsVersion: {
        ...issuerSettingsVersion,
        taxRate: issuerSettingsVersion.taxRate.toFixed(2),
        receiptDocumentThreshold: issuerSettingsVersion.receiptDocumentThreshold.toFixed(2),
      },
      sales: sales.map(({ saleId, releasedAt, sale }) => ({
        id: saleId,
        soldAt: sale.soldAt,
        total: sale.total.toFixed(2),
        location: sale.location,
        releasedAt,
      })),
      files,
    };
  }

  async listSales(query: ListReceiptSalesQueryDto): Promise<PaginatedReceiptSalesDto> {
    const { page, limit } = query;
    const where = this.buildSaleFilter(query);
    const [total, sales] = await this.prisma.$transaction([
      this.prisma.sale.count({ where }),
      this.prisma.sale.findMany({
        where,
        select: RECEIPT_STATUS_SALE_SELECT,
        orderBy: [{ soldAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: sales.map((sale) => {
        const receipt = sale.receiptSales[0]?.receipt ?? null;
        const exemption = sale.receiptExemptions[0] ?? null;
        const status =
          receipt !== null
            ? SaleReceiptStatus.RECEIPTED
            : exemption !== null
              ? SaleReceiptStatus.EXEMPT
              : SaleReceiptStatus.AVAILABLE;
        return {
          id: sale.id,
          soldAt: sale.soldAt,
          total: sale.total.toFixed(2),
          location: sale.location,
          status,
          receipt,
          exemption,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async preview(dto: PreviewReceiptDto): Promise<ReceiptPreviewResponseDto> {
    if (dto.type === ReceiptType.CREDIT_NOTE) {
      throw new BadRequestException("La nota de crédito se registra desde un comprobante vigente");
    }

    const settings = await this.prisma.issuerSettingsVersion.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, taxRate: true, receiptDocumentThreshold: true },
    });
    if (settings === null) {
      throw new ConflictException("Configurá primero los datos de facturación");
    }

    const sales = await this.prisma.sale.findMany({
      where: { id: { in: dto.saleIds } },
      select: RECEIPT_SALE_SELECT,
    });
    return this.buildPreview(dto, settings, sales);
  }

  async create(dto: CreateReceiptDto, createdById: string): Promise<ReceiptResponseDto> {
    if (dto.type === ReceiptType.CREDIT_NOTE) {
      throw new BadRequestException("La nota de crédito se registra desde un comprobante vigente");
    }
    const series = dto.series.trim();
    const number = dto.number.trim();

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockSales(tx, dto.saleIds);
        const settings = await this.findSettings(tx);
        const sales = await this.findSales(tx, dto.saleIds);
        const preview = this.buildPreview(dto, settings, sales);
        const releasedAt = new Date();

        await tx.saleReceiptExemption.updateMany({
          where: { saleId: { in: dto.saleIds }, releasedAt: null },
          data: {
            releasedAt,
            releasedById: createdById,
            releaseReason: `Se registró el comprobante ${series}-${number}`,
          },
        });

        const receipt = await tx.receipt.create({
          data: {
            type: dto.type,
            medium: dto.medium,
            series,
            number,
            issuedOn: parseBusinessDate(dto.issuedOn, "La fecha de emisión"),
            customerId: dto.customerId,
            issuerSettingsVersionId: preview.issuerSettingsVersionId,
            taxableAmount: new Prisma.Decimal(preview.taxableAmount),
            taxAmount: new Prisma.Decimal(preview.taxAmount),
            total: new Prisma.Decimal(preview.total),
            createdById,
            sales: { create: dto.saleIds.map((saleId) => ({ saleId })) },
          },
        });
        return toReceiptResponse(receipt);
      });
    } catch (error) {
      if (isPrismaKnownError(error, "P2002")) {
        throw new ConflictException("Ya existe un comprobante con ese tipo, serie y número");
      }
      throw error;
    }
  }

  async markExemptions(
    dto: MarkReceiptExemptionsDto,
    createdById: string,
  ): Promise<ReceiptExemptionResultDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockSales(tx, dto.saleIds);
      const sales = await this.findSales(tx, dto.saleIds);
      this.assertSelectableSales(dto.customerId, dto.saleIds, sales);
      if (sales.some((sale) => sale.receiptExemptions.length > 0)) {
        throw new ConflictException("Una o más ventas ya están marcadas sin comprobante");
      }

      const result = await tx.saleReceiptExemption.createMany({
        data: dto.saleIds.map((saleId) => ({
          saleId,
          reason: dto.reason.trim(),
          createdById,
        })),
      });
      return { created: result.count };
    });
  }

  async void(id: string, dto: ReceiptReasonDto, voidedById: string): Promise<VoidReceiptResultDto> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM receipts WHERE id = ${id}::uuid FOR UPDATE`);
      const receipt = await tx.receipt.findUnique({
        where: { id },
        select: {
          id: true,
          voidedAt: true,
          sales: { where: { releasedAt: null }, select: { saleId: true, releasedAt: true } },
        },
      });
      if (receipt === null) throw new NotFoundException("El comprobante no existe");
      if (receipt.voidedAt !== null) throw new ConflictException("El comprobante ya fue anulado");

      const releasedAt = new Date();
      const { count } = await tx.receipt.updateMany({
        where: { id, voidedAt: null },
        data: { voidedAt: releasedAt, voidedById, voidReason: dto.reason.trim() },
      });
      if (count !== 1) throw new ConflictException("El comprobante ya fue anulado");

      const released = await tx.receiptSale.updateMany({
        where: { receiptId: id, releasedAt: null },
        data: { releasedAt, releasedById: voidedById },
      });
      return { id, releasedSales: released.count };
    });
  }

  async releaseExemption(
    id: string,
    dto: ReceiptReasonDto,
    releasedById: string,
  ): Promise<ReleaseExemptionResultDto> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM sale_receipt_exemptions WHERE id = ${id}::uuid FOR UPDATE`,
      );
      const exemption = await tx.saleReceiptExemption.findUnique({
        where: { id },
        select: { id: true, saleId: true, releasedAt: true },
      });
      if (exemption === null) throw new NotFoundException("La marca no existe");
      if (exemption.releasedAt !== null) throw new ConflictException("La marca ya fue liberada");
      const { count } = await tx.saleReceiptExemption.updateMany({
        where: { id, releasedAt: null },
        data: { releasedAt: new Date(), releasedById, releaseReason: dto.reason.trim() },
      });
      if (count !== 1) throw new ConflictException("La marca ya fue liberada");
      return { id, saleId: exemption.saleId };
    });
  }

  async createCreditNote(
    affectedReceiptId: string,
    dto: CreateCreditNoteDto,
    createdById: string,
  ): Promise<ReceiptResponseDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM receipts WHERE id = ${affectedReceiptId}::uuid FOR UPDATE`,
        );
        const original = await tx.receipt.findUnique({
          where: { id: affectedReceiptId },
          select: {
            id: true,
            type: true,
            customerId: true,
            issuerSettingsVersionId: true,
            taxableAmount: true,
            taxAmount: true,
            total: true,
            voidedAt: true,
            sales: { where: { releasedAt: null }, select: { saleId: true, releasedAt: true } },
          },
        });
        if (original === null) throw new NotFoundException("El comprobante no existe");
        if (original.type === ReceiptType.CREDIT_NOTE) {
          throw new BadRequestException(
            "Una nota de crédito no puede afectar a otra nota de crédito",
          );
        }
        if (original.voidedAt !== null) {
          throw new ConflictException("El comprobante original ya fue anulado");
        }
        const releasedAt = new Date();
        const { count } = await tx.receipt.updateMany({
          where: { id: affectedReceiptId, voidedAt: null },
          data: {
            voidedAt: releasedAt,
            voidedById: createdById,
            voidReason: dto.reason.trim(),
          },
        });
        if (count !== 1) throw new ConflictException("El comprobante original ya fue anulado");
        await tx.receiptSale.updateMany({
          where: { receiptId: affectedReceiptId, releasedAt: null },
          data: { releasedAt, releasedById: createdById },
        });
        const creditNote = await tx.receipt.create({
          data: {
            type: ReceiptType.CREDIT_NOTE,
            medium: dto.medium,
            series: dto.series.trim(),
            number: dto.number.trim(),
            issuedOn: parseBusinessDate(dto.issuedOn, "La fecha de emisión"),
            customerId: original.customerId,
            issuerSettingsVersionId: original.issuerSettingsVersionId,
            taxableAmount: original.taxableAmount,
            taxAmount: original.taxAmount,
            total: original.total,
            affectedReceiptId,
            reason: dto.reason.trim(),
            createdById,
          },
        });
        return toReceiptResponse(creditNote);
      });
    } catch (error) {
      if (isPrismaKnownError(error, "P2002")) {
        throw new ConflictException("Ya existe una nota de crédito con esa serie y número");
      }
      throw error;
    }
  }

  private buildReceiptFilter(query: ListReceiptsQueryDto): Prisma.ReceiptWhereInput {
    const where: Prisma.ReceiptWhereInput = {};
    if (query.type !== undefined) where.type = query.type;
    if (query.medium !== undefined) where.medium = query.medium;
    if (query.status === ReceiptStatus.ACTIVE) where.voidedAt = null;
    if (query.status === ReceiptStatus.VOIDED) where.voidedAt = { not: null };

    const issuedFrom =
      query.issuedFrom === undefined
        ? undefined
        : parseBusinessDate(query.issuedFrom, "La fecha desde");
    const issuedTo =
      query.issuedTo === undefined
        ? undefined
        : parseBusinessDate(query.issuedTo, "La fecha hasta");
    if (issuedFrom !== undefined && issuedTo !== undefined && issuedFrom > issuedTo) {
      throw new BadRequestException("La fecha desde no puede ser posterior a la fecha hasta");
    }
    if (issuedFrom !== undefined || issuedTo !== undefined) {
      const issuedOn: Prisma.DateTimeFilter<"Receipt"> = {};
      if (issuedFrom !== undefined) issuedOn.gte = issuedFrom;
      if (issuedTo !== undefined) issuedOn.lte = issuedTo;
      where.issuedOn = issuedOn;
    }
    return where;
  }

  private buildSaleFilter(query: ListReceiptSalesQueryDto): Prisma.SaleWhereInput {
    const where: Prisma.SaleWhereInput = {
      location: { customerId: query.customerId },
      voidedAt: null,
      isOpeningBalance: false,
    };
    if (query.status === SaleReceiptStatus.RECEIPTED) {
      where.receiptSales = { some: { releasedAt: null } };
    } else if (query.status === SaleReceiptStatus.EXEMPT) {
      where.receiptExemptions = { some: { releasedAt: null } };
    } else if (query.status === SaleReceiptStatus.AVAILABLE) {
      where.AND = [
        { receiptSales: { none: { releasedAt: null } } },
        { receiptExemptions: { none: { releasedAt: null } } },
      ];
    }
    return where;
  }

  private async findSettings(client: ReceiptClient): Promise<ReceiptSettings> {
    const settings = await client.issuerSettingsVersion.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, taxRate: true, receiptDocumentThreshold: true },
    });
    if (settings === null) {
      throw new ConflictException("Configurá primero los datos de facturación");
    }
    return settings;
  }

  private findSales(client: ReceiptClient, saleIds: string[]): Promise<ReceiptSale[]> {
    return client.sale.findMany({
      where: { id: { in: saleIds } },
      select: RECEIPT_SALE_SELECT,
    });
  }

  private async lockSales(client: ReceiptClient, saleIds: string[]): Promise<void> {
    for (const saleId of [...saleIds].sort()) {
      await client.$queryRaw(
        Prisma.sql`SELECT id FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`,
      );
    }
  }

  private assertSelectableSales(customerId: string, saleIds: string[], sales: ReceiptSale[]): void {
    if (sales.length !== saleIds.length) {
      throw new NotFoundException("Una o más ventas no existen");
    }
    if (sales.some((sale) => sale.voidedAt !== null || sale.isOpeningBalance)) {
      throw new BadRequestException("Solo se pueden incluir ventas vigentes");
    }
    const customerIds = new Set(sales.map((sale) => sale.location.customer.id));
    if (customerIds.size !== 1 || !customerIds.has(customerId)) {
      throw new BadRequestException("Todas las ventas deben ser del mismo cliente");
    }
    if (sales.some((sale) => sale.receiptSales.length > 0)) {
      throw new ConflictException("Una o más ventas ya tienen un comprobante vigente");
    }
  }

  private buildPreview(
    dto: PreviewReceiptDto,
    settings: ReceiptSettings,
    sales: ReceiptSale[],
  ): ReceiptPreviewResponseDto {
    this.assertSelectableSales(dto.customerId, dto.saleIds, sales);

    const customer = sales[0]!.location.customer;
    const total = sales.reduce((sum, sale) => sum.plus(sale.total), new Prisma.Decimal(0));
    if (dto.type === ReceiptType.INVOICE && customer.documentType !== "RUC") {
      throw new BadRequestException("La factura requiere que el cliente tenga RUC");
    }
    if (
      dto.type === ReceiptType.SALES_RECEIPT &&
      total.gte(settings.receiptDocumentThreshold) &&
      customer.documentNumber === null
    ) {
      throw new BadRequestException("La boleta por este monto requiere documento del cliente");
    }

    const divisor = settings.taxRate.div(100).plus(1);
    const taxableAmount = sales.reduce(
      (sum, sale) =>
        sum.plus(sale.total.div(divisor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)),
      new Prisma.Decimal(0),
    );
    const taxAmount = total.minus(taxableAmount);

    return {
      customerId: dto.customerId,
      saleIds: dto.saleIds,
      issuerSettingsVersionId: settings.id,
      taxRate: settings.taxRate.toFixed(2),
      taxableAmount: taxableAmount.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: total.toFixed(2),
    };
  }
}
