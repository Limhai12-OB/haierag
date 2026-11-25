import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { LoginForm } from "./login-form";
import { RegisterForm } from "./register-form";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("LoginForm", () => {
  it("shows required-field errors and does not submit", async () => {
    const submit = vi.fn();
    render(<LoginForm submit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Email is required.")).toBeInTheDocument();
    expect(screen.getByText("Password is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(submit).not.toHaveBeenCalled();
  });

  it("validates email format", async () => {
    const submit = vi.fn();
    render(<LoginForm submit={submit} />);
    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.type(screen.getByLabelText("Password"), "whatever1");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits trimmed credentials and reports invalid credentials", async () => {
    const submit = vi.fn().mockRejectedValue(new ApiError(401, { detail: "Bad credentials" }));
    render(<LoginForm submit={submit} />);
    await userEvent.type(screen.getByLabelText("Email"), "  ann@example.com ");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(submit).toHaveBeenCalledWith({ email: "ann@example.com", password: "secret123" });
    expect(await screen.findByText("Incorrect email or password.")).toBeInTheDocument();
  });
});

describe("RegisterForm", () => {
  const fill = async (v: { name?: string; email?: string; pw?: string; confirm?: string }) => {
    if (v.name) await userEvent.type(screen.getByLabelText("Display name"), v.name);
    if (v.email) await userEvent.type(screen.getByLabelText("Email"), v.email);
    if (v.pw) await userEvent.type(screen.getByLabelText("Password"), v.pw);
    if (v.confirm) await userEvent.type(screen.getByLabelText("Confirm password"), v.confirm);
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
  };

  it("requires all fields", async () => {
    const submit = vi.fn();
    render(<RegisterForm submit={submit} />);
    await fill({});
    expect(screen.getByText("Display name is required.")).toBeInTheDocument();
    expect(screen.getByText("Email is required.")).toBeInTheDocument();
    expect(screen.getByText("Password is required.")).toBeInTheDocument();
    expect(screen.getByText("Please confirm your password.")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("enforces minimum password length (8) and matching confirmation", async () => {
    const submit = vi.fn();
    render(<RegisterForm submit={submit} />);
    await fill({ name: "Ann", email: "ann@example.com", pw: "short", confirm: "short" });
    expect(screen.getByText("Password must be at least 8 characters.")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Password"));
    await userEvent.type(screen.getByLabelText("Password"), "longenough");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits valid input and maps server field errors", async () => {
    const submit = vi
      .fn()
      .mockRejectedValue(new ApiError(409, { detail: "Email already registered", errors: { email: "Already in use" } }));
    render(<RegisterForm submit={submit} />);
    await fill({ name: " Ann ", email: "ann@example.com", pw: "longenough", confirm: "longenough" });
    expect(submit).toHaveBeenCalledWith({ displayName: "Ann", email: "ann@example.com", password: "longenough" });
    expect(await screen.findByText("Already in use")).toBeInTheDocument();
    expect(screen.getByText("An account with this email already exists.")).toBeInTheDocument();
  });
});
