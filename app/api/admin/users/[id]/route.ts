import { NextResponse } from "next/server";
import { appendAuditEventSafely } from "@/lib/audit-store";
import { listCredentialUserAccounts, updateCredentialUserRole } from "@/lib/auth-model";
import { requireAccessArea, requireSameOrigin } from "@/lib/route-auth";
import { serverErrorResponse } from "@/lib/server-api-error";
import { userRoleSchema } from "@/lib/validation";

/**
 * Admin-only role assignment. Public signup always creates employees. Existing
 * signed sessions are revalidated against the current account role on every
 * authenticated request, so demotions take effect immediately.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const { user, response } = await requireAccessArea("admin");
  if (!user) {
    return response;
  }

  const body = (await request.json().catch(() => null)) as { role?: unknown } | null;
  const parsedRole = userRoleSchema.safeParse(body?.role);
  if (!parsedRole.success) {
    return NextResponse.json({ error: "Provide a valid role." }, { status: 400 });
  }

  const { id } = await params;

  try {
    const accounts = await listCredentialUserAccounts();
    if (accounts === null) {
      return NextResponse.json(
        { error: "User management requires a configured database." },
        { status: 503 }
      );
    }

    const target = accounts.find((account) => account.id === id);
    if (!target) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    if (target.email === user.email) {
      return NextResponse.json(
        { error: "Administrators cannot change their own role." },
        { status: 400 }
      );
    }

    const previousRole = target.role;
    const updated = await updateCredentialUserRole({ userId: id, role: parsedRole.data });
    if (!updated) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    await appendAuditEventSafely({
      actor: user.email,
      actorRole: user.role,
      actorName: user.name,
      action: "user_role_changed",
      entityId: updated.id,
      details: {
        email: updated.email,
        fromRole: previousRole,
        toRole: updated.role
      }
    });

    return NextResponse.json({ user: updated });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
