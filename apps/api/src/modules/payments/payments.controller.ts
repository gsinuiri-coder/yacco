import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import type { Response } from "express";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { JwtAccessGuard } from "../auth/guards/jwt-access.guard.js";
import type { AuthenticatedRequest } from "../auth/types/authenticated-request.js";
import { CreateOfficePaymentDto } from "./dto/create-office-payment.dto.js";
import { ListPaymentsQueryDto } from "./dto/list-payments-query.dto.js";
import {
  CreateOfficePaymentResponseDto,
  PaginatedPaymentsDto,
  PaymentActionResponseDto,
} from "./dto/payment-response.dto.js";
import { RejectPaymentDto } from "./dto/reject-payment.dto.js";
import { PaymentsService } from "./payments.service.js";

/**
 * Reading the tray is office work (ADMIN and SELLER, same split as
 * customers/orders): whoever is at the counter needs to see what's pending.
 * Resolving one — confirming money actually landed, or rejecting it — is an
 * ADMIN decision only: it moves debtBalance (confirm) or is the final word
 * on a driver-reported collection (reject), so the method-level @Roles below
 * narrows it, same pattern as ZonesController's write endpoints.
 */
@ApiTags("payments")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the required role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiOperation({
    summary: "Cobranza de oficina: un pago fuera de ruta nace CONFIRMED (ADMIN, SELLER)",
    description:
      "idempotencyKey (opcional, UUID v4): protege contra un reintento de red sobre este " +
      "mismo POST. Sin ella, cada llamada crea un pago nuevo, como siempre. Con ella: la " +
      "primera vez crea y responde 201; un reintento con la MISMA clave no crea nada — " +
      "responde 200 con el pago tal como está HOY en la base (nunca reconstruido del " +
      "request), así que si alguien lo confirmó, rechazó o algo más cambió entre el primer " +
      "intento y el reintento, el llamador ve ese estado real. Si la clave ya se usó con otro " +
      "cliente o otro monto, responde 409: eso es un error de quien llama, no un reintento " +
      "legítimo, y nunca se devuelve el pago de otro.",
  })
  @ApiResponse({
    status: 201,
    type: CreateOfficePaymentResponseDto,
    description: "Pago nuevo creado (sin idempotencyKey, o con una que no existía todavía).",
  })
  @ApiResponse({
    status: 200,
    type: CreateOfficePaymentResponseDto,
    description:
      "Reintento: la idempotencyKey ya tenía un pago. No se creó nada; el pago devuelto es " +
      "el existente, releído de la base.",
  })
  @ApiBadRequestResponse({
    description:
      "Invalid amount, inactive customer/method, or location belongs to another customer",
  })
  @ApiNotFoundResponse({ description: "Customer does not exist" })
  @ApiConflictResponse({
    description: "idempotencyKey already used for a different customerId or amount",
  })
  @Post()
  async create(
    @Body() dto: CreateOfficePaymentDto,
    @Req() request: AuthenticatedRequest,
    // passthrough: true keeps Nest's normal DTO serialization for the return
    // value; only the status code is set by hand here, because it depends on
    // created vs replayed (200/201) and no interceptor for that exists yet.
    @Res({ passthrough: true }) res: Response,
  ): Promise<CreateOfficePaymentResponseDto> {
    // recordedById/confirmedById come from the access token, never the body.
    const { response, created } = await this.paymentsService.createOfficePayment(
      dto,
      request.user.sub,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return response;
  }

  @ApiOperation({
    summary: "Bandeja de pagos, con filtros y totales sobre el filtro completo",
  })
  @ApiResponse({ status: 200, type: PaginatedPaymentsDto })
  @Get()
  findAll(@Query() query: ListPaymentsQueryDto): Promise<PaginatedPaymentsDto> {
    return this.paymentsService.findAll(query);
  }

  @ApiOperation({
    summary: "Confirma un pago PENDING: la deuda del cliente baja por el monto (solo ADMIN)",
  })
  @ApiResponse({ status: 200, type: PaymentActionResponseDto })
  @ApiNotFoundResponse({ description: "Payment id does not exist" })
  @ApiConflictResponse({ description: "Payment is not PENDING" })
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  @Post(":id/confirm")
  confirm(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<PaymentActionResponseDto> {
    // confirmedById comes from the access token, never from the body.
    return this.paymentsService.confirm(id, request.user.sub);
  }

  @ApiOperation({
    summary: "Rechaza un pago PENDING: el dinero nunca llegó (solo ADMIN)",
  })
  @ApiResponse({ status: 200, type: PaymentActionResponseDto })
  @ApiNotFoundResponse({ description: "Payment id does not exist" })
  @ApiBadRequestResponse({ description: "Missing or empty reason" })
  @ApiConflictResponse({ description: "Payment is not PENDING" })
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  @Post(":id/reject")
  reject(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectPaymentDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PaymentActionResponseDto> {
    // rejectedById comes from the access token, never from the body.
    return this.paymentsService.reject(id, dto, request.user.sub);
  }
}
