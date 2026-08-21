import {
  Body,
  Controller,
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
  ApiConflictResponse,
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
import { CreateOrderDto } from "./dto/create-order.dto.js";
import { ListOrdersQueryDto } from "./dto/list-orders-query.dto.js";
import { OrderResponseDto, PaginatedOrdersDto } from "./dto/order-response.dto.js";
import { OrdersService } from "./orders.service.js";

/**
 * ADMIN and SELLER capture and consult pre-orders (spec HU-06 is written for
 * the seller). DRIVER is excluded: the field app works against route stops,
 * not against orders directly.
 */
@ApiTags("orders")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @ApiOperation({ summary: "Registra un pedido en estado PENDING" })
  @ApiResponse({ status: 201, type: OrderResponseDto })
  @ApiBadRequestResponse({ description: "Validation failed, or customer/product does not exist" })
  @Post()
  create(
    @Body() dto: CreateOrderDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<OrderResponseDto> {
    // createdById comes from the access token, never from the body.
    return this.ordersService.create(dto, request.user.sub);
  }

  @ApiOperation({ summary: "Lista pedidos paginados, con filtros por estado, cliente y fecha" })
  @ApiResponse({ status: 200, type: PaginatedOrdersDto })
  @Get()
  findAll(@Query() query: ListOrdersQueryDto): Promise<PaginatedOrdersDto> {
    return this.ordersService.findAll(query);
  }

  @ApiOperation({ summary: "Pedido con sus ítems" })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  @ApiNotFoundResponse({ description: "Order id does not exist" })
  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<OrderResponseDto> {
    return this.ordersService.findOne(id);
  }

  // A dedicated sub-resource rather than a general PATCH body: the only
  // transition this module owns is PENDING -> CANCELLED, so there is no route
  // through which an arbitrary status could be written.
  @ApiOperation({ summary: "Cancela un pedido pendiente" })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  @ApiNotFoundResponse({ description: "Order id does not exist" })
  @ApiConflictResponse({ description: "Order is no longer PENDING" })
  @Patch(":id/cancel")
  cancel(@Param("id", ParseUUIDPipe) id: string): Promise<OrderResponseDto> {
    return this.ordersService.cancel(id);
  }
}
