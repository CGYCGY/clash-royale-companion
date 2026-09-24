// Creates the dev login (dev / Local-Tester-2026) and a fresh invite in DATABASE_PATH. Safe to re-run.
import { createInvite } from "../src/auth/invites";
import { createUser, getUserByUsername } from "../src/auth/users";
import { getDb, migrate } from "../src/db";

const USERNAME = "dev";
const PASSWORD = "Local-Tester-2026";

migrate(getDb());

if (getUserByUsername(USERNAME)) {
  console.log(`User "${USERNAME}" already exists; left unchanged.`);
} else {
  await createUser(USERNAME, PASSWORD);
  console.log(`Created user "${USERNAME}" with password "${PASSWORD}".`);
}

const invite = createInvite({ maxUses: 5, expiresInDays: 30 });
console.log(`Invite code: ${invite.code} (${invite.maxUses} uses, expires ${invite.expiresAt})`);
