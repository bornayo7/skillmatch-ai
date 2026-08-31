import crypto from "node:crypto";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { analyses, candidateRecommendations } from "@/db/schema";
import {
  buildCandidateDuplicateIdentity,
  checkCandidateDuplicates as checkMemoryCandidateDuplicates,
  deleteCandidateRecommendation as deleteMemoryCandidateRecommendation,
  getCandidateResumeById as getMemoryCandidateResumeById,
  listCandidateRecommendations as listMemoryCandidateRecommendations,
  saveAnalysis as saveMemoryAnalysis,
  saveCandidateBatch as saveMemoryCandidateBatch,
  assignCandidateLearningModules as assignMemoryCandidateLearningModules,
  type CandidateDuplicateWarning,
  type CandidatePersistFailure,
  type CandidateRecommendationFilters,
  type CandidateUploadRecord,
  type AnalysisRecord,
} from "./db";
import { appendAuditEventSafely } from "./audit-store";
import { getDatabase } from "./database";
import { matchingConfig } from "./seed-data";
import { deleteResumeObject } from "./storage";
import type { CandidateAnalysis, CandidatePositionRecommendation, SkillMatchResult } from "./skillmatch";

export type CandidateListOptions = {
  limit?: number | null;
  offset?: number;
};

function normalizeCandidateRecommendation(candidate: CandidateAnalysis): CandidateAnalysis {
  return {
    ...candidate,
    assignedLearningModules: candidate.assignedLearningModules ?? [],
    topPositions: candidate.topPositions.map((position) => {
      const details = position.explanationDetails as Partial<CandidatePositionRecommendation["explanationDetails"]> | undefined;
      return {
        ...position,
        explanationDetails: {
          ...details,
          weights: details?.weights ?? matchingConfig.scoringWeights,
          earnedWeight: details?.earnedWeight ?? 0,
          possibleWeight: details?.possibleWeight ?? 0,
          requiredSkills: details?.requiredSkills ?? { matched: 0, total: 0, missing: [] },
          preferredSkills: details?.preferredSkills ?? { matched: 0, total: 0, missing: [] },
          softSkills: details?.softSkills ?? { matched: 0, total: 0, missing: [] },
          certifications: details?.certifications ?? { matched: 0, total: 0, matchedItems: [], missing: [] },
          experience: details?.experience ?? {
            candidateYears: position.structured.yearsExperience,
            minimumYears: position.role.minimumYearsExperience,
            idealYears: position.role.idealYearsExperience,
            earnedWeight: 0,
            meetsMinimum:
              position.structured.yearsExperience !== null &&
              position.structured.yearsExperience >= position.role.minimumYearsExperience,
            meetsIdeal:
              position.structured.yearsExperience !== null &&
              position.structured.yearsExperience >= position.role.idealYearsExperience
          },
          evidence: details?.evidence ?? [],
          rankingFactors: details?.rankingFactors ?? []
        }
      };
    })
  };
}

function rowToCandidate(row: {
  id: string;
  candidateName: string;
  fileName: string;
  storageUrl: string;
  structured: unknown;
  topPositions: unknown;
  aiInsight: unknown;
  assignedLearningModules: string[];
  createdAt: Date;
}) {
  return normalizeCandidateRecommendation({
    id: row.id,
    candidateName: row.candidateName,
    fileName: row.fileName,
    storageUrl: row.storageUrl,
    structured: row.structured as CandidateAnalysis["structured"],
    topPositions: row.topPositions as CandidateAnalysis["topPositions"],
    aiInsight: (row.aiInsight ?? null) as CandidateAnalysis["aiInsight"],
    assignedLearningModules: row.assignedLearningModules,
    createdAt: row.createdAt.toISOString()
  } as CandidateAnalysis);
}

