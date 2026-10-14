import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
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
import { PreviewReceiptDto, ReceiptPreviewResponseDto } from "./dto/preview-receipt.dto.js";
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
}
