import { Controller, Get, Query, UseGuards } from "@nestjs/common";
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
import { ContainerBalancesService } from "./container-balances.service.js";
import { PaginatedContainerBalancesDto } from "./dto/container-balance-response.dto.js";
import { ListContainerBalancesQueryDto } from "./dto/list-container-balances-query.dto.js";

/**
 * ADMIN and SELLER. This is the WORK LIST the office audits the ~750
 * containers on the street with, customer by customer: the owner, and the
 * office clerk (SELLER) who records the counts and needs to see whom to count
 * — the same two roles that can write a count (`container-counts`). Decided by
 * Giancarlo with Claude's recommendation, supuesto 20 of
 * docs/supuestos-por-validar.md. DRIVER and VIEWER stay out: what a driver
 * needs on the route (this stop's balance, right now) is a different screen
 * and a different query, and it does not exist yet; when it does it gets its
 * own route with its own role, rather than widening this one.
 */
@ApiTags("container-balances")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("container-balances")
export class ContainerBalancesController {
  constructor(private readonly containerBalancesService: ContainerBalancesService) {}

  @ApiOperation({
    summary:
      "Envases en poder de clientes, una fila por ubicación, con el último conteo de cada tipo (lista de trabajo de auditoría)",
  })
  @ApiResponse({ status: 200, type: PaginatedContainerBalancesDto })
  @Get()
  findAll(@Query() query: ListContainerBalancesQueryDto): Promise<PaginatedContainerBalancesDto> {
    return this.containerBalancesService.findAll(query);
  }
}
