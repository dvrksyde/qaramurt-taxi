import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import { hashPassword, verifyPassword } from "./passwords";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        login: { label: "Login", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.login || !credentials?.password) return null;

        const operator = await prisma.operator.findUnique({
          where: { login: credentials.login },
        });

        if (!operator || !operator.isActive) return null;

        const passwordCheck = await verifyPassword(credentials.password, operator.passwordHash);
        if (!passwordCheck.valid) return null;

        if (passwordCheck.needsRehash) {
          await prisma.operator.update({
            where: { id: operator.id },
            data: { passwordHash: await hashPassword(credentials.password) },
          });
        }

        // Track last login time for online status
        await prisma.operator.update({
          where: { id: operator.id },
          data: { lastSeenAt: new Date() },
        });

        // Parse permissions from DB
        const perms = Array.isArray(operator.permissions)
          ? operator.permissions as string[]
          : [];

        return {
          id: String(operator.id),
          name: operator.name,
          email: operator.login,
          role: operator.role,
          permissions: perms,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.operatorId = user.id;
        token.permissions = (user as any).permissions || [];
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role as string;
        (session.user as any).operatorId = token.operatorId as string;
        (session.user as any).permissions = token.permissions || [];
      }
      return session;
    },
  },
};
