import { NextResponse } from "next/server";
import { canAccess, getSessionUser } from "@/lib/auth";
import { analyzeResume } from "@/lib/skillmatch";
import { saveAnalysis } from "@/lib/db";
import { requireSameOrigin } from "@/lib/route-auth";
import { analyzeRequestSchema, parseJsonRequestBody } from "@/lib/validation";

function canRunResumeAnalysis(user: Awaited<ReturnType<typeof getSessionUser>>) {
  return canAccess(user, "recruiter") || canAccess(user, "learning");
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const user = await getSessionUser();
  if (!canRunResumeAnalysis(user)) {
    return NextResponse.json({ error: "Authentication required." }, { status: user ? 403 : 401 });
  }

  const { data, error } = await parseJsonRequestBody(analyzeRequestSchema, request);
  if (!data) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const result = analyzeResume(data.resumeText, data.roleId);
  const saved = await saveAnalysis({
    employeeName: data.employeeName,
    resumeText: data.resumeText,
    result
  });

  return NextResponse.json({ result, saved });
}
