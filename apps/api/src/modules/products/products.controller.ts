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
import { ListProductsQueryDto } from "./dto/list-products-query.dto.js";
import { ProductResponseDto } from "./dto/product-response.dto.js";
import { ProductsService } from "./products.service.js";

/**
 * Read-only catalog: ADMIN and SELLER capture orders against it (spec S1 has
 * no product CRUD, the catalog is seeded). Same roles as Customers/Orders;
 * DRIVER is excluded for the same reason it is there.
 */
@ApiTags("products")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @ApiOperation({ summary: "Lista el catálogo de productos (sin paginar)" })
  @ApiResponse({ status: 200, type: ProductResponseDto, isArray: true })
  @Get()
  findAll(@Query() query: ListProductsQueryDto): Promise<ProductResponseDto[]> {
    return this.productsService.findAll(query);
  }
}
