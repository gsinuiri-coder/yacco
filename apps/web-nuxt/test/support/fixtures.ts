import type { Customer, Page } from "@yacco/shared";

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

export function pageOf<T>(data: T[], overrides: Partial<Page<T>> = {}): Page<T> {
  return { data, total: data.length, page: 1, limit: 20, totalPages: 1, ...overrides };
}
