import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appFile = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../app/${path}`, import.meta.url)), "utf8");

describe("shell de Nuxt UI", () => {
  it("delega el layout y su aspecto a componentes y props nativos", () => {
    const layout = appFile("layouts/default.vue");
    const page = appFile("components/AppPage.vue");

    expect(layout).toContain("<UDashboardGroup>");
    expect(layout).toContain("<UDashboardSidebar");
    expect(layout).toContain("<UNavigationMenu");
    expect(layout).toContain("<UUser");
    expect(page).toContain("<UDashboardNavbar");
    expect(page).toContain("<UDashboardToolbar");

    for (const source of [layout, page]) {
      expect(source).not.toMatch(/(?:^|\s)(?::)?class=/u);
      expect(source).not.toMatch(/(?:^|\s):ui=/u);
    }
  });
});
