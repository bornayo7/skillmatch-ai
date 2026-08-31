import { z } from "zod";
import { roles } from "./seed-data";

export const userRoleSchema = z.enum([
  "employee",
  "recruiter",
  "hiring_manager",
  "learning_development",
  "system_admin"
]);

export type UserRole = z.infer<typeof userRoleSchema>;

export const sessionUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.email().transform((value) => value.toLowerCase()),
  role: userRoleSchema
});

export const signedSessionPayloadSchema = sessionUserSchema.extend({
  iat: z.number().int(),
  exp: z.number().int()
}).refine((session) => session.iat <= session.exp, {
  message: "Session issue time must be before expiration."
});

export const loginRequestSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(1)
});

/**
 * Public signup never accepts a role from the client. Every self-registered account is
 * created as the lowest-privilege `employee`; privileged roles are assigned only by a
 * system administrator. A client-supplied `role` field is stripped, never honored.
 */
export const signupRequestSchema = z.object({
  name: z.string().trim().min(2, "Enter your name."),
  email: z.email("Enter a valid email address.").transform((value) => value.toLowerCase()),
  password: z.string().min(10, "Use a password with at least 10 characters.")
});

export const roleIdSchema = z.enum(
  roles.map((role) => role.id) as [string, ...string[]],
  { message: "Select a valid target role." }
);

export const analyzeRequestSchema = z.object({
  employeeName: z.string().trim().min(1).default("Demo Employee"),
  resumeText: z.string().trim().min(20, "Resume text must include at least 20 characters."),
  roleId: roleIdSchema.default("sde-i")
});

export const overrideRequestSchema = z.object({
  candidateId: z.string().trim().min(1, "Candidate is required."),
  promotedRole: roleIdSchema,
  reason: z.string().trim().min(3).default("Manual review")
});

const boundedSkillArray = z
  .array(z.string().trim().min(1).max(120))
  .max(100)
  .optional();

export const savedTargetRoleRequestSchema = z.object({
  roleId: roleIdSchema,
  targetScore: z.number().int().min(1).max(100).optional(),
  currentScore: z.number().int().min(0).max(100).nullable().optional(),
  matchedSkills: boundedSkillArray,
  missingSkills: boundedSkillArray
}).strict();

const optionalAuditDateSchema = z
  .string()
  .trim()
  .max(80)
  .optional()
  .refine((value) => !value || !Number.isNaN(Date.parse(value)), "Use a valid ISO date or date-time.");

export const auditFilterSchema = z.object({
  action: z.string().trim().max(120).optional(),
  actor: z.string().trim().max(320).optional(),
  entityId: z.string().trim().max(200).optional(),
  startDate: optionalAuditDateSchema,
  endDate: optionalAuditDateSchema,
  limit: z.number().int().min(1).max(200).optional()
}).refine(
  (filters) =>
    !filters.startDate ||
    !filters.endDate ||
    Date.parse(filters.startDate) <= Date.parse(filters.endDate),
  { message: "Start date must be before end date." }
);

export function parseJsonRequest<T>(schema: z.ZodType<T>, body: unknown) {
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return { data: parsed.data, error: null };
  }

  return {
    data: null,
    error: parsed.error.issues[0]?.message ?? "Invalid request."
  };
}

export async function parseJsonRequestBody<T>(schema: z.ZodType<T>, request: Pick<Request, "json">) {
  try {
    return parseJsonRequest(schema, await request.json());
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        data: null,
        error: "Malformed JSON body."
      };
    }

    throw error;
  }
}

export function isKnownRoleId(value: string) {
  return roleIdSchema.safeParse(value).success;
}
