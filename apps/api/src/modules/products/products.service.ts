import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { ListProductsQueryDto } from "./dto/list-products-query.dto.js";
import type { ProductResponseDto } from "./dto/product-response.dto.js";

/** Everything the wire shape needs, and nothing else. */
const PRODUCT_INCLUDE = {
  containerType: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

function toProductResponse(product: ProductWithRelations): ProductResponseDto {
  return {
    id: product.id,
    name: product.name,
    type: product.type,
    containerType: product.containerType,
    listPrice: product.listPrice.toFixed(2),
    active: product.active,
  };
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * No pagination: the catalog is a handful of hand-seeded rows on purpose
   * (S1 has no product CRUD). If the catalog ever grows past a page's worth,
   * this is the place to add it — mirroring Customers/Orders.
   *
   * `active` defaults to true: the order form must never offer a product the
   * API would then reject as withdrawn.
   */
  async findAll(query: ListProductsQueryDto): Promise<ProductResponseDto[]> {
    const products = await this.prisma.product.findMany({
      where: { active: query.active ?? true },
      orderBy: { name: "asc" },
      include: PRODUCT_INCLUDE,
    });
    return products.map(toProductResponse);
  }
}
