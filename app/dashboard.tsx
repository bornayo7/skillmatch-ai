"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  LayoutDashboard,
  Search,
  LogOut,
  RefreshCw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  Users,
  X,
  type LucideIcon
} from "lucide-react";
import { roles } from "@/lib/seed-data";
import type { SessionUser } from "@/lib/auth-model";
import { canAccess } from "@/lib/auth-permissions";
import type {
  AdminAlert,
  AnalysisRecord,
  AuditEvent,
  CandidateDuplicateWarning,
  SavedTargetRole,
} from "@/lib/db";
import type { LearningReport } from "@/lib/learning-report";
import type { CandidateAnalysis } from "@/lib/skillmatch";
import {
  AdminAlertsPanel,
  AuditFilterToolbar,
  AuditIntegrityBanner,
  AuditTable,
  HistoryTable,
} from "./components/dashboard/audit-panels";
import {
  AiInsightPanel,
  CandidateResumeFileLinks,
  GapList,
  ReadinessSignals,
  RecentCandidates,
  RecommendationPanel,
  RoleSkillGapChart,
  SkillList,
} from "./components/dashboard/candidate-panels";
import {
  LearningAssignmentPanel,
  LearningReportPanel,
  SavedRoleProgress,
  SavedTargetRolesPanel,
  WorkforceReportPanel,
} from "./components/dashboard/learning-panels";
import { RecruiterOverrideModal } from "./components/dashboard/override-modal";
import { SettingsPanel } from "./components/dashboard/settings-panel";
import {
  fileKey,
  type DemoSettingsPreferences,
  type LoadStatus,
  type NavAccess,
  type RuntimeHealth,
  type SkillGapChartItem,
  type View,
} from "./components/dashboard/shared";
import {
  EmptyPanel,
  ErrorPanel,
  LoadingPanel,
  Metric,
  RestrictedView,
} from "./components/dashboard/status-panels";

type UploadResponse = {
  candidates: CandidateAnalysis[];
  failures: Array<{ fileName: string; error: string }>;
  duplicates?: CandidateDuplicateWarning[];
  persistError?: string;
};

const demoPreferencesStorageKey = "skillmatch.demoPreferences.v1";

const defaultDemoPreferences: DemoSettingsPreferences = {
  defaultRoleId: "sde-ii",
  showParserFailureDetails: true,
  compactCandidateCards: false,
  adminReviewMode: false,
};

const navItems: Array<{ id: View; label: string; icon: LucideIcon; access: NavAccess }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, access: "all" },
  { id: "analyses", label: "Analyses", icon: BarChart3, access: "candidate_analysis" },
  { id: "learning", label: "Learning", icon: BookOpen, access: "learning" },
  { id: "workforce", label: "Workforce", icon: Users, access: "learning" },
  { id: "audit", label: "Audit Log", icon: ShieldCheck, access: "admin" },
  { id: "settings", label: "Settings", icon: Settings, access: "all" }
];

const viewIds = new Set<View>(navItems.map((item) => item.id));

function parseView(value?: string): View | null {
  return value && viewIds.has(value as View) ? (value as View) : null;
}

function canOpenAccess(user: SessionUser, access: NavAccess) {
  if (access === "all") {
    return true;
  }
  if (access === "candidate_analysis") {
    return canAccess(user, "recruiter") || canAccess(user, "learning");
  }

  return canAccess(user, access);
}

function canOpenView(user: SessionUser, view: View) {
  return canOpenAccess(user, navItems.find((item) => item.id === view)?.access ?? "all");
}

async function readApiError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error ?? fallback;
}

function parseDemoSettingsPreferences(value: string | null): DemoSettingsPreferences {
  if (!value) {
    return defaultDemoPreferences;
  }

  try {
    const parsed = JSON.parse(value) as Partial<DemoSettingsPreferences>;
    return {
      defaultRoleId: roles.some((role) => role.id === parsed.defaultRoleId)
        ? (parsed.defaultRoleId as string)
        : defaultDemoPreferences.defaultRoleId,
      showParserFailureDetails:
        typeof parsed.showParserFailureDetails === "boolean"
          ? parsed.showParserFailureDetails
          : defaultDemoPreferences.showParserFailureDetails,
      compactCandidateCards:
        typeof parsed.compactCandidateCards === "boolean"
          ? parsed.compactCandidateCards
          : defaultDemoPreferences.compactCandidateCards,
      adminReviewMode:
        typeof parsed.adminReviewMode === "boolean"
          ? parsed.adminReviewMode
          : defaultDemoPreferences.adminReviewMode,
    };
  } catch {
    return defaultDemoPreferences;
  }
}

function readInitialDemoSettingsPreferences() {
  if (typeof window === "undefined") {
    return defaultDemoPreferences;
  }

  return parseDemoSettingsPreferences(window.localStorage.getItem(demoPreferencesStorageKey));
}

