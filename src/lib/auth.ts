import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";

// Simple password check — in production use bcrypt
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // For demo: hash is "password" for all demo accounts
  // In production: const bcrypt = await import('bcrypt'); return bcrypt.compare(password, hash);
  if (hash === "$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi") {
    return password === "password";
  }
  return password === hash;
}

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

        const valid = await verifyPassword(credentials.password, operator.passwordHash);
        if (!valid) return null;

        return {
          id: String(operator.id),
          name: operator.name,
          email: operator.login,
          role: operator.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role;
        token.operatorId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string; operatorId?: string }).role = token.role as string;
        (session.user as { role?: string; operatorId?: string }).operatorId = token.operatorId as string;
      }
      return session;
    },
  },
};
