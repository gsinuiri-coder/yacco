import { existsSync } from "node:fs";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import type { App, AppOptions, Credential } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { CollectionLike, DocumentLike, FirestoreLike } from "./export.js";

export const CREDENTIALS_ENV = "GOOGLE_APPLICATION_CREDENTIALS";
export const PROJECT_ENV = "YACCO_FIRESTORE_PROJECT";
/** El proyecto de Firebase del sistema viejo. */
export const DEFAULT_PROJECT_ID = "yacco-2026";

/** Lo que este archivo usa de firebase-admin, para poder probarlo sin red. */
export interface FirebaseAdminLike {
  applicationDefault(): Credential;
  initializeApp(options: AppOptions): App;
  getFirestore(app: App): FirestoreReadSource;
}

/**
 * La forma en que se lee un Firestore real. Solo se declaran lecturas: el
 * adaptador de abajo es lo único que el resto del script ve, y no expone ni
 * `set`, ni `add`, ni `update`, ni `delete`, ni `batch`.
 */
export interface FirestoreReadSource {
  collection(name: string): {
    get(): Promise<{
      docs: Array<{
        id: string;
        data(): Record<string, unknown> | undefined;
        ref: { collection(name: string): unknown };
      }>;
    }>;
  };
}

const REAL_ADMIN: FirebaseAdminLike = {
  applicationDefault,
  initializeApp,
  getFirestore: (app) => getFirestore(app) as unknown as FirestoreReadSource,
};

export interface ConnectOptions {
  env?: NodeJS.ProcessEnv;
  /** `--project`; si no viene, la variable de entorno y después el default. */
  projectId?: string | undefined;
  admin?: FirebaseAdminLike;
  fileExists?: (path: string) => boolean;
}

/** El proyecto a leer: el argumento, la variable de entorno, o el del sistema viejo. */
export function resolveProjectId(projectId: string | undefined, env: NodeJS.ProcessEnv): string {
  const fromEnv = env[PROJECT_ENV]?.trim();
  return projectId ?? (fromEnv === undefined || fromEnv === "" ? DEFAULT_PROJECT_ID : fromEnv);
}

/**
 * Abre Firestore con las **credenciales por defecto de la aplicación** (ADC):
 * las que deja `gcloud auth application-default login`, sin bajar ninguna llave
 * de larga vida. Si `GOOGLE_APPLICATION_CREDENTIALS` está puesta, ADC usa ese
 * archivo en su lugar; acá solo se comprueba que exista, para cortar con un
 * mensaje claro. Ni la ruta ni el contenido se imprimen nunca, tampoco en un
 * error.
 */
export function connectFirestore(options: ConnectOptions = {}): FirestoreLike {
  const env = options.env ?? process.env;
  const admin = options.admin ?? REAL_ADMIN;
  const fileExists = options.fileExists ?? existsSync;

  const credentialsPath = env[CREDENTIALS_ENV]?.trim();
  if (credentialsPath !== undefined && credentialsPath !== "" && !fileExists(credentialsPath)) {
    throw new Error(
      `El archivo indicado en ${CREDENTIALS_ENV} no existe. Revisa la ruta, o quita la variable ` +
        "para usar las credenciales de gcloud (ver README: «Credenciales»).",
    );
  }

  const app = admin.initializeApp({
    credential: admin.applicationDefault(),
    projectId: resolveProjectId(options.projectId, env),
  });
  return readOnly(admin.getFirestore(app));
}

/**
 * Envuelve un Firestore real y deja pasar SOLO lecturas: `collection(n).get()`
 * y, por cada documento, `id`, `data()` y `ref.collection(n).get()`. Lo que
 * devuelve son objetos nuevos, así que desde el resto del script no se alcanza
 * ningún método de escritura del SDK aunque alguien lo intente.
 */
export function readOnly(source: FirestoreReadSource): FirestoreLike {
  const collectionOf = (collection: ReturnType<FirestoreReadSource["collection"]>) => {
    const wrapped: CollectionLike = {
      get: async () => {
        const snapshot = await collection.get();
        return {
          docs: snapshot.docs.map((doc): DocumentLike => ({
            id: doc.id,
            data: () => doc.data() ?? {},
            ref: {
              collection: (name) =>
                collectionOf(
                  doc.ref.collection(name) as ReturnType<FirestoreReadSource["collection"]>,
                ),
            },
          })),
        };
      },
    };
    return wrapped;
  };
  return { collection: (name) => collectionOf(source.collection(name)) };
}

/**
 * Saca de un mensaje de error cualquier aparición de la ruta de credenciales:
 * un error del SDK podría nombrar el archivo.
 */
export function redactCredentials(message: string, env: NodeJS.ProcessEnv = process.env): string {
  const credentialsPath = env[CREDENTIALS_ENV]?.trim();
  if (credentialsPath === undefined || credentialsPath === "") return message;
  return message.split(credentialsPath).join(`<${CREDENTIALS_ENV}>`);
}
