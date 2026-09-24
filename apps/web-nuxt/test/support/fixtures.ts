import type {
  Customer,
  CustomerLocation,
  Order,
  Page,
  Route,
  RouteStop,
  User,
} from "@yacco/shared";

export function buildCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Bodega Santa Rosa",
    phone: "987654321",
    address: "Av. Los Álamos 452",
    addressReference: "Portón azul",
    zoneId: null,
    zone: null,
    creditLimit: null,
    debtBalance: "0.00",
    active: true,
    createdAt: "2026-08-21T15:00:00.000Z",
    ...overrides,
  };
}

export function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "o-1",
    customerId: "11111111-1111-4111-8111-111111111111",
    customer: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Bodega Santa Rosa",
      phone: "987654321",
    },
    deliveryDate: "2026-08-25",
    status: "PENDING",
    createdById: "u-1",
    createdAt: "2026-08-21T15:00:00.000Z",
    items: [
      {
        id: "item-1",
        productId: "p-recarga",
        product: { id: "p-recarga", name: "Recarga 20L" },
        quantity: 3,
        unitPrice: "12.50",
      },
    ],
    total: "37.50",
    ...overrides,
  };
}

export function pageOf<T>(data: T[], overrides: Partial<Page<T>> = {}): Page<T> {
  return { data, total: data.length, page: 1, limit: 20, totalPages: 1, ...overrides };
}

export const DRIVER: User = {
  id: "u-luis",
  name: "Luis Quispe",
  username: "luis",
  active: true,
  roles: ["DRIVER"],
};

export function buildStop(overrides: Partial<RouteStop> = {}): RouteStop {
  const position = overrides.position ?? 1;
  return {
    id: `stop-${position}`,
    routeId: "r-1",
    position,
    origin: "ORDER",
    locationId: "loc-1",
    location: {
      id: "loc-1",
      name: "Principal",
      address: "Av. Siempre Viva 123",
      addressReference: "Portón verde",
      phone: "987000111",
      customer: { id: "c-central", name: "Bodega Central" },
    },
    orderId: null,
    status: "PENDING",
    failureReason: null,
    correction: null,
    ...overrides,
  };
}

export function buildRoute(overrides: Partial<Route> = {}): Route {
  return {
    id: "r-1",
    date: "2026-08-28",
    driverId: DRIVER.id,
    driver: { id: DRIVER.id, name: DRIVER.name },
    zoneId: "z-norte",
    zone: { id: "z-norte", name: "Norte" },
    status: "PLANNED",
    createdById: "u-admin",
    createdAt: "2026-08-28T12:00:00.000Z",
    stops: [],
    ...overrides,
  };
}

export function buildLocation(overrides: Partial<CustomerLocation> = {}): CustomerLocation {
  return {
    id: "loc-1",
    name: "Principal",
    address: "Av. Los Álamos 452",
    addressReference: "Portón azul",
    phone: "987654321",
    isPrimary: true,
    active: true,
    ...overrides,
  };
}
