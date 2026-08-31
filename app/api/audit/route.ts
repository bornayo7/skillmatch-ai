import { NextResponse } from "next/server";
import { canAccess, getSessionUser } from "@/lib/auth";
import { listAuditEvents, verifyAuditIntegrity, type AuditEventFilters } from "@/lib/db";
import { auditFilterSchema } from "@/lib/validation";

function parseFilters(url: string) {
  const params = new URL(url).searchParams;
  const limitRaw = params.get("limit");
  const candidate: AuditEventFilters = {
    action: params.get("action")?.trim() || undefined,
    actor: params.get("actor")?.trim() || undefined,
    entityId: params.get("entityId")?.trim() || undefined,
    startDate: params.get("startDate")?.trim() || undefined,
    endDate: params.get("endDate")?.trim() || undefined,
    limit: limitRaw && Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : undefined,
  };
  return auditFilterSchema.safeParse(candidate);
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!canAccess(user, "admin")) {
    return NextResponse.json(
      { error: "System administrator role required." },
      { status: user ? 403 : 401 },
    );
  }

  const parsed = parseFilters(request.url);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid audit filters." },
      { status: 400 }
    );
  }

  const events = await listAuditEvents(parsed.data);
  const integrity = await verifyAuditIntegrity();

  return NextResponse.json({ events, integrity });
}
