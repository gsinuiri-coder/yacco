import { renderSuspended } from "@nuxt/test-utils/runtime";
import { screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import App from "~/app.vue";

describe("esqueleto", () => {
  it("la app levanta y muestra la portada con su título", async () => {
    await renderSuspended(App, { route: "/" });

    expect(screen.getByRole("heading", { level: 1, name: "Yacco" })).toBeTruthy();
    expect(screen.getByText("Planta de agua")).toBeTruthy();
  });
});
