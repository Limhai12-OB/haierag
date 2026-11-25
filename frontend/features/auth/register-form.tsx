"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { describedBy, Field } from "@/components/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, errorMessage } from "@/lib/api-client";
import { hasErrors, validateRegister, type FieldErrors, type RegisterValues } from "@/lib/validation";
import { register } from "@/services/auth";

type Props = { onSuccess?: () => void; submit?: typeof register };

const EMPTY: RegisterValues = { displayName: "", email: "", password: "", confirmPassword: "" };

export function RegisterForm({ onSuccess, submit = register }: Props) {
  const [values, setValues] = useState<RegisterValues>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors<keyof RegisterValues>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const set = (k: keyof RegisterValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateRegister(values);
    setErrors(v);
    setFormError(null);
    if (hasErrors(v)) return;
    setPending(true);
    try {
      await submit({ displayName: values.displayName.trim(), email: values.email.trim(), password: values.password });
      onSuccess?.();
    } catch (err) {
      if (err instanceof ApiError) {
        const fe = err.fieldErrors;
        if (Object.keys(fe).length) setErrors(fe as FieldErrors<keyof RegisterValues>);
        setFormError(err.status === 409 ? "An account with this email already exists." : err.message);
      } else {
        setFormError(errorMessage(err));
      }
    } finally {
      setPending(false);
    }
  }

  const field = (k: keyof RegisterValues, label: string, type: string, autoComplete: string, hint?: string) => (
    <Field id={k} label={label} error={errors[k]} hint={hint}>
      <Input
        id={k}
        type={type}
        autoComplete={autoComplete}
        value={values[k]}
        onChange={set(k)}
        aria-invalid={!!errors[k]}
        aria-describedby={describedBy(k, errors[k], !!hint)}
      />
    </Field>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4" aria-label="Create account">
      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      {field("displayName", "Display name", "text", "name")}
      {field("email", "Email", "email", "email")}
      {field("password", "Password", "password", "new-password", "At least 8 characters.")}
      {field("confirmPassword", "Confirm password", "password", "new-password")}
      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Create account
      </Button>
    </form>
  );
}
