import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { roles } from "@/lib/seed-data";
import { requireSameOrigin } from "@/lib/route-auth";
import { deleteSavedTargetRole, listSavedTargetRoles, saveTargetRole } from "@/lib/saved-role-store";
import { serverErrorResponse } from "@/lib/server-api-error";
import { parseJsonRequestBody, savedTargetRoleRequestSchema } from "@/lib/validation";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    return NextResponse.json({ savedRoles: await listSavedTargetRoles(user.email) });
  } catch (error) {
    return serverErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { data, error } = await parseJsonRequestBody(savedTargetRoleRequestSchema, request);
  if (!data) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const role = roles.find((item) => item.id === data.roleId);
  if (!role) {
    return NextResponse.json({ error: "Choose a valid target role." }, { status: 400 });
  }

  try {
    const savedRole = await saveTargetRole({
      employeeEmail: user.email,
      roleId: role.id,
      roleTitle: role.title,
      targetScore: data.targetScore,
      currentScore: data.currentScore,
      matchedSkills: data.matchedSkills,
      missingSkills: data.missingSkills
    });

    return NextResponse.json({ savedRole });
  } catch (saveError) {
    return serverErrorResponse(saveError);
  }
}

export async function DELETE(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Saved role id is required." }, { status: 400 });
  }

  try {
    const deleted = await deleteSavedTargetRole({ employeeEmail: user.email, id });
    if (!deleted) {
      return NextResponse.json({ error: "Saved role not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (deleteError) {
    return serverErrorResponse(deleteError);
  }
}
