// Server-side serializers shared by API routes (never import Prisma types
// into client bundles — DTOs live in src/lib/api/types.ts).

import type { PanelUser } from "@prisma/client";
import type { PanelUserDTO } from "@/lib/api/types";

export function toPublicUser(user: PanelUser): PanelUserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    mobile: user.mobile,
    company: user.company,
    role: (user.role as PanelUserDTO["role"]) ?? "customer",
    status: (user.status as PanelUserDTO["status"]) ?? "active",
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
