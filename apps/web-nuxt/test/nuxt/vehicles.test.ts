import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery, readBody } from "h3";
import type { H3Event } from "h3";
import type {
  Vehicle,
  VehicleReview,
  VehicleReviewType,
  VehicleReviewTypeStatus,
} from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { resetSession, signIn } from "../support/session";
import { stubWrite } from "../support/route-detail";

const cleanups: Array<() => void> = [];

const VEHICLE_1: Vehicle = {
  id: "v-1",
  plate: "ABC123",
  name: "Camión 1",
  brand: "Toyota",
  model: "Dyna",
  capacityUnits: 80,
  vehicleClass: "N2",
  circulationCardNumber: "TUC-1234",
  active: true,
  createdById: "u-admin",
  createdAt: "2026-08-28T12:00:00.000Z",
  updatedById: null,
  updatedAt: null,
};

const VEHICLE_2: Vehicle = {
  id: "v-2",
  plate: "XYZ789",
  name: "Furgoneta 2",
  brand: "Hyundai",
  model: "H100",
  capacityUnits: 40,
  vehicleClass: null,
  circulationCardNumber: null,
  active: false,
  createdById: "u-admin",
  createdAt: "2026-08-28T12:00:00.000Z",
  updatedById: null,
  updatedAt: null,
};

const REVIEW_TYPE_SOAT: VehicleReviewType = {
  id: "rt-soat",
  name: "SOAT",
  active: true,
  createdById: "u-admin",
  createdAt: "2026-08-28T12:00:00.000Z",
};

const REVIEW_TYPE_TECH: VehicleReviewType = {
  id: "rt-tech",
  name: "Revisión técnica",
  active: true,
  createdById: "u-admin",
  createdAt: "2026-08-28T12:00:00.000Z",
};

const REVIEW_TYPE_FIRE: VehicleReviewType = {
  id: "rt-fire",
  name: "Extintor",
  active: true,
  createdById: "u-admin",
  createdAt: "2026-08-28T12:00:00.000Z",
};

function stubVehicles(
  vehicleList: Vehicle[] = [VEHICLE_1, VEHICLE_2],
  reviewTypeList: VehicleReviewType[] = [REVIEW_TYPE_SOAT, REVIEW_TYPE_TECH, REVIEW_TYPE_FIRE],
) {
  cleanups.push(
    registerEndpoint("/api/v1/vehicles", {
      method: "GET",
      handler: (event: H3Event) => {
        const query = getQuery(event);
        const includeInactive = query.includeInactive === "true";
        return includeInactive ? vehicleList : vehicleList.filter((v) => v.active);
      },
    }),
  );

  cleanups.push(
    registerEndpoint("/api/v1/vehicle-review-types", {
      method: "GET",
      handler: () => reviewTypeList,
    }),
  );
}

async function renderVehiclesPage(roles: ("ADMIN" | "SELLER")[] = ["ADMIN"]) {
  cleanups.push(signIn(roles));
  await renderSuspended(App, { route: "/vehicles" });
  await screen.findByRole("heading", { name: "Vehículos", level: 1 });
}

async function rowOf(plate: string): Promise<HTMLElement> {
  const cell = await screen.findByText(plate);
  return cell.closest("tr") as HTMLElement;
}

