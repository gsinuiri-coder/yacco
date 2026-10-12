import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { readBody, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import type {
  CustomerContact,
  CustomerLocationCoordinateRequest,
  CustomerLocationPhoto,
  Zone,
} from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import CustomerContactsSection from "~/components/CustomerContactsSection.vue";
import CustomerLocationPhotos from "~/components/CustomerLocationPhotos.vue";
import { buildCustomer } from "../support/fixtures";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "loc-primary";

function endpoint(...args: Parameters<typeof registerEndpoint>) {
  cleanups.push(registerEndpoint(...args));
}

function stubZones(zones: Zone[] = []) {
  endpoint("/api/v1/zones", () => zones);
}

describe("Documentos, contactos, fotos y aprobaciones", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn(["ADMIN"]));
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  describe("documentos del cliente en el formulario", () => {
    it("permite ingresar RUC, razón social y dirección fiscal, y los envía en el POST", async () => {
      stubZones([]);
      const bodies: unknown[] = [];
      endpoint("/api/v1/customers", {
        method: "POST",
        handler: async (event: H3Event) => {
          const body = await readBody(event);
          bodies.push(body);
          setResponseStatus(event, 201);
          return buildCustomer({
            documentType: "RUC",
            documentNumber: "20123456789",
            legalName: "Inversiones del Sol SAC",
            fiscalAddress: "Av. Industrial 500",
          });
        },
      });
      endpoint("/api/v1/customers", {
        method: "GET",
        handler: () => ({
          data: [],
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 0,
        }),
      });

      const user = userEvent.setup();
      await renderSuspended(App, { route: "/customers/new" });

      await user.type(await screen.findByLabelText("Nombre"), "Bodega del Sol");
      await user.type(screen.getByLabelText("Teléfono"), "987111222");
      await user.type(screen.getByLabelText("Dirección"), "Av. Las Lomas 123");
      await user.type(screen.getByLabelText("Referencia"), "Frente al parque");

      // Datos tributarios
      await user.click(screen.getByLabelText("Tipo de documento"));
      await user.click(await screen.findByRole("option", { name: "RUC" }));
      await user.type(screen.getByLabelText("Número de documento"), "20123456789");
      await user.type(screen.getByLabelText(/Razón social/), "Inversiones del Sol SAC");
      await user.type(screen.getByLabelText("Dirección fiscal"), "Av. Industrial 500");

      await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0]).toMatchObject({
        name: "Bodega del Sol",
        phone: "987111222",
        documentType: "RUC",
        documentNumber: "20123456789",
        legalName: "Inversiones del Sol SAC",
        fiscalAddress: "Av. Industrial 500",
      });
    });

    it("valida longitud de RUC antes de enviar", async () => {
      stubZones([]);
      const bodies: unknown[] = [];
      endpoint("/api/v1/customers", {
        method: "POST",
        handler: async (event: H3Event) => {
          bodies.push(await readBody(event));
          return buildCustomer();
        },
      });

      const user = userEvent.setup();
      await renderSuspended(App, { route: "/customers/new" });

      await user.type(await screen.findByLabelText("Nombre"), "Bodega Prueba");
      await user.type(screen.getByLabelText("Teléfono"), "987111222");
      await user.type(screen.getByLabelText("Dirección"), "Av. Las Lomas 123");
      await user.type(screen.getByLabelText("Referencia"), "Frente al parque");

      await user.click(screen.getByLabelText("Tipo de documento"));
      await user.click(await screen.findByRole("option", { name: "RUC" }));
      await user.type(screen.getByLabelText("Número de documento"), "12345"); // Corto

      await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

      expect(await screen.findByText("El RUC debe tener 11 dígitos")).toBeTruthy();
      expect(bodies).toHaveLength(0);
    });

    it("muestra advertencia toast si la API responde con duplicateDocumentWarning sin bloquear", async () => {
      stubZones([]);
      endpoint("/api/v1/customers", {
        method: "POST",
        handler: (event: H3Event) => {
          setResponseStatus(event, 201);
          return {
            ...buildCustomer({ documentType: "DNI", documentNumber: "45678901" }),
            duplicateDocumentWarning: "El documento DNI 45678901 ya pertenece a Bodega Central",
          };
        },
      });
      endpoint("/api/v1/customers", {
        method: "GET",
        handler: () => ({
          data: [],
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 0,
        }),
      });

      const user = userEvent.setup();
      await renderSuspended(App, { route: "/customers/new" });

      await user.type(await screen.findByLabelText("Nombre"), "Bodega Hermanos");
      await user.type(screen.getByLabelText("Teléfono"), "987111222");
      await user.type(screen.getByLabelText("Dirección"), "Av. Las Lomas 123");
      await user.type(screen.getByLabelText("Referencia"), "Frente al parque");

      await user.click(screen.getByLabelText("Tipo de documento"));
      await user.click(await screen.findByRole("option", { name: "DNI" }));
      await user.type(screen.getByLabelText("Número de documento"), "45678901");

      await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

      expect(
        await screen.findByText("El documento DNI 45678901 ya pertenece a Bodega Central"),
      ).toBeTruthy();
    });
  });

  describe("gestión de contactos (CustomerContactsSection)", () => {
    const contactList: CustomerContact[] = [
      {
        id: "c-1",
        customerId: CUSTOMER_ID,
        name: "Carlos Gómez",
        phone: "911222333",
        active: true,
        createdById: "u-1",
        removedById: null,
        removedAt: null,
        createdAt: "2026-10-01T10:00:00.000Z",
      },
      {
        id: "c-2",
        customerId: CUSTOMER_ID,
        name: "María Flores",
        phone: null,
        active: true,
        createdById: "u-1",
        removedById: null,
        removedAt: null,
        createdAt: "2026-10-02T10:00:00.000Z",
      },
    ];

    it("muestra la lista de contactos con sus teléfonos o 'Sin teléfono'", async () => {
      endpoint(`/api/v1/customers/${CUSTOMER_ID}/contacts`, () => contactList);

      await renderSuspended(CustomerContactsSection, {
        props: { customerId: CUSTOMER_ID, canEdit: true },
      });

      expect(await screen.findByText("Carlos Gómez")).toBeTruthy();
      expect(screen.getByText("911222333")).toBeTruthy();
      expect(screen.getByText("María Flores")).toBeTruthy();
      expect(screen.getByText("Sin teléfono")).toBeTruthy();
    });

    it("permite agregar un nuevo contacto", async () => {
      let contacts = [...contactList];
      const bodies: unknown[] = [];
      endpoint(`/api/v1/customers/${CUSTOMER_ID}/contacts`, {
        method: "GET",
        handler: () => contacts,
      });
      endpoint(`/api/v1/customers/${CUSTOMER_ID}/contacts`, {
        method: "POST",
        handler: async (event: H3Event) => {
          const body = (await readBody(event)) as { name: string; phone?: string };
          bodies.push(body);
          const newContact: CustomerContact = {
            id: "c-3",
            customerId: CUSTOMER_ID,
            name: body.name,
            phone: body.phone ?? null,
            active: true,
            createdById: "u-1",
            removedById: null,
            removedAt: null,
            createdAt: "2026-10-12T10:00:00.000Z",
          };
          contacts = [...contacts, newContact];
          setResponseStatus(event, 201);
          return newContact;
        },
      });

      const user = userEvent.setup();
      await renderSuspended(CustomerContactsSection, {
        props: { customerId: CUSTOMER_ID, canEdit: true },
      });

      await user.click(await screen.findByRole("button", { name: "Agregar contacto" }));
      await user.type(screen.getByLabelText("Nombre"), "Lucía Rojas");
      await user.type(screen.getByLabelText("Teléfono (opcional)"), "955666777");
      await user.click(screen.getByRole("button", { name: "Guardar contacto" }));

      await waitFor(() => expect(screen.getByText("Lucía Rojas")).toBeTruthy());
      expect(bodies).toEqual([{ name: "Lucía Rojas", phone: "955666777" }]);
    });

    it("permite quitar un contacto", async () => {
      let contacts = [...contactList];
      let deletedId: string | null = null;
      endpoint(`/api/v1/customers/${CUSTOMER_ID}/contacts`, {
        method: "GET",
        handler: () => contacts,
      });
      endpoint(`/api/v1/customers/${CUSTOMER_ID}/contacts/c-1`, {
        method: "DELETE",
        handler: (event: H3Event) => {
          deletedId = "c-1";
          contacts = contacts.filter((c) => c.id !== "c-1");
          setResponseStatus(event, 204);
          return null;
        },
      });

      const user = userEvent.setup();
      await renderSuspended(CustomerContactsSection, {
        props: { customerId: CUSTOMER_ID, canEdit: true },
      });

      const items = await screen.findAllByRole("button", { name: "Quitar" });
      await user.click(items[0]!);

      await waitFor(() => expect(deletedId).toBe("c-1"));
      await waitFor(() => expect(screen.queryByText("Carlos Gómez")).toBeNull());
    });
  });

  describe("fotos de locales (CustomerLocationPhotos)", () => {
    const photoList: CustomerLocationPhoto[] = [
      {
        id: "photo-1",
        locationId: LOCATION_ID,
        objectKey: "photos/p1.jpg",
        contentType: "image/jpeg",
        sizeBytes: 1024,
        status: "APPROVED",
        hiddenAt: null,
        hiddenById: null,
        hiddenReason: null,
        uploadedById: "u-1",
        reviewedById: null,
        reviewedAt: null,
        rejectionReason: null,
        createdAt: "2026-10-05T12:00:00.000Z",
        uploadedBy: { id: "u-1", name: "Admin Principal" },
      },
    ];

    it("renderiza la lista de fotos y permite verla en grande", async () => {
      endpoint(`/api/v1/customer-locations/${LOCATION_ID}/photos`, () => photoList);
      endpoint("/api/v1/customer-locations/photos/photo-1", () => new ArrayBuffer(8));

      const user = userEvent.setup();
      await renderSuspended(CustomerLocationPhotos, {
        props: {
          locationId: LOCATION_ID,
          locationName: "Local Centro",
          isAdmin: true,
          canUpload: true,
        },
      });

      expect(await screen.findByText("Fotos del local (1/10)")).toBeTruthy();
      const card = screen.getByText("Ver en grande").closest("div");
      await user.click(card!);

      // Abre el modal
      expect(await screen.findByText("Foto del local")).toBeTruthy();
      expect(screen.getByText("Admin Principal")).toBeTruthy();
    });

    it("permite a un ADMIN ocultar una foto con motivo obligatorio", async () => {
      let photos = [...photoList];
      const patchBodies: unknown[] = [];
      endpoint(`/api/v1/customer-locations/${LOCATION_ID}/photos`, {
        method: "GET",
        handler: () => photos,
      });
      endpoint("/api/v1/customer-locations/photos/photo-1", () => new ArrayBuffer(8));
      endpoint("/api/v1/customer-locations/photos/photo-1/hide", {
        method: "PATCH",
        handler: async (event: H3Event) => {
          patchBodies.push(await readBody(event));
          photos = [];
          return { ...photoList[0], hiddenAt: new Date().toISOString() };
        },
      });

      const user = userEvent.setup();
      await renderSuspended(CustomerLocationPhotos, {
        props: {
          locationId: LOCATION_ID,
          locationName: "Local Centro",
          isAdmin: true,
          canUpload: true,
        },
      });

      await user.click(await screen.findByRole("button", { name: "Ocultar foto" }));

      // Abre modal ocultar
      expect(await screen.findByRole("heading", { name: "Ocultar foto" })).toBeTruthy();
      const modal = screen.getByRole("dialog");

      // Submit sin motivo -> falla
      const submitBtn = within(modal).getByRole("button", { name: "Ocultar foto" });
      await user.click(submitBtn);
      expect((await within(modal).findByRole("alert")).textContent).toContain(
        "El motivo para ocultar la foto es obligatorio",
      );
      expect(patchBodies).toHaveLength(0);

      // Ingresa motivo y envía
      await user.type(
        within(modal).getByLabelText("Motivo para ocultar"),
        "Fachada pintada de otro color",
      );
      await user.click(submitBtn);

      await waitFor(() => expect(patchBodies).toHaveLength(1));
      expect(patchBodies[0]).toEqual({ reason: "Fachada pintada de otro color" });
    });
  });

  describe("bandeja de pendientes (pending-approvals)", () => {
    const pendingPhotos: CustomerLocationPhoto[] = [
      {
        id: "photo-pending-1",
        locationId: LOCATION_ID,
        objectKey: "photos/p2.jpg",
        contentType: "image/jpeg",
        sizeBytes: 1024,
        status: "PENDING",
        hiddenAt: null,
        hiddenById: null,
        hiddenReason: null,
        uploadedById: "u-driver",
        reviewedById: null,
        reviewedAt: null,
        rejectionReason: null,
        createdAt: "2026-10-10T14:00:00.000Z",
        location: {
          id: LOCATION_ID,
          name: "Bodega El Carmen",
          customer: { id: CUSTOMER_ID, name: "Carmen Rosa" },
        },
        uploadedBy: { id: "u-driver", name: "Luis Chofer" },
      },
    ];

    const pendingCoordinates: CustomerLocationCoordinateRequest[] = [
      {
        id: "coord-req-1",
        locationId: LOCATION_ID,
        latitude: "-12.046374",
        longitude: "-77.042793",
        accuracyM: "15.00",
        status: "PENDING",
        rejectionReason: null,
        previousLatitude: "-12.000000",
        previousLongitude: "-77.000000",
        requestedById: "u-driver",
        reviewedById: null,
        reviewedAt: null,
        createdAt: "2026-10-10T14:30:00.000Z",
        location: {
          id: LOCATION_ID,
          name: "Bodega El Carmen",
          customer: { id: CUSTOMER_ID, name: "Carmen Rosa" },
        },
        requestedBy: { id: "u-driver", name: "Luis Chofer" },
      },
    ];

    it("aprueba una foto pendiente", async () => {
      let photos = [...pendingPhotos];
      const reviewBodies: unknown[] = [];
      endpoint("/api/v1/pending-approvals", () => ({
        photos,
        coordinateRequests: [],
      }));
      endpoint("/api/v1/customer-locations/photos/photo-pending-1", () => new ArrayBuffer(8));
      endpoint("/api/v1/customer-locations/photos/photo-pending-1/review", {
        method: "PATCH",
        handler: async (event: H3Event) => {
          reviewBodies.push(await readBody(event));
          photos = [];
          return { ...pendingPhotos[0], status: "APPROVED" };
        },
      });

      const user = userEvent.setup();
      await renderSuspended(App, { route: "/pending-approvals" });

      expect(await screen.findByText("Fotos por aprobar (1)")).toBeTruthy();
      expect(screen.getByText("Bodega El Carmen")).toBeTruthy();
      expect(screen.getByText(/Luis Chofer/)).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Aprobar" }));

      await waitFor(() => expect(reviewBodies).toHaveLength(1));
      expect(reviewBodies[0]).toEqual({ status: "APPROVED" });
      await waitFor(() => expect(screen.getByText("Bandeja al día")).toBeTruthy());
    });

    it("rechaza una foto pendiente con motivo obligatorio", async () => {
      let photos = [...pendingPhotos];
      const reviewBodies: unknown[] = [];
      endpoint("/api/v1/pending-approvals", () => ({
        photos,
        coordinateRequests: [],
      }));
      endpoint("/api/v1/customer-locations/photos/photo-pending-1", () => new ArrayBuffer(8));
      endpoint("/api/v1/customer-locations/photos/photo-pending-1/review", {
        method: "PATCH",
        handler: async (event: H3Event) => {
          reviewBodies.push(await readBody(event));
          photos = [];
          return { ...pendingPhotos[0], status: "REJECTED" };
        },
      });

      const user = userEvent.setup();
      await renderSuspended(App, { route: "/pending-approvals" });

      await user.click(await screen.findByRole("button", { name: "Rechazar" }));
      expect(await screen.findByRole("heading", { name: "Rechazar solicitud" })).toBeTruthy();
      const modal = screen.getByRole("dialog");

      // Submit sin motivo -> falla
      const submitBtn = within(modal).getByRole("button", { name: "Rechazar solicitud" });
      await user.click(submitBtn);
      expect((await within(modal).findByRole("alert")).textContent).toContain(
        "El motivo de rechazo es obligatorio",
      );
      expect(reviewBodies).toHaveLength(0);

      // Ingresa motivo y envía
      await user.type(within(modal).getByLabelText("Motivo de rechazo"), "Foto desenfocada");
      await user.click(submitBtn);

      await waitFor(() => expect(reviewBodies).toHaveLength(1));
      expect(reviewBodies[0]).toEqual({ status: "REJECTED", rejectionReason: "Foto desenfocada" });
    });

    it("aprueba una solicitud de coordenadas y muestra enlaces a Google Maps", async () => {
      let coords = [...pendingCoordinates];
      const reviewBodies: unknown[] = [];
      endpoint("/api/v1/pending-approvals", () => ({
        photos: [],
        coordinateRequests: coords,
      }));
      endpoint("/api/v1/customer-locations/coordinate-requests/coord-req-1/review", {
        method: "PATCH",
        handler: async (event: H3Event) => {
          reviewBodies.push(await readBody(event));
          coords = [];
          return { ...pendingCoordinates[0], status: "APPROVED" };
        },
      });

      const user = userEvent.setup();
      await renderSuspended(App, { route: "/pending-approvals" });

      expect(await screen.findByText("Ubicaciones por aprobar (1)")).toBeTruthy();
      expect(screen.getByText("-12.046374, -77.042793")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Ver propuesta en Maps" }).getAttribute("href")).toBe(
        "https://www.google.com/maps?q=-12.046374,-77.042793",
      );

      await user.click(screen.getByRole("button", { name: "Aprobar" }));

      await waitFor(() => expect(reviewBodies).toHaveLength(1));
      expect(reviewBodies[0]).toEqual({ status: "APPROVED" });
      await waitFor(() => expect(screen.getByText("Bandeja al día")).toBeTruthy());
    });

    it("rechaza una solicitud de coordenadas con motivo", async () => {
      let coords = [...pendingCoordinates];
      const reviewBodies: unknown[] = [];
      endpoint("/api/v1/pending-approvals", () => ({
        photos: [],
        coordinateRequests: coords,
      }));
      endpoint("/api/v1/customer-locations/coordinate-requests/coord-req-1/review", {
        method: "PATCH",
        handler: async (event: H3Event) => {
          reviewBodies.push(await readBody(event));
          coords = [];
          return { ...pendingCoordinates[0], status: "REJECTED" };
        },
      });

      const user = userEvent.setup();
      await renderSuspended(App, { route: "/pending-approvals" });

      await user.click(await screen.findByRole("button", { name: "Rechazar" }));
      await user.type(
        await screen.findByLabelText("Motivo de rechazo"),
        "Coordenadas tomadas en la esquina equivocada",
      );
      await user.click(screen.getByRole("button", { name: "Rechazar solicitud" }));

      await waitFor(() => expect(reviewBodies).toHaveLength(1));
      expect(reviewBodies[0]).toEqual({
        status: "REJECTED",
        rejectionReason: "Coordenadas tomadas en la esquina equivocada",
      });
    });
  });
});
