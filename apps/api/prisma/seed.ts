import { PrismaClient, UserRole } from "@prisma/client";
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
  for (const name of ["Con caño", "Sin caño"]) {
    await prisma.containerType.upsert({
      where: { name },
      update: {},
      create: { name },
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

  console.log("Seed completed: roles, container types, payment methods, admin user.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
