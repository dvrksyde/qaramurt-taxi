import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PROTECTED_PATHS = [
  "/monitor",
  "/drivers",
  "/vehicles",
  "/journal",
  "/calls",
  "/operators",
  "/admissions",
  "/billing",
  "/settings",
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PATHS.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/monitor/:path*",
    "/drivers/:path*",
    "/vehicles/:path*",
    "/journal/:path*",
    "/calls/:path*",
    "/operators/:path*",
    "/admissions/:path*",
    "/billing/:path*",
    "/settings/:path*",
  ],
};
