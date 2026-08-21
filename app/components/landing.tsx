import Image from "next/image";
import {
  BookOpen,
  FileSearch,
  GitBranch,
  ScanSearch,
  ShieldCheck,
  Target,
  UserCheck
} from "lucide-react";
import { BrandLogo } from "./app-brand";

const sourceUrl = "https://github.com/bornayo7/skillmatch-ai";

const features = [
  {
    icon: ScanSearch,
    title: "Evidence-backed scoring",
    text: "Every match decomposes into required skills, preferred skills, certifications, and experience — with the resume snippets that earned each point. No mystery numbers."
  },
  {
    icon: Target,
    title: "Skill gaps, not just scores",
    text: "Missing requirements become a ranked gap list mapped to learning recommendations, so the same engine powers screening and career development."
  },
  {
    icon: ShieldCheck,
    title: "Built like it handles real PII",
    text: "Server-side RBAC, private resume storage, CSRF and rate-limit protection, and a hash-chained audit trail behind every decision."
  }
] as const;

const workflow = [
  {
    icon: FileSearch,
    title: "Upload resumes",
    text: "PDF, DOCX, TXT, or ZIP batches — validated by file signature, deduplicated by content fingerprint."
  },
  {
    icon: GitBranch,
    title: "Match against roles",
    text: "A weighted, deterministic engine scores each candidate against role requirements and records its evidence."
  },
  {
    icon: BookOpen,
    title: "Close the gaps",
    text: "Skill gaps roll up into learning plans for candidates and aggregate reports for L&D teams."
  },
  {
    icon: UserCheck,
    title: "Humans decide",
    text: "Recruiters review, compare, and override recommendations — every action lands in the audit log."
  }
] as const;

export default function LandingPage() {
  return (
    <main className="landing-shell">
      <header className="landing-header">
        <BrandLogo />
        <nav className="landing-nav" aria-label="Landing">
          <a className="landing-nav-link" href={sourceUrl} rel="noreferrer" target="_blank">
            Source
          </a>
          <a className="landing-nav-cta" href="/login">
            Open the demo
          </a>
        </nav>
      </header>

      <section className="landing-hero">
        <h1>
          Talent matching you can <em>explain</em>.
        </h1>
        <p>
          SkillMatch AI parses resumes, ranks candidate-role fit with evidence-backed scoring,
          surfaces skill gaps, and keeps humans in charge of the final call.
        </p>
        <div className="landing-hero-actions">
          <a className="landing-nav-cta" href="/login">
            Try the live demo
          </a>
          <a className="landing-secondary-cta" href={sourceUrl} rel="noreferrer" target="_blank">
            View the source
          </a>
        </div>
        <p className="landing-hero-note">
          Demo accounts are listed on the sign-in page — no signup needed.
        </p>
        <div className="landing-screenshot">
          <Image
            alt="SkillMatch AI recruiter dashboard showing an overall match score, matched skills with evidence, missing skills, and ranked role recommendations"
            src="/screenshots/dashboard.png"
            width={1440}
            height={900}
            priority
          />
        </div>
      </section>

      <section className="landing-features" aria-label="Highlights">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <article className="landing-feature-card" key={feature.title}>
              <Icon aria-hidden="true" />
              <h2>{feature.title}</h2>
              <p>{feature.text}</p>
            </article>
          );
        })}
      </section>

      <section className="landing-workflow" aria-label="How it works">
        <h2>How it works</h2>
        <ol>
          {workflow.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title}>
                <span className="landing-step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <Icon aria-hidden="true" />
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <footer className="landing-footer">
        <span>
          Next.js · TypeScript · PostgreSQL · Drizzle · Cloudflare R2 · Vitest · Playwright
        </span>
        <a href={sourceUrl} rel="noreferrer" target="_blank">
          GitHub
        </a>
      </footer>
    </main>
  );
}