export async function checkCandidateDuplicates<T extends CandidateUploadRecord>(uploads: T[]) {
  const db = getDatabase();
  if (!db) {
    return checkMemoryCandidateDuplicates(uploads);
  }

  const seenDuplicateKeys = new Set<string>();
  const accepted: T[] = [];
  const duplicates: CandidateDuplicateWarning[] = [];

  for (const upload of uploads) {
    if (seenDuplicateKeys.has(upload.duplicateKey)) {
      duplicates.push({
        type: "exact_duplicate",
        source: "upload_batch",
        candidateName: upload.candidate.candidateName,
        fileName: upload.candidate.fileName,
        duplicateKey: upload.duplicateKey,
        clusterKey: upload.clusterKey,
        message: "Skipped duplicate resume upload."
      });
      continue;
    }
    seenDuplicateKeys.add(upload.duplicateKey);

    const [exact] = await db
      .select({ id: candidateRecommendations.id, fileName: candidateRecommendations.fileName })
      .from(candidateRecommendations)
      .where(eq(candidateRecommendations.duplicateKey, upload.duplicateKey))
      .limit(1);

    if (exact) {
      duplicates.push({
        type: "exact_duplicate",
        source: "existing_records",
        candidateName: upload.candidate.candidateName,
        fileName: upload.candidate.fileName,
        duplicateKey: upload.duplicateKey,
        clusterKey: upload.clusterKey,
        matchedCandidateId: exact.id,
        matchedFileName: exact.fileName,
        message: "Skipped duplicate resume upload."
      });
      continue;
    }

    const [cluster] = await db
      .select({ id: candidateRecommendations.id, fileName: candidateRecommendations.fileName })
      .from(candidateRecommendations)
      .where(eq(candidateRecommendations.candidateName, upload.candidate.candidateName))
      .orderBy(desc(candidateRecommendations.createdAt))
      .limit(1);

    if (cluster) {
      duplicates.push({
        type: "candidate_cluster",
        source: "existing_records",
        candidateName: upload.candidate.candidateName,
        fileName: upload.candidate.fileName,
        duplicateKey: upload.duplicateKey,
        clusterKey: upload.clusterKey,
        matchedCandidateId: cluster.id,
        matchedFileName: cluster.fileName,
        message: "Uploaded candidate is clustered with an existing candidate record."
      });
    }

    accepted.push(upload);
  }

  return { accepted, duplicates };
}

export async function saveCandidateBatch(input: {
  actor: string;
  actorRole?: string | null;
  actorName?: string | null;
  uploads: CandidateUploadRecord[];
  skipDuplicateScan?: boolean;
}) {
  const db = getDatabase();
  if (!db) {
    return saveMemoryCandidateBatch(input);
  }

  const checked = input.skipDuplicateScan
    ? { accepted: input.uploads, duplicates: [] as CandidateDuplicateWarning[] }
    : await checkCandidateDuplicates(input.uploads);
  const savedUploads: CandidateUploadRecord[] = [];
  const persistFailures: CandidatePersistFailure[] = [];

  for (const upload of checked.accepted) {
    const best = upload.candidate.topPositions[0];
    try {
      await db.insert(candidateRecommendations).values({
        id: upload.candidate.id,
        candidateName: upload.candidate.candidateName,
        fileName: upload.candidate.fileName,
        storageUrl: upload.candidate.storageUrl,
        duplicateKey: upload.duplicateKey,
        structuredResume: upload.candidate.structured,
        topPositions: upload.candidate.topPositions,
        aiInsight: upload.candidate.aiInsight,
        assignedLearningModules: upload.candidate.assignedLearningModules,
        bestRoleTitle: best?.role.title ?? "No match",
        bestScore: best?.score ?? 0
      });
      savedUploads.push(upload);
    } catch (error) {
      persistFailures.push({
        candidateId: upload.candidate.id,
        candidateName: upload.candidate.candidateName,
        fileName: upload.candidate.fileName,
        storageUrl: upload.candidate.storageUrl,
        error: error instanceof Error ? error.message : "Database insert failed."
      });
    }
  }

  await appendAuditEventSafely({
    actor: input.actor,
    actorRole: input.actorRole ?? null,
    actorName: input.actorName ?? null,
    action: "recommendation_generation",
    details: {
      count: savedUploads.length,
      duplicates: checked.duplicates.length,
      failed: persistFailures.length,
      mode: "database"
    }
  });

  return {
    candidates: savedUploads.map((upload) => upload.candidate),
    duplicates: checked.duplicates,
    persistFailures
  };
}

