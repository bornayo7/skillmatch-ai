import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSessionUser,
  mockListCredentialUserAccounts,
  mockUpdateCredentialUserRole,
  mockAppendAuditEvent
} = vi.hoisted(() => ({
  mockGetSessionUser: vi.fn(),
  mockListCredentialUserAccounts: vi.fn(),
  mockUpdateCredentialUserRole: vi.fn(),
  mockAppendAuditEvent: vi.fn()
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSessionUser: mockGetSessionUser
  };
});

vi.mock("@/lib/auth-model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-model")>();
  return {
    ...actual,
    listCredentialUserAccounts: mockListCredentialUserAccounts,
    updateCredentialUserRole: mockUpdateCredentialUserRole
  };
});

vi.mock("@/lib/db", () => ({
  appendAuditEvent: mockAppendAuditEvent
}));

import { GET as usersGet } from "@/app/api/admin/users/route";
import { PATCH as userPatch } from "@/app/api/admin/users/[id]/route";

const adminUser = { name: "Ada Admin", email: "admin@skillmatch.demo", role: "system_admin" };
const employeeAccount = {
  id: "user-1",
  name: "Pat Employee",
  email: "pat@example.com",
  role: "employee",
  createdAt: "2026-08-01T00:00:00.000Z"
};

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/admin/users/user-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function patchParams(id = "user-1") {
  return { params: Promise.resolve({ id }) };
}

describe("admin user management API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendAuditEvent.mockResolvedValue(undefined);
  });

  it.each(["employee", "recruiter", "hiring_manager", "learning_development"])(
    "rejects %s from listing users",
    async (role) => {
      mockGetSessionUser.mockResolvedValue({ name: "User", email: `${role}@example.com`, role });
      const response = await usersGet();
      expect(response.status).toBe(403);
      expect(mockListCredentialUserAccounts).not.toHaveBeenCalled();
    }
  );

  it("rejects unauthenticated listing", async () => {
    mockGetSessionUser.mockResolvedValue(null);
    const response = await usersGet();
    expect(response.status).toBe(401);
  });

  it("lists accounts for system admins", async () => {
    mockGetSessionUser.mockResolvedValue(adminUser);
    mockListCredentialUserAccounts.mockResolvedValue([employeeAccount]);

    const response = await usersGet();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ users: [employeeAccount], supported: true });
  });

  it("reports unsupported user management in demo memory mode", async () => {
    mockGetSessionUser.mockResolvedValue(adminUser);
    mockListCredentialUserAccounts.mockResolvedValue(null);

    const response = await usersGet();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ users: [], supported: false });
  });

  it("rejects non-admin role changes", async () => {
    mockGetSessionUser.mockResolvedValue({ name: "Rae", email: "rae@example.com", role: "recruiter" });
    const response = await userPatch(patchRequest({ role: "system_admin" }), patchParams());
    expect(response.status).toBe(403);
    expect(mockUpdateCredentialUserRole).not.toHaveBeenCalled();
  });

  it("changes a role and audits the change", async () => {
    mockGetSessionUser.mockResolvedValue(adminUser);
    mockListCredentialUserAccounts.mockResolvedValue([employeeAccount]);
    mockUpdateCredentialUserRole.mockResolvedValue({ ...employeeAccount, role: "recruiter" });

    const response = await userPatch(patchRequest({ role: "recruiter" }), patchParams());
    expect(response.status).toBe(200);
    expect(mockUpdateCredentialUserRole).toHaveBeenCalledWith({ userId: "user-1", role: "recruiter" });
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user_role_changed",
        entityId: "user-1",
        details: expect.objectContaining({ fromRole: "employee", toRole: "recruiter" })
      })
    );
  });

  it("rejects an invalid role value", async () => {
    mockGetSessionUser.mockResolvedValue(adminUser);
    const response = await userPatch(patchRequest({ role: "super_root" }), patchParams());
    expect(response.status).toBe(400);
    expect(mockUpdateCredentialUserRole).not.toHaveBeenCalled();
  });

  it("prevents admins from changing their own role", async () => {
    mockGetSessionUser.mockResolvedValue(adminUser);
    mockListCredentialUserAccounts.mockResolvedValue([
      { ...employeeAccount, id: "admin-1", email: adminUser.email, role: "system_admin" }
    ]);

    const response = await userPatch(patchRequest({ role: "employee" }), patchParams("admin-1"));
    expect(response.status).toBe(400);
    expect(mockUpdateCredentialUserRole).not.toHaveBeenCalled();
  });

  it("rejects cross-origin role changes", async () => {
    mockGetSessionUser.mockResolvedValue(adminUser);
    const request = new Request("http://localhost/api/admin/users/user-1", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example.net",
        host: "localhost"
      },
      body: JSON.stringify({ role: "recruiter" })
    });

    const response = await userPatch(request, patchParams());
    expect(response.status).toBe(403);
    expect(mockUpdateCredentialUserRole).not.toHaveBeenCalled();
  });
});
