import { readFileSync } from "node:fs";
import { PrismaClient, ProductType, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * The catalog lives in seed-catalog.json so the production smoke
 * (scripts/smoke.mjs, checkCatalogs) compares main against the SAME list this
 * seeds, instead of a copy that drifts.
 */
interface SeedCatalog {
  containerTypes: string[];
  products: { name: string; type: ProductType; containerTypeName: string; listPrice: string }[];
  paymentMethods: { name: string; requiresConfirmation: boolean }[];
}
const catalog = JSON.parse(
  readFileSync(new URL("./seed-catalog.json", import.meta.url), "utf8"),
) as SeedCatalog;

// Idempotent: every insert is an upsert on a unique key, safe to re-run.
async function main() {
  for (const name of [UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER, UserRole.VIEWER]) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // Catalog names are UI strings and stay in Spanish (es-PE).
  const containerTypesByName = new Map<string, { id: string }>();
  for (const name of catalog.containerTypes) {
    const containerType = await prisma.containerType.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    containerTypesByName.set(name, containerType);
  }

  // Product.name is not @unique (two customer-facing products can share a
  // name across catalogs in the future), so this can't be a upsert() on
  // {where:{name}} — findFirst + create-if-missing is what makes it
  // idempotent instead.
  //
  // listPrice values are provisional placeholders: the owner sets the real
  // ones in «Productos» (PATCH /products/:id). The names are not placeholders:
  // they get copied onto every OrderItem created against them.
  for (const product of catalog.products) {
    const existing = await prisma.product.findFirst({ where: { name: product.name } });
    if (existing !== null) continue;

    const containerType = containerTypesByName.get(product.containerTypeName);
    if (containerType === undefined) {
      throw new Error(`Seed data error: container type "${product.containerTypeName}" not found`);
    }
    await prisma.product.create({
      data: {
        name: product.name,
        type: product.type,
        containerTypeId: containerType.id,
        listPrice: product.listPrice,
      },
    });
  }

  // Cash the driver counts himself is firm on the spot; anything that lands
  // on the owner's phone or bank app needs the office to confirm it saw it.
  for (const { name, requiresConfirmation } of catalog.paymentMethods) {
    await prisma.paymentMethod.upsert({
      where: { name },
      update: { requiresConfirmation },
      create: { name, requiresConfirmation },
    });
  }

  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      name: "Administrador",
      passwordHash,
    },
  });

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { name: UserRole.ADMIN },
  });
  await prisma.userRoleAssignment.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });

  console.log("Seed completed: roles, container types, products, payment methods, admin user.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
