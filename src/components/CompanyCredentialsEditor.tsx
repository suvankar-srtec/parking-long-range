"use client";

import { useState, type FormEvent } from "react";
import PasswordInput from "@/components/PasswordInput";
import { ActionButton } from "@/components/LoadingIndicator";
import { useFeedback, useMutation } from "@/components/FeedbackProvider";
import { requestJson } from "@/lib/client-request";

export default function CompanyCredentialsEditor({
  userId,
  companyName,
  initialPassword,
}: {
  userId: string;
  companyName: string;
  initialPassword: string;
}) {
  const { notify, refresh } = useFeedback();
  const { pending, execute } = useMutation();
  const [password, setPassword] = useState(initialPassword);

  const dirty = password !== initialPassword;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password.trim()) {
      notify("Company password is required.", "error");
      return;
    }

    void execute(async () => {
      const result = await requestJson<{ ok: true; message: string }>(
        "/api/company-account",
        "PATCH",
        { password },
      );
      notify(result.message || "Company password updated successfully.");
      refresh();
    });
  }

  return <form className="company-credentials-editor" aria-busy={pending} onSubmit={submit}>
    <div className="company-credentials-head">
      <div>
        <span>COMPANY LOGIN</span>
      </div>
      <ActionButton type="submit" className="secondary-button company-credentials-save" pending={pending} pendingText="Saving…" disabled={!dirty || pending}>
        Update password
      </ActionButton>
    </div>

    <div className="company-credentials-grid">
      <label>
        Company User ID
        <input value={userId} readOnly autoComplete="username" />
      </label>
      <label>
        Company name
        <input value={companyName} readOnly />
      </label>
      <PasswordInput
        label="Company password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        disabled={pending}
        required
      />
    </div>

    <style>{`
      .company-credentials-editor{margin:0 0 14px;padding:12px;border:1px solid #d6dfda;border-radius:10px;background:#f8faf9}
      .company-credentials-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:10px}
      .company-credentials-head>div{display:flex;align-items:baseline;gap:9px;min-width:0}
      .company-credentials-head span{font-size:9px;font-weight:900;letter-spacing:.08em;color:#8241b2}
      .company-credentials-head strong{font-size:13px;color:#17261e}
      .company-credentials-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
      .company-credentials-grid>label,.company-credentials-grid>.password-field{display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:800;color:#3d4c44;min-width:0}
      .company-credentials-grid input{width:100%;height:40px;border:1px solid #cbd7d0;border-radius:8px;background:#fff;padding:0 12px;font:inherit;color:#17261e;outline:none;box-sizing:border-box}
      .company-credentials-grid input[readonly]{background:#f1edf5;color:#564663}
      .company-credentials-grid input:focus{border-color:#8d4bbb;box-shadow:0 0 0 2px rgba(141,75,187,.10)}
      .company-credentials-grid .password-input-wrap{position:relative}
      .company-credentials-grid .password-input-wrap input{padding-right:44px}
      .company-credentials-grid .password-toggle{position:absolute;right:7px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:30px;height:30px;border:0;background:transparent;color:#69766f;cursor:pointer}
      .company-credentials-grid .password-toggle:hover{color:#7f3faf}
      .company-credentials-save{min-width:132px;justify-content:center}
      @media(max-width:900px){.company-credentials-grid{grid-template-columns:1fr 1fr}.company-credentials-grid>.password-field{grid-column:1/-1}}
      @media(max-width:620px){.company-credentials-head{align-items:flex-start;flex-direction:column}.company-credentials-grid{grid-template-columns:1fr}.company-credentials-grid>.password-field{grid-column:auto}.company-credentials-save{width:100%}}
    `}</style>
  </form>;
}
