import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Prisma from being bundled — keeps it as external so it won't
  // be executed at build time for API routes
  serverExternalPackages: ["@prisma/client", "prisma"],
  experimental: {},
};

export default nextConfig;
