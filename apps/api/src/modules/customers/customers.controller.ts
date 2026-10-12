import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
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
import type { AuthenticatedRequest } from "../auth/types/authenticated-request.js";
import { CustomersService } from "./customers.service.js";
import { AccountStatementQueryDto } from "./dto/account-statement-query.dto.js";
import { AccountStatementResponseDto } from "./dto/account-statement-response.dto.js";
import { CreateCustomerContactDto } from "./dto/create-customer-contact.dto.js";
import { CreateCustomerDto } from "./dto/create-customer.dto.js";
import { CustomerContactResponseDto } from "./dto/customer-contact-response.dto.js";
import { CustomerResponseDto, PaginatedCustomersDto } from "./dto/customer-response.dto.js";
import { ListCustomersQueryDto } from "./dto/list-customers-query.dto.js";
import { UpdateCustomerDto } from "./dto/update-customer.dto.js";
import { ZoneCustomerCountsDto } from "./dto/zone-counts-response.dto.js";

/**
 * ADMIN and SELLER manage the customer roster (spec HU-05 is written for the
 * seller). DRIVER is excluded: a driver reaches customer data through the
 * day's route, never through the roster.
 */
@ApiTags("customers")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("customers")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @ApiOperation({ summary: "Registra un cliente (deuda y saldo de envases arrancan en 0)" })
  @ApiResponse({ status: 201, type: CustomerResponseDto })
  @ApiBadRequestResponse({ description: "Validation failed, or zoneId does not exist" })
  @Post()
  create(@Body() dto: CreateCustomerDto): Promise<CustomerResponseDto> {
    return this.customersService.create(dto);
  }

  @ApiOperation({ summary: "Lista clientes paginados, con búsqueda y filtros" })
  @ApiResponse({ status: 200, type: PaginatedCustomersDto })
  @ApiBadRequestResponse({ description: "Validation failed, or withoutZone together with zoneId" })
  @Get()
  findAll(@Query() query: ListCustomersQueryDto): Promise<PaginatedCustomersDto> {
    return this.customersService.findAll(query);
  }

  // Before `:id`: otherwise "zone-counts" reaches ParseUUIDPipe as an id.
  @ApiOperation({ summary: "Clientes activos por zona, y los activos sin zona" })
  @ApiResponse({ status: 200, type: ZoneCustomerCountsDto })
  @Get("zone-counts")
  countByZone(): Promise<ZoneCustomerCountsDto> {
    return this.customersService.countActiveByZone();
  }

  @ApiOperation({ summary: "Ficha de un cliente" })
  @ApiResponse({ status: 200, type: CustomerResponseDto })
  @ApiNotFoundResponse({ description: "Customer id does not exist" })
  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<CustomerResponseDto> {
    return this.customersService.findOne(id);
  }

  // Deactivation is `active: false` through this route. There is no DELETE:
  // Customer's relations are onDelete: Restrict, so a hard delete would fail
  // the moment the customer had any operational history.
  @ApiOperation({ summary: "Actualiza un cliente; active=false lo desactiva" })
  @ApiResponse({ status: 200, type: CustomerResponseDto })
  @ApiNotFoundResponse({ description: "Customer id does not exist" })
  @ApiBadRequestResponse({ description: "Validation failed, or zoneId does not exist" })
  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ): Promise<CustomerResponseDto> {
    return this.customersService.update(id, dto);
  }

  @ApiOperation({
    summary: "Estado de cuenta: cargos y abonos intercalados, con saldo corriente",
    description:
      "Un abono PENDING o REJECTED aparece en la lista pero no mueve el saldo — solo un CONFIRMED lo hace",
  })
  @ApiResponse({ status: 200, type: AccountStatementResponseDto })
  @ApiNotFoundResponse({ description: "Customer id does not exist" })
  @Get(":id/account-statement")
  getAccountStatement(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: AccountStatementQueryDto,
  ): Promise<AccountStatementResponseDto> {
    return this.customersService.getAccountStatement(id, query);
  }

  @ApiOperation({ summary: "Lista contactos activos de un cliente" })
  @ApiResponse({ status: 200, type: CustomerContactResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: "Customer id does not exist" })
  @Get(":id/contacts")
  findContacts(@Param("id", ParseUUIDPipe) id: string): Promise<CustomerContactResponseDto[]> {
    return this.customersService.findContacts(id);
  }

  @ApiOperation({ summary: "Agrega un contacto al cliente" })
  @ApiResponse({ status: 201, type: CustomerContactResponseDto })
  @ApiNotFoundResponse({ description: "Customer id does not exist" })
  @Post(":id/contacts")
  createContact(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateCustomerContactDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CustomerContactResponseDto> {
    return this.customersService.createContact(id, dto, req.user.sub);
  }

  @ApiOperation({ summary: "Desactiva un contacto del cliente" })
  @ApiResponse({ status: 200, type: CustomerContactResponseDto })
  @ApiNotFoundResponse({ description: "Contact id does not exist" })
  @Delete(":id/contacts/:contactId")
  removeContact(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("contactId", ParseUUIDPipe) contactId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<CustomerContactResponseDto> {
    return this.customersService.removeContact(id, contactId, req.user.sub);
  }
}
