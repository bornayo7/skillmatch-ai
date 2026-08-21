import { NextResponse } from "next/server";
import { listCredentialUserAccounts } from "@/lib/auth-model";
import { requireAccessArea } from "@/lib/route-auth";
import { serverErrorResponse } from "@/lib/server-api-error";

export async function GET() {
  const { user, response } = await requireAccessArea("admin");
  if (!user) {
    return response;
  }

  try {
    const accounts = await listCredentialUserAccounts();
    if (accounts === null) {
      // Demo memory mode has no user table; role management needs a database.
      return NextResponse.json({ users: [], supported: false });
    }

    return NextResponse.json({ users: accounts, supported: true });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
