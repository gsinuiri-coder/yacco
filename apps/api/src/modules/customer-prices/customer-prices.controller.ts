import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { JwtAccessGuard } from "../auth/guards/jwt-access.guard.js";
import { CustomerPricesService } from "./customer-prices.service.js";
import { CreateCustomerPriceDto } from "./dto/create-customer-price.dto.js";
import { CustomerPriceResponseDto } from "./dto/customer-price-response.dto.js";
import { EffectivePriceResponseDto } from "./dto/effective-price-response.dto.js";
import { EffectivePricesQueryDto } from "./dto/effective-prices-query.dto.js";
import { UpdateCustomerPriceDto } from "./dto/update-customer-price.dto.js";

/**
 * Nested under the customer: a price agreement is never a standalone
 * resource, only ever "this customer's price for this product". Management
 * (list/create/update/delete) is ADMIN-only — pricing is a commercial
 * decision, not office capture (spec). The effective-price lookup is open to
 * SELLER too: they need to see it while taking an order.
 */
@ApiTags("customer-prices")
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("customers/:customerId")
export class CustomerPricesController {
  constructor(private readonly customerPricesService: CustomerPricesService) {}

  @ApiOperation({ summary: "Lista los precios pactados de un cliente" })
  @ApiResponse({ status: 200, type: CustomerPriceResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: "Customer id does not exist" })
  @ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN role" })
  @Roles(UserRole.ADMIN)
  @Get("prices")
  findAll(
    @Param("customerId", ParseUUIDPipe) customerId: string,
  ): Promise<CustomerPriceResponseDto[]> {
    return this.customerPricesService.findAll(customerId);
  }

  @ApiOperation({
    summary: "Pacta un precio para un cliente, opcionalmente solo para una locación",
  })
  @ApiResponse({ status: 201, type: CustomerPriceResponseDto })
  @ApiBadRequestResponse({ description: "Validation failed, or product/location invalid" })
  @ApiConflictResponse({
    description: "A price for this customer/product(/location) already exists",
  })
  @ApiNotFoundResponse({ description: "Customer id does not exist" })
  @ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN role" })
  @Roles(UserRole.ADMIN)
  @Post("prices")
  create(
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Body() dto: CreateCustomerPriceDto,
  ): Promise<CustomerPriceResponseDto> {
    return this.customerPricesService.create(customerId, dto);
  }

  @ApiOperation({ summary: "Actualiza el precio de un pacto existente" })
  @ApiResponse({ status: 200, type: CustomerPriceResponseDto })
  @ApiNotFoundResponse({ description: "Price id does not exist for this customer" })
  @ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN role" })
  @Roles(UserRole.ADMIN)
  @Patch("prices/:priceId")
  update(
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Param("priceId", ParseUUIDPipe) priceId: string,
    @Body() dto: UpdateCustomerPriceDto,
  ): Promise<CustomerPriceResponseDto> {
    return this.customerPricesService.update(customerId, priceId, dto);
  }

  @ApiOperation({ summary: "Elimina un precio pactado; vuelve a regir el nivel superior" })
  @ApiNoContentResponse({ description: "Deleted" })
  @ApiNotFoundResponse({ description: "Price id does not exist for this customer" })
  @ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN role" })
  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  @Delete("prices/:priceId")
  remove(
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Param("priceId", ParseUUIDPipe) priceId: string,
  ): Promise<void> {
    return this.customerPricesService.remove(customerId, priceId);
  }

  @ApiOperation({
    summary:
      "Precio efectivo de cada producto activo para un cliente (y, opcionalmente, una locación), con su origen",
  })
  @ApiResponse({ status: 200, type: EffectivePriceResponseDto, isArray: true })
  @ApiBadRequestResponse({
    description: "Location does not exist or does not belong to this customer",
  })
  @ApiNotFoundResponse({ description: "Customer id does not exist" })
  @ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Get("effective-prices")
  findEffectivePrices(
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Query() query: EffectivePricesQueryDto,
  ): Promise<EffectivePriceResponseDto[]> {
    return this.customerPricesService.findEffectivePrices(customerId, query);
  }
}
