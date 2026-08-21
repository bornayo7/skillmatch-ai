"use client";

import { BookmarkCheck, GraduationCap, Target, Trash2, X } from "lucide-react";
import type { RoleRequirement } from "@/lib/seed-data";
import type { SavedTargetRole } from "@/lib/db";
import type { LearningReport, LearningReportGroup } from "@/lib/learning-report";
import type { CandidateAnalysis } from "@/lib/skillmatch";
import type { LoadStatus } from "./shared";
import { EmptyPanel, LoadingPanel } from "./status-panels";

function learningModuleId(roleId: string, skill: string) {
  return `${roleId}:${skill}`;
}

export function WorkforceReportPanel({ report, status }: { report: LearningReport | null; status: LoadStatus }) {
  if (status === "loading") {
    return <LoadingPanel title="Building Workforce report" text="Aggregating missing skills by department, employee group, and role family." />;
  }

  if (status === "forbidden") {
    return (
      <EmptyPanel
        title="Workforce report restricted"
        text="Learning and development or system administrator access is required for workforce skill-gap reporting."
      />
    );
  }

  if (status === "error") {
    return (
      <EmptyPanel
        title="Workforce report unavailable"
        text="The grouped skill-gap report could not be loaded. Refresh the workspace and try again."
      />
    );
  }

  if (!report || report.totalCandidates === 0) {
    return (
      <EmptyPanel
        title="No Workforce report data yet"
        text="Upload and analyze resumes first. This page will then group common skill gaps for L&D planning."
      />
    );
  }

  return (
    <section className="concept-panel" data-testid="workforce-report-panel">
      <div className="panel-heading">
        <h2>Workforce / L&amp;D skill-gap report</h2>
        <span>{report.totalCandidates} analyzed</span>
      </div>
      <p className="m-0 mb-3 text-[13px] leading-relaxed text-muted">
        Groups missing skills from candidate recommendations into MVP workforce views for learning planning.
      </p>
      <div className="workforce-report-grid">
        <div>
          <h3>Top missing skills</h3>
          <ul className="workforce-skill-list">
            {report.topMissingSkills.map((gap) => (
              <li key={gap.skill}>
                <strong>{gap.skill}</strong>
                <span>{gap.affectedCandidates} affected candidate{gap.affectedCandidates === 1 ? "" : "s"}</span>
                <em>{gap.recommendation}</em>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <LearningReportColumn title="By department" groups={report.byDepartment} />
          <LearningReportColumn title="By employee group" groups={report.byEmployeeGroup} />
          <LearningReportColumn title="By role family" groups={report.byRoleFamily} />
        </div>
      </div>
    </section>
  );
}

export function SavedTargetRolesPanel({
  currentRoleSaved,
  roles,
  status,
  bookmarkDisabled,
  bookmarkDisabledReason,
  onRemove,
  onSave,
  onSelect
}: {
  currentRoleSaved: boolean;
  roles: SavedTargetRole[];
  status: LoadStatus;
  bookmarkDisabled?: boolean;
  bookmarkDisabledReason?: string;
  onRemove: (id: string) => void;
  onSave: () => void;
  onSelect: (roleId: string) => void;
}) {
  return (
    <section className="concept-panel saved-target-panel" aria-labelledby="saved-target-roles-heading">
      <div className="panel-heading">
        <h2 id="saved-target-roles-heading">Saved Target Roles</h2>
        <span>{status === "loading" ? "..." : roles.length}</span>
      </div>
      <p id="saved-target-roles-help" className="m-0 mb-3 text-[12px] leading-snug text-muted">
        Candidates are persisted when you run analysis (see <strong className="font-semibold text-ink">Analyses</strong>).
        Bookmark the <strong className="font-semibold text-ink">job role</strong> in the header to pin gap tracking and demo
        learning picks—optional, separate from storing résumés.
      </p>
      <button
        className="primary-action"
        type="button"
        onClick={onSave}
        aria-describedby="saved-target-roles-help"
        disabled={Boolean(bookmarkDisabled)}
        title={bookmarkDisabled ? bookmarkDisabledReason : undefined}
      >
        <BookmarkCheck aria-hidden="true" />
        {currentRoleSaved ? "Refresh bookmark & snapshot" : "Bookmark role for Learning"}
      </button>
      {status === "loading" ? (
        <p className="list-placeholder" role="status">
          Loading saved target roles...
        </p>
      ) : null}
      {status === "error" ? (
        <p className="error-message" role="alert">
          Could not load saved target roles. Use Refresh to try again.
        </p>
      ) : null}
      {status !== "loading" && roles.length ? (
        <ul className="saved-role-list">
          {roles.slice(0, 3).map((role) => (
            <li key={role.id}>
              <button type="button" onClick={() => onSelect(role.roleId)}>
                <Target aria-hidden="true" />
                <span>
                  <strong>{role.roleTitle}</strong>
                  <small>{role.currentScore === null ? "No score yet" : `${role.currentScore}% current match`}</small>
                </span>
                <em>{role.progressPercent}%</em>
              </button>
              <button
                aria-label={`Remove ${role.roleTitle}`}
                className="queue-icon-button"
                onClick={() => onRemove(role.id)}
                title={`Remove ${role.roleTitle}`}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : status === "ready" && !roles.length ? (
        <p className="list-placeholder">Bookmark a role above to unlock Learning progress—not required to keep analyzed candidates.</p>
      ) : null}
    </section>
  );
}

export function SavedRoleProgress({
  roles,
  status,
  onRemove,
  onSelect
}: {
  roles: SavedTargetRole[];
  status: LoadStatus;
  onRemove: (id: string) => void;
  onSelect: (roleId: string) => void;
}) {
  return (
    <section className="concept-panel">
      <div className="panel-heading">
        <h2>Target Role Progress</h2>
        <span>{status === "loading" ? "Loading" : roles.length ? "Employee plan" : "No saved targets"}</span>
      </div>
      {status === "loading" ? (
        <p className="list-placeholder" role="status">
          Loading target roles...
        </p>
      ) : null}
      {status === "error" ? (
        <p className="error-message" role="alert">
          Could not load target role progress. Use Refresh to try again.
        </p>
      ) : null}
      {status !== "loading" && roles.length ? (
        <div className="saved-progress-grid">
          {roles.map((role) => (
            <article key={role.id}>
              <div>
                <strong>{role.roleTitle}</strong>
                <span>{role.missingSkills.length ? `${role.missingSkills.slice(0, 3).join(", ")} gaps` : "No tracked gaps"}</span>
              </div>
              <meter min={0} max={100} value={role.progressPercent} />
              <em>{role.progressPercent}% to {role.targetScore}% goal</em>
              <button className="icon-text-button" type="button" onClick={() => onSelect(role.roleId)}>
                <Target aria-hidden="true" />
                View learning
              </button>
              <button className="queue-icon-button" type="button" onClick={() => onRemove(role.id)} aria-label={`Remove ${role.roleTitle}`}>
                <Trash2 aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      ) : status === "ready" && !roles.length ? (
        <p className="list-placeholder">
          No saved target roles yet. Bookmark a comparison role from the dashboard sidebar to track gap progress on
          Learning. Uploaded candidates already appear under Analyses; that action only pins the job role for progress.
        </p>
      ) : null}
    </section>
  );
}

export function LearningAssignmentPanel({
  busy,
  candidate,
  onToggle,
  role
}: {
  busy: boolean;
  candidate?: CandidateAnalysis;
  onToggle: (moduleId: string, assigned: boolean) => void;
  role: RoleRequirement;
}) {
  const assignedModules = new Set(candidate?.assignedLearningModules ?? []);
  const candidateMissingSkills = new Set(
    candidate?.topPositions.find((position) => position.role.id === role.id)?.missingSkills.map((gap) => gap.skill) ??
      candidate?.topPositions[0]?.missingSkills.map((gap) => gap.skill) ??
      []
  );

  return (
    <section className="concept-panel">
      <div className="panel-heading">
        <h2>Learning Module Assignments</h2>
        <span>{candidate ? role.title : "No resume selected"}</span>
      </div>
      {candidate ? (
        <>
          <p className="m-0 mb-3 text-[12px] leading-snug text-muted">
            Assign role-specific learning modules directly to {candidate.candidateName}&apos;s saved resume.
          </p>
          <div className="learning-grid">
            {Object.entries(role.learning).map(([skill, course]) => {
              const moduleId = learningModuleId(role.id, skill);
              const assigned = assignedModules.has(moduleId);
              const recommended = candidateMissingSkills.has(skill);
              return (
                <article className={`learning-item learning-assignment-item ${assigned ? "is-assigned" : ""}`} key={moduleId}>
                  <GraduationCap aria-hidden="true" />
                  <div>
                    <strong>{course}</strong>
                    <span>
                      {skill}
                      {recommended ? " - gap match" : ""}
                    </span>
                  </div>
                  <button
                    className={assigned ? "icon-text-button assigned-module-button" : "icon-text-button"}
                    disabled={busy}
                    onClick={() => onToggle(moduleId, !assigned)}
                    type="button"
                  >
                    {assigned ? "Assigned" : "Assign"}
                  </button>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <p className="list-placeholder">Upload and analyze a resume, then assign learning modules from this screen.</p>
      )}
    </section>
  );
}

export function LearningReportPanel({ report, status }: { report: LearningReport | null; status: LoadStatus }) {
  return (
    <section className="concept-panel" aria-labelledby="learning-report-heading" data-testid="learning-report-panel">
      <div className="panel-heading">
        <h2 id="learning-report-heading">L&amp;D skill-gap report</h2>
        <span>
          {status === "loading"
            ? "..."
            : status === "forbidden"
              ? "L&D only"
              : report
                ? `${report.totalCandidates} candidates`
                : "—"}
        </span>
      </div>
      <p className="m-0 mb-3 text-[12px] leading-snug text-muted">
        Aggregates missing skills from analyzed candidates by department, employee group, and role family. Visible to
        learning &amp; development and system administrators only.
      </p>
      {status === "loading" ? <p className="list-placeholder">Building report…</p> : null}
      {status === "forbidden" ? (
        <p className="list-placeholder">Learning and development access required.</p>
      ) : null}
      {status === "error" ? (
        <p className="error-message" role="alert">
          Could not load the learning report. Try refreshing.
        </p>
      ) : null}
      {status === "ready" && report ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <LearningReportColumn title="By department" groups={report.byDepartment} />
          <LearningReportColumn title="By employee group" groups={report.byEmployeeGroup} />
          <LearningReportColumn title="By role family" groups={report.byRoleFamily} />
        </div>
      ) : null}
    </section>
  );
}

export function LearningReportColumn({ title, groups }: { title: string; groups: LearningReportGroup[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-[13px] font-bold uppercase tracking-wide text-subtle">{title}</h3>
      {groups.length === 0 ? (
        <p className="list-placeholder">No data yet — analyze a few resumes to populate this view.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {groups.map((group) => (
            <li
              key={`${group.dimension}-${group.groupId}`}
              className="rounded-lg border border-border bg-panel px-3 py-2 text-[13px]"
              data-testid={`learning-report-group-${group.dimension}`}
            >
              <div className="flex items-center justify-between gap-2">
                <strong className="font-semibold text-ink">{group.groupName}</strong>
                <span className="status-chip">{group.candidateCount} candidate{group.candidateCount === 1 ? "" : "s"}</span>
              </div>
              {group.topMissingSkills.length ? (
                <ul className="mt-2 space-y-1 list-disc pl-4 text-muted">
                  {group.topMissingSkills.map((skill) => (
                    <li key={skill.skill}>
                      <span className="text-ink">{skill.skill}</span> — {skill.affectedCandidates} affected ·{" "}
                      <em>{skill.recommendation}</em>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-muted">No recurring gaps in the current sample.</p>
              )}
              <p className="mt-2 text-[12px] font-medium text-ink">{group.prioritizedRecommendation}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
