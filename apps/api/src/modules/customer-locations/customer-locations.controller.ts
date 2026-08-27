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
import { CustomerLocationsService } from "./customer-locations.service.js";
import { CustomerLocationResponseDto } from "./dto/customer-location-response.dto.js";
import { ListCustomerLocationsQueryDto } from "./dto/list-customer-locations-query.dto.js";

/**
 * Nested under the customer: a location is never a standalone resource.
 * Read-only in this phase — no create/update/delete route — mirroring
 * container-types: the primary location is created with the customer
 * (CustomersService), a second one is still inserted by hand until a
 * management UI exists. ADMIN and SELLER: both register container
 * movements and pact prices against a customer's location.
 */
@ApiTags("customer-locations")
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("customers/:customerId")
export class CustomerLocationsController {
  constructor(private readonly customerLocationsService: CustomerLocationsService) {}

  @ApiOperation({ summary: "Lista las ubicaciones de un cliente (sin paginar)" })
  @ApiResponse({ status: 200, type: CustomerLocationResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: "Customer id does not exist" })
  @ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Get("locations")
  findAll(
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Query() query: ListCustomerLocationsQueryDto,
  ): Promise<CustomerLocationResponseDto[]> {
    return this.customerLocationsService.findAll(customerId, query);
  }
}
