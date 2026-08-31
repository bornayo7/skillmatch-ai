"use client";

import type { AccessArea } from "@/lib/auth-permissions";

export type SkillGapChartItem = {
  skill: string;
  source: "required" | "preferred";
  status: "matched" | "gap";
  importance: "critical" | "important";
  coverage: number;
};

export type View = "dashboard" | "analyses" | "learning" | "workforce" | "audit" | "settings";
export type LoadStatus = "loading" | "ready" | "forbidden" | "error";
export type NavAccess = "all" | "candidate_analysis" | AccessArea;

export type RuntimeHealth = {
  status: string;
  database?: {
    configured: boolean;
    mode: string;
    schemaReady: boolean;
    missingTables: readonly string[];
    missingColumns?: readonly string[];
  };
  storage?: {
    configured: boolean;
    provider: string;
    mode: string;
    persistent: boolean;
    publicBaseUrlConfigured: boolean;
    objectDeletionSupported: boolean;
    error?: string;
  };
  auth?: {
    demoCredentialsActive: boolean;
  };
  error?: string;
};

export type DemoSettingsPreferences = {
  defaultRoleId: string;
  showParserFailureDetails: boolean;
  compactCandidateCards: boolean;
  adminReviewMode: boolean;
};

export function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}
