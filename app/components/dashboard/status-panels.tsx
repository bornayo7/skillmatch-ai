"use client";

import { AlertTriangle, LockKeyhole, RefreshCw } from "lucide-react";
import type { SessionUser } from "@/lib/auth-model";
import type { View } from "./shared";

function getRestrictedViewCopy(view: View) {
  if (view === "analyses") {
    return {
      title: "Analyses",
      text: "Recruiters, hiring managers, learning and development, and system administrators can view organization-wide analysis history."
    };
  }
  if (view === "learning") {
    return {
      title: "Learning",
      text: "Learning and development or system administrator access is required to assign modules to saved candidate resumes."
    };
  }
  if (view === "workforce") {
    return {
      title: "Workforce",
      text: "Learning and development or system administrator access is required for workforce skill-gap reporting."
    };
  }
  return {
    title: "Audit Log",
    text: "System administrators can view login, upload, recommendation, and recruiter override events."
  };
}

export function EmptyPanel({ title, text }: { title: string; text: string }) {
  return (
    <article className="concept-panel empty-panel">
      <h2>{title}</h2>
      <p>{text}</p>
    </article>
  );
}

export function LoadingPanel({ title, text }: { title: string; text: string }) {
  return (
    <article className="concept-panel empty-panel loading-panel" role="status" aria-live="polite">
      <RefreshCw aria-hidden="true" />
      <h2>{title}</h2>
      <p>{text}</p>
    </article>
  );
}

export function ErrorPanel({
  title,
  text,
  onRetry,
}: {
  title: string;
  text: string;
  onRetry: () => void;
}) {
  return (
    <article className="concept-panel empty-panel error-panel" role="alert">
      <AlertTriangle aria-hidden="true" />
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="icon-text-button" type="button" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        Retry
      </button>
    </article>
  );
}

export function RestrictedView({ user, view }: { user: SessionUser; view: View }) {
  const copy = getRestrictedViewCopy(view);
  return (
    <section className="screen-stack">
      <article className="concept-panel restricted-panel">
        <LockKeyhole aria-hidden="true" />
        <div>
          <h2>Restricted access: {copy.title}</h2>
          <p>{copy.text}</p>
          <span>Current role: {user.role.replace("_", " ")}</span>
        </div>
      </article>
    </section>
  );
}

export function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <article className="concept-panel metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
