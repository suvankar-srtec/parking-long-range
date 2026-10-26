"use client";

import { useId, useState, type InputHTMLAttributes } from "react";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; floatingLabel?: boolean };

export default function PasswordInput({ label, id, disabled, floatingLabel = false, ...props }: PasswordInputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const [visible, setVisible] = useState(false);
  const action = visible ? "Hide password" : "Show password";

  return <div className={`password-field${floatingLabel ? " floating-password-field" : ""}`}>
    {!floatingLabel && <label htmlFor={inputId}>{label}</label>}
    <div className="password-input-wrap">
      <input {...props} id={inputId} type={visible ? "text" : "password"} disabled={disabled} placeholder={floatingLabel ? " " : props.placeholder} />
      {floatingLabel && <><label htmlFor={inputId}>{label}</label><fieldset className="floating-field-outline" aria-hidden="true"><legend><span>{label}</span></legend></fieldset></>}
      <button type="button" className="password-toggle" aria-label={action} title={action}
        aria-controls={inputId} aria-pressed={visible} disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} onClick={() => setVisible((value) => !value)}>
        <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </div>
  </div>;
}
