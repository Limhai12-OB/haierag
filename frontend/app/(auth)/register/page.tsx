"use client";

import Link from "next/link";
import { AuthCard } from "@/features/auth/auth-card";
import { GuestOnly } from "@/features/auth/auth-guard";
import { RegisterForm } from "@/features/auth/register-form";

export default function RegisterPage() {
  return (
    <GuestOnly>
      <AuthCard
        title="Create your account"
        description="Start building a searchable knowledge base."
        footer={
          <span>
            Already registered?{" "}
            <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
              Sign in
            </Link>
          </span>
        }
      >
        <RegisterForm />
      </AuthCard>
    </GuestOnly>
  );
}
