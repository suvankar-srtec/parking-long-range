"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import styles from "./AdminCredentialsPopup.module.css";
import { requestJson } from "@/lib/client-request";
import { useFeedback, useMutation } from "@/components/FeedbackProvider";
import { ActionButton } from "@/components/LoadingIndicator";
import PasswordInput from "@/components/PasswordInput";

type Credentials = {
  buildingId: string;
  userId: string;
  buildingName: string;
};

export default function AdminCredentialsPopup() {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState<Credentials | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { notify } = useFeedback();
  const { pending, execute } = useMutation();

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; trigger.current?.focus(); };
  }, [open]);

  async function show() {
    setOpen(true);
    if (data || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/account/admin-credentials", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to load Admin credentials.");
      setData(result.credentials);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Admin credentials.");
    } finally {
      setLoading(false);
    }
  }

  function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const password = String(form.get("password") ?? "");
    if (!password.trim()) {
      notify("Enter a new Admin password.", "error");
      return;
    }

    void execute(async () => {
      const result = await requestJson<{ ok: true; message: string }>(
        `/api/buildings/${data.buildingId}`,
        "PATCH",
        { password },
      );
      notify(result.message || "Admin password updated.");
      formElement.reset();
      dialog.current?.focus();
    });
  }

  return <>
    <button ref={trigger} type="button" className="sidebar-role-pill sidebar-role-button" onClick={() => void show()}>ADMIN</button>
    {open ? createPortal(<div className={styles.backdrop} onMouseDown={event => {
      if (event.target === event.currentTarget && !pending) setOpen(false);
    }} onKeyDown={event => {
      if (event.key === "Escape" && !pending) { event.preventDefault(); setOpen(false); }
      if (event.key === "Tab") {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') || []);
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
      }
    }}>
      <section ref={dialog} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="admin-credentials-title">
        <header className={styles.header}>
          <div><span className={styles.eyebrow}>ADMIN ACCOUNT</span><h2 id="admin-credentials-title">Admin credentials</h2></div>
          <button type="button" className={styles.close} aria-label="Close" disabled={pending} onClick={() => setOpen(false)}>&times;</button>
        </header>
        <div className={styles.body}>
          {loading ? <p role="status">Loading credentials...</p> : null}
          {error ? <div role="alert" className="parking-feedback parking-feedback-error">{error}</div> : null}
          {data ? <>
            <dl className={styles.details}><div><dt>Admin User ID</dt><dd>{data.userId}</dd></div><div><dt>Building</dt><dd>{data.buildingName}</dd></div></dl>
            <form className={styles.form} onSubmit={updatePassword} aria-busy={pending}>
              <PasswordInput label="New password" name="password" placeholder="Enter new password" autoComplete="new-password" required disabled={pending} />
              <footer className={styles.actions}>
                <button type="button" className={styles.cancel} disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
                <ActionButton type="submit" className={styles.save} pending={pending} pendingText="Updating...">Update password</ActionButton>
              </footer>
            </form>
          </> : null}
        </div>
      </section>
    </div>, document.body) : null}
  </>;
}
