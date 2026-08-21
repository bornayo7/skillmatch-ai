import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateAnalysis } from "@/lib/skillmatch";

const {
  mockGetSessionUser,
  mockSaveAnalysis,
  mockSaveCandidateBatch,
  mockCheckCandidateDuplicates,
  mockRecordAdminAlert,
  mockBuildCandidateDuplicateIdentity,
  mockExtractResumeText,
  mockAnalyzeCandidateResume,
  mockInferCandidateName,
  mockStoreResumeFile,
  mockDeleteResumeObject
} = vi.hoisted(() => ({
  mockGetSessionUser: vi.fn(),
  mockSaveAnalysis: vi.fn(),
  mockSaveCandidateBatch: vi.fn(),
  mockCheckCandidateDuplicates: vi.fn(),
  mockRecordAdminAlert: vi.fn(),
  mockBuildCandidateDuplicateIdentity: vi.fn(),
  mockExtractResumeText: vi.fn(),
  mockAnalyzeCandidateResume: vi.fn(),
  mockInferCandidateName: vi.fn(),
  mockStoreResumeFile: vi.fn(),
  mockDeleteResumeObject: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: mockGetSessionUser
}));

vi.mock("@/lib/db", () => ({
  saveAnalysis: mockSaveAnalysis,
  saveCandidateBatch: mockSaveCandidateBatch,
  checkCandidateDuplicates: mockCheckCandidateDuplicates,
  recordAdminAlert: mockRecordAdminAlert,
  buildCandidateDuplicateIdentity: mockBuildCandidateDuplicateIdentity
}));

vi.mock("@/lib/resume-parser", () => ({
  extractResumeText: mockExtractResumeText
}));

vi.mock("@/lib/skillmatch", () => ({
  analyzeCandidateResume: mockAnalyzeCandidateResume,
  inferCandidateName: mockInferCandidateName
}));

vi.mock("@/lib/storage", () => ({
  storeResumeFile: mockStoreResumeFile,
  deleteResumeObject: mockDeleteResumeObject
}));

import { POST as uploadPost } from "@/app/api/upload/route";

function createUploadRequest(formData: FormData) {
  return {
    headers: new Headers(),
    formData: async () => formData
  } as unknown as Request;
}

function createCandidate(id: string, fileName: string, candidateName = "Alex Smith"): CandidateAnalysis {
  return {
    id,
    candidateName,
    fileName,
    storageUrl: `local://resumes/${id}.pdf`,
    structured: {
      skills: ["TypeScript"],
      yearsExperience: 5,
      education: ["Bachelor's degree"],
      location: "Remote",
      certifications: [],
      biasMaskedText: "masked"
    },
    topPositions: [
      {
        role: {
          id: "sde-i",
          title: "Software Engineer I",
          requiredSkills: [],
          preferredSkills: [],
          learning: {}
        },
        extractedSkills: ["TypeScript"],
        structured: {
          skills: ["TypeScript"],
          yearsExperience: 5,
          education: ["Bachelor's degree"],
          location: "Remote",
          certifications: [],
          biasMaskedText: "masked"
        },
        matchedSkills: ["TypeScript"],
        missingSkills: [],
        score: 90,
        explanation: "good fit",
        explanationDetails: {
          weights: { required: 1, preferred: 1 },
          earnedWeight: 1,
          possibleWeight: 1,
          required: { matched: 0, total: 0, missing: [] },
          preferred: { matched: 0, total: 0, missing: [] },
          evidence: [],
          rankingFactors: []
        },
        rank: 1
      }
    ],
    aiInsight: null,
    createdAt: "2026-05-03T00:00:00.000Z"
  } as unknown as CandidateAnalysis;
}

