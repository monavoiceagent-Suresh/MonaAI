// Creates the platform's sole Super Admin owner account, or promotes an existing user to it.
// Only one account may hold this flag (enforced by a partial unique index in the database), so
// this refuses if one already exists — promote/demote manually via Prisma Studio if you need to
// hand ownership to a different account.
// Run: MONA_PASSWORD='...' npm run super-admin:create -- <email> ["<full name>"]
// If <email> already exists as a regular user, pass no password: the existing account is
// promoted as-is and its current password keeps working.
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password.ts";

const MIN_PASSWORD_LENGTH = 12;

const [rawEmail, fullName] = process.argv.slice(2);
const password = process.env["MONA_PASSWORD"] ?? "";

if (!rawEmail) {
  console.error('Usage: MONA_PASSWORD=... npm run super-admin:create -- <email> ["<full name>"]');
  process.exit(1);
}

const email = rawEmail.trim().toLowerCase();
const db = new PrismaClient();

try {
  const existingSuperAdmin = await db.user.findFirst({
    where: { isSuperAdmin: true },
    select: { email: true },
  });
  if (existingSuperAdmin && existingSuperAdmin.email !== email) {
    console.error(
      `A Super Admin already exists (${existingSuperAdmin.email}). Only one is supported; ` +
        `change it directly in the database if you need to hand ownership to a different account.`,
    );
    process.exit(1);
  }

  const existingUser = await db.user.findUnique({
    where: { email },
    select: { id: true, isSuperAdmin: true },
  });

  if (existingUser) {
    if (existingUser.isSuperAdmin) {
      console.log(`${email} is already the Super Admin. Nothing changed.`);
    } else {
      await db.user.update({ where: { id: existingUser.id }, data: { isSuperAdmin: true } });
      console.log(`Promoted existing user ${email} to Super Admin.`);
    }
  } else {
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.error(
        `No user with that email exists yet, so a password is required to create one. ` +
          `MONA_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      process.exit(1);
    }
    const passwordHash = await hashPassword(password);
    const user = await db.user.create({
      data: { email, fullName: (fullName ?? "").trim(), passwordHash, isSuperAdmin: true },
      select: { id: true },
    });
    console.log(`Created Super Admin ${email} (${user.id}).`);
  }
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "P2002") {
    console.error(`Could not set ${email} as Super Admin: one already exists.`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await db.$disconnect();
}
