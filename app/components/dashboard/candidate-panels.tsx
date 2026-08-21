"use client";

import {
  AlertTriangle,
  BookmarkCheck,
  CheckCircle2,
  ChevronRight,
  FileText,
  Sparkles
} from "lucide-react";
import type { CandidateAnalysis } from "@/lib/skillmatch";
import type { SkillGapChartItem } from "./shared";

function candidateHasStoredResumeFile(candidate: Pick<CandidateAnalysis, "storageUrl" | "fileName">) {
  return Boolean(candidate.storageUrl?.trim() && candidate.fileName?.trim());
}

export function CandidateResumeFileLinks({ candidate }: { candidate: CandidateAnalysis }) {
  if (!candidateHasStoredResumeFile(candidate)) {
    return null;
  }
  const hrefBase = `/api/candidates/${candidate.id}/resume`;
  const isPdf = candidate.fileName.toLowerCase().endsWith(".pdf");
  return (
    <span className="candidate-resume-links">
      <a
        className="resume-download-link"
        href={`${hrefBase}?view=1`}
        target="_blank"
        rel="noopener noreferrer"
      >
        View résumé
      </a>
      <span className="candidate-resume-links-sep" aria-hidden="true">
        ·
      </span>
      <a className="resume-download-link" href={hrefBase}>
        {isPdf ? "Download PDF" : "Download file"}
      </a>
    </span>
  );
}

