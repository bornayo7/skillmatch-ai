import { NextResponse } from "next/server";
import { setSessionUser } from "@/lib/auth";
import { createCredentialUser } from "@/lib/auth-model";
import { appendAuditEventSafely } from "@/lib/audit-store";
import { consumeRateLimit, getClientAddress } from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/route-auth";
import { parseJsonRequestBody, signupRequestSchema } from "@/lib/validation";

const signupIpLimit = { limit: 10, windowSeconds: 60 * 60 };

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const clientAddress = getClientAddress(request);
  if (clientAddress) {
    const decision = await consumeRateLimit({
      key: `signup:ip:${clientAddress}`,
      ...signupIpLimit
    });
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "Too many signup attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } }
      );
    }
  }

  const { data, error } = await parseJsonRequestBody(signupRequestSchema, request);
  if (!data) {
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const user = await createCredentialUser(data);
    await setSessionUser(user);
    await appendAuditEventSafely({
      actor: user.email,
      actorRole: user.role,
      actorName: user.name,
      action: "signup",
      details: { role: user.role }
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (signupError) {
    return NextResponse.json(
      { error: signupError instanceof Error ? signupError.message : "Signup failed." },
      { status: 400 }
    );
  }
}
