import { Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/auth-card";

export const metadata: Metadata = { title: "Password recovery" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Password recovery">
      <div className="grid gap-4">
        <Alert>
          <Info aria-hidden />
          <AlertTitle>Self-service recovery isn&apos;t available yet</AlertTitle>
          <AlertDescription>
            HaieRag does not send password-reset emails in this version. Please contact your administrator — they can
            help you regain access to your account.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
