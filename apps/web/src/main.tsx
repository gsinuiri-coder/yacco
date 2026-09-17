import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app";
import { cutoverTarget } from "./lib/cutover";
import "./styles.css";

// Antes de montar nada: en el host viejo de Render no se renderiza la app,
// se la manda a producción en Vercel (D-019). replace() y no assign(): el
// botón «atrás» no tiene que volver a caer en la redirección.
const redirectTo = cutoverTarget(globalThis.location);
if (redirectTo !== null) {
  globalThis.location.replace(redirectTo);
} else {
  mount();
}

function mount(): void {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Falta el elemento #root en index.html");
  }

  createRoot(container).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}