export default function Dashboard({
  user,
  enableE2eFileHook = false,
  initialView,
}: {
  user: SessionUser;
  enableE2eFileHook?: boolean;
  initialView?: string;
}) {
  const [view, setView] = useState<View>(() => parseView(initialView) ?? "dashboard");
  const [roleId, setRoleId] = useState(() => readInitialDemoSettingsPreferences().defaultRoleId);
  const [files, setFiles] = useState<File[]>([]);
  const [candidates, setCandidates] = useState<CandidateAnalysis[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisRecord[]>([]);
  const [savedRoles, setSavedRoles] = useState<SavedTargetRole[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditIntegrity, setAuditIntegrity] = useState<{ ok: boolean; issues: number }>({ ok: true, issues: 0 });
  const [auditFilters, setAuditFilters] = useState({
    action: "",
    actor: "",
    entityId: "",
    startDate: "",
    endDate: "",
  });
  const [adminAlerts, setAdminAlerts] = useState<AdminAlert[]>([]);
  const [adminAlertStatus, setAdminAlertStatus] = useState<LoadStatus>(
    canAccess(user, "admin") ? "loading" : "forbidden",
  );
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<LoadStatus>("loading");
  const [learningReport, setLearningReport] = useState<LearningReport | null>(null);
  const [learningReportStatus, setLearningReportStatus] = useState<LoadStatus>(
    canAccess(user, "learning") ? "loading" : "forbidden",
  );
  const [failures, setFailures] = useState<UploadResponse["failures"]>([]);
  const [uploadDuplicateWarnings, setUploadDuplicateWarnings] = useState<CandidateDuplicateWarning[]>([]);
  const [overrideCandidate, setOverrideCandidate] = useState<CandidateAnalysis | null>(null);
  const [manualRestrictedView, setManualRestrictedView] = useState<View | null>(() => {
    const parsedView = parseView(initialView);
    return parsedView && !canOpenView(user, parsedView) ? parsedView : null;
  });
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [selectedLearningCandidateId, setSelectedLearningCandidateId] = useState<string>("");
  const [learningAssignmentStatus, setLearningAssignmentStatus] = useState<"idle" | "saving">("idle");
  const [isUploading, setIsUploading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [candidateStatus, setCandidateStatus] = useState<LoadStatus>("loading");
  const [analysisHistoryStatus, setAnalysisHistoryStatus] = useState<LoadStatus>("loading");
  const [savedRolesStatus, setSavedRolesStatus] = useState<LoadStatus>("loading");
  const [auditStatus, setAuditStatus] = useState<LoadStatus>(
    canAccess(user, "admin") ? "loading" : "forbidden"
  );
  const [query, setQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState("");
  const [educationFilter, setEducationFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [minYearsFilter, setMinYearsFilter] = useState("");
  const [deletingCandidateId, setDeletingCandidateId] = useState("");
  const [demoPreferences, setDemoPreferences] = useState<DemoSettingsPreferences>(() =>
    readInitialDemoSettingsPreferences()
  );
  const serverFiltersRef = useRef({
    skill: "",
    education: "",
    location: "",
    minYears: "",
  });

  useEffect(() => {
    serverFiltersRef.current = {
      skill: skillFilter,
      education: educationFilter,
      location: locationFilter,
      minYears: minYearsFilter,
    };
  }, [educationFilter, locationFilter, minYearsFilter, skillFilter]);

  const selectedRole = roles.find((role) => role.id === roleId) ?? roles[0];
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId) ?? candidates[0];
  const selectedLearningCandidate =
    candidates.find((candidate) => candidate.id === selectedLearningCandidateId) ?? selectedCandidate;
  const selectedRoleMatch = selectedCandidate?.topPositions.find((item) => item.role.id === roleId);
  const bestRecommendation = selectedRoleMatch ?? selectedCandidate?.topPositions[0];
  const selectedResult = selectedRoleMatch ?? bestRecommendation;
  const savedCurrentRole = savedRoles.find((role) => role.roleId === roleId);
  const accessibleNavItems = useMemo(
    () => navItems.filter((item) => canOpenAccess(user, item.access)),
    [user]
  );
  const firstAccessibleView = accessibleNavItems[0]?.id ?? "dashboard";
  const userCanViewAnalysisHistory = canAccess(user, "recruiter") || canAccess(user, "learning");
  const userCanViewCandidates = canAccess(user, "recruiter") || canAccess(user, "learning");
  const userCanViewAudit = canAccess(user, "admin");
  const userCanDeleteCandidates = canAccess(user, "recruiter");
  const roleAccessSummary = useMemo(
    () =>
      navItems.map((item) => ({
        label: item.label,
        allowed: canOpenAccess(user, item.access),
      })),
    [user]
  );
  const activeViewAllowed = canOpenView(user, view);
  const showRestrictedView = !activeViewAllowed && manualRestrictedView === view;
  const screenView: View | null = showRestrictedView ? null : activeViewAllowed ? view : firstAccessibleView;
  const workforceGaps =
    learningReport?.topMissingSkills.map((gap) => [gap.skill, gap.affectedCandidates] as [string, number]) ?? [];
  const workforceGapMeterMax = Math.max(learningReport?.totalCandidates ?? candidates.length, 5);

  const skillGapChartItems = useMemo<SkillGapChartItem[]>(() => {
    if (!selectedResult) {
      return [];
    }

    const matchedSkills = new Set(selectedResult.matchedSkills);
    const missingSkills = new Map(selectedResult.missingSkills.map((gap) => [gap.skill, gap]));

    return [...selectedRole.requiredSkills, ...selectedRole.preferredSkills].map((skill) => {
      const source: SkillGapChartItem["source"] = selectedRole.requiredSkills.includes(skill) ? "required" : "preferred";
      const isMatched = matchedSkills.has(skill);
      const missingGap = missingSkills.get(skill);

      return {
        skill,
        source,
        status: isMatched ? "matched" : "gap",
        importance: missingGap?.importance ?? (source === "required" ? "critical" : "important"),
        coverage: isMatched ? 100 : source === "required" ? 32 : 56
      };
    });
  }, [selectedRole, selectedResult]);

  const filteredCandidates = candidates.filter((candidate) =>
    `${candidate.candidateName} ${candidate.fileName} ${candidate.topPositions[0]?.role.title ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  const hasActiveServerCandidateFilters = Boolean(
    skillFilter.trim() || educationFilter.trim() || locationFilter.trim() || minYearsFilter.trim()
  );

  const refreshRecords = useCallback(
    async (options?: { skipCandidates?: boolean; forceEmptyCandidateFilters?: boolean }) => {
      const candidateParams = new URLSearchParams();
      const useServerFilters = !options?.forceEmptyCandidateFilters;
      if (useServerFilters) {
        skillFilter
          .split(",")
          .map((skill) => skill.trim())
          .filter(Boolean)
          .forEach((skill) => candidateParams.append("skill", skill));
        if (educationFilter.trim()) {
          candidateParams.set("education", educationFilter.trim());
        }
        if (locationFilter.trim()) {
          candidateParams.set("location", locationFilter.trim());
        }
        if (minYearsFilter.trim()) {
          candidateParams.set("minYearsExperience", minYearsFilter.trim());
        }
      }

      const candidateQuery = candidateParams.size ? `?${candidateParams.toString()}` : "";
      const skipCandidates = Boolean(options?.skipCandidates);
      const errors: string[] = [];

      setIsRefreshing(true);
      setRefreshError("");
      if (!skipCandidates) {
        setCandidateStatus(userCanViewCandidates ? "loading" : "forbidden");
      }
      setAnalysisHistoryStatus(userCanViewAnalysisHistory ? "loading" : "forbidden");
      setSavedRolesStatus("loading");
      setAuditStatus(userCanViewAudit ? "loading" : "forbidden");
      setRuntimeStatus("loading");
      const userCanViewLearning = canAccess(user, "learning");
      const userCanViewAdminAlerts = canAccess(user, "admin");
      if (userCanViewLearning) {
        setLearningReportStatus("loading");
      }
      if (userCanViewAdminAlerts) {
        setAdminAlertStatus("loading");
      }

      const auditQueryParams = new URLSearchParams();
      Object.entries(auditFilters).forEach(([key, value]) => {
        const trimmed = value.trim();
        if (trimmed) {
          auditQueryParams.set(key, trimmed);
        }
      });
      const auditUrl = auditQueryParams.size ? `/api/audit?${auditQueryParams.toString()}` : "/api/audit";

      try {
        const [
          candidateResponse,
          analysisResponse,
          savedRolesResponse,
          auditResponse,
          learningReportResponse,
          adminAlertsResponse,
          healthResponse,
        ] = await Promise.all([
          skipCandidates || !userCanViewCandidates
            ? Promise.resolve(null)
            : fetch(`/api/candidates${candidateQuery}`),
          userCanViewAnalysisHistory ? fetch("/api/analyses") : Promise.resolve(null),
          fetch("/api/saved-roles"),
          userCanViewAudit ? fetch(auditUrl) : Promise.resolve(null),
          userCanViewLearning ? fetch("/api/learning-report") : Promise.resolve(null),
          userCanViewAdminAlerts ? fetch("/api/admin-alerts") : Promise.resolve(null),
          fetch("/api/health"),
        ]);

        if (candidateResponse) {
          if (candidateResponse.ok) {
            const payload = (await candidateResponse.json()) as { candidates: CandidateAnalysis[] };
            setCandidates(payload.candidates);
            setCandidateStatus("ready");
            setSelectedCandidateId((current) => {
              const ids = new Set(payload.candidates.map((c) => c.id));
              if (!payload.candidates.length) {
                return "";
              }
              if (current && ids.has(current)) {
                return current;
              }
              return payload.candidates[0]!.id;
            });
            setSelectedLearningCandidateId((current) => {
              const ids = new Set(payload.candidates.map((c) => c.id));
              if (!payload.candidates.length) {
                return "";
              }
              if (current && ids.has(current)) {
                return current;
              }
              return payload.candidates[0]!.id;
            });
          } else if (candidateResponse.status === 403) {
            setCandidateStatus("forbidden");
            errors.push("Candidate records are restricted for this role.");
          } else {
            setCandidateStatus("error");
            errors.push(
              await readApiError(
                candidateResponse,
                `Could not load candidates (HTTP ${candidateResponse.status}).`
              )
            );
          }
        }

        if (analysisResponse) {
          if (analysisResponse.ok) {
            const payload = (await analysisResponse.json()) as { analyses: AnalysisRecord[] };
            setAnalyses(payload.analyses);
            setAnalysisHistoryStatus("ready");
          } else if (analysisResponse.status === 403) {
            setAnalyses([]);
            setAnalysisHistoryStatus("forbidden");
            if (userCanViewAnalysisHistory) {
              errors.push("Analysis history access was denied unexpectedly.");
            }
          } else {
            setAnalysisHistoryStatus("error");
            errors.push(
              await readApiError(
                analysisResponse,
                `Could not load analysis history (HTTP ${analysisResponse.status}).`
              )
            );
          }
        } else {
          setAnalyses([]);
        }

        if (savedRolesResponse.ok) {
          const payload = (await savedRolesResponse.json()) as { savedRoles: SavedTargetRole[] };
          setSavedRoles(payload.savedRoles);
          setSavedRolesStatus("ready");
        } else {
          setSavedRolesStatus("error");
          errors.push(
            await readApiError(
              savedRolesResponse,
              `Could not load saved target roles (HTTP ${savedRolesResponse.status}).`
            )
          );
        }

        if (auditResponse) {
          if (auditResponse.ok) {
            const payload = (await auditResponse.json()) as {
              events: AuditEvent[];
              integrity?: { ok: boolean; issues: Array<unknown> };
            };
            setAuditEvents(payload.events);
            setAuditIntegrity({
              ok: payload.integrity?.ok ?? true,
              issues: payload.integrity?.issues?.length ?? 0,
            });
            setAuditStatus("ready");
          } else if (auditResponse.status === 403) {
            setAuditEvents([]);
            setAuditStatus("forbidden");
            if (userCanViewAudit) {
              errors.push("Audit log access was denied unexpectedly.");
            }
          } else {
            setAuditStatus("error");
            errors.push(
              await readApiError(
                auditResponse,
                `Could not load audit log (HTTP ${auditResponse.status}).`
              )
            );
          }
        } else {
          setAuditEvents([]);
        }

        if (learningReportResponse) {
          if (learningReportResponse.ok) {
            const payload = (await learningReportResponse.json()) as { report: LearningReport };
            setLearningReport(payload.report);
            setLearningReportStatus("ready");
          } else if (learningReportResponse.status === 403) {
            setLearningReport(null);
            setLearningReportStatus("forbidden");
          } else {
            setLearningReportStatus("error");
            errors.push(
              await readApiError(
                learningReportResponse,
                `Could not load L&D learning report (HTTP ${learningReportResponse.status}).`
              )
            );
          }
        } else {
          setLearningReport(null);
        }

        if (adminAlertsResponse) {
          if (adminAlertsResponse.ok) {
            const payload = (await adminAlertsResponse.json()) as { alerts: AdminAlert[] };
            setAdminAlerts(payload.alerts);
            setAdminAlertStatus("ready");
          } else if (adminAlertsResponse.status === 403) {
            setAdminAlerts([]);
            setAdminAlertStatus("forbidden");
          } else {
            setAdminAlertStatus("error");
            errors.push(
              await readApiError(
                adminAlertsResponse,
                `Could not load admin alerts (HTTP ${adminAlertsResponse.status}).`
              )
            );
          }
        } else {
          setAdminAlerts([]);
        }

        if (healthResponse.ok) {
          const payload = (await healthResponse.json()) as RuntimeHealth;
          setRuntimeHealth(payload);
          setRuntimeStatus("ready");
        } else {
          const payload = (await healthResponse.json().catch(() => null)) as RuntimeHealth | null;
          setRuntimeHealth(payload);
          setRuntimeStatus(payload ? "ready" : "error");
        }

        if (errors.length) {
          const message = errors.join(" ");
          setRefreshError(message);
          setNotice(message);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not refresh dashboard data.";
        setRefreshError(message);
        setNotice(message);
        if (!skipCandidates) {
          setCandidateStatus("error");
        }
        if (userCanViewAnalysisHistory) {
          setAnalysisHistoryStatus("error");
        }
        setSavedRolesStatus("error");
        if (userCanViewAudit) {
          setAuditStatus("error");
        }
        setRuntimeStatus("error");
      } finally {
        setIsRefreshing(false);
      }
    },
    [
      auditFilters,
      educationFilter,
      locationFilter,
      minYearsFilter,
      skillFilter,
      user,
      userCanViewAnalysisHistory,
      userCanViewCandidates,
      userCanViewAudit
    ]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshRecords(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshRecords]);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) {
      return;
    }
    const nextFiles = Array.from(fileList).filter((file) => /\.(pdf|docx|txt|zip)$/i.test(file.name));
    setFiles((current) => {
      const queued = new Set(current.map(fileKey));
      const uniqueFiles = nextFiles.filter((file) => {
        const key = fileKey(file);
        if (queued.has(key)) {
          return false;
        }
        queued.add(key);
        return true;
      });
      return [...current, ...uniqueFiles].slice(0, 12);
    });
  }, []);

  useEffect(() => {
    if (!enableE2eFileHook) {
      return;
    }
    const win = window as Window & {
      __skillmatchE2eSyncQueuedFilesFromInput?: () => void;
    };
    win.__skillmatchE2eSyncQueuedFilesFromInput = () => {
      const input = document.querySelector<HTMLInputElement>(".upload-panel input[type=file]");
      if (!input?.files?.length) {
        return;
      }
      addFiles(input.files);
    };
    return () => {
      delete win.__skillmatchE2eSyncQueuedFilesFromInput;
    };
  }, [addFiles, enableE2eFileHook]);

  function removeFile(fileToRemove: File) {
    const removeKey = fileKey(fileToRemove);
    setFiles((current) => current.filter((file) => fileKey(file) !== removeKey));
  }

  function clearFiles() {
    setFiles([]);
  }

  async function uploadResumes() {
    if (!files.length) {
      setNotice("Select at least one resume before running analysis.");
      return;
    }

    setIsUploading(true);
    setNotice("");
    setFailures([]);
    setUploadDuplicateWarnings([]);

    const formData = new FormData();
    files.forEach((file) => formData.append("resumes", file));

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });

      const contentType = response.headers.get("content-type") ?? "";

      let payload: unknown;

      if (contentType.includes("application/json")) {
        try {
          payload = await response.json();
        } catch {
          setNotice(`Upload failed (${response.status}). The server returned invalid JSON.`);
          return;
        }
      } else {
        const text = await response.text();
        const snippet = text.trim().slice(0, 200);
        setNotice(
          snippet
            ? `Upload failed (${response.status}). ${snippet}`
            : `Upload failed (${response.status}).`,
        );
        return;
      }

      if (!response.ok) {
        const errBody = payload as { error?: string };
        setNotice(errBody.error ?? `Upload failed (${response.status}).`);
        return;
      }

      const uploadPayload = payload as UploadResponse;
      const duplicatesFromResponse = uploadPayload.duplicates ?? [];
      setCandidates((current) => [...uploadPayload.candidates, ...current]);
      const newestUploadedId = uploadPayload.candidates.at(-1)?.id;
      setSelectedCandidateId(newestUploadedId ?? selectedCandidateId);
      setFailures(uploadPayload.failures);
      setUploadDuplicateWarnings(duplicatesFromResponse);

      const duplicates = duplicatesFromResponse;
      const dupPhrase =
        duplicates.length > 0
          ? duplicates.length === 1
            ? ` 1 duplicate or cluster warning.`
            : ` ${duplicates.length} duplicate or cluster warnings.`
          : "";

      const persistWarn = uploadPayload.persistError?.trim();
      let message =
        uploadPayload.candidates.length > 0
          ? `Processed ${uploadPayload.candidates.length} resume${uploadPayload.candidates.length === 1 ? "" : "s"}.${dupPhrase}`
          : `No resumes were processed.${dupPhrase}`;
      if (persistWarn) {
        message +=
          uploadPayload.candidates.length > 0
            ? ` Results were analyzed but could not be saved: ${persistWarn}`
            : ` ${persistWarn}`;
      }

      const prevFilters = serverFiltersRef.current;
      const hadServerFilters = Boolean(
        prevFilters.skill.trim() ||
          prevFilters.education.trim() ||
          prevFilters.location.trim() ||
          prevFilters.minYears.trim(),
      );
      if (uploadPayload.candidates.length > 0 && !persistWarn && hadServerFilters) {
        message += " Candidate filters were cleared so new uploads stay visible under Analyses.";
        setSkillFilter("");
        setEducationFilter("");
        setLocationFilter("");
        setMinYearsFilter("");
      }

      setNotice(message);

      setFiles([]);

      if (uploadPayload.candidates.length > 0 && !persistWarn) {
        void refreshRecords({
          skipCandidates: false,
          forceEmptyCandidateFilters: true,
        });
      } else {
        void refreshRecords({ skipCandidates: Boolean(persistWarn) });
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Upload failed unexpectedly.");
    } finally {
      setIsUploading(false);
    }
  }

  async function saveCurrentTargetRole() {
    const response = await fetch("/api/saved-roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roleId,
        targetScore: 80,
        currentScore: selectedResult?.score ?? null,
        matchedSkills,
        missingSkills: missingSkills.map((gap) => gap.skill)
      })
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setNotice(payload.error ?? "Could not bookmark this role for Learning.");
      return;
    }

    const payload = (await response.json()) as { savedRole: SavedTargetRole };
    setSavedRoles((current) => [payload.savedRole, ...current.filter((role) => role.id !== payload.savedRole.id)]);
    setNotice(`Pinned "${selectedRole.title}" for Learning. Candidate analyses stay under Analyses.`);
  }

  async function removeSavedRole(id: string) {
    const response = await fetch(`/api/saved-roles?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) {
      setSavedRoles((current) => current.filter((role) => role.id !== id));
      return;
    }
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setNotice(payload.error ?? "Could not remove this bookmark. Try again.");
  }

  async function assignLearningModule(moduleId: string, assigned: boolean) {
    if (!selectedLearningCandidate) {
      setNotice("Select a resume before assigning learning modules.");
      return;
    }

    const currentModules = new Set(selectedLearningCandidate.assignedLearningModules ?? []);
    if (assigned) {
      currentModules.add(moduleId);
    } else {
      currentModules.delete(moduleId);
    }

    setLearningAssignmentStatus("saving");
    const response = await fetch(`/api/candidates/${selectedLearningCandidate.id}/learning-modules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleIds: Array.from(currentModules) })
    });

    setLearningAssignmentStatus("idle");
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setNotice(payload.error ?? "Could not update learning assignments.");
      return;
    }

    const payload = (await response.json()) as { candidate: CandidateAnalysis };
    setCandidates((current) => current.map((candidate) => (candidate.id === payload.candidate.id ? payload.candidate : candidate)));
    setNotice(`Updated learning modules for ${payload.candidate.candidateName}.`);
  }

  async function deleteCandidateResume(candidate: CandidateAnalysis) {
    if (!userCanDeleteCandidates) {
      setNotice("Your role cannot delete saved candidate resume records.");
      return;
    }

    const confirmed = window.confirm(
      `Delete the saved resume record for ${candidate.candidateName}? This removes the candidate recommendation row from the demo workspace.`
    );
    if (!confirmed) {
      return;
    }

    setDeletingCandidateId(candidate.id);
    try {
      const response = await fetch(`/api/candidates/${candidate.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setNotice(payload.error ?? "Could not delete this resume record.");
        return;
      }

      const remainingCandidates = candidates.filter((item) => item.id !== candidate.id);
      setCandidates(remainingCandidates);
      if (selectedCandidateId === candidate.id) {
        setSelectedCandidateId(remainingCandidates[0]?.id ?? "");
      }
      if (selectedLearningCandidateId === candidate.id) {
        setSelectedLearningCandidateId(remainingCandidates[0]?.id ?? "");
      }
      setNotice(`Deleted resume record for ${candidate.candidateName}.`);
      void refreshRecords();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete this resume record.");
    } finally {
      setDeletingCandidateId("");
    }
  }

  async function saveDemoPreferences() {
    window.localStorage.setItem(demoPreferencesStorageKey, JSON.stringify(demoPreferences));
    if (roles.some((role) => role.id === demoPreferences.defaultRoleId)) {
      setRoleId(demoPreferences.defaultRoleId);
    }

    if (user.role === "system_admin") {
      try {
        const response = await fetch("/api/settings/demo-preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "admin", preferences: demoPreferences }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          setNotice(payload.error ?? "Saved demo preferences, but the admin audit event failed.");
          return;
        }
      } catch {
        setNotice("Saved demo preferences, but the admin audit event failed.");
        return;
      }
      setNotice("Saved demo preferences and recorded an admin settings audit event.");
      return;
    }

    setNotice("Saved demo preferences in this browser.");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const matchedSkills = selectedResult?.matchedSkills ?? [];
  const missingSkills = selectedResult?.missingSkills ?? [];
  const userCanSubmitRecruiterOverride = canAccess(user, "recruiter");

  const updateViewUrl = useCallback((nextView: View) => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    if (nextView === "dashboard") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", nextView);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  function selectView(nextView: View) {
    const resolvedView = canOpenView(user, nextView) ? nextView : firstAccessibleView;
    setManualRestrictedView(null);
    setView(resolvedView);
    updateViewUrl(resolvedView);
  }

  useEffect(() => {
    if (screenView && screenView !== view) {
      updateViewUrl(screenView);
    }
  }, [screenView, updateViewUrl, view]);

  return (
    <main className="product-shell">
      <div className="product-layout">
        <header className="app-header">
          <div className="brand-block">
            <div className="brand-title">
              <h1>SkillMatch AI</h1>
              <p className="brand-tagline">Resume analysis and role fit</p>
            </div>
            <label className="role-context">
              Target role
              <select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="header-actions">
            <button
              className="icon-text-button"
              type="button"
              disabled={isUploading || isRefreshing}
              title={
                isUploading
                  ? "Wait for upload to finish before refreshing."
                  : "Reload candidates, bookmarks, analysis history, and audit data"
              }
              onClick={() => void refreshRecords()}
            >
              <RefreshCw aria-hidden="true" />
              {isRefreshing ? "Refreshing..." : "Refresh data"}
            </button>
            <span className="session-meta">
              {user.name}
              <span className="session-meta-role">{user.role.replace("_", " ")}</span>
            </span>
            <button className="icon-text-button" type="button" onClick={logout}>
              <LogOut aria-hidden="true" />
              Sign out
            </button>
          </div>
        </header>

        <nav className="top-nav" aria-label="Sections">
          {accessibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`top-nav-item ${screenView === item.id ? "active" : ""}`}
                key={item.id}
                type="button"
                onClick={() => selectView(item.id)}
              >
                <Icon aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <section className="main-product">
        {isRefreshing ? (
          <div className="refresh-status" role="status" aria-live="polite">
            <RefreshCw aria-hidden="true" />
            Refreshing workspace data...
          </div>
        ) : null}
        {refreshError ? (
          <div className="refresh-alert" role="alert">
            <AlertTriangle aria-hidden="true" />
            <span>{refreshError}</span>
            <button className="icon-text-button" type="button" disabled={isRefreshing} onClick={() => void refreshRecords()}>
              <RefreshCw aria-hidden="true" />
              Retry
            </button>
          </div>
        ) : null}
        {notice && screenView !== "dashboard" ? (
          <p className="notice" role="status" aria-live="polite">
            {notice}
          </p>
        ) : null}

        {showRestrictedView ? <RestrictedView user={user} view={view} /> : null}

        {screenView === "dashboard" ? (
          <>
            <section className="concept-grid">
              <section className="concept-panel upload-panel">
                <h2>Upload resumes</h2>
                <div
                  className="drop-zone"
                  data-testid="resume-drop-zone"
                  onDrop={(event) => {
                    event.preventDefault();
                    addFiles(event.dataTransfer.files);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                >
                  <UploadCloud aria-hidden="true" />
                  <strong>Drop PDF, DOCX, TXT, or ZIP resumes here</strong>
                  <span>or click to browse</span>
                  <input
                    aria-label="Upload resume files"
                    type="file"
                    multiple
                    accept=".pdf,.docx,.txt,.zip,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/zip,application/x-zip-compressed"
                    onChange={(event) => {
                      addFiles(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </div>
                <div className="queue-header">
                  <span>{files.length ? `${files.length} selected` : "No resumes selected"}</span>
                  <button className="queue-clear-button" type="button" onClick={clearFiles} disabled={!files.length || isUploading}>
                    <Trash2 aria-hidden="true" />
                    Clear all
                  </button>
                </div>
                <ul className="file-list">
                  {files.map((file) => (
                    <li key={fileKey(file)}>
                      <CheckCircle2 aria-hidden="true" />
                      <span>{file.name}</span>
                      <small>{Math.round(file.size / 1024)} KB</small>
                      <button
                        className="queue-icon-button"
                        type="button"
                        onClick={() => removeFile(file)}
                        disabled={isUploading}
                        aria-label={`Remove ${file.name}`}
                        title={`Remove ${file.name}`}
                      >
                        <X aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="role-facts">
                  <h3>Role context</h3>
                  <p>Job Family: {selectedRole.family}</p>
                  <p>Business Unit: {selectedRole.department}</p>
                  <p>Level: {selectedRole.level}</p>
                  <p>
                    Experience: {selectedRole.minimumYearsExperience} to {selectedRole.idealYearsExperience}+ years
                  </p>
                  <p>
                    Certifications:{" "}
                    {selectedRole.requiredCertifications.concat(selectedRole.preferredCertifications).join(", ") || "None specified"}
                  </p>
                  <p>
                    Soft skills:{" "}
                    {selectedRole.requiredSoftSkills.concat(selectedRole.preferredSoftSkills).join(", ")}
                  </p>
                </div>
                {notice ? <p className="notice">{notice}</p> : null}
                {failures.map((failure) => (
                  <p className="error-message" key={failure.fileName}>
                    {failure.fileName}: {failure.error}
                  </p>
                ))}
                {uploadDuplicateWarnings.length > 0 ? (
                  <div
                    data-testid="upload-duplicate-advisory"
                    className="rounded-lg border border-border-strong bg-brand-light px-3 py-2.5 text-[13px] text-ink"
                    role="region"
                    aria-label="Duplicate resume notices"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="font-semibold">Duplicate / cluster notices</strong>
                        <span className="mt-1 block font-normal leading-snug text-muted">
                          These files matched an existing uploaded résumé or another file in this run. Ranking did not store
                          a new row until you resolve overlaps.
                        </span>
                      </div>
                      <button
                        type="button"
                        className="queue-icon-button shrink-0"
                        aria-label="Dismiss duplicate notices"
                        title="Dismiss"
                        onClick={() => setUploadDuplicateWarnings([])}
                      >
                        <X aria-hidden={true} />
                      </button>
                    </div>
                    <ul className="upload-duplicate-list mt-3 list-none space-y-1.5 p-0 font-medium">
                      {uploadDuplicateWarnings.map((dup) => (
                        <li key={`${dup.fileName}:${dup.duplicateKey}:${dup.clusterKey}:${dup.source}`}>
                          <span className="text-ink">{dup.fileName}</span>
                          <span className="text-muted"> — {dup.message}</span>
                          {dup.matchedFileName ? (
                            <span className="text-muted"> ({dup.matchedFileName})</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <button
                  className="run-button"
                  onClick={uploadResumes}
                  disabled={isUploading || !files.length}
                  title={
                    !files.length
                      ? "Add at least one résumé file (PDF, DOCX, TXT, or ZIP) to run analysis."
                      : undefined
                  }
                >
                  <SlidersHorizontal aria-hidden="true" />
                  {isUploading ? "Processing resumes..." : "Run SkillMatch Analysis"}
                </button>
              </section>

              <section className="concept-panel overview-panel">
                <div className="panel-heading">
                  <h2>Skill Match Overview</h2>
                  {selectedCandidate ? (
                    <span className="overview-panel-candidate-heading">
                      <span>{selectedCandidate.candidateName}</span>
                      <CandidateResumeFileLinks candidate={selectedCandidate} />
                    </span>
                  ) : null}
                </div>
                <div className="overview-content">
                  <div className="overview-summary">
                    <div className={`score-column${selectedResult ? "" : " is-empty"}`}>
                      <div
                        className="score-ring large"
                        style={{ "--score": `${selectedResult?.score ?? 0}%` } as CSSProperties}
                        aria-label={selectedResult ? `Match score ${selectedResult.score}%` : "No match score yet"}
                      >
                        <strong>{selectedResult ? `${selectedResult.score}%` : "—"}</strong>
                      </div>
                      <strong>Overall Match</strong>
                      <span>{selectedResult ? selectedRole.title : "Upload resumes to rank positions"}</span>
                    </div>
                    <SkillList title="Top Matched Skills" items={matchedSkills.slice(0, 8)} />
                    <ReadinessSignals result={selectedResult} />
                    <GapList gaps={missingSkills.slice(0, 8)} />
                  </div>
                  <RoleSkillGapChart
                    candidateName={selectedCandidate?.candidateName}
                    items={skillGapChartItems}
                    roleTitle={selectedRole.title}
                  />
                </div>
              </section>

              <aside className="right-stack">
                <SavedTargetRolesPanel
                  currentRoleSaved={Boolean(savedCurrentRole)}
                  roles={savedRoles}
                  status={savedRolesStatus}
                  bookmarkDisabled={!selectedResult}
                  bookmarkDisabledReason="Run analysis on at least one résumé to snapshot match scores for this role."
                  onRemove={removeSavedRole}
                  onSave={saveCurrentTargetRole}
                  onSelect={(id) => {
                    setRoleId(id);
                    selectView("learning");
                  }}
                />
                <RecommendationPanel candidate={selectedCandidate} />
                <AiInsightPanel insight={selectedCandidate?.aiInsight ?? null} />
                <RecentCandidates candidates={candidates} onSelect={setSelectedCandidateId} />
              </aside>
            </section>
          </>
        ) : null}

        {screenView === "analyses" ? (
          <section className="screen-stack">
            <div className="screen-toolbar">
              <label className="search-box">
                <Search aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search candidates" />
              </label>
              <button className="icon-text-button" disabled={isRefreshing} onClick={() => void refreshRecords()}>
                <RefreshCw aria-hidden="true" />
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="filter-toolbar" aria-label="Candidate filters">
              <label>
                Skills
                <input value={skillFilter} onChange={(event) => setSkillFilter(event.target.value)} placeholder="java, aws" />
              </label>
              <label>
                Education
                <input value={educationFilter} onChange={(event) => setEducationFilter(event.target.value)} placeholder="Bachelor" />
              </label>
              <label>
                Location
                <input value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} placeholder="Seattle" />
              </label>
              <label>
                Min years
                <input
                  min="0"
                  type="number"
                  value={minYearsFilter}
                  onChange={(event) => setMinYearsFilter(event.target.value)}
                  placeholder="3"
                />
              </label>
            </div>
            <section className="data-grid">
              {candidateStatus === "loading" ? (
                <LoadingPanel
                  title="Loading candidates"
                  text="Refreshing saved candidate recommendations and filters."
                />
              ) : null}
              {candidateStatus === "error" ? (
                <ErrorPanel
                  title="Could not load candidates"
                  text="The candidate list did not refresh. Existing cards stay visible if they were already loaded."
                  onRetry={() => void refreshRecords()}
                />
              ) : null}
              {candidateStatus === "forbidden" ? (
                <EmptyPanel
                  title="Candidate records are restricted"
                  text="Your current role cannot view saved candidate recommendations."
                />
              ) : null}
              {candidateStatus !== "loading" && candidateStatus !== "forbidden" ? filteredCandidates.map((candidate) => (
                <article className="candidate-card" key={candidate.id}>
                  <div className="panel-heading">
                    <h2>{candidate.candidateName}</h2>
                    <em className="status-chip">{candidate.topPositions[0]?.score ?? 0}%</em>
                  </div>
                  <p>
                    {candidate.fileName}{" "}
                    <CandidateResumeFileLinks candidate={candidate} />
                  </p>
                  <strong style={{ fontSize: "13px" }}>{candidate.topPositions[0]?.role.title ?? "No recommendation"}</strong>
                  <span className="candidate-meta">
                    {(candidate.structured.skills.slice(0, 4).join(", ") || "No skills extracted")}
                    {candidate.structured.location ? ` | ${candidate.structured.location}` : ""}
                    {candidate.structured.yearsExperience !== null ? ` | ${candidate.structured.yearsExperience} yrs` : ""}
                  </span>
                  <small>{candidate.topPositions[0]?.explanation}</small>
                  <div className="candidate-card-actions">
                    {userCanSubmitRecruiterOverride ? (
                      <button
                        type="button"
                        className="icon-text-button text-left"
                        onClick={() => setOverrideCandidate(candidate)}
                      >
                        Flag recruiter override (audit-only)
                      </button>
                    ) : null}
                    {userCanDeleteCandidates ? (
                      <button
                        type="button"
                        className="icon-text-button danger-button"
                        disabled={deletingCandidateId === candidate.id}
                        aria-label={`Delete resume for ${candidate.candidateName}`}
                        onClick={() => void deleteCandidateResume(candidate)}
                      >
                        <Trash2 aria-hidden="true" />
                        {deletingCandidateId === candidate.id ? "Deleting..." : "Delete resume"}
                      </button>
                    ) : null}
                  </div>
                </article>
              )) : null}
              {candidateStatus === "ready" && !filteredCandidates.length ? (
                candidates.length > 0 ? (
                  <EmptyPanel
                    title="No matching candidates"
                    text="None of the candidates currently loaded match. Clear the search box or loosen Skill / Location / Education / Min years, then Refresh."
                  />
                ) : hasActiveServerCandidateFilters ? (
                  <EmptyPanel
                    title="No candidates match these filters"
                    text="The server returned no rows for your Skill / Location / Education / Min years filters. Clear or loosen them and press Refresh—you may have excluded an upload you just processed."
                  />
                ) : (
                  <EmptyPanel
                    title="No candidate analyses yet"
                    text="No candidates yet—upload from the Dashboard tab. Analyses are available after you process résumés."
                  />
                )
              ) : null}
            </section>
            <HistoryTable
              analyses={analyses}
              isRefreshing={isRefreshing}
              onRetry={() => void refreshRecords()}
              status={analysisHistoryStatus}
            />
          </section>
        ) : null}

        {screenView === "learning" ? (
          <section className="screen-stack">
            <div className="screen-toolbar">
              <label className="role-context learning-resume-picker">
                Resume
                <select
                  value={selectedLearningCandidate?.id ?? ""}
                  onChange={(event) => setSelectedLearningCandidateId(event.target.value)}
                  disabled={!candidates.length}
                >
                  {candidates.length ? (
                    candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.candidateName} - {candidate.fileName}
                      </option>
                    ))
                  ) : (
                    <option value="">Upload a resume first</option>
                  )}
                </select>
              </label>
              <button className="icon-text-button" type="button" disabled={isRefreshing} onClick={() => void refreshRecords()}>
                <RefreshCw aria-hidden="true" />
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <section className="metric-grid">
              <Metric label="Saved target roles" value={savedRoles.length} />
              <Metric label="Current role progress" value={savedCurrentRole ? `${savedCurrentRole.progressPercent}%` : "Not saved"} />
              <Metric
                label="Assigned modules"
                value={selectedLearningCandidate?.assignedLearningModules?.length ?? 0}
              />
            </section>
            <LearningAssignmentPanel
              busy={learningAssignmentStatus === "saving"}
              candidate={selectedLearningCandidate}
              onToggle={(moduleId, assigned) => void assignLearningModule(moduleId, assigned)}
              role={selectedRole}
            />
            <SavedRoleProgress
              roles={savedRoles}
              status={savedRolesStatus}
              onRemove={removeSavedRole}
              onSelect={setRoleId}
            />
            <LearningReportPanel report={learningReport} status={learningReportStatus} />
          </section>
        ) : null}

        {screenView === "workforce" ? (
          <section className="screen-stack">
            <div className="screen-toolbar">
              <span className="text-[13px] text-muted">
                Workforce / L&amp;D report based on saved candidate analyses in this workspace.
              </span>
              <button className="icon-text-button" type="button" disabled={isRefreshing} onClick={() => void refreshRecords()}>
                <RefreshCw aria-hidden="true" />
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <section className="metric-grid">
              <Metric label="Analyzed candidates" value={learningReport?.totalCandidates ?? candidates.length} />
              <Metric label="Top missing skills" value={learningReport?.topMissingSkills.length ?? 0} />
              <Metric
                label="Report groups"
                value={
                  learningReport
                    ? learningReport.byDepartment.length +
                      learningReport.byEmployeeGroup.length +
                      learningReport.byRoleFamily.length
                    : 0
                }
              />
            </section>
            <WorkforceReportPanel report={learningReport} status={learningReportStatus} />
            <section className="concept-panel">
              <div className="panel-heading">
                <h2>Role catalog reference</h2>
                <span>Seed catalog (demo)</span>
              </div>
              <p className="m-0 mb-3 text-[12px] leading-snug text-muted">
                Roles and skills come from bundled seed data—not live headcount or ATS openings.
              </p>
              <div className="role-matrix">
                {roles.map((role) => (
                  <article key={role.id}>
                    <strong>{role.title}</strong>
                    <span>{role.department}</span>
                    <small>{role.requiredSkills.slice(0, 5).join(", ")}</small>
                  </article>
                ))}
              </div>
            </section>
            <section className="flex flex-col gap-4 rounded-lg border border-border bg-panel p-4 shadow-md md:p-[clamp(1rem,1.15vw,1.125rem)]">
              <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-b border-border pb-3">
                <h2 className="m-0 text-[15px] font-bold tracking-tight text-[#0f172a]">Common skill gaps</h2>
                <span className="max-w-xs text-end text-xs font-semibold leading-snug text-muted sm:max-w-sm">
                  All analyzed candidates
                </span>
              </div>
              <p className="m-0 text-[13px] leading-relaxed text-muted">
                Aggregated missing skills from recent analyses (when available).
                {!workforceGaps.length && !candidates.length ? (
                  <span className="block pt-2 font-medium text-ink">
                    Illustrative gaps from the selected role&apos;s requirements appear below until résumé analyses exist.
                  </span>
                ) : null}
              </p>
              <div className="flex flex-col gap-3">
                {(workforceGaps.length
                  ? workforceGaps
                  : selectedRole.requiredSkills
                      .slice(0, 5)
                      .map((skill, index) => [skill, 5 - index] as [string, number])
                ).map(([skill, count]) => (
                  <div
                    key={skill}
                    className="grid grid-cols-1 items-center gap-x-4 gap-y-2 min-[460px]:grid-cols-[minmax(7rem,8.5rem)_minmax(0,1fr)_2.75rem]"
                  >
                    <span className="truncate text-[13px] font-medium capitalize text-ink min-[460px]:row-auto">
                      {skill}
                    </span>
                    <meter
                      className="col-span-full min-h-[6px] w-full min-w-0 appearance-none min-[460px]:col-auto"
                      value={Number(count)}
                      min={0}
                      max={workforceGapMeterMax}
                    />
                    <strong className="text-left text-[13px] font-bold tabular-nums text-muted min-[460px]:text-end">
                      {Number(count)}
                    </strong>
                  </div>
                ))}
              </div>
              <div
                role="status"
                aria-live="polite"
                aria-busy={isUploading && files.length > 0}
                className="mt-0.5 flex items-start gap-3 border-t border-border pt-3"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel text-subtle ring-1 ring-border"
                  aria-hidden={true}
                >
                  <Activity className="size-[17px]" strokeWidth={2} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[12px] font-bold uppercase tracking-wide text-subtle">Browser upload staging</span>
                  <p className="m-0 text-[13px] font-medium leading-snug text-ink">
                    {isUploading && files.length > 0 ? (
                      <>
                        <span className="font-semibold text-brand">{files.length}</span> file
                        {files.length === 1 ? "" : "s"} queued in this browser before analysis runs—not a server job queue.
                      </>
                    ) : (
                      <span className="text-muted">Nothing staged in your browser queue.</span>
                    )}
                  </p>
                </div>
              </div>
            </section>
          </section>
        ) : null}

        {screenView === "audit" ? (
          <section className="screen-stack">
            <AdminAlertsPanel
              alerts={adminAlerts}
              status={adminAlertStatus}
              isRefreshing={isRefreshing}
              onResolve={async (alertId) => {
                const response = await fetch(`/api/admin-alerts/${alertId}/resolve`, { method: "POST" });
                if (response.ok) {
                  setNotice("Alert resolved.");
                  void refreshRecords();
                } else {
                  setNotice("Could not resolve alert.");
                }
              }}
              onSeedDemo={async () => {
                const response = await fetch("/api/admin-alerts", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    source: "sync",
                    severity: "info",
                    message: "Demo: future sync integration placeholder (no live integration yet).",
                  }),
                });
                if (response.ok) {
                  setNotice("Recorded a placeholder sync alert for demo purposes.");
                  void refreshRecords();
                } else {
                  setNotice("Could not record placeholder alert.");
                }
              }}
              onRetry={() => void refreshRecords()}
            />
            <section className="concept-panel audit-log-panel">
              <div className="panel-heading">
                <h2>Audit Log</h2>
                <span>{user.role === "system_admin" ? `${auditEvents.length} events` : "Admin only"}</span>
              </div>
              {user.role === "system_admin" ? (
                <>
                  <AuditIntegrityBanner integrity={auditIntegrity} />
                  <AuditFilterToolbar
                    filters={auditFilters}
                    onChange={setAuditFilters}
                    onApply={() => void refreshRecords()}
                    isRefreshing={isRefreshing}
                  />
                  <div className="mb-3 flex flex-wrap justify-end gap-2">
                    <button className="icon-text-button" type="button" disabled={isRefreshing} onClick={() => void refreshRecords()}>
                      <RefreshCw aria-hidden="true" />
                      {isRefreshing ? "Refreshing..." : "Refresh log"}
                    </button>
                  </div>
                  <AuditTable events={auditEvents} isRefreshing={isRefreshing} onRetry={() => void refreshRecords()} status={auditStatus} />
                </>
              ) : (
                <EmptyPanel
                  title="Restricted screen"
                  text="System administrators can view login, upload, and override events."
                />
              )}
            </section>
          </section>
        ) : null}

        {screenView === "settings" ? (
          <section className="screen-stack">
            <SettingsPanel
              demoPreferences={demoPreferences}
              onPreferenceChange={setDemoPreferences}
              onSavePreferences={() => void saveDemoPreferences()}
              roleAccessSummary={roleAccessSummary}
              runtimeHealth={runtimeHealth}
              runtimeStatus={runtimeStatus}
              user={user}
            />
            <section className="concept-panel settings-grid hidden">
              <div>
                <h2>Account</h2>
                <p>{user.name}</p>
                <strong>{user.email}</strong>
                <span>{user.role.replace("_", " ")}</span>
              </div>
              <div>
                <h2>MVP Controls</h2>
                <p>Demo accounts for this build are defined in server configuration.</p>
                <p>Session lifetime is eight hours.</p>
                <p className="m-0 text-[13px] leading-relaxed text-muted">
                  Persistence follows the workspace status above — memory mode keeps analyses only until the server restarts;
                  Postgres with migrations lets uploads and audit rows survive restarts.
                </p>
              </div>
            </section>
          </section>
        ) : null}
        </section>
      </div>

      <RecruiterOverrideModal
        key={overrideCandidate?.id ?? "closed"}
        candidate={overrideCandidate}
        onClose={() => setOverrideCandidate(null)}
        refreshRecords={() => void refreshRecords()}
        onRecordedNotice={(note) => setNotice(note)}
      />
    </main>
  );
}
