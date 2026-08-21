import { NextResponse } from "next/server";
import { clearSessionUser, getSessionUser } from "@/lib/auth";
import { appendAuditEvent } from "@/lib/db";
import { requireSameOrigin } from "@/lib/route-auth";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const user = await getSessionUser();
  await clearSessionUser();
  await appendAuditEvent({
    actor: user?.email ?? "unknown",
    actorRole: user?.role ?? null,
    actorName: user?.name ?? null,
    action: "logout",
    details: {}
  });

  return NextResponse.json({ ok: true });
}
