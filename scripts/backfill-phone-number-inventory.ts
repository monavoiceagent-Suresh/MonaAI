// One-off backfill for M1 (see docs/MULTI_TENANT_TELEPHONY_PLAN.md): creates one PhoneNumber
// inventory row, status ASSIGNED, for every distinct existing InboundNumber.phone that has no
// matching inventory row yet, owned by that number's current clientId.
//
// Required before enabling the inbound-publish inventory guard (inbound.functions.ts
// publishInboundNumberFor): without this, every existing tenant's next republish of an
// already-working number would be rejected as "not in inventory". Safe to run more than once —
// it only ever inserts a PhoneNumber for a phone that doesn't already have one.
//
// Run: npm run db:backfill-phone-numbers  (or: node --experimental-strip-types scripts/backfill-phone-number-inventory.ts)
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

try {
  const numbers = await db.inboundNumber.findMany({
    select: { phone: true, clientId: true },
    distinct: ["phone"],
  });
  const existing = new Set(
    (await db.phoneNumber.findMany({ select: { e164: true } })).map((n) => n.e164),
  );

  let created = 0;
  for (const number of numbers) {
    if (existing.has(number.phone)) continue;
    await db.phoneNumber.create({
      data: {
        e164: number.phone,
        capability: "VOICE_BOTH",
        status: "ASSIGNED",
        clientId: number.clientId,
      },
    });
    console.log(`Backfilled ${number.phone} -> client ${number.clientId}`);
    created += 1;
  }
  console.log(
    created > 0
      ? `Backfilled ${created} number(s) into the inventory.`
      : "Nothing to backfill: every existing inbound number already has an inventory row.",
  );
} finally {
  await db.$disconnect();
}
