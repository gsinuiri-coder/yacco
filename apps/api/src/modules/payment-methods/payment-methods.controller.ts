import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { JwtAccessGuard } from "../auth/guards/jwt-access.guard.js";
import { ListPaymentMethodsQueryDto } from "./dto/list-payment-methods-query.dto.js";
import { PaymentMethodResponseDto } from "./dto/payment-method-response.dto.js";
import { PaymentMethodsService } from "./payment-methods.service.js";

/**
 * Read-only catalog, open to DRIVER too (unlike zones/container-types):
 * the collection screen a driver uses at the door needs this list the same
 * way the office does — CLAUDE.md's catalog rule applies regardless of who
 * is asking. There is no write route in this PR; see
 * docs/backlog-tecnico.md.
 */
@ApiTags("payment-methods")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the required role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER)
@Controller("payment-methods")
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @ApiOperation({ summary: "Lista el catálogo de métodos de pago (sin paginar)" })
  @ApiResponse({ status: 200, type: PaymentMethodResponseDto, isArray: true })
  @Get()
  findAll(@Query() query: ListPaymentMethodsQueryDto): Promise<PaymentMethodResponseDto[]> {
    return this.paymentMethodsService.findAll(query);
  }

  // Sin consumidor en apps/web, y así se queda: mismo
  // PaymentMethodResponseDto que un elemento del listado (los dos usan
  // PAYMENT_METHOD_SELECT), y la API embebe {id, name} en toda referencia a
  // método de pago. Quien lo va a necesitar es el móvil, para resolver un id
  // suelto cuando su copia local del catálogo quedó vieja (spec §4.3,
  // POST /sync/operations). Ver docs/estado-por-modulo.md.
  @ApiOperation({ summary: "Un método de pago por id" })
  @ApiResponse({ status: 200, type: PaymentMethodResponseDto })
  @ApiNotFoundResponse({ description: "Payment method id does not exist" })
  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<PaymentMethodResponseDto> {
    return this.paymentMethodsService.findOne(id);
  }
}
