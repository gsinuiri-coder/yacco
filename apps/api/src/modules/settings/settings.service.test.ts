import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { SettingsService } from "./settings.service.js";

async function buildService(environment: Record<string, string | undefined>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      SettingsService,
      { provide: ConfigService, useValue: { get: (key: string) => environment[key] } },
    ],
  }).compile();
  return moduleRef.get(SettingsService);
}

describe("SettingsService.plantLocation", () => {
  it("returns the configured coordinates without converting their decimal strings", async () => {
    const service = await buildService({
      PLANT_LATITUDE: "-12.046374",
      PLANT_LONGITUDE: "-77.042793",
    });

    expect(service.plantLocation()).toEqual({
      latitude: "-12.046374",
      longitude: "-77.042793",
    });
  });

  it("returns a nullable pair while the plant location is not configured", async () => {
    const service = await buildService({});

    expect(service.plantLocation()).toEqual({ latitude: null, longitude: null });
  });
});

describe("SettingsService.locationTracking", () => {
  it("defaults to every 5 minutes when nothing is configured", async () => {
    const service = await buildService({});

    expect(service.locationTracking()).toEqual({ intervalSeconds: 300 });
  });

  it("returns the configured interval, so changing it needs no new app", async () => {
    const service = await buildService({ LOCATION_INTERVAL_SECONDS: "120" });

    expect(service.locationTracking()).toEqual({ intervalSeconds: 120 });
  });
});
