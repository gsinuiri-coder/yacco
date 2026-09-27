import { Controller, Get, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { JwtAccessGuard } from "../auth/guards/jwt-access.guard.js";
import { DebtReconciliationService } from "./debt-reconciliation.service.js";
import { DebtReconciliationResponseDto } from "./dto/debt-reconciliation-response.dto.js";

/**
 * Solo ADMIN, igual que el cuadre de envases: es un diagnóstico sobre la
 * deuda de todo el padrón. Siempre 200: un descuadre es un hallazgo, no un
 * error HTTP.
 */
@ApiTags("debt-reconciliation")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("debt-reconciliation")
export class DebtReconciliationController {
  constructor(private readonly debtReconciliationService: DebtReconciliationService) {}

  @ApiOperation({
    summary:
      "Compara la deuda guardada de cada cliente contra sus ventas y cobros sumados desde cero",
  })
  @ApiResponse({ status: 200, type: DebtReconciliationResponseDto })
  @Get()
  check(): Promise<DebtReconciliationResponseDto> {
    return this.debtReconciliationService.check();
  }
}
