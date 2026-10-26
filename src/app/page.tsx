"use client";

import { type FormEvent } from "react";
import { useFeedback, useMutation } from "@/components/FeedbackProvider";
import { ActionButton } from "@/components/LoadingIndicator";
import PasswordInput from "@/components/PasswordInput";
import styles from "./login.module.css";
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

  return <main className={styles.page}>
    <section className={styles.shell} aria-label="SRTEC Access Control login">
      <aside className={styles.brandPanel}>
        <div className={styles.brand}><span className={styles.mark} aria-hidden="true">S</span><div><strong>SRTEC</strong><span>Access Control</span></div></div>
        <div className={styles.brandContent}>
          <span className={styles.eyebrow}>PARKING & ACCESS MANAGEMENT</span>
          <h1>Every entry.<br />Under control.</h1>
          <div className={styles.illustration} aria-hidden="true">
            <svg viewBox="0 0 420 210" fill="none">
              <path d="M20 178h380M55 197h310" stroke="currentColor" strokeOpacity=".16" />
              <rect x="66" y="51" width="96" height="127" rx="12" fill="currentColor" fillOpacity=".06" stroke="currentColor" strokeOpacity=".25" />
              <rect x="82" y="68" width="64" height="53" rx="7" fill="currentColor" fillOpacity=".09" />
              <path d="M105 105V82h13a7 7 0 0 1 0 14h-13" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              <circle cx="114" cy="143" r="5" fill="#65d9bd" />
              <path d="M162 138h150" stroke="#65d9bd" strokeWidth="10" strokeLinecap="round" />
              <path d="m182 133-6 10m31-10-6 10m31-10-6 10m31-10-6 10m31-10-6 10" stroke="#163c52" strokeWidth="6" />
              <path d="M307 178v-27m25 27v-63" stroke="currentColor" strokeOpacity=".3" strokeWidth="5" strokeLinecap="round" />
              <path d="M293 64a26 26 0 0 1 37 0m-30 8a15 15 0 0 1 23 0m-16 8a5 5 0 0 1 9 0" stroke="#65d9bd" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
          <div className={styles.features}><span>Buildings</span><span>Vehicles</span><span>RFID access</span></div>
        </div>
        <span className={styles.brandFooter}>SRTEC Access Control System</span>
      </aside>
      <div className={styles.formPanel}>
        <div className={styles.formBrand}><span className={styles.formMark} aria-hidden="true">S</span><div><strong>SRTEC</strong><span>Access Control</span></div></div>
        <form className={styles.form} noValidate aria-busy={pending} onSubmit={submit}>
          <label>User ID<input name="userId" placeholder="User ID" required autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={pending} /></label>
          <PasswordInput label="Password" name="password" placeholder="Password" required autoComplete="current-password" disabled={pending} />
          <ActionButton type="submit" className={styles.submit} pending={pending} pendingText="Signing in...">Sign in <span aria-hidden="true">&rarr;</span></ActionButton>
        </form>
        <div className={styles.formFooter}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>Authorized personnel only</div>
      </div>
    </section>
  </main>;
}