describe("Vehículos", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("lista vehículos activos por defecto y muestra sus columnas principales", async () => {
    stubVehicles();

    await renderVehiclesPage();

    expect(await screen.findByText("ABC123")).toBeTruthy();
    const row = await rowOf("ABC123");
    expect(within(row).getByText("Camión 1")).toBeTruthy();
    expect(within(row).getByText("Toyota Dyna")).toBeTruthy();
    expect(within(row).getByText("80 bidones")).toBeTruthy();
    expect(within(row).getByText("En uso")).toBeTruthy();

    // Inactivo no aparece con el filtro "En uso"
    expect(screen.queryByText("XYZ789")).toBeNull();
  });

  it("permite a un ADMIN dar de alta un vehículo", async () => {
    stubVehicles();
    let createdBody: Record<string, unknown> | null = null;
    cleanups.push(
      registerEndpoint("/api/v1/vehicles", {
        method: "POST",
        handler: async (event: H3Event) => {
          createdBody = (await readBody(event)) as Record<string, unknown>;
          return {
            ...VEHICLE_1,
            id: "v-new",
            plate: createdBody.plate,
            name: createdBody.name,
          };
        },
      }),
    );

    await renderVehiclesPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Nuevo vehículo" }));

    await screen.findByRole("heading", { name: "Nuevo vehículo" });
    await user.type(screen.getByLabelText("Placa"), "DEF456");
    await user.type(screen.getByLabelText("Nombre / Alias"), "Camión 2");
    await user.type(screen.getByLabelText("Marca"), "Hino");
    await user.type(screen.getByLabelText("Modelo"), "Dutro");
    await user.type(screen.getByLabelText("Capacidad (bidones)"), "90");

    await user.click(screen.getByRole("button", { name: "Crear vehículo" }));

    await waitFor(() => expect(createdBody).not.toBeNull());
    expect(createdBody).toMatchObject({
      plate: "DEF456",
      name: "Camión 2",
      brand: "Hino",
      model: "Dutro",
      capacityUnits: 90,
    });
  });

  it("permite a un ADMIN editar un vehículo existente", async () => {
    stubVehicles();
    const bodies = stubWrite(cleanups, "/api/v1/vehicles/v-1", "PATCH", () => VEHICLE_1);

    await renderVehiclesPage();

    const user = userEvent.setup();
    const row = await rowOf("ABC123");
    await user.click(within(row).getByRole("button", { name: "Editar" }));

    await screen.findByRole("heading", { name: "Editar vehículo" });
    const nameInput = screen.getByLabelText("Nombre / Alias");
    await user.clear(nameInput);
    await user.type(nameInput, "Camión 1 Modificado");

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((bodies[0] as Record<string, unknown>).name).toBe("Camión 1 Modificado");
  });

  it("permite desactivar y reactivar un vehículo", async () => {
    stubVehicles();
    let patchedActive: boolean | null = null;
    cleanups.push(
      registerEndpoint("/api/v1/vehicles/v-1", {
        method: "PATCH",
        handler: async (event: H3Event) => {
          const body = (await readBody(event)) as { active: boolean };
          patchedActive = body.active;
          return { ...VEHICLE_1, active: body.active };
        },
      }),
    );

    await renderVehiclesPage();

    const user = userEvent.setup();
    const row = await rowOf("ABC123");
    await user.click(within(row).getByRole("button", { name: "Desactivar" }));

    await waitFor(() => expect(patchedActive).toBe(false));
  });

  it("la pestaña de tipos de revisión lista los tipos y permite crear uno nuevo", async () => {
    stubVehicles();
    const bodies = stubWrite(cleanups, "/api/v1/vehicle-review-types", "POST", () => ({
      id: "rt-new",
      name: "Botiquín",
      active: true,
      createdById: "u-admin",
      createdAt: "2026-08-28T12:00:00.000Z",
    }));

    await renderVehiclesPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Tipos de revisión" }));

    expect(await screen.findByText("SOAT")).toBeTruthy();
    expect(screen.getByText("Revisión técnica")).toBeTruthy();
    expect(screen.getByText("Extintor")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Nuevo tipo de revisión" }));
    await screen.findByRole("heading", { name: "Nuevo tipo de revisión" });

    await user.type(screen.getByLabelText("Nombre"), "Botiquín");
    await user.click(screen.getByRole("button", { name: "Crear tipo" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((bodies[0] as Record<string, unknown>).name).toBe("Botiquín");
  });

  it("abre el modal de revisiones de un vehículo y muestra su estado e historial", async () => {
    stubVehicles();

    const statuses: VehicleReviewTypeStatus[] = [
      {
        reviewTypeId: REVIEW_TYPE_SOAT.id,
        reviewTypeName: REVIEW_TYPE_SOAT.name,
        status: "VIGENTE",
        daysRemaining: 180,
        latestReview: {
          id: "rev-1",
          vehicleId: VEHICLE_1.id,
          reviewTypeId: REVIEW_TYPE_SOAT.id,
          reviewType: { id: REVIEW_TYPE_SOAT.id, name: REVIEW_TYPE_SOAT.name },
          startsOn: "2026-01-01",
          endsOn: "2027-01-01",
          notes: "Póliza Rimac",
          recordedById: "u-admin",
          recordedBy: { id: "u-admin", name: "Administrador" },
          createdAt: "2026-01-01T12:00:00.000Z",
          voidedAt: null,
          voidedById: null,
          voidedBy: null,
          voidReason: null,
        },
      },
      {
        reviewTypeId: REVIEW_TYPE_TECH.id,
        reviewTypeName: REVIEW_TYPE_TECH.name,
        status: "POR_VENCER",
        daysRemaining: 10,
        latestReview: null,
      },
      {
        reviewTypeId: REVIEW_TYPE_FIRE.id,
        reviewTypeName: REVIEW_TYPE_FIRE.name,
        status: "SIN_REGISTRO",
        daysRemaining: null,
        latestReview: null,
      },
    ];

    cleanups.push(
      registerEndpoint("/api/v1/vehicles/v-1/reviews-status", {
        method: "GET",
        handler: () => statuses,
      }),
    );

    const history: VehicleReview[] = [
      {
        id: "rev-1",
        vehicleId: VEHICLE_1.id,
        reviewTypeId: REVIEW_TYPE_SOAT.id,
        reviewType: { id: REVIEW_TYPE_SOAT.id, name: REVIEW_TYPE_SOAT.name },
        startsOn: "2026-01-01",
        endsOn: "2027-01-01",
        notes: "Póliza Rimac",
        recordedById: "u-admin",
        recordedBy: { id: "u-admin", name: "Administrador" },
        createdAt: "2026-01-01T12:00:00.000Z",
        voidedAt: null,
        voidedById: null,
        voidedBy: null,
        voidReason: null,
      },
    ];

    cleanups.push(
      registerEndpoint("/api/v1/vehicles/v-1/reviews", {
        method: "GET",
        handler: () => history,
      }),
    );

    await renderVehiclesPage();

    const user = userEvent.setup();
    const row = await rowOf("ABC123");
    await user.click(within(row).getByRole("button", { name: "Revisiones" }));

    expect(await screen.findByText("Revisiones: Camión 1 (ABC123)")).toBeTruthy();
    expect(screen.getByText("Vigente")).toBeTruthy();
    expect(screen.getByText("Por vencer")).toBeTruthy();
    expect(screen.getByText("Sin registro")).toBeTruthy();

    expect(screen.getByText("Póliza Rimac")).toBeTruthy();
    expect(screen.getByText("Válida")).toBeTruthy();
  });

  it("permite anular una revisión con motivo y queda auditada", async () => {
    stubVehicles();

    cleanups.push(
      registerEndpoint("/api/v1/vehicles/v-1/reviews-status", {
        method: "GET",
        handler: () => [],
      }),
    );

    const voidBodies = stubWrite(
      cleanups,
      "/api/v1/vehicles/v-1/reviews/rev-1/void",
      "PATCH",
      () => ({
        id: "rev-1",
        voidedAt: "2026-08-28T12:00:00.000Z",
        voidReason: "Error de digitación",
      }),
    );

    const history: VehicleReview[] = [
      {
        id: "rev-1",
        vehicleId: VEHICLE_1.id,
        reviewTypeId: REVIEW_TYPE_SOAT.id,
        reviewType: { id: REVIEW_TYPE_SOAT.id, name: REVIEW_TYPE_SOAT.name },
        startsOn: "2026-01-01",
        endsOn: "2027-01-01",
        notes: null,
        recordedById: "u-admin",
        recordedBy: { id: "u-admin", name: "Administrador" },
        createdAt: "2026-01-01T12:00:00.000Z",
        voidedAt: null,
        voidedById: null,
        voidedBy: null,
        voidReason: null,
      },
    ];

    cleanups.push(
      registerEndpoint("/api/v1/vehicles/v-1/reviews", {
        method: "GET",
        handler: () => history,
      }),
    );

    await renderVehiclesPage();

    const user = userEvent.setup();
    const row = await rowOf("ABC123");
    await user.click(within(row).getByRole("button", { name: "Revisiones" }));

    await screen.findByText("Revisiones: Camión 1 (ABC123)");
    await user.click(screen.getByRole("button", { name: "Anular" }));

    await screen.findByText("Anular revisión de SOAT");
    await user.type(screen.getByLabelText("Motivo de la anulación"), "Error de digitación");
    await user.click(screen.getByRole("button", { name: "Confirmar anulación" }));

    await waitFor(() => expect(voidBodies).toHaveLength(1));
    expect((voidBodies[0] as Record<string, unknown>).voidReason).toBe("Error de digitación");
  });

  it("permite registrar una nueva revisión con fecha de inicio, fin y notas", async () => {
    stubVehicles();

    cleanups.push(
      registerEndpoint("/api/v1/vehicles/v-1/reviews-status", {
        method: "GET",
        handler: () => [],
      }),
    );
    cleanups.push(
      registerEndpoint("/api/v1/vehicles/v-1/reviews", {
        method: "GET",
        handler: () => [],
      }),
    );

    const createBodies = stubWrite(cleanups, "/api/v1/vehicles/v-1/reviews", "POST", () => ({
      id: "rev-new",
      startsOn: "2026-10-12",
      endsOn: "2027-10-12",
      notes: "Póliza Pacifico 456",
      createdAt: "2026-08-28T12:00:00.000Z",
      recordedBy: { id: "u-admin", name: "Administrador" },
      reviewType: { id: REVIEW_TYPE_SOAT.id, name: REVIEW_TYPE_SOAT.name },
    }));

    await renderVehiclesPage();

    const user = userEvent.setup();
    const row = await rowOf("ABC123");
    await user.click(within(row).getByRole("button", { name: "Revisiones" }));

    await screen.findByText("Revisiones: Camión 1 (ABC123)");
    await user.click(screen.getByRole("button", { name: "Registrar revisión" }));

    await screen.findByRole("heading", { name: "Registrar nueva revisión" });
    await user.type(screen.getByLabelText("Fecha de inicio"), "2026-10-12");
    await user.type(screen.getByLabelText("Fecha de vencimiento"), "2027-10-12");
    await user.type(
      screen.getByLabelText("Notas / Observaciones (opcional)"),
      "Póliza Pacifico 456",
    );

    await user.click(screen.getByRole("button", { name: "Guardar revisión" }));

    await waitFor(() => expect(createBodies).toHaveLength(1));
    expect(createBodies[0]).toMatchObject({
      startsOn: "2026-10-12",
      endsOn: "2027-10-12",
      notes: "Póliza Pacifico 456",
    });
  });
});
