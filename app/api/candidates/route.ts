import { NextResponse } from "next/server";
import { listCandidateRecommendations, type CandidateRecommendationFilters } from "@/lib/db";
import { requireAccessArea } from "@/lib/route-auth";
import { serverErrorResponse } from "@/lib/server-api-error";

export async function GET(request: Request) {
  // Recruiting roles browse candidates; L&D needs the list to assign learning modules.
  const { user, response } = await requireAccessArea("recruiter", "learning");
  if (!user) {
    return response;
  }

  const params = new URL(request.url).searchParams;
  const minYears = params.get("minYearsExperience");
  const filters: CandidateRecommendationFilters = {
    skills: params
      .getAll("skill")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean),
    education: params.get("education")?.trim() || undefined,
    location: params.get("location")?.trim() || undefined,
    minYearsExperience: minYears && Number.isFinite(Number(minYears)) ? Number(minYears) : undefined
  };

  try {
    return NextResponse.json({ candidates: await listCandidateRecommendations(filters) });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
