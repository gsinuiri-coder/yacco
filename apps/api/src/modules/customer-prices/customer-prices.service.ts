import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CreateCustomerPriceDto } from "./dto/create-customer-price.dto.js";
import type { CustomerPriceResponseDto } from "./dto/customer-price-response.dto.js";
import type { EffectivePricesQueryDto } from "./dto/effective-prices-query.dto.js";
import type { EffectivePriceResponseDto } from "./dto/effective-price-response.dto.js";
import { PriceSource } from "./dto/effective-price-response.dto.js";
import type { UpdateCustomerPriceDto } from "./dto/update-customer-price.dto.js";

function isPrismaKnownError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/** Everything the wire shape needs, and nothing else. */
const CUSTOMER_PRICE_INCLUDE = {
  product: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
} satisfies Prisma.CustomerPriceInclude;

type CustomerPriceWithRelations = Prisma.CustomerPriceGetPayload<{
  include: typeof CUSTOMER_PRICE_INCLUDE;
}>;

function toCustomerPriceResponse(price: CustomerPriceWithRelations): CustomerPriceResponseDto {
  return {
    id: price.id,
    product: price.product,
    location: price.location,
    price: price.price.toFixed(2),
  };
}

@Injectable()
export class CustomerPricesService {
  constructor(private readonly prisma: PrismaService) {}

  /** ADMIN-only management: this is a commercial decision, not office capture. */
  async findAll(customerId: string): Promise<CustomerPriceResponseDto[]> {
    await this.assertCustomerExists(customerId);

    const prices = await this.prisma.customerPrice.findMany({
      where: { customerId },
      include: CUSTOMER_PRICE_INCLUDE,
      orderBy: { product: { name: "asc" } },
    });
    return prices.map(toCustomerPriceResponse);
  }

  async create(customerId: string, dto: CreateCustomerPriceDto): Promise<CustomerPriceResponseDto> {
    await this.assertCustomerExists(customerId);
    await this.assertProductExists(dto.productId);
    if (dto.locationId !== undefined) {
      await this.assertLocationBelongsToCustomer(dto.locationId, customerId);
    }

    try {
      const price = await this.prisma.customerPrice.create({
        data: {
          customerId,
          productId: dto.productId,
          locationId: dto.locationId ?? null,
          price: new Prisma.Decimal(dto.price),
        },
        include: CUSTOMER_PRICE_INCLUDE,
      });
      return toCustomerPriceResponse(price);
    } catch (error) {
      // P2002: one of the two partial unique indexes (customer_prices_base_price_key
      // for locationId IS NULL, customer_prices_location_price_key otherwise).
      if (isPrismaKnownError(error, "P2002")) {
        throw new ConflictException(
          dto.locationId !== undefined
            ? "Ya existe un precio pactado para este cliente, este producto y esta ubicación"
            : "Ya existe un precio pactado para este cliente y este producto",
        );
      }
      throw error;
    }
  }

  /** Only the price moves; re-pointing product/location is a different agreement. */
  async update(
    customerId: string,
    priceId: string,
    dto: UpdateCustomerPriceDto,
  ): Promise<CustomerPriceResponseDto> {
    // Scoped by customerId too: a price id that exists under a different
    // customer must read as "not found here", never leak via a 200.
    const { count } = await this.prisma.customerPrice.updateMany({
      where: { id: priceId, customerId },
      data: { price: new Prisma.Decimal(dto.price) },
    });
    if (count === 0) {
      throw new NotFoundException(`El precio "${priceId}" no existe para este cliente`);
    }

    const price = await this.prisma.customerPrice.findUniqueOrThrow({
      where: { id: priceId },
      include: CUSTOMER_PRICE_INCLUDE,
    });
    return toCustomerPriceResponse(price);
  }

  /** Deleting a price lets the next level up (customer, then list) take over. */
  async remove(customerId: string, priceId: string): Promise<void> {
    const { count } = await this.prisma.customerPrice.deleteMany({
      where: { id: priceId, customerId },
    });
    if (count === 0) {
      throw new NotFoundException(`El precio "${priceId}" no existe para este cliente`);
    }
  }

  /**
   * Precedence (spec, decided with the client): location price (if a
   * location is given) > customer-wide price (locationId null) > product's
   * listPrice. The agreement is with the customer; a location price is an
   * exception for that one branch. This is the ONLY place this rule lives —
   * every caller (web included) reads the resolved price and its source,
   * never re-derives it.
   */
  async findEffectivePrices(
    customerId: string,
    query: EffectivePricesQueryDto,
  ): Promise<EffectivePriceResponseDto[]> {
    await this.assertCustomerExists(customerId);
    if (query.locationId !== undefined) {
      await this.assertLocationBelongsToCustomer(query.locationId, customerId);
    }

    const [products, prices] = await Promise.all([
      this.prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      this.prisma.customerPrice.findMany({
        where: {
          customerId,
          OR: [
            { locationId: null },
            ...(query.locationId !== undefined ? [{ locationId: query.locationId }] : []),
          ],
        },
      }),
    ]);

    const customerPriceByProduct = new Map(
      prices
        .filter((price) => price.locationId === null)
        .map((price) => [price.productId, price] as const),
    );
    const locationPriceByProduct = new Map(
      prices
        .filter((price) => price.locationId !== null)
        .map((price) => [price.productId, price] as const),
    );

    return products.map((product) => {
      const productRef = { id: product.id, name: product.name };

      const locationPrice = locationPriceByProduct.get(product.id);
      if (locationPrice !== undefined) {
        return {
          product: productRef,
          price: locationPrice.price.toFixed(2),
          source: PriceSource.LOCATION,
        };
      }

      const customerPrice = customerPriceByProduct.get(product.id);
      if (customerPrice !== undefined) {
        return {
          product: productRef,
          price: customerPrice.price.toFixed(2),
          source: PriceSource.CUSTOMER,
        };
      }

      return { product: productRef, price: product.listPrice.toFixed(2), source: PriceSource.LIST };
    });
  }

  private async assertCustomerExists(customerId: string): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (customer === null) {
      throw new NotFoundException(`El cliente "${customerId}" no existe`);
    }
  }

  private async assertProductExists(productId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (product === null) {
      throw new BadRequestException(`El producto "${productId}" no existe`);
    }
  }

  private async assertLocationBelongsToCustomer(
    locationId: string,
    customerId: string,
  ): Promise<void> {
    const location = await this.prisma.customerLocation.findUnique({
      where: { id: locationId },
      select: { customerId: true },
    });
    if (location === null) {
      throw new BadRequestException(`La ubicación "${locationId}" no existe`);
    }
    if (location.customerId !== customerId) {
      throw new BadRequestException(`La ubicación "${locationId}" no pertenece a este cliente`);
    }
  }
}
