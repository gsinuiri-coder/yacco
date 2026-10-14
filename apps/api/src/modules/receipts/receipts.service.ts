import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, ReceiptType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { PreviewReceiptDto, ReceiptPreviewResponseDto } from "./dto/preview-receipt.dto.js";

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

@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

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

  private buildPreview(
    dto: PreviewReceiptDto,
    settings: ReceiptSettings,
    sales: ReceiptSale[],
  ): ReceiptPreviewResponseDto {
    if (sales.length !== dto.saleIds.length) {
      throw new NotFoundException("Una o más ventas no existen");
    }
    if (sales.some((sale) => sale.voidedAt !== null || sale.isOpeningBalance)) {
      throw new BadRequestException("Solo se pueden incluir ventas vigentes");
    }

    const customerIds = new Set(sales.map((sale) => sale.location.customer.id));
    if (customerIds.size !== 1 || !customerIds.has(dto.customerId)) {
      throw new BadRequestException("Todas las ventas deben ser del mismo cliente");
    }
    if (sales.some((sale) => sale.receiptSales.length > 0)) {
      throw new ConflictException("Una o más ventas ya tienen un comprobante vigente");
    }

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
