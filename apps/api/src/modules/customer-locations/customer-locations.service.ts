import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CustomerLocationResponseDto } from "./dto/customer-location-response.dto.js";
import type { ListCustomerLocationsQueryDto } from "./dto/list-customer-locations-query.dto.js";

@Injectable()
export class CustomerLocationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * No pagination: a customer's locations are a handful of rows at most.
   * There is no create/update/delete yet — every customer gets exactly one
   * (its primary) at creation (CustomersService), and a second location is
   * still inserted by hand until that management UI exists.
   *
   * `active` defaults to true: a movement or a price form must never offer a
   * withdrawn location.
   */
  async findAll(
    customerId: string,
    query: ListCustomerLocationsQueryDto,
  ): Promise<CustomerLocationResponseDto[]> {
    await this.assertCustomerExists(customerId);

    return this.prisma.customerLocation.findMany({
      where: { customerId, active: query.active ?? true },
      orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        address: true,
        addressReference: true,
        phone: true,
        isPrimary: true,
        active: true,
      },
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
}
