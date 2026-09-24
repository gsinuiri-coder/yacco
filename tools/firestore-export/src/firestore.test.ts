import type { App, AppOptions, Credential } from "firebase-admin/app";
import { describe, expect, it, vi } from "vitest";
import {
  CREDENTIALS_ENV,
  DEFAULT_PROJECT_ID,
  PROJECT_ENV,
  connectFirestore,
  readOnly,
  redactCredentials,
  resolveProjectId,
} from "./firestore.js";
import type { FirebaseAdminLike, FirestoreReadSource } from "./firestore.js";

const WRITE_METHODS = ["set", "add", "update", "delete", "create", "batch", "runTransaction"];

/**
 * Un Firestore falso que, como el real, TIENE métodos de escritura en cada
 * nivel: el adaptador de solo lectura no debe dejar alcanzar ninguno.
 */
function writableFake(): FirestoreReadSource & { writes: string[] } {
  const writes: string[] = [];
  const writeMethods = () =>
    Object.fromEntries(WRITE_METHODS.map((method) => [method, () => writes.push(method)]));
  const collection = (docs: Array<{ id: string; fields?: Record<string, unknown> }>) => ({
    ...writeMethods(),
    get: () =>
      Promise.resolve({
        docs: docs.map((doc) => ({
          id: doc.id,
          data: () => doc.fields,
          ref: {
            ...writeMethods(),
            collection: () => collection([{ id: `${doc.id}-pay`, fields: { amount: 5 } }]),
          },
        })),
      }),
  });
  return {
    writes,
    ...writeMethods(),
    collection: (name: string) =>
      collection([{ id: `${name}-1`, fields: { total: 10 } }, { id: "vacio" }]),
  } as FirestoreReadSource & { writes: string[] };
}

function fakeAdmin(source: FirestoreReadSource = writableFake()) {
  const credential = { getAccessToken: vi.fn() } as unknown as Credential;
  const init: AppOptions[] = [];
  const admin: FirebaseAdminLike = {
    applicationDefault: () => credential,
    initializeApp: (options) => {
      init.push(options);
      return {} as App;
    },
    getFirestore: () => source,
  };
  return { admin, init, credential };
}

describe("readOnly", () => {
  it("deja leer colecciones, documentos y subcolecciones, y nada más", async () => {
    const source = writableFake();
    const firestore = readOnly(source);

    const snapshot = await firestore.collection("vouchers").get();
    const [first, empty] = snapshot.docs;
    const pays = await first!.ref.collection("debtPays").get();

    expect(first!.id).toBe("vouchers-1");
    expect(first!.data()).toEqual({ total: 10 });
    // Un documento sin campos se lee como un objeto vacío, no como undefined.
    expect(empty!.data()).toEqual({});
    expect(pays.docs[0]!.data()).toEqual({ amount: 5 });

    // Ningún objeto que el script ve tiene un método de escritura.
    for (const exposed of [firestore, firestore.collection("vouchers"), first!, first!.ref]) {
      for (const method of WRITE_METHODS) expect(exposed).not.toHaveProperty(method);
    }
    expect(source.writes).toEqual([]);
  });
});

describe("connectFirestore", () => {
  it("por defecto usa las credenciales de gcloud (ADC) y el proyecto del sistema viejo", async () => {
    const { admin, init, credential } = fakeAdmin();

    const firestore = connectFirestore({ env: {}, admin });

    expect(init).toEqual([{ credential, projectId: DEFAULT_PROJECT_ID }]);
    expect((await firestore.collection("customers").get()).docs).toHaveLength(2);
  });

  it("el proyecto se puede cambiar por argumento o por variable de entorno", () => {
    const { admin, init } = fakeAdmin();

    connectFirestore({ env: { [PROJECT_ENV]: "otro-env" }, projectId: "otro-arg", admin });
    connectFirestore({ env: { [PROJECT_ENV]: "otro-env" }, admin });

    expect(init.map((options) => options.projectId)).toEqual(["otro-arg", "otro-env"]);
  });

  it("con GOOGLE_APPLICATION_CREDENTIALS apuntando a un archivo que no existe, corta sin nombrar la ruta", () => {
    const { admin, init } = fakeAdmin();
    const secretPath = "C:/privado/llave-secreta.json";

    const attempt = () =>
      connectFirestore({ env: { [CREDENTIALS_ENV]: secretPath }, admin, fileExists: () => false });

    expect(attempt).toThrow(/no existe/);
    expect(attempt).not.toThrow(/llave-secreta/);
    expect(init).toEqual([]);
  });

  it("con GOOGLE_APPLICATION_CREDENTIALS a un archivo que existe, sigue por ADC", () => {
    const { admin, init } = fakeAdmin();

    connectFirestore({
      env: { [CREDENTIALS_ENV]: "C:/privado/llave.json" },
      admin,
      fileExists: () => true,
    });

    expect(init).toHaveLength(1);
  });
});

describe("resolveProjectId", () => {
  it("una variable vacía cuenta como ausente", () => {
    expect(resolveProjectId(undefined, { [PROJECT_ENV]: "  " })).toBe(DEFAULT_PROJECT_ID);
  });
});

describe("redactCredentials", () => {
  it("tacha la ruta de credenciales de un mensaje, y sin variable lo deja igual", () => {
    const env = { [CREDENTIALS_ENV]: "C:/privado/llave.json" };
    expect(redactCredentials("The file at C:/privado/llave.json is bad", env)).toBe(
      `The file at <${CREDENTIALS_ENV}> is bad`,
    );
    expect(redactCredentials("sin ruta", {})).toBe("sin ruta");
  });
});
