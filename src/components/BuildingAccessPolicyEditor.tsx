"use client";

import { useState, type FormEvent } from "react";
import { requestJson } from "@/lib/client-request";
import { useFeedback, useMutation } from "./FeedbackProvider";
import { ActionButton } from "./LoadingIndicator";

type Policy = { parkingLimitsEnabled: boolean; antiPassbackEnabled: boolean };

export default function BuildingAccessPolicyEditor({ buildingId, ...initial }: Policy & { buildingId: string }) {
  const [saved, setSaved] = useState<Policy>(initial);
  const [policy, setPolicy] = useState<Policy>(initial);
  const { notify, refresh } = useFeedback();
  const { pending, execute } = useMutation();
  const changed = policy.parkingLimitsEnabled !== saved.parkingLimitsEnabled || policy.antiPassbackEnabled !== saved.antiPassbackEnabled;
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void execute(async () => {
      const data = await requestJson<{ ok: boolean; policy: Policy; message: string }>(`/api/buildings/${buildingId}/access-policy`, "PATCH", policy);
      setSaved(data.policy); setPolicy(data.policy); notify(data.message); refresh();
    });
  }
  return <form className="building-access-policy" onSubmit={save} aria-label="Building access settings" aria-busy={pending}>
    <fieldset disabled={pending}>
      <legend>Access settings</legend>
      <label><input type="checkbox" checked={policy.parkingLimitsEnabled} onChange={event => setPolicy(current => ({ ...current, parkingLimitsEnabled: event.target.checked }))} /> Parking limits enabled</label>
      <label><input type="checkbox" checked={policy.antiPassbackEnabled} onChange={event => setPolicy(current => ({ ...current, antiPassbackEnabled: event.target.checked }))} /> Anti-passback enabled</label>
    </fieldset>
    <p>Limits apply to building, owner, company and visitor capacity. Anti-passback prevents repeated entry or exit without the opposite scan. Occupancy remains tracked when disabled.</p>
    <p>Limits require gateway or website authorization. With controller LAN disconnected, stored-card fallback cannot guarantee capacity limits. Controller anti-passback updates when it reconnects.</p>
    <ActionButton type="submit" className="primary-button" pending={pending} pendingText="Saving settings…" disabled={!changed}>Save access settings</ActionButton>
    <style jsx>{`
      .building-access-policy{margin-bottom:16px;padding:12px;border:1px solid #c6d8ed;border-radius:6px}
      fieldset{border:0;padding:0;margin:0;display:flex;gap:16px;flex-wrap:wrap}
      legend{font-weight:700;margin-bottom:8px;font-size:13px}
      label{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer}
      input{width:16px;height:16px;margin:0;accent-color:#1266c4}
      p{font-size:12px;color:#52667d;margin:8px 0;line-height:1.5}
    `}</style>
  </form>;
}
