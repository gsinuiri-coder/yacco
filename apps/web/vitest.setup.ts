import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./src/test/server";

// MSW arbitra todas las peticiones de los tests: `error` en peticiones no
// declaradas obliga a que cada test explicite el contrato que espera.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => server.close());
