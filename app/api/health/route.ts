import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getSessionUser } from "@/lib/auth";
import { getAuthConfig, getDatabaseConfig, getStorageConfig } from "@/lib/env";

const requiredTables = [
  "users",
  "analyses",
  "audit_events",
  "admin_alerts",
  "candidate_recommendations",
  "saved_target_roles"
] as const;

const requiredColumns = [
  { table: "analyses", column: "candidate_id" },
  { table: "candidate_recommendations", column: "ai_insight" },
  { table: "candidate_recommendations", column: "assigned_learning_modules" },
  { table: "candidate_recommendations", column: "duplicate_key" },
  { table: "audit_events", column: "actor_role" },
  { table: "audit_events", column: "actor_name" },
  { table: "audit_events", column: "previous_hash" },
  { table: "audit_events", column: "hash" }
] as const;

export const dynamic = "force-dynamic";

function getStorageHealth() {
  try {
    const storage = getStorageConfig();
    return {
      configured: storage.provider === "r2",
      provider: storage.provider,
      mode: storage.provider === "r2" ? "r2" : "local_memory",
      persistent: storage.provider === "r2",
      publicBaseUrlConfigured: storage.provider === "r2" ? Boolean(storage.publicBaseUrl) : false,
      objectDeletionSupported: true,
    };
  } catch {
    return {
      configured: true,
      provider: "unknown",
      mode: "degraded",
      persistent: false,
      publicBaseUrlConfigured: false,
      objectDeletionSupported: false,
      error: "Storage health check failed.",
    };
  }
}

function getAuthHealth() {
  try {
    return { demoCredentialsActive: getAuthConfig(process.env, { requireUsers: false }).usesFallbackUsers };
  } catch {
    return { demoCredentialsActive: false };
  }
}

async function canSeeDetails() {
  const user = await getSessionUser().catch(() => null);
  return user?.role === "system_admin";
}

function minimalResponse(status: "ok" | "degraded", httpStatus: number) {
  return NextResponse.json({ status }, { status: httpStatus });
}

export async function GET() {
  const detailed = await canSeeDetails();
  let databaseUrl: string | null = null;

  try {
    databaseUrl = getDatabaseConfig().url;
  } catch (error) {
    console.error("Runtime health configuration failed", error);
    return detailed
      ? NextResponse.json(
          {
            status: "degraded",
            database: {
              configured: false,
              mode: "unavailable",
              schemaReady: false,
              missingTables: [...requiredTables],
              missingColumns: requiredColumns.map(({ table, column }) => `${table}.${column}`)
            },
            storage: getStorageHealth(),
            auth: getAuthHealth(),
            error: "Runtime configuration is incomplete."
          },
          { status: 503 }
        )
      : minimalResponse("degraded", 503);
  }

  if (!databaseUrl) {
    if (!detailed) {
      return minimalResponse("ok", 200);
    }
    return NextResponse.json({
      status: "ok",
      database: {
        configured: false,
        mode: "memory",
        schemaReady: false,
        missingTables: requiredTables,
        missingColumns: [] as string[]
      },
      storage: getStorageHealth(),
      auth: getAuthHealth()
    });
  }

  try {
    const sql = neon(databaseUrl);
    const tableRows = await sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
    `;

    const publicTables = new Set(tableRows.map((row) => String(row.table_name)));
    const missingTables = requiredTables.filter((table) => !publicTables.has(table));

    const columnRows = await sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
    `;
    const columnKeys = new Set(
      columnRows.map((row) => `${String(row.table_name)}.${String(row.column_name)}`)
    );
    const missingColumns: string[] = [];
    for (const { table, column } of requiredColumns) {
      if (publicTables.has(table) && !columnKeys.has(`${table}.${column}`)) {
        missingColumns.push(`${table}.${column}`);
      }
    }

    const schemaReady = missingTables.length === 0 && missingColumns.length === 0;
    const status = schemaReady ? "ok" : "degraded";
    const httpStatus = schemaReady ? 200 : 503;
    if (!detailed) {
      return minimalResponse(status, httpStatus);
    }

    return NextResponse.json(
      {
        status,
        database: {
          configured: true,
          mode: "postgres",
          schemaReady,
          missingTables,
          missingColumns
        },
        storage: getStorageHealth(),
        auth: getAuthHealth()
      },
      { status: httpStatus }
    );
  } catch (error) {
    console.error("Database health check failed", error);
    if (!detailed) {
      return minimalResponse("degraded", 503);
    }
    return NextResponse.json(
      {
        status: "degraded",
        database: {
          configured: true,
          mode: "postgres",
          schemaReady: false,
          missingTables: [...requiredTables],
          missingColumns: [] as string[]
        },
        storage: getStorageHealth(),
        auth: getAuthHealth(),
        error: "Database health check failed."
      },
      { status: 503 }
    );
  }
}
