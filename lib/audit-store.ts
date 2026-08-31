import { desc } from "drizzle-orm";
import { auditEvents } from "@/db/schema";
import { computeAuditEventHash, GENESIS_PREVIOUS_HASH } from "./audit-integrity";
import { appendAuditEvent as appendMemoryAuditEvent, type AuditEvent } from "./db";
import { getDatabase } from "./database";

export type AuditEventInput = {
  actor: string;
  actorRole?: string | null;
  actorName?: string | null;
  action: string;
  entityId?: string;
  details: Record<string, unknown>;
};

let memoryAuditQueue: Promise<void> = Promise.resolve();

function isUniqueViolation(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  return record.code === "23505" || String(record.message ?? "").includes("audit_events_previous_hash_unique_idx");
}

async function getMostRecentAuditHash() {
  const db = getDatabase();
  if (!db) {
    return GENESIS_PREVIOUS_HASH;
  }

  const [row] = await db
    .select({ hash: auditEvents.hash })
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(1);

  return row?.hash ?? GENESIS_PREVIOUS_HASH;
}

function appendSerializedMemoryAuditEvent(input: AuditEventInput) {
  const run = memoryAuditQueue.then(() => appendMemoryAuditEvent(input));
  memoryAuditQueue = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Appends an audit event without allowing two concurrent writers to claim the
 * same predecessor. Postgres uses a unique predecessor index as a compare-and-
 * swap guard. Memory mode uses a small promise queue to preserve the same contract.
 */
export async function appendAuditEvent(input: AuditEventInput): Promise<AuditEvent> {
  const db = getDatabase();
  if (!db) {
    return appendSerializedMemoryAuditEvent(input);
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const createdAt = new Date().toISOString();
    const previousHash = await getMostRecentAuditHash();
    const hash = computeAuditEventHash({
      previousHash,
      actor: input.actor,
      actorRole: input.actorRole ?? null,
      actorName: input.actorName ?? null,
      action: input.action,
      entityId: input.entityId ?? null,
      details: input.details,
      createdAt,
    });

    try {
      const [inserted] = await db
        .insert(auditEvents)
        .values({
          actor: input.actor,
          actorRole: input.actorRole ?? null,
          actorName: input.actorName ?? null,
          action: input.action,
          entityId: input.entityId ?? null,
          details: input.details,
          previousHash,
          hash,
          createdAt: new Date(createdAt),
        })
        .returning({ id: auditEvents.id });

      return {
        id: String(inserted.id),
        actor: input.actor,
        actorRole: input.actorRole ?? null,
        actorName: input.actorName ?? null,
        action: input.action,
        entityId: input.entityId,
        details: input.details,
        previousHash,
        hash,
        createdAt,
      };
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 7) {
        throw error;
      }
    }
  }

  throw new Error("Audit event could not be serialized after repeated concurrent writes.");
}

export async function appendAuditEventSafely(input: AuditEventInput) {
  try {
    return await appendAuditEvent(input);
  } catch (error) {
    console.error("Audit event write failed", error);
    return null;
  }
}
