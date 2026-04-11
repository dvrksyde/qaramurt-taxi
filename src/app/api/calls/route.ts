export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

async function authorizeCallsWrite(req: NextRequest) {
  const webhookSecret = process.env.CALLS_WEBHOOK_SECRET;
  const providedSecret = req.headers.get("x-calls-webhook-secret");

  if (webhookSecret && providedSecret === webhookSecret) {
    return { allowed: true as const };
  }

  return checkPermission(["accept_calls"]);
}

// GET /api/calls
export async function GET(req: NextRequest) {
  const { allowed, response } = await checkPermission(["accept_calls"]);
  if (!allowed) return response!;

  const { searchParams } = new URL(req.url);
  const fromDate   = searchParams.get("fromDate");
  const toDate     = searchParams.get("toDate");
  const phone      = searchParams.get("phone");
  const callType   = searchParams.get("callType");
  const status     = searchParams.get("status");
  const operatorId = searchParams.get("operatorId");
  const serviceId  = searchParams.get("serviceId");

  const where: Record<string, unknown> = {};
  if (fromDate || toDate) {
    where.timestamp = {};
    if (fromDate) (where.timestamp as Record<string, unknown>).gte = new Date(fromDate);
    if (toDate)   (where.timestamp as Record<string, unknown>).lte = new Date(toDate);
  }
  if (phone)      where.OR = [{ phoneFrom: { contains: phone } }, { phoneTo: { contains: phone } }];
  if (callType)   where.callType   = callType;
  if (status)     where.status     = status;
  if (operatorId) where.operatorId = parseInt(operatorId);
  if (serviceId)  where.serviceId  = parseInt(serviceId);

  const calls = await prisma.callLog.findMany({
    where,
    include: {
      operator: { select: { id: true, name: true } },
      service:  { select: { id: true, name: true } },
    },
    orderBy: { timestamp: "desc" },
    take: 200,
  });

  return NextResponse.json({ data: calls });
}

// POST /api/calls — log incoming call (from SIP webhook)
export async function POST(req: NextRequest) {
  const { allowed, response } = await authorizeCallsWrite(req);
  if (!allowed) return response!;

  const body = await req.json();
  const { phoneFrom, phoneTo, callType, operatorId, serviceId, durationTotalSec, durationWaitSec, durationTalkSec, status, recordingUrl } = body;

  const call = await prisma.callLog.create({
    data: {
      phoneFrom,
      phoneTo: phoneTo || "",
      callType: callType || "inbound",
      operatorId: operatorId ? parseInt(operatorId) : null,
      serviceId:  serviceId  ? parseInt(serviceId)  : null,
      durationTotalSec: durationTotalSec || 0,
      durationWaitSec:  durationWaitSec  || 0,
      durationTalkSec:  durationTalkSec  || 0,
      status: status || "missed",
      recordingUrl: recordingUrl || null,
    },
  });

  return NextResponse.json({ data: call }, { status: 201 });
}
