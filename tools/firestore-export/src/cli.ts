import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, UsageError } from "./args.js";
import { exportCustomers, exportVouchers } from "./export.js";
import { connectFirestore } from "./firestore.js";

/**
 * One-off tool Giancarlo runs on HIS machine to take a snapshot of the old
 * system. Not part of the API or the web app; the roster loader reads the
 * files this writes and never talks to Firestore itself. The console only
 * ever shows COUNTS — never a document, a name, a phone number or a debt.
 */
async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const firestore = connectFirestore();
  mkdirSync(args.outDir, { recursive: true });

  if (args.command === "customers") {
    const customers = await exportCustomers(firestore);
    const file = join(args.outDir, "customers.json");
    writeFileSync(file, JSON.stringify(customers, null, 2), "utf8");
    console.log(`customers: ${customers.length} documentos exportados -> ${file}`);
    return;
  }

  const { vouchers, scanned } = await exportVouchers(firestore, { pendingOnly: args.pendingOnly });
  const file = join(args.outDir, "vouchers.json");
  writeFileSync(file, JSON.stringify(vouchers, null, 2), "utf8");
  const debtPays = vouchers.reduce((sum, voucher) => sum + voucher.debtPays.length, 0);
  const scope = args.pendingOnly ? "con deuda pendiente" : "todos";
  console.log(
    `vouchers: ${vouchers.length} documentos exportados (${scope}) de ${scanned} leídos, ` +
      `con ${debtPays} debtPays anidados -> ${file}`,
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(error.message);
  } else {
    // Only the message: a stack could include the credentials path.
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
});
