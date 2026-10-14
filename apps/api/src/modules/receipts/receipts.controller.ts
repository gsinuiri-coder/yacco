import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { JwtAccessGuard } from "../auth/guards/jwt-access.guard.js";
import type { AuthenticatedRequest } from "../auth/types/authenticated-request.js";
import { CreateReceiptDto } from "./dto/create-receipt.dto.js";
import { PreviewReceiptDto, ReceiptPreviewResponseDto } from "./dto/preview-receipt.dto.js";
import { MarkReceiptExemptionsDto, ReceiptReasonDto } from "./dto/receipt-action.dto.js";
import {
  ReceiptExemptionResultDto,
  ReceiptResponseDto,
  VoidReceiptResultDto,
} from "./dto/receipt-response.dto.js";
import { ReceiptsService } from "./receipts.service.js";

@ApiTags("receipts")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Se requiere un rol de oficina" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("receipts")
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @ApiOperation({
    summary: "Calcula base, IGV y total desde las ventas antes de registrar el comprobante",
  })
  @ApiResponse({ status: 200, type: ReceiptPreviewResponseDto })
  @ApiBadRequestResponse({ description: "Ventas o documento del cliente inválidos" })
  @ApiConflictResponse({ description: "Datos fiscales faltantes o venta ya comprobada" })
  @HttpCode(200)
  @Post("preview")
  preview(@Body() dto: PreviewReceiptDto): Promise<ReceiptPreviewResponseDto> {
    return this.receiptsService.preview(dto);
  }

  @ApiOperation({ summary: "Registra una boleta o factura sobre ventas completas" })
  @ApiResponse({ status: 201, type: ReceiptResponseDto })
  @Post()
  create(
    @Body() dto: CreateReceiptDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReceiptResponseDto> {
    return this.receiptsService.create(dto, request.user.sub);
  }

  @ApiOperation({ summary: "Marca una o varias ventas como No lleva comprobante" })
  @ApiResponse({ status: 201, type: ReceiptExemptionResultDto })
  @Post("exemptions")
  markExemptions(
    @Body() dto: MarkReceiptExemptionsDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReceiptExemptionResultDto> {
    return this.receiptsService.markExemptions(dto, request.user.sub);
  }

  @ApiOperation({ summary: "Anula un comprobante y libera todas sus ventas (solo ADMIN)" })
  @ApiResponse({ status: 200, type: VoidReceiptResultDto })
  @Roles(UserRole.ADMIN)
  @Patch(":id/void")
  void(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReceiptReasonDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<VoidReceiptResultDto> {
    return this.receiptsService.void(id, dto, request.user.sub);
  }
}
