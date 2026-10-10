import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CustomerLocationResponseDto } from "./dto/customer-location-response.dto.js";
import type { ListCustomerLocationsQueryDto } from "./dto/list-customer-locations-query.dto.js";
import type { UpdateCustomerLocationDto } from "./dto/update-customer-location.dto.js";

const LOCATION_SELECT = {
  id: true,
  name: true,
  address: true,
  addressReference: true,
  phone: true,
  contactName: true,
  latitude: true,
  longitude: true,
  isPrimary: true,
  active: true,
  externalCode: true,
} as const;

const GOOGLE_MAPS_REDIRECT_HOSTS = new Set([
  "google.com",
  "maps.app.goo.gl",
  "maps.google.com",
  "www.google.com",
]);

type LocationRow = Prisma.CustomerLocationGetPayload<{ select: typeof LOCATION_SELECT }>;

function toResponse(location: LocationRow): CustomerLocationResponseDto {
  return {
    ...location,
    latitude: location.latitude?.toFixed(6) ?? null,
    longitude: location.longitude?.toFixed(6) ?? null,
  };
}

function googleMapsUrl(value: string, shortOnly = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException("El enlace de Google Maps no es válido");
  }
  const allowedHost = shortOnly
    ? url.hostname === "maps.app.goo.gl"
    : GOOGLE_MAPS_REDIRECT_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" || !allowedHost) {
    throw new BadRequestException("Solo se aceptan enlaces seguros de Google Maps");
  }
  if (url.hostname !== "maps.app.goo.gl" && !url.pathname.startsWith("/maps")) {
    throw new BadRequestException("El enlace no lleva a Google Maps");
  }
  return url;
}

@Injectable()
export class CustomerLocationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active locations only by default; there are only a handful per customer. */
  async findAll(
    customerId: string,
    query: ListCustomerLocationsQueryDto,
  ): Promise<CustomerLocationResponseDto[]> {
    await this.assertCustomerExists(customerId);

    const locations = await this.prisma.customerLocation.findMany({
      where: { customerId, active: query.active ?? true },
      orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      select: LOCATION_SELECT,
    });
    return locations.map(toResponse);
  }

  async update(
    customerId: string,
    locationId: string,
    dto: UpdateCustomerLocationDto,
  ): Promise<CustomerLocationResponseDto> {
    const result = await this.prisma.customerLocation.updateMany({
      where: { id: locationId, customerId },
      data: {
        ...(dto.contactName !== undefined
          ? { contactName: dto.contactName === null ? null : dto.contactName.trim() || null }
          : {}),
        ...(dto.latitude !== undefined
          ? { latitude: dto.latitude === null ? null : new Prisma.Decimal(dto.latitude) }
          : {}),
        ...(dto.longitude !== undefined
          ? { longitude: dto.longitude === null ? null : new Prisma.Decimal(dto.longitude) }
          : {}),
      },
    });
    if (result.count === 0) {
      throw new NotFoundException(`El local "${locationId}" no pertenece a este cliente`);
    }
    const location = await this.prisma.customerLocation.findFirstOrThrow({
      where: { id: locationId, customerId },
      select: LOCATION_SELECT,
    });
    return toResponse(location);
  }

  async resolveGoogleMapsLink(customerId: string, value: string): Promise<{ url: string }> {
    await this.assertCustomerExists(customerId);
    let current = googleMapsUrl(value, true);

    for (let redirect = 0; redirect < 5; redirect++) {
      let response: Response;
      try {
        response = await fetch(current.toString(), {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(5_000),
          headers: { "user-agent": "Yacco Google Maps link resolver" },
        });
      } catch {
        throw new BadRequestException("No se pudo abrir el enlace abreviado de Google Maps");
      }
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || location === null) {
        throw new BadRequestException("El enlace abreviado de Google Maps no se pudo expandir");
      }
      current = googleMapsUrl(new URL(location, current).toString());
      if (current.hostname !== "maps.app.goo.gl") return { url: current.toString() };
    }

    throw new BadRequestException("El enlace abreviado de Google Maps tiene demasiados desvíos");
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
