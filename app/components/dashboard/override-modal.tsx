"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { roles } from "@/lib/seed-data";
import type { CandidateAnalysis } from "@/lib/skillmatch";

export function RecruiterOverrideModal({
  candidate,
  onClose,
  refreshRecords,
  onRecordedNotice,
}: {
  candidate: CandidateAnalysis | null;
  onClose: () => void;
  refreshRecords: () => void | Promise<void>;
  onRecordedNotice: (note: string) => void;
}) {
  if (!candidate) {
    return null;
  }

  return (
    <RecruiterOverrideModalInner
      candidate={candidate}
      onClose={onClose}
      refreshRecords={refreshRecords}
      onRecordedNotice={onRecordedNotice}
    />
  );
}

export function RecruiterOverrideModalInner({
  candidate,
  onClose,
  refreshRecords,
  onRecordedNotice,
}: {
  candidate: CandidateAnalysis;
  onClose: () => void;
  refreshRecords: () => void | Promise<void>;
  onRecordedNotice: (note: string) => void;
}) {
  const [promotedRoleId, setPromotedRoleId] = useState(() => candidate.topPositions[0]?.role.id ?? roles[0].id);
  const [reason, setReason] = useState("Cross-team priority after panel review.");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrorMsg("");
    try {
      const response = await fetch("/api/override", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: candidate.id,
          promotedRole: promotedRoleId,
          reason,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setErrorMsg(payload.error ?? "Override request failed.");
        return;
      }
      onRecordedNotice(
        "Recruiter override logged to the audit trail. In this demo it does not alter stored match scores.",
      );
      await refreshRecords();
      onClose();
    } catch {
      setErrorMsg("Override request failed unexpectedly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      aria-labelledby="override-dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      onClick={onClose}
    >
      <form
        className="w-full max-w-md rounded-lg border border-border bg-panel p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="override-dialog-title" className="m-0 text-base font-bold text-ink">
          Flag recruiter override
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          This records a decision in the audit log for stakeholders. It does <strong>not</strong> rewrite stored
          SkillMatch scores yet.
        </p>
        <p className="mt-1 text-[12px] text-subtle">
          Candidate: <span className="font-semibold text-ink">{candidate.candidateName}</span> · file{" "}
          {candidate.fileName}
        </p>
        <label className="role-context mt-4">
          Promoted role emphasis
          <select
            value={promotedRoleId}
            onChange={(e) => setPromotedRoleId(e.target.value)}
            required
            disabled={busy}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.title}
              </option>
            ))}
          </select>
        </label>
        <label className="role-context mt-3">
          Reason (shown in audit metadata)
          <textarea
            className="min-h-[76px] w-full resize-y rounded-[var(--radius-sm)] border border-border bg-panel px-3 py-2 text-[13px] font-medium text-ink"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            minLength={3}
          />
        </label>
        {errorMsg ? (
          <p className="error-message mt-3" role="alert">
            {errorMsg}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="icon-text-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="run-button mt-0 max-w-none min-h-[38px]" disabled={busy}>
            {busy ? "Recording…" : "Record audit entry"}
          </button>
        </div>
      </form>
    </div>
  );
}
