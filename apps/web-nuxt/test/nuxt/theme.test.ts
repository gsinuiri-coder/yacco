import { describe, expect, it } from "vitest";

describe("tema", () => {
  it("Nuxt UI usa las paletas propias de Yacco, no los defaults", () => {
    const { ui } = useAppConfig();

    expect(ui.colors).toMatchObject({
      primary: "lagoon",
      secondary: "ochre",
      neutral: "basalt",
    });
  });
});
