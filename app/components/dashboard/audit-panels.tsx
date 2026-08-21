"use client";

import { AlertTriangle, RefreshCw, Search, ShieldCheck } from "lucide-react";
import type { AdminAlert, AnalysisRecord, AuditEvent } from "@/lib/db";
import type { LoadStatus } from "./shared";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "./status-panels";

export function HistoryTable({
  analyses,
  isRefreshing,
  onRetry,
  status,
}: {
  analyses: AnalysisRecord[];
  isRefreshing: boolean;
  onRetry: () => void;
  status: LoadStatus;
}) {
  return (
    <section className="concept-panel audit-log-panel">
      <div className="panel-heading">
        <h2>Analysis History</h2>
        <span>
          {status === "forbidden" ? "—" : status === "loading" ? "…" : analyses.length}
        </span>
      </div>
      {status === "loading" ? (
        <p className="m-0 text-[13px] text-muted">Loading analysis history…</p>
      ) : null}
      {status === "forbidden" ? (
        <div className="rounded-lg border border-border-strong bg-brand-light px-3 py-3 text-[13px] leading-relaxed text-ink">
          <strong className="font-semibold">Analysis history is limited by role</strong>
          <p className="m-0 mt-2 text-muted">
            Standard employee accounts do not see organization-wide analysis history. Recruiter, hiring manager,
            learning and development, and system admin roles do. Your SkillMatch overview and candidate cards
            above still reflect résumés processed in this session.
          </p>
        </div>
      ) : null}
      {status === "error" ? (
        <div className="error-message m-0 flex flex-wrap items-center justify-between gap-2 text-[13px]" role="alert">
          <span>Could not load analysis history. Try again in a moment.</span>
          <button className="icon-text-button" type="button" disabled={isRefreshing} onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            {isRefreshing ? "Refreshing..." : "Retry history"}
          </button>
        </div>
      ) : null}
      {status === "ready" || (status === "error" && analyses.length > 0) ? (
        <div className="audit-log-table">
          <div className="audit-log-row head">
            <span>Candidate</span>
            <span>Target Role</span>
            <span>Score</span>
            <span>Created</span>
          </div>
          {analyses.map((analysis) => (
            <div className="audit-log-row" key={analysis.id}>
              <span>{analysis.employeeName}</span>
              <span>{analysis.targetRole}</span>
              <span className="status-chip">{analysis.score}%</span>
              <span>{new Date(analysis.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      ) : null}
      {status === "ready" && analyses.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">
          No history rows yet—history is appended when uploads save successfully after analysis.
        </p>
      ) : null}
    </section>
  );
}

export function AuditTable({
  events,
  isRefreshing,
  onRetry,
  status,
}: {
  events: AuditEvent[];
  isRefreshing: boolean;
  onRetry: () => void;
  status: LoadStatus;
}) {
  if (status === "loading") {
    return <LoadingPanel title="Loading audit events" text="Refreshing the latest admin audit trail." />;
  }

  if (status === "forbidden") {
    return (
      <EmptyPanel
        title="Audit log restricted"
        text="System administrator access is required for login, upload, recommendation, and override events."
      />
    );
  }

  if (status === "error") {
    return (
      <ErrorPanel
        title="Could not load audit log"
        text="The audit log refresh failed. Existing events stay visible if they were already loaded."
        onRetry={onRetry}
      />
    );
  }

  if (!events.length) {
    return (
      <EmptyPanel
        title="No audit events yet"
        text="Login, uploads, recommendations, and recruiter overrides appear here after activity."
      />
    );
  }
  return (
    <div className="audit-log-table" aria-busy={isRefreshing}>
      <div className="audit-log-row head">
        <span>Date & Time</span>
        <span>Action</span>
        <span>Actor</span>
        <span>Status</span>
      </div>
      {events.map((event) => (
        <div className="audit-log-row" key={event.id}>
          <span>{new Date(event.createdAt).toLocaleString()}</span>
          <span>{event.action.replaceAll("_", " ")}</span>
          <span>
            {event.actor}
            {event.actorRole ? (
              <em className="block text-[11px] uppercase tracking-wide text-subtle">
                {event.actorRole.replace("_", " ")}
              </em>
            ) : null}
          </span>
          <span className="status-chip">Recorded</span>
        </div>
      ))}
    </div>
  );
}

export function AuditIntegrityBanner({ integrity }: { integrity: { ok: boolean; issues: number } }) {
  if (integrity.ok) {
    return (
      <div
        data-testid="audit-integrity-banner"
        className="mb-3 rounded-lg border border-border bg-brand-light px-3 py-2 text-[13px] font-medium text-ink"
      >
        <ShieldCheck aria-hidden="true" className="inline-icon" /> Audit hash chain verified - no tampering detected.
      </div>
    );
  }
  return (
    <div
      data-testid="audit-integrity-banner"
      className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-700"
      role="alert"
    >
      <AlertTriangle aria-hidden="true" className="inline-icon" /> Audit chain integrity check failed
      {integrity.issues > 0 ? ` (${integrity.issues} issue${integrity.issues === 1 ? "" : "s"})` : ""}.
      Investigate before trusting recent events.
    </div>
  );
}

export function AuditFilterToolbar({
  filters,
  onChange,
  onApply,
  isRefreshing,
}: {
  filters: { action: string; actor: string; entityId: string; startDate: string; endDate: string };
  onChange: (next: { action: string; actor: string; entityId: string; startDate: string; endDate: string }) => void;
  onApply: () => void;
  isRefreshing: boolean;
}) {
  return (
    <form
      className="filter-toolbar mb-3"
      aria-label="Audit log filters"
      data-testid="audit-filter-toolbar"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <label>
        Action
        <input
          value={filters.action}
          onChange={(event) => onChange({ ...filters, action: event.target.value })}
          placeholder="login"
        />
      </label>
      <label>
        Actor
        <input
          value={filters.actor}
          onChange={(event) => onChange({ ...filters, actor: event.target.value })}
          placeholder="admin@"
        />
      </label>
      <label>
        Entity ID
        <input
          value={filters.entityId}
          onChange={(event) => onChange({ ...filters, entityId: event.target.value })}
          placeholder="candidate-…"
        />
      </label>
      <label>
        From
        <input
          type="date"
          value={filters.startDate}
          onChange={(event) => onChange({ ...filters, startDate: event.target.value })}
        />
      </label>
      <label>
        To
        <input
          type="date"
          value={filters.endDate}
          onChange={(event) => onChange({ ...filters, endDate: event.target.value })}
        />
      </label>
      <button className="icon-text-button" type="submit" disabled={isRefreshing}>
        <Search aria-hidden="true" />
        Apply filters
      </button>
    </form>
  );
}

export function AdminAlertsPanel({
  alerts,
  status,
  isRefreshing,
  onResolve,
  onSeedDemo,
  onRetry,
}: {
  alerts: AdminAlert[];
  status: LoadStatus;
  isRefreshing: boolean;
  onResolve: (id: string) => void | Promise<void>;
  onSeedDemo: () => void | Promise<void>;
  onRetry: () => void;
}) {
  const openCount = alerts.filter((alert) => alert.status === "open").length;
  return (
    <section className="concept-panel" aria-labelledby="admin-alerts-heading" data-testid="admin-alerts-panel">
      <div className="panel-heading">
        <h2 id="admin-alerts-heading">Operational alerts</h2>
        <span>
          {status === "loading" ? "..." : status === "forbidden" ? "Admin only" : `${openCount} open`}
        </span>
      </div>
      <p className="m-0 mb-3 text-[12px] leading-snug text-muted">
        Storage, database, upload, and future sync failures land here. Future sync alerts are placeholder/demo
        simulations until real integrations exist.
      </p>
      {status === "loading" ? <p className="list-placeholder">Loading alerts…</p> : null}
      {status === "forbidden" ? (
        <p className="list-placeholder">System administrator access required.</p>
      ) : null}
      {status === "error" ? (
        <ErrorPanel
          title="Could not load alerts"
          text="The alert refresh failed. Try again in a moment."
          onRetry={onRetry}
        />
      ) : null}
      {status === "ready" && alerts.length === 0 ? (
        <p className="list-placeholder">No operational alerts. Seed a demo placeholder if you want to demo the workflow.</p>
      ) : null}
      {status === "ready" && alerts.length > 0 ? (
        <ul className="m-0 list-none space-y-2 p-0">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className="flex flex-col gap-1 rounded-lg border border-border bg-panel px-3 py-2 text-[13px]"
              data-testid={`admin-alert-${alert.severity}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="font-semibold text-ink">{alert.message}</strong>
                <span
                  className={`status-chip ${alert.severity === "critical" ? "border-red-300 text-red-700" : ""}`}
                >
                  {alert.severity} · {alert.status}
                </span>
              </div>
              <span className="text-muted">
                {alert.source} · {new Date(alert.createdAt).toLocaleString()}
                {alert.resolvedBy ? ` · resolved by ${alert.resolvedBy}` : ""}
              </span>
              {alert.status === "open" ? (
                <div>
                  <button
                    type="button"
                    className="icon-text-button"
                    disabled={isRefreshing}
                    onClick={() => void onResolve(alert.id)}
                  >
                    Mark resolved
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {status === "ready" ? (
        <div className="mt-3">
          <button
            type="button"
            className="icon-text-button"
            disabled={isRefreshing}
            onClick={() => void onSeedDemo()}
          >
            Add demo sync placeholder
          </button>
        </div>
      ) : null}
    </section>
  );
}
