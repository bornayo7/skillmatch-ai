import { NextResponse } from "next/server";
import {
  buildCandidateDuplicateIdentity,
  checkCandidateDuplicates,
  saveAnalysis,
  saveCandidateBatch,
} from "@/lib/candidate-store";
import { recordAdminAlert, type CandidateDuplicateWarning } from "@/lib/db";
import { extractResumeText } from "@/lib/resume-parser";
import { generateResumeAiInsight, getResumeAiInsightConfig } from "@/lib/resume-ai-insight";
import { expandResumeUploads } from "@/lib/resume-upload-files";
import {
  analyzeCandidateResume,
  inferCandidateName,
  type CandidateAnalysis,
} from "@/lib/skillmatch";
import { isAllowedResumeUpload } from "@/lib/resume-upload-validation";
import { requireAccessArea, requireSameOrigin } from "@/lib/route-auth";
import { serverErrorResponse } from "@/lib/server-api-error";
import { deleteResumeObject, storeResumeFile } from "@/lib/storage";
import { resumeUploadConfig } from "@/lib/upload-config";

type PendingUpload = {
  candidate: CandidateAnalysis;
  resumeText: string;
  duplicateKey: string;
  clusterKey: string;
  bytes: Uint8Array;
  contentType: string;
};

async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T, index: number) => Promise<void>) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await task(items[index]!, index);
    }
  });
  await Promise.all(workers);
}

async function cleanupStoredUploads(uploads: PendingUpload[]) {
  const failed: PendingUpload[] = [];
  await Promise.all(
    uploads.map(async (upload) => {
      const result = await deleteResumeObject(upload.candidate.storageUrl);
      if (!result.deleted && result.error) {
        failed.push(upload);
      }
    })
  );
  return failed;
}

