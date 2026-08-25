import { existsSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";

export const CREDENTIALS_ENV = "GOOGLE_APPLICATION_CREDENTIALS";

/**
 * Opens the connection from the service-account file named by
 * GOOGLE_APPLICATION_CREDENTIALS. The variable's VALUE is a path on this
 * machine and the file holds a private key: neither the path, nor its
 * contents, nor any fragment of it is ever printed — not on success, not in
 * an error. If it is missing, the message says how to set it and stops.
 */
export function connectFirestore(env: NodeJS.ProcessEnv = process.env): Firestore {
  const credentialsPath = env[CREDENTIALS_ENV];
  if (credentialsPath === undefined || credentialsPath.trim() === "") {
    throw new Error(
      `Falta la variable ${CREDENTIALS_ENV}. Debe apuntar al archivo JSON del service account ` +
        "de Firebase (ver README: «Credenciales»). Ejemplo en PowerShell:\n" +
        `  $env:${CREDENTIALS_ENV} = "C:\\ruta\\privada\\serviceAccount.json"`,
    );
  }
  if (!existsSync(credentialsPath)) {
    // Deliberately does not echo the path: it may reveal where keys are kept.
    throw new Error(
      `El archivo indicado en ${CREDENTIALS_ENV} no existe. Revisa la ruta (ver README: «Credenciales»).`,
    );
  }
  const app = initializeApp({ credential: cert(credentialsPath) });
  return getFirestore(app);
}
