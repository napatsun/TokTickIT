import { getPrisma } from "../src/prisma.js";

/**
 * Idempotent seed — safe to run multiple times.
 * Uses upsert on unique keys so re-running never creates duplicates.
 */
export async function seed() {
  const prisma = getPrisma();

  // ─── Categories ──────────────────────────────────────────
  const categoryNames = [
    "Account and Access",
    "Hardware",
    "Software",
    "Network",
  ];
  for (const name of categoryNames) {
    await prisma.category.upsert({
      where: { name },
      update: { isActive: true },
      create: { name, isActive: true },
    });
  }

  // ─── Related Systems ─────────────────────────────────────
  const relatedSystemNames = [
    "Email",
    "Campus Wi-Fi",
    "VPN",
    "Corporate Laptop",
    "Printer",
    "Grade Submission App",
  ];
  for (const name of relatedSystemNames) {
    await prisma.relatedSystem.upsert({
      where: { name },
      update: { isActive: true },
      create: { name, isActive: true },
    });
  }

  // ─── Development Requesters ──────────────────────────────
  const requesters = [
    {
      fullName: "Jennifer Anderson",
      email: "jennifer.anderson@example.com",
      isActive: true,
    },
    {
      fullName: "Sarah Johnson",
      email: "sarah.johnson@example.com",
      isActive: true,
    },
    {
      fullName: "Michael Brown",
      email: "michael.brown@example.com",
      isActive: true,
    },
    {
      fullName: "David Lee",
      email: "david.lee@example.com",
      isActive: true,
    },
    {
      fullName: "Robert Wilson",
      email: "robert.wilson@example.com",
      isActive: false,
    },
  ];
  for (const { fullName, email, isActive } of requesters) {
    await prisma.devRequester.upsert({
      where: { email },
      update: { fullName, isActive },
      create: { fullName, email, isActive },
    });
  }

  console.log("Seed completed.");
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