function candidateFilterConditions(filters: CandidateRecommendationFilters) {
  const conditions: SQL[] = [];
  for (const skill of filters.skills ?? []) {
    const normalized = skill.trim().toLowerCase();
    if (normalized) {
      conditions.push(sql`exists (
        select 1
          from jsonb_array_elements_text(coalesce(${candidateRecommendations.structuredResume}->'skills', '[]'::jsonb)) as skill_value(value)
         where lower(skill_value.value) = ${normalized}
      )`);
    }
  }

  const education = filters.education?.trim().toLowerCase();
  if (education) {
    conditions.push(sql`exists (
      select 1
        from jsonb_array_elements_text(coalesce(${candidateRecommendations.structuredResume}->'education', '[]'::jsonb)) as education_value(value)
       where lower(education_value.value) like ${`%${education}%`}
    )`);
  }

  const location = filters.location?.trim().toLowerCase();
  if (location) {
    conditions.push(sql`lower(coalesce(${candidateRecommendations.structuredResume}->>'location', '')) like ${`%${location}%`}`);
  }

  if (filters.minYearsExperience !== undefined) {
    conditions.push(sql`case
      when coalesce(${candidateRecommendations.structuredResume}->>'yearsExperience', '') ~ '^[0-9]+([.][0-9]+)?$'
      then (${candidateRecommendations.structuredResume}->>'yearsExperience')::numeric >= ${filters.minYearsExperience}
      else false
    end`);
  }

  return conditions;
}