describe("POST /api/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionUser.mockResolvedValue({
      name: "Recruiter",
      email: "recruiter@skillmatch.demo",
      role: "recruiter"
    });
    mockInferCandidateName.mockReturnValue("Alex Smith");
    mockBuildCandidateDuplicateIdentity.mockImplementation(({ candidateName, fileName, resumeText }) => {
      const identitySuffix = resumeText.includes("distributed systems") ? "resume-a" : "resume-b";
      return {
        duplicateKey: `${candidateName}:${identitySuffix}`,
        clusterKey: `${candidateName}:${fileName.replace(/\.[^.]+$/, "").toLowerCase()}`
      };
    });
    mockCheckCandidateDuplicates.mockImplementation(async (uploads) => ({
      accepted: uploads,
      duplicates: []
    }));
    mockRecordAdminAlert.mockResolvedValue(undefined);
    mockDeleteResumeObject.mockResolvedValue({ supported: true, deleted: true });
  });

  it("rejects upload for roles without recruiting access", async () => {
    mockGetSessionUser.mockResolvedValue({
      name: "Pat Employee",
      email: "employee@skillmatch.demo",
      role: "employee"
    });

    const formData = new FormData();
    formData.append("resumes", new File(["resume"], "resume.pdf", { type: "application/pdf" }));

    const response = await uploadPost(createUploadRequest(formData));

    expect(response.status).toBe(403);
    expect(mockStoreResumeFile).not.toHaveBeenCalled();
    expect(mockSaveCandidateBatch).not.toHaveBeenCalled();
  });

  it("skips same-batch duplicate uploads before persistence and returns a structured warning", async () => {
    const candidate = createCandidate("cand-1", "Alex-Smith.pdf");
    mockExtractResumeText.mockResolvedValue({
      text: "Alex Smith\nTypeScript engineer with five years of distributed systems experience.",
      bytes: new Uint8Array([1, 2, 3])
    });
    mockStoreResumeFile.mockResolvedValue({ url: candidate.storageUrl });
    mockAnalyzeCandidateResume.mockReturnValue(candidate);
    mockSaveCandidateBatch.mockResolvedValue({ candidates: [candidate], duplicates: [], persistFailures: [] });

    const formData = new FormData();
    formData.append("resumes", new File(["one"], "Alex-Smith.pdf", { type: "application/pdf" }));
    formData.append("resumes", new File(["two"], "Alex-Smith.pdf", { type: "application/pdf" }));

    const response = await uploadPost(createUploadRequest(formData));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      candidates: [candidate],
      duplicates: [
        {
          type: "exact_duplicate",
          source: "upload_batch",
          candidateName: "Alex Smith",
          fileName: "Alex-Smith.pdf",
          duplicateKey: "Alex Smith:resume-a",
          clusterKey: "Alex Smith:alex-smith",
          message: "Skipped duplicate resume upload in the same batch."
        }
      ],
      failures: []
    });
    expect(mockStoreResumeFile).toHaveBeenCalledTimes(1);
    expect(mockAnalyzeCandidateResume).toHaveBeenCalledTimes(1);
    expect(mockSaveCandidateBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "recruiter@skillmatch.demo",
        actorRole: "recruiter",
        actorName: "Recruiter",
        skipDuplicateScan: true,
        uploads: [
          expect.objectContaining({
            candidate,
            resumeText: "Alex Smith\nTypeScript engineer with five years of distributed systems experience.",
            duplicateKey: "Alex Smith:resume-a",
            clusterKey: "Alex Smith:alex-smith"
          })
        ]
      })
    );
    expect(mockSaveAnalysis).toHaveBeenCalledTimes(1);
  });

  it("cleans up the stored resume object when the candidate record cannot be persisted", async () => {
    const candidate = createCandidate("cand-3", "Sam-Rivera.pdf", "Sam Rivera");
    mockInferCandidateName.mockReturnValue("Sam Rivera");
    mockExtractResumeText.mockResolvedValue({
      text: "Sam Rivera\nBackend engineer with Go and distributed systems experience.",
      bytes: new Uint8Array([7, 8, 9])
    });
    mockStoreResumeFile.mockResolvedValue({ url: candidate.storageUrl });
    mockAnalyzeCandidateResume.mockReturnValue(candidate);
    mockSaveCandidateBatch.mockResolvedValue({
      candidates: [],
      duplicates: [],
      persistFailures: [
        {
          candidateId: candidate.id,
          candidateName: candidate.candidateName,
          fileName: candidate.fileName,
          storageUrl: candidate.storageUrl,
          error: "insert failed"
        }
      ]
    });

    const formData = new FormData();
    formData.append("resumes", new File(["resume"], "Sam-Rivera.pdf", { type: "application/pdf" }));

    const response = await uploadPost(createUploadRequest(formData));

    expect(response.status).toBe(200);
    expect(mockDeleteResumeObject).toHaveBeenCalledWith(candidate.storageUrl);
    const payload = (await response.json()) as { failures: Array<{ fileName: string }> };
    expect(payload.failures).toEqual([
      expect.objectContaining({ fileName: "Sam-Rivera.pdf" })
    ]);
    expect(mockSaveAnalysis).not.toHaveBeenCalled();
  });

  it("skips existing-record duplicates before any object is stored and avoids analysis writes", async () => {
    const candidate = createCandidate("cand-2", "Jordan-Lee.pdf", "Jordan Lee");
    mockInferCandidateName.mockReturnValue("Jordan Lee");
    mockBuildCandidateDuplicateIdentity.mockReturnValue({
      duplicateKey: "Jordan Lee:72",
      clusterKey: "Jordan Lee:jordan-lee"
    });
    mockExtractResumeText.mockResolvedValue({
      text: "Jordan Lee\nFull-stack engineer with React, SQL, and API platform experience.",
      bytes: new Uint8Array([4, 5, 6])
    });
    mockAnalyzeCandidateResume.mockReturnValue(candidate);
    const existingRecordWarning = {
      type: "exact_duplicate" as const,
      source: "existing_records" as const,
      candidateName: "Jordan Lee",
      fileName: "Jordan-Lee.pdf",
      duplicateKey: "Jordan Lee:72",
      clusterKey: "Jordan Lee:jordan-lee",
      matchedCandidateId: "existing-analysis-id",
      message: "Skipped duplicate resume upload."
    };
    mockCheckCandidateDuplicates.mockResolvedValue({
      accepted: [],
      duplicates: [existingRecordWarning]
    });

    const formData = new FormData();
    formData.append("resumes", new File(["resume"], "Jordan-Lee.pdf", { type: "application/pdf" }));

    const response = await uploadPost(createUploadRequest(formData));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      candidates: [],
      duplicates: [existingRecordWarning],
      failures: []
    });
    expect(mockStoreResumeFile).not.toHaveBeenCalled();
    expect(mockSaveCandidateBatch).not.toHaveBeenCalled();
    expect(mockSaveAnalysis).not.toHaveBeenCalled();
  });

});

