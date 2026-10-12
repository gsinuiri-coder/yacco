import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import {
  ApiBadRequestResponse,
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
import type { AuthenticatedRequest } from "../auth/types/authenticated-request.js";
import { AccessoriesService } from "./accessories.service.js";
import {
  AccessoryMovementResponseDto,
  CustomerAccessoryBalanceResponseDto,
} from "./dto/accessory-response.dto.js";
import { ChargeAccessoryDto } from "./dto/charge-accessory.dto.js";
import { LoanAccessoryDto } from "./dto/loan-accessory.dto.js";
import { ReturnAccessoryDto } from "./dto/return-accessory.dto.js";

@ApiTags("customer-locations")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Missing required role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("customer-locations/:locationId/accessories")
export class CustomerLocationAccessoriesController {
  constructor(private readonly accessoriesService: AccessoriesService) {}

  @ApiOperation({ summary: "Lista saldos de accesorios prestados en la ubicación" })
  @ApiResponse({ status: 200, type: CustomerAccessoryBalanceResponseDto, isArray: true })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Get()
  listBalances(
    @Param("locationId", ParseUUIDPipe) locationId: string,
  ): Promise<CustomerAccessoryBalanceResponseDto[]> {
    return this.accessoriesService.listCustomerBalances(locationId);
  }

  @ApiOperation({ summary: "Registra un préstamo de accesorio a la ubicación" })
  @ApiResponse({ status: 201, type: AccessoryMovementResponseDto })
  @ApiBadRequestResponse({ description: "Validation failed" })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Post("loans")
  loan(
    @Param("locationId", ParseUUIDPipe) locationId: string,
    @Body() dto: LoanAccessoryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccessoryMovementResponseDto> {
    return this.accessoriesService.loan(locationId, dto, request.user.sub);
  }

  @ApiOperation({ summary: "Registra la devolución de un accesorio a planta" })
  @ApiResponse({ status: 201, type: AccessoryMovementResponseDto })
  @ApiBadRequestResponse({ description: "Validation failed or returning more than borrowed" })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Post("returns")
  returnLoan(
    @Param("locationId", ParseUUIDPipe) locationId: string,
    @Body() dto: ReturnAccessoryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccessoryMovementResponseDto> {
    return this.accessoriesService.returnLoan(locationId, dto, request.user.sub);
  }

  @ApiOperation({ summary: "Cobra un accesorio prestado (ADMIN, con motivo)" })
  @ApiResponse({ status: 201, type: AccessoryMovementResponseDto })
  @ApiBadRequestResponse({ description: "Validation failed or charging more than borrowed" })
  @Roles(UserRole.ADMIN)
  @Post("charges")
  chargeLoan(
    @Param("locationId", ParseUUIDPipe) locationId: string,
    @Body() dto: ChargeAccessoryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccessoryMovementResponseDto> {
    return this.accessoriesService.chargeLoan(locationId, dto, request.user.sub);
  }
}
