import { setupServer } from "msw/node";

// Sin handlers por defecto: cada test declara el contrato que ejercita, así
// una petición inesperada falla en vez de responder algo genérico.
export const server = setupServer();
