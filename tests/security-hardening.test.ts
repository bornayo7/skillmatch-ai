import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSessionUser,
  mockSetSessionUser,
  mockCreateCredentialUser,
  mockVerifyCredentials,
  mockAppendAuditEvent,
  mockListCandidateRecommendations,
  mockGetCandidateResumeById,
  mockGetResumeObject
} = vi.hoisted(() => ({
  mockGetSessionUser: vi.fn(),
  mockSetSessionUser: vi.fn(),
  mockCreateCredentialUser: vi.fn(),
  mockVerifyCredentials: vi.fn(),
  mockAppendAuditEvent: vi.fn(),
  mockListCandidateRecommendations: vi.fn(),
  mockGetCandidateResumeById: vi.fn(),
  mockGetResumeObject: vi.fn()
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSessionUser: mockGetSessionUser,
    setSessionUser: mockSetSessionUser
  };
});

vi.mock("@/lib/auth-model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-model")>();
  return {
    ...actual,
    createCredentialUser: mockCreateCredentialUser,
    verifyCredentials: mockVerifyCredentials
  };
});

vi.mock("@/lib/db", () => ({
  appendAuditEvent: mockAppendAuditEvent,
  listCandidateRecommendations: mockListCandidateRecommendations,
  getCandidateResumeById: mockGetCandidateResumeById
}));

vi.mock("@/lib/storage", () => ({
  getResumeObject: mockGetResumeObject
}));

import { POST as signupPost } from "@/app/api/auth/signup/route";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { GET as candidatesGet } from "@/app/api/candidates/route";
import { GET as resumeGet } from "@/app/api/candidates/[id]/resume/route";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/route-auth";
import { signupRequestSchema } from "@/lib/validation";

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

function sessionUser(role: string) {
  return { name: "Test User", email: `${role}@skillmatch.demo`, role };
}

describe("signup privilege escalation prevention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mockAppendAuditEvent.mockResolvedValue(undefined);
    mockSetSessionUser.mockResolvedValue(undefined);
  });

  it("strips a client-supplied role from the signup schema", () => {
    const parsed = signupRequestSchema.parse({
      name: "Attacker",
      email: "attacker@example.com",
      password: "supersecurepassword",
      role: "system_admin"
    });

    expect(parsed).not.toHaveProperty("role");
  });

  it.each(["recruiter", "hiring_manager", "learning_development", "system_admin"])(
    "never forwards the privileged role %s to account creation",
    async (attemptedRole) => {
      mockCreateCredentialUser.mockResolvedValue({
        name: "Attacker",
        email: "attacker@example.com",
        role: "employee"
      });

      const response = await signupPost(
        jsonRequest("http://localhost/api/auth/signup", {
          name: "Attacker",
          email: "attacker@example.com",
          password: "supersecurepassword",
          role: attemptedRole
        })
      );

      expect(response.status).toBe(201);
      expect(mockCreateCredentialUser).toHaveBeenCalledTimes(1);
      expect(mockCreateCredentialUser.mock.calls[0][0]).not.toHaveProperty("role");
      const payload = (await response.json()) as { user: { role: string } };
      expect(payload.user.role).toBe("employee");
    }
  );
});

describe("same-origin protection for cookie-auth mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
  });

  it("allows requests without an Origin header (non-browser clients)", () => {
    const request = new Request("http://localhost/api/upload", { method: "POST" });
    expect(requireSameOrigin(request)).toBeNull();
  });

  it("allows same-origin browser requests", () => {
    const request = new Request("https://skillmatch.example.com/api/upload", {
      method: "POST",
      headers: { origin: "https://skillmatch.example.com", host: "skillmatch.example.com" }
    });
    expect(requireSameOrigin(request)).toBeNull();
  });

  it("rejects cross-origin requests", async () => {
    const request = new Request("https://skillmatch.example.com/api/upload", {
      method: "POST",
      headers: { origin: "https://evil.example.net", host: "skillmatch.example.com" }
    });
    const response = requireSameOrigin(request);
    expect(response?.status).toBe(403);
  });

  it("rejects an opaque null origin", () => {
    const request = new Request("https://skillmatch.example.com/api/upload", {
      method: "POST",
      headers: { origin: "null", host: "skillmatch.example.com" }
    });
    expect(requireSameOrigin(request)?.status).toBe(403);
  });

  it("honors x-forwarded-host behind a proxy", () => {
    const request = new Request("http://internal:3000/api/upload", {
      method: "POST",
      headers: {
        origin: "https://skillmatch.example.com",
        host: "internal:3000",
        "x-forwarded-host": "skillmatch.example.com"
      }
    });
    expect(requireSameOrigin(request)).toBeNull();
  });

  it("blocks cross-origin signup requests end to end", async () => {
    const response = await signupPost(
      jsonRequest(
        "https://skillmatch.example.com/api/auth/signup",
        { name: "Someone", email: "someone@example.com", password: "supersecurepassword" },
        { origin: "https://evil.example.net", host: "skillmatch.example.com" }
      )
    );
    expect(response.status).toBe(403);
    expect(mockCreateCredentialUser).not.toHaveBeenCalled();
  });
});

