import { z } from "zod";

export const platformRoleSchema = z.enum(["user", "support", "admin", "super_admin"]);
export const userStatusSchema = z.enum(["active", "suspended"]);

export const adminUserRoleUpdateSchema = z.object({
  role: platformRoleSchema,
});

export const adminUserStatusUpdateSchema = z.object({
  status: userStatusSchema,
  reason: z.string().trim().min(3).max(500).optional(),
}).superRefine((value, context) => {
  if (value.status === "suspended" && !value.reason) {
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "Укажите причину блокировки",
    });
  }
});

export const adminWorkspacePlanUpdateSchema = z.object({
  planCode: z.enum(["free", "start", "creator", "studio"]),
});

export const adminMinuteAdjustmentSchema = z.object({
  seconds: z.number().int().min(-3_600_000).max(3_600_000).refine((value) => value !== 0),
  reason: z.string().trim().min(3).max(240),
});

export const adminListQuerySchema = z.object({
  search: z.string().trim().max(120).default(""),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(10).max(100).default(25),
});

export type PlatformRole = z.infer<typeof platformRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
