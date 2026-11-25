"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { formatDateTime } from "@/lib/format";
import { updateMe } from "@/services/auth";

export function ProfileForm() {
  const user = useAuthStore((s) => s.user)!;
  const [name, setName] = useState(user.displayName);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => updateMe({ displayName: name.trim() }),
    onSuccess: () => toast.success("Profile updated"),
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>How you appear to other members.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-md gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return setError("Display name is required.");
            if (n.length > 100) return setError("Display name must be at most 100 characters.");
            setError(null);
            save.mutate();
          }}
        >
          <Field id="display-name" label="Display name" error={error}>
            <Input
              id="display-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? "display-name-error" : undefined}
            />
          </Field>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="truncate">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Role</dt>
              <dd>
                <Badge variant="secondary">{user.systemRole === "ADMIN" ? "Administrator" : "User"}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Member since</dt>
              <dd>{formatDateTime(user.createdAt)}</dd>
            </div>
          </dl>
          <div>
            <Button type="submit" disabled={save.isPending || name.trim() === user.displayName}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Save changes
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
