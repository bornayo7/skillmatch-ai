import { NextResponse } from "next/server";
import { listCandidateRecommendations } from "@/lib/candidate-store";
import type { CandidateRecommendationFilters } from "@/lib/db";
import { requireAccessArea } from "@/lib/route-auth";
import { serverErrorResponse } from "@/lib/server-api-error";

export async function GET(request: Request) {
  const { user, response } = await requireAccessArea("recruiter", "learning");
  if (!user) {
    return response;
  }

  const params = new URL(request.url).searchParams;
  const minYears = params.get("minYearsExperience");
  const parsedMinYears = minYears === null ? undefined : Number(minYears);
  if (parsedMinYears !== undefined && (!Number.isFinite(parsedMinYears) || parsedMinYears < 0)) {
    return NextResponse.json({ error: "Minimum years of experience must be zero or greater." }, { status: 400 });
  }

  const requestedLimit = Number(params.get("limit") ?? 50);
  const requestedOffset = Number(params.get("offset") ?? 0);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
    return NextResponse.json({ error: "Limit must be an integer from 1 to 100." }, { status: 400 });
  }
  if (!Number.isInteger(requestedOffset) || requestedOffset < 0) {
    return NextResponse.json({ error: "Offset must be a non-negative integer." }, { status: 400 });
  }

  const filters: CandidateRecommendationFilters = {
    skills: params
      .getAll("skill")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean),
    education: params.get("education")?.trim() || undefined,
    location: params.get("location")?.trim() || undefined,
    minYearsExperience: parsedMinYears
  };

  try {
    const candidates = await listCandidateRecommendations(filters, {
      limit: requestedLimit,
      offset: requestedOffset
    });
    return NextResponse.json({
      candidates,
      nextOffset: candidates.length === requestedLimit ? requestedOffset + candidates.length : null
    });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
