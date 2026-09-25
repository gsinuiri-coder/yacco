import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
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
import { ListProductsQueryDto } from "./dto/list-products-query.dto.js";
import { ProductResponseDto } from "./dto/product-response.dto.js";
import { UpdateProductDto } from "./dto/update-product.dto.js";
import { ProductsService } from "./products.service.js";

/**
 * The catalog is seeded (spec S1 has no product CRUD). Reading is open to
 * every role that prices something; writing is only the list price, ADMIN
 * only: the price the whole roster pays by default is an owner decision.
 */
@ApiTags("products")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
@UseGuards(JwtAccessGuard, RolesGuard)
// DRIVER lee el catálogo: el formulario de parada de «Mi ruta» lo necesita.
// VIEWER: la cuenta del smoke lee los catálogos, que no tienen datos de clientes.
@Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER, UserRole.VIEWER)
@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @ApiOperation({ summary: "Lista el catálogo de productos (sin paginar)" })
  @ApiResponse({ status: 200, type: ProductResponseDto, isArray: true })
  @Get()
  findAll(@Query() query: ListProductsQueryDto): Promise<ProductResponseDto[]> {
    return this.productsService.findAll(query);
  }

  @ApiOperation({ summary: "Cambia el precio de lista de un producto (solo ADMIN)" })
  @ApiResponse({ status: 200, type: ProductResponseDto })
  @ApiNotFoundResponse({ description: "Product id does not exist" })
  @ApiBadRequestResponse({ description: "listPrice is not a 2-decimal amount" })
  @Roles(UserRole.ADMIN)
  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.update(id, dto);
  }
}
