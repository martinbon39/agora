// argos admin CLI — runs on the server, talks to the DB directly (never HTTP).
// Usage: node dist/cli.js enroll
import { initDb } from "./db.js";
import { initAuthDb, createEnrollToken, expectedOrigin } from "./auth.js";

const cmd = process.argv[2];

switch (cmd) {
  case "enroll": {
    const db = initDb();
    initAuthDb(db);
    const token = createEnrollToken(db);
    console.log("One-shot enrollment link (valid 15 min):");
    console.log(`${expectedOrigin()}/#/register?token=${token}`);
    break;
  }
  default:
    console.error("usage: cli.js enroll");
    process.exit(1);
}
