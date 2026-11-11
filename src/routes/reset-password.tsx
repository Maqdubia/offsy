import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password | OFFSY" },
      { name: "description", content: "Choose a new password for your OFFSY account." },
      { property: "og:title", content: "Set a new password | OFFSY" },
      { property: "og:description", content: "Choose a new password for your OFFSY account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const verifyRecovery = async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (hash.get("type") === "recovery" && hash.get("access_token") && hash.get("refresh_token")) {
        const { error } = await supabase.auth.setSession({
          access_token: hash.get("access_token") ?? "",
          refresh_token: hash.get("refresh_token") ?? "",
        });
        if (error) toast.error(error.message);
        else setRecoveryReady(true);
      } else {
        const { data } = await supabase.auth.getSession();
        setRecoveryReady(Boolean(data.session));
      }
    };
    void verifyRecovery();
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 8) return toast.error("Use at least 8 characters for your password.");
    if (password !== confirmation) return toast.error("Those passwords don’t match.");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Your password has been updated. You can sign in now.");
    await supabase.auth.signOut();
    window.location.assign("/");
  };

  return (
    <main className="auth-page">
      <div className="auth-backdrop auth-backdrop-one" aria-hidden="true" />
      <div className="auth-backdrop auth-backdrop-two" aria-hidden="true" />
      <section className="auth-shell">
        <Link to="/" className="auth-wordmark" aria-label="OFFSY home">offsy<span>.</span></Link>
        <div className="auth-panel">
          <div className="auth-mark"><LockKeyhole size={20} /></div>
          <span className="eyebrow">A LITTLE TIME FOR YOU</span>
          <h1>Choose a new password</h1>
          <p className="auth-subtitle">Make it something only you know.</p>
          {!recoveryReady ? (
            <div className="auth-message" role="status">Open the password-reset link from your email to continue.</div>
          ) : (
            <form className="auth-form" onSubmit={(event) => void submit(event)}>
              <label className="field-label" htmlFor="new-password">New password</label>
              <div className="password-wrap">
                <Input id="new-password" autoComplete="new-password" type={showPassword ? "text" : "password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
                <Button type="button" variant="ghost" size="icon" className="password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff /> : <Eye />}</Button>
              </div>
              <label className="field-label" htmlFor="confirm-password">Confirm new password</label>
              <Input id="confirm-password" autoComplete="new-password" type="password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
              <Button type="submit" className="auth-submit" disabled={saving}>{saving ? "Saving…" : "Save new password"}</Button>
            </form>
          )}
          <Link to="/" className="auth-back-link"><ArrowLeft size={15} /> Back to sign in</Link>
        </div>
      </section>
    </main>
  );
}