describe("saveCandidateBatch memory duplicate detection", () => {
  beforeEach(async () => {
    const actualDb = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
    actualDb.resetCandidateRecommendationsForTests();
  });

  it("blocks exact duplicates and emits candidate-cluster warnings without dropping distinct resumes", async () => {
    const actualDb = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
    const firstResumeText = "Alex Smith TypeScript engineer with AWS and distributed systems experience.";
    const clusteredResumeText = "Alex Smith platform engineer with React, SQL, and product delivery experience.";
    const firstIdentity = actualDb.buildCandidateDuplicateIdentity({
      candidateName: "Alex Smith",
      fileName: "Alex-Smith.pdf",
      resumeText: firstResumeText
    });
    const duplicateIdentity = actualDb.buildCandidateDuplicateIdentity({
      candidateName: "Alex Smith",
      fileName: "Alex-Smith.pdf",
      resumeText: firstResumeText
    });
    const clusteredIdentity = actualDb.buildCandidateDuplicateIdentity({
      candidateName: "Alex Smith",
      fileName: "Alex-Smith.pdf",
      resumeText: clusteredResumeText
    });

    const firstSave = await actualDb.saveCandidateBatch({
      actor: "recruiter@skillmatch.demo",
      uploads: [
        {
          candidate: createCandidate("memory-1", "Alex-Smith.pdf"),
          resumeText: firstResumeText,
          duplicateKey: firstIdentity.duplicateKey,
          clusterKey: firstIdentity.clusterKey
        }
      ]
    });
    const duplicateSave = await actualDb.saveCandidateBatch({
      actor: "recruiter@skillmatch.demo",
      uploads: [
        {
          candidate: createCandidate("memory-2", "Alex-Smith.pdf"),
          resumeText: firstResumeText,
          duplicateKey: duplicateIdentity.duplicateKey,
          clusterKey: duplicateIdentity.clusterKey
        }
      ]
    });
    const clusteredSave = await actualDb.saveCandidateBatch({
      actor: "recruiter@skillmatch.demo",
      uploads: [
        {
          candidate: createCandidate("memory-3", "Alex-Smith.pdf"),
          resumeText: clusteredResumeText,
          duplicateKey: clusteredIdentity.duplicateKey,
          clusterKey: clusteredIdentity.clusterKey
        }
      ]
    });

    expect(firstSave.candidates).toHaveLength(1);
    expect(firstSave.duplicates).toHaveLength(0);
    expect(duplicateSave.candidates).toHaveLength(0);
    expect(duplicateSave.duplicates).toEqual([
      expect.objectContaining({
        type: "exact_duplicate",
        source: "existing_records",
        candidateName: "Alex Smith",
        fileName: "Alex-Smith.pdf",
        duplicateKey: duplicateIdentity.duplicateKey,
        clusterKey: duplicateIdentity.clusterKey
      })
    ]);
    expect(clusteredSave.candidates).toHaveLength(1);
    expect(clusteredSave.duplicates).toEqual([
      expect.objectContaining({
        type: "candidate_cluster",
        source: "existing_records",
        candidateName: "Alex Smith",
        fileName: "Alex-Smith.pdf",
        duplicateKey: clusteredIdentity.duplicateKey,
        clusterKey: clusteredIdentity.clusterKey
      })
    ]);
  });
});
