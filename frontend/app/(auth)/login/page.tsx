"use client";

import Link from "next/link";
import { AuthCard } from "@/features/auth/auth-card";
import { GuestOnly } from "@/features/auth/auth-guard";
import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  // GuestOnly redirects to ?next= (or /dashboard) as soon as the session becomes authenticated.
  return (
    <GuestOnly>
      <AuthCard
        title="Sign in"
        description="Welcome back to your knowledge base."
        footer={
          <span>
            No account?{" "}
            <Link href="/register" className="font-medium text-foreground underline-offset-4 hover:underline">
              Create one
            </Link>
          </span>
        }
      >
        <LoginForm />
      </AuthCard>
    </GuestOnly>
  );
}
