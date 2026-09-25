import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, UsageError } from "./args.js";
import type { CliArgs } from "./args.js";
import { exportCustomers, exportVouchers } from "./export.js";
import type { FirestoreLike } from "./export.js";
import { connectFirestore, redactCredentials } from "./firestore.js";
import { toCustomerTags } from "./tags.js";

/**
 * Lo que la CLI toca del mundo de afuera, inyectado para poder probarla sin
 * disco, sin red y sin argv reales.
 */
export interface CliDeps {
  connect(args: CliArgs): FirestoreLike;
  mkdir(dir: string): void;
  writeFile(file: string, contents: string): void;
  log(message: string): void;
  error(message: string): void;
  env: NodeJS.ProcessEnv;
}

export const REAL_DEPS: CliDeps = {
  connect: (args) => connectFirestore({ projectId: args.projectId }),
  mkdir: (dir) => mkdirSync(dir, { recursive: true }),
  writeFile: (file, contents) => writeFileSync(file, contents, "utf8"),
  log: (message) => console.log(message),
  error: (message) => console.error(message),
  env: process.env,
};

/**
 * Herramienta de un solo uso que Giancarlo corre en SU máquina para sacar una
 * foto del sistema viejo. No es parte de la API ni del web; el cargador del
 * padrón lee los archivos que esto escribe y nunca habla con Firestore. La
 * consola solo muestra CUENTAS: nunca un documento, un nombre, un teléfono ni
 * una deuda. Devuelve el código de salida.
 */
export async function run(argv: string[], deps: CliDeps = REAL_DEPS): Promise<number> {
  try {
    const args = parseArgs(argv);
    const firestore = deps.connect(args);
    deps.mkdir(args.outDir);

    if (args.command === "customers") {
      const customers = await exportCustomers(firestore);
      const file = join(args.outDir, "customers.json");
      deps.writeFile(file, JSON.stringify(customers, null, 2));
      deps.log(`customers: ${customers.length} documentos exportados -> ${file}`);
      return 0;
    }

    if (args.command === "tags") {
      const customers = toCustomerTags(await exportCustomers(firestore));
      const file = join(args.outDir, "tags.json");
      deps.writeFile(file, JSON.stringify(customers, null, 2));
      const tagged = customers.filter((customer) => customer.tags.length > 0).length;
      deps.log(`tags: ${customers.length} clientes, ${tagged} con etiquetas -> ${file}`);
      return 0;
    }

    const { vouchers, scanned } = await exportVouchers(firestore, {
      pendingOnly: args.pendingOnly,
    });
    const file = join(args.outDir, "vouchers.json");
    deps.writeFile(file, JSON.stringify(vouchers, null, 2));
    const debtPays = vouchers.reduce((sum, voucher) => sum + voucher.debtPays.length, 0);
    const scope = args.pendingOnly ? "con deuda pendiente" : "todos";
    deps.log(
      `vouchers: ${vouchers.length} documentos exportados (${scope}) de ${scanned} leídos, ` +
        `con ${debtPays} debtPays anidados -> ${file}`,
    );
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      deps.error(error.message);
    } else {
      // Solo el mensaje, y sin la ruta de credenciales: un stack o un error
      // del SDK podrían nombrar el archivo.
      const message = error instanceof Error ? error.message : String(error);
      deps.error(`Error: ${redactCredentials(message, deps.env)}`);
    }
    return 1;
  }
}

/** Verdadero solo cuando este archivo es el que se ejecutó (no al importarlo en un test). */
export function isEntryPoint(moduleUrl: string, argv1: string | undefined): boolean {
  return argv1 !== undefined && moduleUrl === pathToFileURL(argv1).href;
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}
