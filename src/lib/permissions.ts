/**
 * Permission enforcement helper for API routes.
 *
 * Usage in API routes:
 *   const { allowed, response } = await checkPermission(["add_drivers"]);
 *   if (!allowed) return response;
 *
 * Admins bypass all permission checks.
 */

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "./auth";

interface PermCheckResult {
  allowed: boolean;
  response?: NextResponse;
  session?: any;
  operatorId?: number;
  permissions?: string[];
  role?: string;
}

/**
 * Check if the current session user has ANY of the required permissions.
 * Admins always pass. Returns 401 if not logged in, 403 if no permission.
 */
export async function checkPermission(
  requiredPerms: string[]
): Promise<PermCheckResult> {
  const session = await getServerSession(authOptions);

  if (!session) {
    return {
      allowed: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const user = session.user as any;
  const role: string = user?.role || "operator";
  const permissions: string[] = user?.permissions || [];
  const operatorId = parseInt(user?.operatorId || "0");

  // Admins bypass all permission checks
  if (role === "admin") {
    return { allowed: true, session, operatorId, permissions, role };
  }

  // Check if user has at least one of the required permissions
  const hasPermission = requiredPerms.length === 0 ||
    requiredPerms.some((p) => permissions.includes(p));

  if (!hasPermission) {
    return {
      allowed: false,
      response: NextResponse.json(
        { error: "У вас нет прав для выполнения этого действия" },
        { status: 403 }
      ),
    };
  }

  return { allowed: true, session, operatorId, permissions, role };
}

/**
 * Quick auth check — just verifies session exists, returns session data.
 */
export async function requireAuth(): Promise<PermCheckResult> {
  return checkPermission([]);
}
