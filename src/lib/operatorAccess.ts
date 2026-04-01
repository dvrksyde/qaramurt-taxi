import { NextResponse } from "next/server";

import { checkPermission } from "./permissions";

export async function requireOrderReadAccess(orderOperatorId: number | null) {
  const result = await checkPermission(["journal_own", "journal_all"]);
  if (!result.allowed) return result;

  const isAdmin = result.role === "admin";
  const canSeeAll = isAdmin || (result.permissions || []).includes("journal_all");

  if (!canSeeAll && result.operatorId !== orderOperatorId) {
    return {
      allowed: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return result;
}

export async function requireOrderWriteAccess() {
  return checkPermission(["current_orders"]);
}
