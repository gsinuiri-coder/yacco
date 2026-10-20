import { renderSuspended } from "@nuxt/test-utils/runtime";
import { screen } from "@testing-library/vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LocationPhotoImg from "~/components/LocationPhotoImg.vue";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const { createObjectURL, revokeObjectURL } = URL;

// El componente baja la foto con fetch nativo (no con $fetch) y la muestra
// como blob: registerEndpoint no la sirve.
function serveBlob(ok: boolean): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ok ? new Response(new Blob(["foto"])) : new Response(null, { status: 404 }),
    ),
  );
  URL.createObjectURL = () => "blob:foto";
  URL.revokeObjectURL = () => {};
}

describe("LocationPhotoImg", () => {
  beforeEach(() => {
    resetSession();
    cleanups.push(signIn(["ADMIN"]));
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.unstubAllGlobals();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  it("pide la foto al endpoint de la foto y la muestra con su texto alternativo", async () => {
    serveBlob(true);
    await renderSuspended(LocationPhotoImg, { props: { photoId: "photo-1" } });

    const img = await screen.findByRole("img", { name: "Foto de local" });
    expect(img.getAttribute("src")).toBe("blob:foto");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/customer-locations/photos/photo-1/raw",
      expect.anything(),
    );
  });

  it("muestra la foto entera con el texto alternativo que se le pasa", async () => {
    serveBlob(true);
    await renderSuspended(LocationPhotoImg, {
      props: { photoId: "photo-1", alt: "Fachada del local", whole: true },
    });

    expect(
      (await screen.findByRole("img", { name: "Fachada del local" })).getAttribute("src"),
    ).toBe("blob:foto");
  });

  it("avisa que la foto no está disponible si el servidor no la entrega", async () => {
    serveBlob(false);
    await renderSuspended(LocationPhotoImg, { props: { photoId: "photo-1", whole: true } });

    expect(await screen.findByText("No disponible")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