export async function POST(request: Request) {
  try {
    const originError = requireSameOrigin(request);
    if (originError) {
      return originError;
    }

    const { user, response } = await requireAccessArea("recruiter");
    if (!user) {
      return response;
    }

    const formData = await request.formData();
    const rawFiles = formData
      .getAll("resumes")
      .filter((item): item is File => item instanceof File && item.size > 0);

    if (!rawFiles.length) {
      return NextResponse.json({ error: "Upload at least one PDF, DOCX, TXT, or ZIP file." }, { status: 400 });
    }

    if (
      rawFiles.length > resumeUploadConfig.maxRawZipUploadCount &&
      rawFiles.some((file) => file.name.toLowerCase().endsWith(".zip"))
    ) {
      return NextResponse.json(
        { error: `Upload ${resumeUploadConfig.maxRawZipUploadCount} zip files or fewer at a time.` },
        { status: 400 }
      );
    }

    for (const file of rawFiles) {
      if (file.name.toLowerCase().endsWith(".zip") && file.size > resumeUploadConfig.maxZipFileSizeBytes) {
        return NextResponse.json(
          { error: `Zip file exceeds ${resumeUploadConfig.maxZipFileSizeLabel} limit.` },
          { status: 400 }
        );
      }
    }

    const expanded = await expandResumeUploads(rawFiles);
    const files = expanded.files;
    const failures: Array<{ fileName: string; error: string }> = [...expanded.failures];

    if (!files.length) {
      return NextResponse.json({ error: "Upload at least one supported resume file.", failures }, { status: 400 });
    }

    if (files.length > resumeUploadConfig.maxBatchResumeCount) {
      return NextResponse.json(
        {
          error: `Upload ${resumeUploadConfig.maxBatchResumeCount} resumes or fewer at a time, including files inside zips.`
        },
        { status: 400 }
      );
    }

    const pendingUploads: PendingUpload[] = [];
    const duplicates: CandidateDuplicateWarning[] = [];
    const seenDuplicateKeys = new Set<string>();
    const seenClusterKeys = new Set<string>();

    for (const file of files) {
      try {
        if (file.size > resumeUploadConfig.maxResumeFileSizeBytes) {
          throw new Error(`File exceeds ${resumeUploadConfig.maxResumeFileSizeLabel} limit.`);
        }

        if (!isAllowedResumeUpload(file.name, file.type)) {
          throw new Error("Only PDF, DOCX, or TXT resumes are supported.");
        }

        const parsed = await extractResumeText(file);
        if (parsed.text.length < 20) {
          throw new Error("Resume text could not be extracted.");
        }

        const candidateName = inferCandidateName(file.name, parsed.text);
        const { duplicateKey, clusterKey } = buildCandidateDuplicateIdentity({
          candidateName,
          fileName: file.name,
          resumeText: parsed.text,
        });

        if (seenDuplicateKeys.has(duplicateKey)) {
          duplicates.push({
            type: "exact_duplicate",
            source: "upload_batch",
            candidateName,
            fileName: file.name,
            duplicateKey,
            clusterKey,
            message: "Skipped duplicate resume upload in the same batch.",
          });
          continue;
        }

        if (seenClusterKeys.has(clusterKey)) {
          duplicates.push({
            type: "candidate_cluster",
            source: "upload_batch",
            candidateName,
            fileName: file.name,
            duplicateKey,
            clusterKey,
            message: "Candidate is clustered with another resume in the same upload batch.",
          });
        }

        seenDuplicateKeys.add(duplicateKey);
        seenClusterKeys.add(clusterKey);

        const candidate = analyzeCandidateResume({
          fileName: file.name,
          resumeText: parsed.text,
          storageUrl: "",
        });
        pendingUploads.push({
          candidate,
          resumeText: parsed.text,
          duplicateKey,
          clusterKey,
          bytes: parsed.bytes,
          contentType: file.type || "application/octet-stream",
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown parsing failure";
        failures.push({ fileName: file.name, error: reason });
        if (
          reason !== `File exceeds ${resumeUploadConfig.maxResumeFileSizeLabel} limit.` &&
          reason !== "Only PDF, DOCX, or TXT resumes are supported."
        ) {
          await recordAdminAlert({
            source: "upload",
            severity: "warning",
            message: `Resume parsing failed for ${file.name}: ${reason}`,
            details: { fileName: file.name, actor: user.email },
          }).catch((alertError) => console.error("Unable to record upload alert", alertError));
        }
      }
    }

    const checked = await checkCandidateDuplicates(pendingUploads);
    duplicates.push(...checked.duplicates);

    const storedUploads: PendingUpload[] = [];
    for (const upload of checked.accepted) {
      try {
        const stored = await storeResumeFile({
          fileName: upload.candidate.fileName,
          contentType: upload.contentType,
          bytes: upload.bytes,
        });
        upload.candidate.storageUrl = stored.url;
        storedUploads.push(upload);
      } catch (storageError) {
        const message = storageError instanceof Error ? storageError.message : "Storage upload failed.";
        failures.push({ fileName: upload.candidate.fileName, error: message });
        await recordAdminAlert({
          source: "storage",
          severity: "warning",
          message: `Resume storage failed for ${upload.candidate.fileName}: ${message}`,
          details: { fileName: upload.candidate.fileName, actor: user.email },
        }).catch((alertError) => console.error("Unable to record storage alert", alertError));
      }
    }

    const aiConfig = getResumeAiInsightConfig();
    if (aiConfig) {
      await runWithConcurrency(storedUploads, 3, async ({ candidate }, index) => {
        try {
          candidate.aiInsight = await generateResumeAiInsight({
            config: aiConfig,
            maskedResumeText: candidate.structured.biasMaskedText,
            topRoleTitles: candidate.topPositions.slice(0, 4).map((position) => position.role.title),
            candidateLabel: `candidate-${index + 1}`,
          });
        } catch {
          candidate.aiInsight = null;
        }
      });
    }

    if (!storedUploads.length) {
      return NextResponse.json({ candidates: [], duplicates, failures });
    }

    try {
      const saved = await saveCandidateBatch({
        actor: user.email,
        actorRole: user.role,
        actorName: user.name,
        uploads: storedUploads,
        skipDuplicateScan: true,
      });
      duplicates.push(...saved.duplicates);

      for (const failure of saved.persistFailures ?? []) {
        failures.push({
          fileName: failure.fileName,
          error: `Candidate record could not be saved: ${failure.error}`,
        });
        const deletion = await deleteResumeObject(failure.storageUrl);
        await recordAdminAlert({
          source: "database",
          severity: "critical",
          message: `Resume persistence failed for ${failure.fileName}: ${failure.error}`,
          details: {
            actor: user.email,
            fileName: failure.fileName,
            storageCleanup: deletion.deleted ? "deleted" : "not_deleted",
            storageCleanupError: deletion.error ?? null,
          },
        }).catch((alertError) => console.error("Unable to record database alert", alertError));
      }

      const savedCandidateIds = new Set(saved.candidates.map((candidate) => candidate.id));
      for (const { candidate, resumeText } of storedUploads) {
        if (!savedCandidateIds.has(candidate.id)) {
          continue;
        }

        const best = candidate.topPositions[0];
        if (!best) {
          continue;
        }

        try {
          await saveAnalysis({
            candidateId: candidate.id,
            employeeName: candidate.candidateName,
            resumeText,
            result: best,
            recordAudit: false,
          });
        } catch (analysisError) {
          const message = analysisError instanceof Error ? analysisError.message : "Analysis history could not be saved.";
          failures.push({ fileName: candidate.fileName, error: `Candidate saved, but analysis history failed: ${message}` });
          await recordAdminAlert({
            source: "database",
            severity: "warning",
            message: `Analysis history persistence failed for ${candidate.fileName}: ${message}`,
            details: { actor: user.email, candidateId: candidate.id },
          }).catch((alertError) => console.error("Unable to record analysis persistence alert", alertError));
        }
      }

      return NextResponse.json({ candidates: saved.candidates, duplicates, failures });
    } catch (error) {
      const persistError = error instanceof Error ? error.message : "Failed to save resumes.";
      const cleanupFailures = await cleanupStoredUploads(storedUploads);
      for (const upload of cleanupFailures) {
        failures.push({
          fileName: upload.candidate.fileName,
          error: "Persistence failed and the stored resume could not be cleaned up automatically."
        });
      }

      await recordAdminAlert({
        source: "database",
        severity: "critical",
        message: `Resume persistence failed: ${persistError}`,
        details: {
          actor: user.email,
          candidateCount: storedUploads.length,
          storageCleanupFailures: cleanupFailures.map((upload) => upload.candidate.storageUrl)
        },
      }).catch((alertError) => console.error("Unable to record database alert", alertError));

      return NextResponse.json(
        {
          error: "Resume analysis completed, but the candidate records could not be persisted.",
          candidates: [],
          duplicates,
          failures,
          persistError,
        },
        { status: 503 }
      );
    }
  } catch (error) {
    return serverErrorResponse(error);
  }
}
