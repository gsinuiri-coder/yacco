import { cleanup, configure } from "@testing-library/vue";
import { afterEach } from "vitest";

// La primera pantalla de cada archivo carga sus componentes en frío: el
// segundo por defecto de findBy* no alcanza en una máquina cargada de CI.
configure({ asyncUtilTimeout: 5_000 });

// Sin `globals: true`, Testing Library no desmonta solo entre tests y cada
// render se acumula sobre el anterior.
afterEach(() => {
  cleanup();
});
