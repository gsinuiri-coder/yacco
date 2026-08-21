import { PrismaClient, ProductType, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Idempotent: every insert is an upsert on a unique key, safe to re-run.
async function main() {
  for (const name of [UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER]) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // Catalog names are UI strings and stay in Spanish (es-PE).
  const containerTypesByName = new Map<string, { id: string }>();
  for (const name of ["Con caño", "Sin caño"]) {
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
  // listPrice values are provisional placeholders, pending confirmation with
  // the plant owner — see docs/backlog-tecnico.md. The names are not
  // placeholders: they get copied onto every OrderItem created against them.
  const products: {
    name: string;
    type: ProductType;
    containerTypeName: string;
    listPrice: string;
  }[] = [
    {
      name: "Recarga 20L con caño",
      type: ProductType.REFILL,
      containerTypeName: "Con caño",
      listPrice: "8.00",
    },
    {
      name: "Recarga 20L sin caño",
      type: ProductType.REFILL,
      containerTypeName: "Sin caño",
      listPrice: "8.00",
    },
    {
      name: "Bidón 20L con caño",
      type: ProductType.CONTAINER_SALE,
      containerTypeName: "Con caño",
      listPrice: "30.00",
    },
    {
      name: "Bidón 20L sin caño",
      type: ProductType.CONTAINER_SALE,
      containerTypeName: "Sin caño",
      listPrice: "28.00",
    },
  ];
  for (const product of products) {
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

  for (const name of ["Efectivo", "Transferencia", "Yape", "Plin"]) {
    await prisma.paymentMethod.upsert({
      where: { name },
      update: {},
      create: { name },
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
