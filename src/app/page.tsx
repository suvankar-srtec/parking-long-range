"use client";

import { type FormEvent } from "react";
import { useFeedback, useMutation } from "@/components/FeedbackProvider";
import { ActionButton } from "@/components/LoadingIndicator";
import PasswordInput from "@/components/PasswordInput";
import { checkForm, requestJson } from "@/lib/client-request";

export default function LoginPage() {
  const { notify, navigate } = useFeedback();
  const { pending, execute } = useMutation();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formError = checkForm(event.currentTarget);
    if (formError) { notify(formError, "error"); return; }
    const data = new FormData(event.currentTarget);

    void execute(async () => {
      const result = await requestJson<{ ok: boolean; redirectTo: string }>("/api/login", "POST", {
        userId: data.get("userId"),
        password: data.get("password"),
      });
      notify("Signed in successfully.");
      navigate(result.redirectTo || "/dashboard", true);
    });
  }

  return <main className="login-page"><section className="login-card">
    <div className="brand-badge">SRTEC Access Control</div>
    <form className="login-form" noValidate aria-busy={pending} onSubmit={submit}>
      <label>User ID<input name="userId" placeholder="User ID" required autoComplete="username" disabled={pending} /></label>
      <PasswordInput label="Password" name="password" placeholder="Password" required autoComplete="current-password" disabled={pending} />
      <ActionButton type="submit" className="login-submit" pending={pending} pendingText="Signing in…">Sign in</ActionButton>
    </form>
  </section></main>;
}
