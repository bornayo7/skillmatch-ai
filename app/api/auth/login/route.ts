import { NextResponse } from "next/server";
import { setSessionUser } from "@/lib/auth";
import { verifyCredentials } from "@/lib/auth-model";
import { appendAuditEvent } from "@/lib/db";
import { clearRateLimit, consumeRateLimit, getClientAddress, peekRateLimit } from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/route-auth";
import { loginRequestSchema, parseJsonRequestBody } from "@/lib/validation";

const emailLimit = { limit: 5, windowSeconds: 15 * 60 };
const ipLimit = { limit: 20, windowSeconds: 15 * 60 };

async function appendLoginAuditEvent(input: {
  actor: string;
  actorRole?: string | null;
  actorName?: string | null;
  action: "failed_login" | "login";
  details: Record<string, unknown>;
}) {
  try {
    await appendAuditEvent(input);
  } catch (error) {
    console.error("Unable to append login audit event", error);
  }
}

function tooManyAttemptsResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many sign-in attempts. Try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export async function POST(request: Request) {
  try {
    const originError = requireSameOrigin(request);
    if (originError) {
      return originError;
    }

    const { data, error } = await parseJsonRequestBody(loginRequestSchema, request);
    if (!data) {
      if (error === "Malformed JSON body.") {
        await appendLoginAuditEvent({
          actor: "anonymous",
          action: "failed_login",
          details: { reason: "malformed_json" }
        });
      }

      return NextResponse.json({ error }, { status: 400 });
    }

    const { email, password } = data;

    // Only failed attempts count toward the limits, so legitimate sign-ins from a
    // shared address (offices, CI) are never throttled by other users' successes.
    const emailKey = `login:email:${email}`;
    const clientAddress = getClientAddress(request);
    const ipKey = clientAddress ? `login:ip:${clientAddress}` : null;

    const emailDecision = await peekRateLimit({ key: emailKey, ...emailLimit });
    if (!emailDecision.allowed) {
      return tooManyAttemptsResponse(emailDecision.retryAfterSeconds);
    }

    if (ipKey) {
      const ipDecision = await peekRateLimit({ key: ipKey, ...ipLimit });
      if (!ipDecision.allowed) {
        return tooManyAttemptsResponse(ipDecision.retryAfterSeconds);
      }
    }

    const user = await verifyCredentials(email, password);

    if (!user) {
      await consumeRateLimit({ key: emailKey, ...emailLimit });
      if (ipKey) {
        await consumeRateLimit({ key: ipKey, ...ipLimit });
      }
      await appendLoginAuditEvent({
        actor: email || "anonymous",
        action: "failed_login",
        details: { reason: "invalid_credentials" }
      });
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    await clearRateLimit(`login:email:${email}`);
    await setSessionUser(user);
    await appendLoginAuditEvent({
      actor: user.email,
      actorRole: user.role,
      actorName: user.name,
      action: "login",
      details: { role: user.role }
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error("Unable to complete login", error);
    return NextResponse.json({ error: "Sign in is temporarily unavailable." }, { status: 500 });
  }
}
