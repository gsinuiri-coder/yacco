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
import { CustomerLocationsService } from "./customer-locations.service.js";
import { PendingApprovalsResponseDto } from "./dto/pending-approvals-response.dto.js";

@ApiTags("pending-approvals")
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("pending-approvals")
export class PendingApprovalsController {
  constructor(private readonly customerLocationsService: CustomerLocationsService) {}

  @ApiOperation({
    summary: "Bandeja de solicitudes pendientes del administrador (fotos y ubicaciones)",
  })
  @ApiResponse({ status: 200, type: PendingApprovalsResponseDto })
  @ApiForbiddenResponse({
    description: "Solo ADMIN puede ver la bandeja de aprobaciones pendientes",
  })
  @Get()
  getPendingApprovals(): Promise<PendingApprovalsResponseDto> {
    return this.customerLocationsService.getPendingApprovals();
  }
}