export function SkillList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3>
        <CheckCircle2 aria-hidden="true" />
        {title}
      </h3>
      {items.length ? (
        <ul className="match-table">
          {items.map((skill) => (
            <li key={skill}>
              <span>{skill}</span>
              <small>Matched</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="list-placeholder">Upload a resume to see matched skills.</p>
      )}
    </div>
  );
}

export function GapList({ gaps }: { gaps: CandidateAnalysis["topPositions"][number]["missingSkills"] }) {
  return (
    <div>
      <h3>
        <AlertTriangle aria-hidden="true" />
        Missing Skills
      </h3>
      {gaps.length ? (
        <ul className="gap-table">
          {gaps.map((gap) => (
            <li key={gap.skill}>
              <span>{gap.skill}</span>
              <small>{gap.importance}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="list-placeholder">No gaps to display yet.</p>
      )}
    </div>
  );
}

export function ReadinessSignals({ result }: { result?: CandidateAnalysis["topPositions"][number] }) {
  if (!result) {
    return (
      <div>
        <h3>
          <BookmarkCheck aria-hidden="true" />
          Readiness Signals
        </h3>
        <p className="list-placeholder">Upload a resume to compare experience, certifications, and soft skills.</p>
      </div>
    );
  }

  const details = result.explanationDetails;
  const experience = details?.experience ?? {
    candidateYears: result.structured.yearsExperience,
    minimumYears: result.role.minimumYearsExperience,
    idealYears: result.role.idealYearsExperience
  };
  const certifications = details?.certifications ?? { matched: 0, total: 0 };
  const softSkills = details?.softSkills ?? { matched: 0, total: 0 };

  return (
    <div>
      <h3>
        <BookmarkCheck aria-hidden="true" />
        Readiness Signals
      </h3>
      <ul className="match-table">
        <li>
          <span>Experience</span>
          <small>
            {experience.candidateYears ?? "Unknown"} yrs vs {experience.minimumYears}-{experience.idealYears}+ target
          </small>
        </li>
        <li>
          <span>Certifications</span>
          <small>{certifications.matched}/{certifications.total} matched</small>
        </li>
        <li>
          <span>Soft skills</span>
          <small>{softSkills.matched}/{softSkills.total} matched</small>
        </li>
      </ul>
    </div>
  );
}

export function RoleSkillGapChart({
  candidateName,
  items,
  roleTitle
}: {
  candidateName?: string;
  items: SkillGapChartItem[];
  roleTitle: string;
}) {
  const chartW = 560;
  const barX = 208;
  const barW = 260;
  const metaX = 548;
  const chartHeight = Math.max(items.length * 42 + 28, 180);

  if (!items.length) {
    return (
      <section
        className="skill-gap-chart-panel skill-gap-chart-panel--empty"
        aria-labelledby="skill-gap-chart-title"
      >
        <div className="panel-heading">
          <h3 id="skill-gap-chart-title">Role Skill-Gap Chart</h3>
        </div>
        <p className="chart-caption">
          Upload a resume and run analysis to see skill coverage for {roleTitle}.
        </p>
        <div className="chart-placeholder" />
      </section>
    );
  }

  return (
    <section className="skill-gap-chart-panel" aria-labelledby="skill-gap-chart-title">
      <div className="panel-heading">
        <h3 id="skill-gap-chart-title">Role Skill-Gap Chart</h3>
        <span>{candidateName ?? "Candidate"}</span>
      </div>
      <p className="chart-caption">
        {`${candidateName ?? "Candidate"}'s coverage for ${roleTitle}. Green bars are matched skills; shorter bars are gaps (required vs preferred).`}
      </p>
      <figure
        className="skill-gap-chart-figure"
        aria-label={`${roleTitle} skill coverage chart`}
      >
        <svg
          aria-labelledby="skill-gap-chart-title"
          className="skill-gap-chart"
          role="img"
          viewBox={`0 0 ${chartW} ${chartHeight}`}
        >
          {items.map((item, index) => {
            const y = 18 + index * 42;
            const fillWidth = Math.max(36, Math.round((item.coverage / 100) * barW));
            const barClassName = [
              "chart-bar-fill",
              item.status === "matched" ? "is-matched" : "",
              item.source === "required" ? "is-required" : "is-preferred"
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <g key={item.skill} transform={`translate(0 ${y})`}>
                <text className="chart-skill-label" x="0" y="14">
                  {item.skill}
                </text>
                <rect className="chart-bar-track" height="14" rx="7" ry="7" width={barW} x={barX} y="0" />
                <rect className={barClassName} height="14" rx="7" ry="7" width={fillWidth} x={barX} y="0" />
                <text className="chart-meta-label" x={metaX} y="12">
                  {item.status === "matched" ? "Matched" : item.importance}
                </text>
              </g>
            );
          })}
        </svg>
        <figcaption className="chart-legend">
          <span>
            <i className="legend-swatch matched" aria-hidden="true" />
            Matched skill
          </span>
          <span>
            <i className="legend-swatch preferred" aria-hidden="true" />
            Preferred gap
          </span>
          <span>
            <i className="legend-swatch critical" aria-hidden="true" />
            Required gap
          </span>
        </figcaption>
      </figure>
    </section>
  );
}

export function AiInsightPanel({ insight }: { insight: CandidateAnalysis["aiInsight"] }) {
  return (
    <section className="concept-panel ai-insight-panel">
      <div className="panel-heading">
        <h2>
          <Sparkles aria-hidden="true" className="inline-icon" />
          AI resume review
        </h2>
        <span>Advisory</span>
      </div>
      {insight ? (
        <div className="ai-insight-body">
          <p className="ai-insight-summary">{insight.summary}</p>
          <div className="ai-insight-columns">
            <div>
              <h3>Strengths</h3>
              <ul>
                {insight.strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Development areas</h3>
              <ul>
                {insight.developmentAreas.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <div>
            <h3>Role fit</h3>
            <p>{insight.roleFitNotes}</p>
          </div>
          {insight.followUpQuestions.length ? (
            <div>
              <h3>Follow-up questions</h3>
              <ul className="follow-up-list">
                {insight.followUpQuestions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="list-placeholder">
          When optional AI resume review is enabled for your workspace, a structured narrative appears after each upload.
          Skill matching above still runs without it.
        </p>
      )}
    </section>
  );
}

export function RecommendationPanel({ candidate }: { candidate?: CandidateAnalysis }) {
  const positions = candidate?.topPositions ?? [];
  return (
    <section className="concept-panel">
      <div className="panel-heading">
        <h2>Recommended Positions</h2>
        <span>Prioritized</span>
      </div>
      {positions.length ? (
        <ol className="recommendation-list">
          {positions.slice(0, 5).map((recommendation) => (
            <li key={recommendation.role.id}>
              <b>{recommendation.rank}</b>
              <div>
                <strong>{recommendation.role.title}</strong>
                <span>{recommendation.role.department}</span>
              </div>
              <em>{recommendation.score}%</em>
            </li>
          ))}
        </ol>
      ) : (
        <p className="list-placeholder">
          Run an analysis to see ranked role recommendations here.
        </p>
      )}
    </section>
  );
}

export function RecentCandidates({ candidates, onSelect }: { candidates: CandidateAnalysis[]; onSelect: (id: string) => void }) {
  return (
    <section className="concept-panel">
      <div className="panel-heading">
        <h2>Recent Analyses</h2>
        <span>{candidates.length}</span>
      </div>
      {candidates.length ? (
        <ul className="recent-list">
          {candidates.slice(0, 4).map((candidate) => (
            <li key={candidate.id} className="recent-list-item">
              <button type="button" onClick={() => onSelect(candidate.id)}>
                <FileText aria-hidden="true" />
                <span>
                  <strong>{candidate.candidateName}</strong>
                  {candidate.topPositions[0]?.role.title}
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
              <CandidateResumeFileLinks candidate={candidate} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="list-placeholder">
          No analyses yet. Upload and process résumés from the Dashboard tab—completed analyses will show up here.
        </p>
      )}
    </section>
  );
}
