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
import { ContainerReconciliationService } from "./container-reconciliation.service.js";
import { ContainerReconciliationResponseDto } from "./dto/container-reconciliation-response.dto.js";

/**
 * ADMIN-only: this is a diagnostic over the whole fleet's books, not
 * something a seller or driver needs. Always 200, even with discrepancies —
 * a mismatch is a finding this endpoint reports, not an HTTP error. Machine
 * auth for a scheduled/cron caller is a separate PR; this route only serves
 * an authenticated ADMIN for now.
 */
@ApiTags("container-reconciliation")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("container-reconciliation")
export class ContainerReconciliationController {
  constructor(private readonly containerReconciliationService: ContainerReconciliationService) {}

  @ApiOperation({
    summary:
      "Compara el saldo materializado de envases contra el libro de movimientos reconstruido desde cero",
  })
  @ApiResponse({ status: 200, type: ContainerReconciliationResponseDto })
  @Get()
  check(): Promise<ContainerReconciliationResponseDto> {
    return this.containerReconciliationService.check();
  }
}
