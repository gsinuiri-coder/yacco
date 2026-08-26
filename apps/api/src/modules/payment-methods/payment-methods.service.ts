import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { ListPaymentMethodsQueryDto } from "./dto/list-payment-methods-query.dto.js";
import type { PaymentMethodResponseDto } from "./dto/payment-method-response.dto.js";

const PAYMENT_METHOD_SELECT = {
  id: true,
  name: true,
  active: true,
  requiresConfirmation: true,
} as const;

/**
 * Read-only catalog: four or five rows, seeded and stable (CLAUDE.md — a
 * catalog is always read from its own endpoint; there is no POST/PATCH
 * here yet, see docs/backlog-tecnico.md for when one becomes necessary).
 * Same shape as ZonesService/ContainerTypesService.
 */
@Injectable()
export class PaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * No pagination: a handful of rows. `active` defaults to true: a
   * collection form must never offer a withdrawn method — including the
   * synthetic "Apertura" the roster loader upserts, which is born inactive
   * for exactly this reason.
   */
  async findAll(query: ListPaymentMethodsQueryDto): Promise<PaymentMethodResponseDto[]> {
    return this.prisma.paymentMethod.findMany({
      where: { active: query.active ?? true },
      orderBy: { name: "asc" },
      select: PAYMENT_METHOD_SELECT,
    });
  }

  async findOne(id: string): Promise<PaymentMethodResponseDto> {
    const paymentMethod = await this.prisma.paymentMethod.findUnique({
      where: { id },
      select: PAYMENT_METHOD_SELECT,
    });
    if (paymentMethod === null) {
      throw new NotFoundException(`El método de pago "${id}" no existe`);
    }
    return paymentMethod;
  }
}
