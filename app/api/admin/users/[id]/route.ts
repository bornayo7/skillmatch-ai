import { NextResponse } from "next/server";
import { listCredentialUserAccounts, updateCredentialUserRole } from "@/lib/auth-model";
import { appendAuditEvent } from "@/lib/db";
import { requireAccessArea, requireSameOrigin } from "@/lib/route-auth";
import { serverErrorResponse } from "@/lib/server-api-error";
import { userRoleSchema } from "@/lib/validation";

/**
 * Admin-only role assignment. This is the only path that grants privileged
 * roles — public signup always creates employees. Every change is audited.
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

    // Admins cannot change their own role, so the last administrator can never
    // accidentally lock the workspace out of admin access.
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

    await appendAuditEvent({
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
