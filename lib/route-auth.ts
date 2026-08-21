import { NextResponse } from "next/server";
import { getSessionUser } from "./auth";
import type { SessionUser } from "./auth-model";
import { canAccess, type AccessArea } from "./auth-permissions";

export type RouteGuardResult =
  | { user: SessionUser; response: null }
  | { user: null; response: NextResponse };

function unauthorizedResponse() {
  return NextResponse.json({ error: "Authentication required." }, { status: 401 });
}

function forbiddenResponse() {
  return NextResponse.json({ error: "You do not have access to this resource." }, { status: 403 });
}

export async function requireSession(): Promise<RouteGuardResult> {
  const user = await getSessionUser();
  if (!user) {
    return { user: null, response: unauthorizedResponse() };
  }

  return { user, response: null };
}

/** Requires an authenticated session with access to at least one of the given areas. */
export async function requireAccessArea(...areas: AccessArea[]): Promise<RouteGuardResult> {
  const user = await getSessionUser();
  if (!user) {
    return { user: null, response: unauthorizedResponse() };
  }

  if (!areas.some((area) => canAccess(user, area))) {
    return { user: null, response: forbiddenResponse() };
  }

  return { user, response: null };
}

/**
 * Cross-site request forgery guard for cookie-authenticated mutations.
 *
 * Browsers attach an Origin header to every cross-origin (and same-origin) POST/PUT/DELETE,
 * so a mismatched Origin identifies a forged cross-site request. Requests without an Origin
 * header come from non-browser clients (curl, server-side tests) that cannot ride a victim's
 * ambient cookies, so they pass through. A literal "null" Origin (sandboxed iframe, file://)
 * is rejected.
 */
export function requireSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return null;
  }

  const rejection = NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  if (origin === "null") {
    return rejection;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return rejection;
  }

  const requestHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!requestHost || originHost !== requestHost.trim()) {
    return rejection;
  }

  return null;
}
