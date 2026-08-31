import { NextResponse } from "next/server";
import { canAccess, getSessionUser } from "@/lib/auth";
import { appendAuditEventSafely } from "@/lib/audit-store";
import { listCandidateRecommendations } from "@/lib/candidate-store";
import { buildLearningReport } from "@/lib/learning-report";
import { serverErrorResponse } from "@/lib/server-api-error";

export async function GET() {
  const user = await getSessionUser();
  if (!canAccess(user, "learning")) {
    return NextResponse.json(
      { error: "Learning and development access required." },
      { status: user ? 403 : 401 },
    );
  }

  try {
    const candidates = await listCandidateRecommendations({}, { limit: null });
    const report = buildLearningReport(candidates);
    await appendAuditEventSafely({
      actor: user!.email,
      actorRole: user!.role,
      actorName: user!.name,
      action: "learning_report_viewed",
      details: {
        totalCandidates: report.totalCandidates,
        departmentGroups: report.byDepartment.length,
        employeeGroups: report.byEmployeeGroup.length,
        roleFamilyGroups: report.byRoleFamily.length,
      },
    });
    return NextResponse.json({ report });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
