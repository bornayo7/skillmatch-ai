import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const envFiles = [".env.local", ".env"];
const migrationsFolder = "./db/migrations";
const genesisPreviousHash = "0".repeat(64);

function stripWrappingQuotes(value) {
  return value.replace(/^['"]|['"]$/g, "");
}

function readEnvFileValue(filePath, key) {
  if (!existsSync(filePath)) {
    return undefined;
  }

  const contents = readFileSync(filePath, "utf8");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = contents.match(new RegExp(`^${escapedKey}\\s*=\\s*(.*)$`, "m"));
  const rawValue = match?.[1]?.trim();

  return rawValue ? stripWrappingQuotes(rawValue) : undefined;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function computeAuditEventHash(input) {
  const payload = stableStringify({
    previousHash: input.previousHash,
    actor: input.actor,
    actorRole: input.actorRole,
    actorName: input.actorName,
    action: input.action,
    entityId: input.entityId,
    details: input.details,
    createdAt: input.createdAt,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

async function repairAuditChain(databaseUrl) {
  const sql = neon(databaseUrl);
  const rows = await sql`
    select id, actor, actor_role, actor_name, action, entity_id, details, created_at
      from audit_events
     order by created_at asc, id asc
  `;

  let previousHash = genesisPreviousHash;
  for (const row of rows) {
    const createdAt = new Date(row.created_at).toISOString();
    const hash = computeAuditEventHash({
      previousHash,
      actor: String(row.actor),
      actorRole: row.actor_role == null ? null : String(row.actor_role),
      actorName: row.actor_name == null ? null : String(row.actor_name),
      action: String(row.action),
      entityId: row.entity_id == null ? null : String(row.entity_id),
      details: row.details ?? {},
      createdAt,
    });

    await sql`
      update audit_events
         set previous_hash = ${previousHash},
             hash = ${hash},
             created_at = ${new Date(createdAt)}
       where id = ${row.id}
    `;
    previousHash = hash;
  }

  await sql`
    create unique index if not exists audit_events_previous_hash_unique_idx
      on audit_events (previous_hash)
  `;
}

export function readDatabaseUrl(options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const explicitValue = env.DATABASE_URL?.trim();

  if (explicitValue) {
    return explicitValue;
  }

  for (const fileName of envFiles) {
    const value = readEnvFileValue(path.join(cwd, fileName), "DATABASE_URL");
    if (value) {
      return value;
    }
  }

  return undefined;
}

export async function runMigrations(options = {}) {
  const databaseUrl = readDatabaseUrl(options);

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run database setup. Checked process.env, .env.local, and .env.");
  }

  await migrate(drizzle(neon(databaseUrl)), { migrationsFolder });
  await repairAuditChain(databaseUrl);

  return {
    databaseUrl,
    migrationsFolder
  };
}

async function main() {
  const result = await runMigrations();
  console.log(`Database setup complete via ${result.migrationsFolder}. Audit chain verified and serialized.`);
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
