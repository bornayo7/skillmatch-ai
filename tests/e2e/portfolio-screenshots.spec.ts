import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { signInDemoRecruiter } from "./auth-helpers";
import { pickDashboardResume } from "./dashboard-upload-helpers";

/**
 * Regenerates the README/marketing screenshots in docs/screenshots.
 * Skipped by default; run with:
 *   PORTFOLIO_SCREENSHOTS=1 npx playwright test portfolio-screenshots
 */
const enabled = process.env.PORTFOLIO_SCREENSHOTS === "1";

const shotDir = path.join(process.cwd(), "public", "screenshots");
const fixtureDir = path.join(process.cwd(), "tests", "fixtures");
const resumePath = path.join(fixtureDir, "alex-smith-sde-resume.pdf");

function ensureResumePdf() {
  fs.mkdirSync(fixtureDir, { recursive: true });
  if (fs.existsSync(resumePath)) {
    return;
  }
  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(resumePath));
  doc.text("Alex Smith");
  doc.text("Java engineer with 5 years experience.");
  doc.text("Skills: Java, AWS, SQL, REST API, Git, System Design, Data Structures, Docker.");
  doc.text("Certification: AWS Certified Cloud Practitioner.");
  doc.end();
}

test.skip(!enabled, "Set PORTFOLIO_SCREENSHOTS=1 to regenerate README screenshots");

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

test("captures portfolio screenshots", async ({ page, request }) => {
  ensureResumePdf();
  fs.mkdirSync(shotDir, { recursive: true });
  await request.post("/api/e2e/reset-memory");

  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Talent matching you can/ })).toBeVisible();
  await page.screenshot({ path: path.join(shotDir, "landing.png"), fullPage: true });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to SkillMatch" })).toBeVisible();
  await page.screenshot({ path: path.join(shotDir, "login.png") });

  await signInDemoRecruiter(page);
  await pickDashboardResume(page, resumePath);
  await page.getByRole("button", { name: /run skillmatch analysis/i }).click();
  await expect(page.getByText(/Processed 1 resume/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Skill Match Overview" })).toBeVisible();

  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(shotDir, "dashboard.png") });

  await page.getByRole("heading", { name: "Skill Match Overview" }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -80);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shotDir, "match-overview.png") });
});