export async function listCandidateRecommendations(
  filters: CandidateRecommendationFilters = {},
  options: CandidateListOptions = {}
) {
  const db = getDatabase();
  if (!db) {
    return listMemoryCandidateRecommendations(filters);
  }

  const limit = options.limit === null ? null : Math.max(1, Math.min(100, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const conditions = candidateFilterConditions(filters);
  const base = db
    .select({
      id: candidateRecommendations.id,
      candidateName: candidateRecommendations.candidateName,
      fileName: candidateRecommendations.fileName,
      storageUrl: candidateRecommendations.storageUrl,
      structured: candidateRecommendations.structuredResume,
      topPositions: candidateRecommendations.topPositions,
      aiInsight: candidateRecommendations.aiInsight,
      assignedLearningModules: candidateRecommendations.assignedLearningModules,
      createdAt: candidateRecommendations.createdAt
    })
    .from(candidateRecommendations);
  const filtered = conditions.length ? base.where(and(...conditions)) : base;
  const ordered = filtered.orderBy(desc(candidateRecommendations.createdAt));
  const rows = limit === null ? await ordered.offset(offset) : await ordered.limit(limit).offset(offset);

  return rows.map(rowToCandidate);
}

export async function saveAnalysis(input: {
  candidateId?: string | null;
  employeeName: string;
  resumeText: string;
  result: SkillMatchResult;
  recordAudit?: boolean;
  auditActor?: string;
  auditActorRole?: string | null;
  auditActorName?: string | null;
}): Promise<AnalysisRecord> {
  const db = getDatabase();
  if (!db) {
    const saved = await saveMemoryAnalysis(input);
    if (input.recordAudit !== false) {
      await appendAuditEventSafely({
        actor: input.auditActor ?? input.employeeName,
        actorRole: input.auditActorRole ?? null,
        actorName: input.auditActorName ?? null,
        action: "recommendation_generation",
        entityId: saved.id,
        details: { targetRole: input.result.role.title, score: input.result.score }
      });
    }
    return saved;
  }

  const record: AnalysisRecord = {
    id: crypto.randomUUID(),
    employeeName: input.employeeName,
    targetRole: input.result.role.title,
    score: input.result.score,
    matchedSkills: input.result.matchedSkills,
    missingSkills: input.result.missingSkills.map((item) => item.skill),
    createdAt: new Date().toISOString()
  };

  await db.insert(analyses).values({
    id: record.id,
    candidateId: input.candidateId ?? null,
    employeeName: input.employeeName,
    targetRoleId: input.result.role.id,
    targetRoleTitle: input.result.role.title,
    resumeText: input.resumeText,
    score: input.result.score,
    matchedSkills: input.result.matchedSkills,
    missingSkills: record.missingSkills,
    explanation: input.result.explanation,
    createdAt: new Date(record.createdAt)
  });

  if (input.recordAudit !== false) {
    await appendAuditEventSafely({
      actor: input.auditActor ?? input.employeeName,
      actorRole: input.auditActorRole ?? null,
      actorName: input.auditActorName ?? null,
      action: "recommendation_generation",
      entityId: record.id,
      details: { targetRole: input.result.role.title, score: input.result.score }
    });
  }

  return record;
}

export async function assignCandidateLearningModules(input: {
  actor: string;
  actorRole?: string | null;
  actorName?: string | null;
  candidateId: string;
  moduleIds: string[];
}) {
  const db = getDatabase();
  if (!db) {
    return assignMemoryCandidateLearningModules(input);
  }

  const assignedLearningModules = Array.from(new Set(input.moduleIds.map((id) => id.trim()).filter(Boolean)));
  const [row] = await db
    .update(candidateRecommendations)
    .set({ assignedLearningModules })
    .where(eq(candidateRecommendations.id, input.candidateId))
    .returning({
      id: candidateRecommendations.id,
      candidateName: candidateRecommendations.candidateName,
      fileName: candidateRecommendations.fileName,
      storageUrl: candidateRecommendations.storageUrl,
      structured: candidateRecommendations.structuredResume,
      topPositions: candidateRecommendations.topPositions,
      aiInsight: candidateRecommendations.aiInsight,
      assignedLearningModules: candidateRecommendations.assignedLearningModules,
      createdAt: candidateRecommendations.createdAt
    });

  if (!row) {
    return null;
  }

  await appendAuditEventSafely({
    actor: input.actor,
    actorRole: input.actorRole ?? null,
    actorName: input.actorName ?? null,
    action: "learning_modules_assigned",
    entityId: input.candidateId,
    details: { moduleIds: assignedLearningModules, mode: "database" }
  });

  return rowToCandidate(row);
}

export async function getCandidateResumeById(candidateId: string) {
  const db = getDatabase();
  if (!db) {
    return getMemoryCandidateResumeById(candidateId);
  }

  const [row] = await db
    .select({ fileName: candidateRecommendations.fileName, storageUrl: candidateRecommendations.storageUrl })
    .from(candidateRecommendations)
    .where(eq(candidateRecommendations.id, candidateId))
    .limit(1);

  return row ?? null;
}

export async function deleteCandidateRecommendation(input: {
  actor: string;
  actorRole?: string | null;
  actorName?: string | null;
  candidateId: string;
}) {
  const db = getDatabase();
  if (!db) {
    const resume = await getMemoryCandidateResumeById(input.candidateId);
    if (!resume) {
      return null;
    }
    const firstDeletion = await deleteResumeObject(resume.storageUrl);
    if (!firstDeletion.supported || (!firstDeletion.deleted && firstDeletion.error)) {
      throw new Error(firstDeletion.error ?? "Stored resume deletion is not supported.");
    }
    return deleteMemoryCandidateRecommendation(input);
  }

  const [candidate] = await db
    .select({
      id: candidateRecommendations.id,
      candidateName: candidateRecommendations.candidateName,
      fileName: candidateRecommendations.fileName,
      storageUrl: candidateRecommendations.storageUrl
    })
    .from(candidateRecommendations)
    .where(eq(candidateRecommendations.id, input.candidateId))
    .limit(1);

  if (!candidate) {
    return null;
  }

  const objectDeletion = await deleteResumeObject(candidate.storageUrl);
  if (!objectDeletion.supported || (!objectDeletion.deleted && objectDeletion.error)) {
    throw new Error(objectDeletion.error ?? "Stored resume deletion is not supported.");
  }

  await db.delete(candidateRecommendations).where(eq(candidateRecommendations.id, input.candidateId));

  await appendAuditEventSafely({
    actor: input.actor,
    actorRole: input.actorRole ?? null,
    actorName: input.actorName ?? null,
    action: "candidate_resume_deleted",
    entityId: candidate.id,
    details: {
      candidateName: candidate.candidateName,
      fileName: candidate.fileName,
      resumeObjectDeleted: true,
      mode: "database"
    }
  });

  return {
    candidateId: candidate.id,
    candidateName: candidate.candidateName,
    fileName: candidate.fileName,
    storageUrl: candidate.storageUrl,
    resumeObjectDeleted: true,
    resumeObjectDeletionSupported: true,
    resumeObjectDeletionError: undefined,
    mode: "database" as const
  };
}

export { buildCandidateDuplicateIdentity };
