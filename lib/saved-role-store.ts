import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { savedTargetRoles } from "@/db/schema";
import {
  deleteSavedTargetRole as deleteMemorySavedTargetRole,
  listSavedTargetRoles as listMemorySavedTargetRoles,
  saveTargetRole as saveMemoryTargetRole,
  type SavedTargetRole,
} from "./db";
import { appendAuditEventSafely } from "./audit-store";
import { getDatabase } from "./database";

function clampScore(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function calculateProgress(currentScore: number | null, targetScore: number) {
  return currentScore === null ? 0 : clampScore((currentScore / targetScore) * 100, 0, 100);
}

function mapRole(row: typeof savedTargetRoles.$inferSelect): SavedTargetRole {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function listSavedTargetRoles(employeeEmail: string) {
  const db = getDatabase();
  if (!db) {
    return listMemorySavedTargetRoles(employeeEmail);
  }

  const rows = await db
    .select()
    .from(savedTargetRoles)
    .where(eq(savedTargetRoles.employeeEmail, employeeEmail))
    .orderBy(desc(savedTargetRoles.updatedAt));
  return rows.map(mapRole);
}

export async function saveTargetRole(input: {
  employeeEmail: string;
  roleId: string;
  roleTitle: string;
  targetScore?: number;
  currentScore?: number | null;
  matchedSkills?: string[];
  missingSkills?: string[];
}) {
  const db = getDatabase();
  if (!db) {
    const saved = await saveMemoryTargetRole(input);
    await appendAuditEventSafely({
      actor: input.employeeEmail,
      action: "saved_target_role_upsert",
      entityId: saved.id,
      details: { roleId: saved.roleId, roleTitle: saved.roleTitle, progressPercent: saved.progressPercent }
    });
    return saved;
  }

  const targetScore = clampScore(input.targetScore ?? 80, 1, 100);
  const currentScore = input.currentScore == null ? null : clampScore(input.currentScore, 0, 100);
  const progressPercent = calculateProgress(currentScore, targetScore);
  const now = new Date();
  const id = crypto.randomUUID();

  const [row] = await db
    .insert(savedTargetRoles)
    .values({
      id,
      employeeEmail: input.employeeEmail,
      roleId: input.roleId,
      roleTitle: input.roleTitle,
      targetScore,
      currentScore,
      matchedSkills: input.matchedSkills ?? [],
      missingSkills: input.missingSkills ?? [],
      progressPercent,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [savedTargetRoles.employeeEmail, savedTargetRoles.roleId],
      set: {
        roleTitle: input.roleTitle,
        targetScore,
        currentScore,
        matchedSkills: input.matchedSkills ?? [],
        missingSkills: input.missingSkills ?? [],
        progressPercent,
        updatedAt: now
      }
    })
    .returning();

  const saved = mapRole(row);
  await appendAuditEventSafely({
    actor: input.employeeEmail,
    action: "saved_target_role_upsert",
    entityId: saved.id,
    details: { roleId: saved.roleId, roleTitle: saved.roleTitle, progressPercent: saved.progressPercent }
  });
  return saved;
}

export async function deleteSavedTargetRole(input: { employeeEmail: string; id: string }) {
  const db = getDatabase();
  if (!db) {
    return deleteMemorySavedTargetRole(input);
  }

  const rows = await db
    .delete(savedTargetRoles)
    .where(and(eq(savedTargetRoles.employeeEmail, input.employeeEmail), eq(savedTargetRoles.id, input.id)))
    .returning({ id: savedTargetRoles.id });
  return rows.length > 0;
}
