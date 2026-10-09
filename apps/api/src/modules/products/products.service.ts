import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { ListProductsQueryDto } from "./dto/list-products-query.dto.js";
import type { ProductResponseDto } from "./dto/product-response.dto.js";
import type { ProductPriceChangeResponseDto } from "./dto/product-price-change-response.dto.js";
import type { UpdateProductDto } from "./dto/update-product.dto.js";

/** Everything the wire shape needs, and nothing else. */
const PRODUCT_INCLUDE = {
  containerType: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

const PRICE_CHANGE_INCLUDE = {
  changedBy: { select: { id: true, name: true } },
} satisfies Prisma.ProductPriceChangeInclude;

type PriceChangeWithRelations = Prisma.ProductPriceChangeGetPayload<{
  include: typeof PRICE_CHANGE_INCLUDE;
}>;

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

function toPriceChangeResponse(change: PriceChangeWithRelations): ProductPriceChangeResponseDto {
  return {
    id: change.id,
    previousPrice: change.previousPrice?.toFixed(2) ?? null,
    newPrice: change.newPrice.toFixed(2),
    changedAt: change.changedAt.toISOString(),
    changedBy: change.changedBy,
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

  /**
   * Sets the list price. Sales already written keep theirs; a pending order
   * is priced when it is delivered, so it gets the new one (supuesto 17).
   */
  async update(
    id: string,
    dto: UpdateProductDto,
    changedById: string,
  ): Promise<ProductResponseDto> {
    // MONEY_PATTERN admits 0. A zero list price is almost always a typo, and
    // it would make every delivery without an agreed price free, silently.
    const listPrice = new Prisma.Decimal(dto.listPrice);
    if (listPrice.lte(0)) {
      throw new BadRequestException("El precio de lista debe ser mayor que 0");
    }
    try {
      const product = await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.product.findUniqueOrThrow({ where: { id } });
        if (current.listPrice.equals(listPrice)) {
          return transaction.product.findUniqueOrThrow({ where: { id }, include: PRODUCT_INCLUDE });
        }
        const updated = await transaction.product.update({
          where: { id },
          data: { listPrice },
          include: PRODUCT_INCLUDE,
        });
        await transaction.productPriceChange.create({
          data: {
            productId: id,
            previousPrice: current.listPrice,
            newPrice: listPrice,
            changedById,
          },
        });
        return updated;
      });
      return toProductResponse(product);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new NotFoundException(`El producto "${id}" no existe`);
      }
      throw error;
    }
  }

  async findPriceChanges(id: string): Promise<ProductPriceChangeResponseDto[]> {
    const product = await this.prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (product === null) {
      throw new NotFoundException(`El producto "${id}" no existe`);
    }
    const changes = await this.prisma.productPriceChange.findMany({
      where: { productId: id },
      orderBy: { changedAt: "desc" },
      include: PRICE_CHANGE_INCLUDE,
    });
    return changes.map(toPriceChangeResponse);
  }
}
