import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
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
import {
  GoogleMapsLinkResolutionDto,
  ResolveGoogleMapsLinkDto,
} from "./dto/resolve-google-maps-link.dto.js";
import { UpdateCustomerLocationDto } from "./dto/update-customer-location.dto.js";

/**
 * Nested under the customer: a location is never a standalone resource.
 * The primary location is created with the customer (CustomersService),
 * while this controller lists locations, updates their delivery details,
 * and resolves Google Maps short links. Creating and deleting locations
 * remain outside this module. ADMIN and SELLER both register container
 * movements and pact prices against a customer's location.
 */
@ApiTags("customer-locations")
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("customers/:customerId")
export class CustomerLocationsController {
  constructor(private readonly customerLocationsService: CustomerLocationsService) {}

  @ApiOperation({ summary: "Lista las ubicaciones de un cliente (sin paginar)" })
  @ApiResponse({ status: 200, type: CustomerLocationResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: "Customer id does not exist" })
  @ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
  @Get("locations")
  findAll(
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Query() query: ListCustomerLocationsQueryDto,
  ): Promise<CustomerLocationResponseDto[]> {
    return this.customerLocationsService.findAll(customerId, query);
  }

  @ApiOperation({ summary: "Actualiza contacto y coordenadas de un local del cliente" })
  @ApiResponse({ status: 200, type: CustomerLocationResponseDto })
  @ApiNotFoundResponse({ description: "Customer or location does not exist" })
  @Patch("locations/:locationId")
  update(
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Param("locationId", ParseUUIDPipe) locationId: string,
    @Body() dto: UpdateCustomerLocationDto,
  ): Promise<CustomerLocationResponseDto> {
    return this.customerLocationsService.update(customerId, locationId, dto);
  }

  @ApiOperation({ summary: "Expande un enlace abreviado de Google Maps" })
  @ApiResponse({ status: 201, type: GoogleMapsLinkResolutionDto })
  @Post("locations/google-maps-link-resolutions")
  resolveGoogleMapsLink(
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Body() dto: ResolveGoogleMapsLinkDto,
  ): Promise<GoogleMapsLinkResolutionDto> {
    return this.customerLocationsService.resolveGoogleMapsLink(customerId, dto.url);
  }
}