describe("login rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mockAppendAuditEvent.mockResolvedValue(undefined);
    mockSetSessionUser.mockResolvedValue(undefined);
  });

  it("throttles repeated failed logins for the same account", async () => {
    mockVerifyCredentials.mockResolvedValue(null);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await loginPost(
        jsonRequest("http://localhost/api/auth/login", {
          email: "victim@example.com",
          password: "wrong-password"
        })
      );
      expect(response.status).toBe(401);
    }

    const throttled = await loginPost(
      jsonRequest("http://localhost/api/auth/login", {
        email: "victim@example.com",
        password: "wrong-password"
      })
    );
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBeTruthy();
    expect(mockVerifyCredentials).toHaveBeenCalledTimes(5);
  });

  it("does not throttle a successful login within the limit", async () => {
    mockVerifyCredentials.mockResolvedValue(sessionUser("employee"));

    const response = await loginPost(
      jsonRequest("http://localhost/api/auth/login", {
        email: "legit@example.com",
        password: "correct-password"
      })
    );
    expect(response.status).toBe(200);
  });

  it("throttles bursts from a single client address across accounts", async () => {
    mockVerifyCredentials.mockResolvedValue(null);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await loginPost(
        jsonRequest(
          "http://localhost/api/auth/login",
          { email: `probe-${attempt}@example.com`, password: "wrong" },
          { "x-forwarded-for": "203.0.113.9" }
        )
      );
    }

    const throttled = await loginPost(
      jsonRequest(
        "http://localhost/api/auth/login",
        { email: "probe-final@example.com", password: "wrong" },
        { "x-forwarded-for": "203.0.113.9" }
      )
    );
    expect(throttled.status).toBe(429);
  });
});

describe("candidate data RBAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mockListCandidateRecommendations.mockResolvedValue([]);
  });

  it("rejects unauthenticated candidate listing", async () => {
    mockGetSessionUser.mockResolvedValue(null);
    const response = await candidatesGet(new Request("http://localhost/api/candidates"));
    expect(response.status).toBe(401);
    expect(mockListCandidateRecommendations).not.toHaveBeenCalled();
  });

  it("rejects employees from listing candidates", async () => {
    mockGetSessionUser.mockResolvedValue(sessionUser("employee"));
    const response = await candidatesGet(new Request("http://localhost/api/candidates"));
    expect(response.status).toBe(403);
    expect(mockListCandidateRecommendations).not.toHaveBeenCalled();
  });

  it.each(["recruiter", "hiring_manager", "learning_development", "system_admin"])(
    "allows %s to list candidates",
    async (role) => {
      mockGetSessionUser.mockResolvedValue(sessionUser(role));
      const response = await candidatesGet(new Request("http://localhost/api/candidates"));
      expect(response.status).toBe(200);
    }
  );

  it.each(["employee", "learning_development"])(
    "rejects %s from downloading raw resumes",
    async (role) => {
      mockGetSessionUser.mockResolvedValue(sessionUser(role));
      const response = await resumeGet(new Request("http://localhost/api/candidates/abc/resume"), {
        params: Promise.resolve({ id: "abc" })
      });
      expect(response.status).toBe(403);
      expect(mockGetCandidateResumeById).not.toHaveBeenCalled();
    }
  );

  it("allows recruiters to download a stored resume", async () => {
    mockGetSessionUser.mockResolvedValue(sessionUser("recruiter"));
    mockGetCandidateResumeById.mockResolvedValue({
      storageUrl: "local://resumes/abc.pdf",
      fileName: "abc.pdf"
    });
    mockGetResumeObject.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf"
    });

    const response = await resumeGet(new Request("http://localhost/api/candidates/abc/resume"), {
      params: Promise.resolve({ id: "abc" })
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });
});
