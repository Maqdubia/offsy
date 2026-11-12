import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileClock,
  Heart,
  LogOut,
  PartyPopper,
  Plus,
  Sparkles,
  Sun,
  Umbrella,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { availableDays, formatDate, formatLeaveStatus, initials } from "@/lib/offsy-utils";
import type {
  OffsyBalance,
  OffsyDepartment,
  OffsyHoliday,
  OffsyLeaveType,
  OffsyNotification,
  OffsyProfile,
  OffsyRequest,
  OffsyRole,
} from "@/lib/offsy-utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OFFSY | A little time for you" },
      { name: "description", content: "Your friendly, clear space for managing work and time off." },
      { property: "og:title", content: "OFFSY | A little time for you" },
      { property: "og:description", content: "Your friendly, clear space for managing work and time off." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

type LeaveData = {
  profile: OffsyProfile;
  department: OffsyDepartment | null;
  role: OffsyRole;
  balances: (OffsyBalance & { leaveType: OffsyLeaveType })[];
  requests: (OffsyRequest & { leaveType: OffsyLeaveType })[];
  notifications: OffsyNotification[];
  holidays: OffsyHoliday[];
};

const today = new Date();
const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function HomePage() {
  const [sessionReady, setSessionReady] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [data, setData] = useState<LeaveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [signUpMode, setSignUpMode] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (!alive) return;
      if (authError || !authData.user) {
        setUserEmail("");
        setData(null);
        setLoading(false);
        setSessionReady(true);
        return;
      }
      setUserEmail(authData.user.email ?? "");
      setSessionReady(true);
      const userId = authData.user.id;
      const [profileResult, roleResult, balancesResult, requestsResult, notificationResult, holidayResult] = await Promise.all([
        supabase.from("profiles").select("*, departments(*)").eq("user_id", userId).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
        supabase.from("leave_balances").select("*, leave_types(*)").eq("employee_id", userId),
        supabase.from("leave_requests").select("*, leave_types(*)").eq("employee_id", userId).order("created_at", { ascending: false }).limit(8),
        supabase.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(5),
        supabase.from("holidays").select("*").gte("holiday_date", new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)).order("holiday_date"),
      ]);
      if (!alive) return;
      const firstError = [profileResult.error, roleResult.error, balancesResult.error, requestsResult.error, notificationResult.error, holidayResult.error].find(Boolean);
      if (firstError) toast.error(firstError.message);
      if (!profileResult.data) {
        setData(null);
        setLoading(false);
        return;
      }
      const profileRow = profileResult.data as OffsyProfile & { departments: OffsyDepartment | null };
      const balanceRows = (balancesResult.data ?? []) as unknown as (OffsyBalance & { leave_types: OffsyLeaveType })[];
      const requestRows = (requestsResult.data ?? []) as unknown as (OffsyRequest & { leave_types: OffsyLeaveType })[];
      setData({
        profile: profileRow,
        department: profileRow.departments,
        role: (roleResult.data?.role ?? "employee") as OffsyRole,
        balances: balanceRows.filter((row) => row.leave_types).map(({ leave_types, ...row }) => ({ ...row, leaveType: leave_types })),
        requests: requestRows.filter((row) => row.leave_types).map(({ leave_types, ...row }) => ({ ...row, leaveType: leave_types })),
        notifications: (notificationResult.data ?? []) as OffsyNotification[],
        holidays: (holidayResult.data ?? []) as OffsyHoliday[],
      });
      setLoading(false);
    };
    void load();
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      void load();
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const dayCount = useMemo(() => calculateWorkingDays(startDate, endDate, data?.holidays ?? []), [startDate, endDate, data?.holidays]);
  const selectedBalance = data?.balances.find((balance) => balance.leave_type_id === leaveTypeId);
  const pendingCount = data?.requests.filter((request) => request.status === "pending").length ?? 0;
  const totalAvailable = data?.balances.reduce((sum, balance) => sum + availableDays(balance), 0) ?? 0;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const calendarCells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);
  const displayName = data?.profile.full_name || userEmail.split("@")[0] || "there";
  const greeting = today.getHours() < 12 ? "Good morning" : today.getHours() < 17 ? "Good afternoon" : "Good evening";

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    setAuthBusy(true);
    if (forgotMode) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
      setAuthBusy(false);
      if (error) toast.error(error.message);
      else toast.success("Check your email for a link to reset your password.");
      return;
    }
    const password = String(form.get("password") ?? "");
    if (signUpMode) {
      const fullName = String(form.get("fullName") ?? "").trim();
      const { data: result, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin } });
      setAuthBusy(false);
      if (error) toast.error(error.message);
      else if (!result.session) toast.success("Check your email to confirm your account.");
      else toast.success("Your OFFSY account is ready.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setAuthBusy(false);
    if (error) toast.error(error.message);
  }

  async function submitLeave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!leaveTypeId || !startDate || !endDate || !reason.trim()) {
      toast.error("Choose a leave type, dates, and add a reason.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("offsy_submit_leave_request", {
      _leave_type_id: leaveTypeId,
      _start_date: startDate,
      _end_date: endDate,
      _reason: reason.trim(),
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message.replace(/^.*?:\s*/, ""));
      return;
    }
    toast.success("Your leave request has been submitted successfully.");
    setLeaveTypeId("");
    setStartDate("");
    setEndDate("");
    setReason("");
    const { data: authData } = await supabase.auth.getUser();
    if (authData.user) {
      const [requestsResult, notificationsResult, balancesResult] = await Promise.all([
        supabase.from("leave_requests").select("*, leave_types(*)").eq("employee_id", authData.user.id).order("created_at", { ascending: false }).limit(8),
        supabase.from("notifications").select("*").eq("user_id", authData.user.id).order("created_at", { ascending: false }).limit(5),
        supabase.from("leave_balances").select("*, leave_types(*)").eq("employee_id", authData.user.id),
      ]);
      setData((current) => current ? {
        ...current,
        requests: ((requestsResult.data ?? []) as unknown as (OffsyRequest & { leave_types: OffsyLeaveType })[]).filter((row) => row.leave_types).map(({ leave_types, ...row }) => ({ ...row, leaveType: leave_types })),
        notifications: (notificationsResult.data ?? []) as OffsyNotification[],
        balances: ((balancesResult.data ?? []) as unknown as (OffsyBalance & { leave_types: OffsyLeaveType })[]).filter((row) => row.leave_types).map(({ leave_types, ...row }) => ({ ...row, leaveType: leave_types })),
      } : current);
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) toast.error(error.message);
    else {
      setData(null);
      setUserEmail("");
      toast.success("You’re signed out.");
    }
  }

  if (!sessionReady || loading) return <div className="offsy-loading"><img src={logoUrl} alt="OFFSY" /><span>Making a little space…</span></div>;
  if (!data) return <AuthScreen signUpMode={signUpMode} forgotMode={forgotMode} showPassword={showPassword} busy={authBusy} onSubmit={handleAuth} onSignUp={() => { setSignUpMode((value) => !value); setForgotMode(false); }} onForgot={() => { setForgotMode((value) => !value); setSignUpMode(false); }} onShowPassword={() => setShowPassword((value) => !value)} />;

  return (
    <main className="offsy-dashboard">
      <header className="offsy-topbar">
        <Link to="/" className="offsy-brand" aria-label="OFFSY home"><img src={logoUrl} alt="OFFSY" /></Link>
        <div className="offsy-tagline">A little time for you.</div>
        <div className="offsy-account"><span className="offsy-account-name">{displayName}</span><span className="offsy-avatar">{initials(displayName)}</span><Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut /></Button></div>
      </header>
      <div className="offsy-page">
        <section className="offsy-welcome">
          <div className="offsy-welcome-copy"><span className="offsy-overline"><Sun size={15} /> YOUR TIME-OFF OVERVIEW</span><h1>{greeting}, {displayName}!</h1><p>Here’s your time-off overview. Work well. Rest better.</p></div>
          <div className="offsy-welcome-art" aria-hidden="true"><CalendarDays size={58} strokeWidth={1.35} /><Sparkles className="offsy-art-spark" size={23} /><span>REST<br />WELL</span></div>
        </section>

        <section className="offsy-stats" aria-label="Leave summary">
          <StatCard icon={<Umbrella />} label="Total available" value={`${formatNumber(totalAvailable)} days`} note="Across all leave types" tone="coral" />
          {data.balances.slice(0, 2).map((balance, index) => <StatCard key={balance.id} icon={index === 0 ? <Heart /> : <Sun />} label={balance.leaveType.name} value={`${formatNumber(availableDays(balance))} days`} note={`${formatNumber(balance.used_days)} used of ${formatNumber(balance.entitled_days)}`} tone={index === 0 ? "lavender" : "peach"} />)}
          <StatCard icon={<FileClock />} label="Pending requests" value={String(pendingCount)} note={pendingCount === 1 ? "Awaiting a decision" : "Awaiting decisions"} tone="plum" />
        </section>

        <section className="offsy-content-grid">
          <div className="offsy-section offsy-leave-section" id="apply-leave">
            <div className="offsy-section-head"><div><span className="offsy-overline"><PartyPopper size={14} /> A LITTLE TIME FOR YOU</span><h2>Plan a day off</h2><p>Plan your time off. We’ll handle the paperwork.</p></div><span className="offsy-section-icon"><Plus size={20} /></span></div>
            {data.balances.length === 0 ? <EmptyState icon={<Umbrella />} title="Your leave balance is on its way" text="Your administrator will add your available leave here." /> : <form className="offsy-leave-form" onSubmit={(event) => void submitLeave(event)}>
              <label className="offsy-field"><span>Leave type</span><select required value={leaveTypeId} onChange={(event) => setLeaveTypeId(event.target.value)}><option value="">Choose a leave type</option>{data.balances.map((balance) => <option key={balance.id} value={balance.leave_type_id}>{balance.leaveType.name} · {formatNumber(availableDays(balance))} days available</option>)}</select></label>
              <div className="offsy-date-fields"><label className="offsy-field"><span>First day</span><Input type="date" min={today.toISOString().slice(0, 10)} required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label className="offsy-field"><span>Last day</span><Input type="date" min={startDate || today.toISOString().slice(0, 10)} required value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
              {startDate && endDate && <div className="offsy-day-count"><Clock3 size={15} />{dayCount} working {dayCount === 1 ? "day" : "days"}{selectedBalance ? <span>{formatNumber(availableDays(selectedBalance))} available</span> : null}</div>}
              <label className="offsy-field"><span>Reason for your request</span><textarea required maxLength={2000} rows={3} placeholder="Share anything your manager should know…" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
              <Button className="offsy-submit" type="submit" disabled={submitting || !data.balances.length}>{submitting ? "Sending your request…" : "Submit request"}<ArrowRight size={16} /></Button>
            </form>}
          </div>

          <div className="offsy-section offsy-calendar-section">
            <div className="offsy-calendar-heading"><div><span className="offsy-overline"><CalendarDays size={14} /> YOUR MONTH</span><h2>Time-off calendar</h2></div><div className="offsy-month-controls"><Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></Button><span>{month.toLocaleDateString("en", { month: "long", year: "numeric" })}</span><Button variant="ghost" size="icon" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></Button></div></div>
            <div className="offsy-calendar-grid" role="grid" aria-label={`${month.toLocaleDateString("en", { month: "long", year: "numeric" })} calendar`}>
              {weekdayNames.map((day) => <span key={day} className="offsy-weekday" role="columnheader">{day}</span>)}
              {calendarCells.map((day, index) => {
                if (!day) return <span key={`empty-${index}`} className="offsy-calendar-cell offsy-calendar-empty" aria-hidden="true" />;
                const dayDate = new Date(month.getFullYear(), month.getMonth(), day);
                const isoDate = dateKey(dayDate);
                const isToday = isoDate === dateKey(today);
                const holiday = data.holidays.find((item) => item.holiday_date === isoDate);
                const request = data.requests.find((item) => item.status === "approved" && isoDate >= item.start_date && isoDate <= item.end_date);
                return <span key={day} className={`offsy-calendar-cell${isToday ? " is-today" : ""}${holiday ? " has-holiday" : ""}${request ? " has-leave" : ""}`} role="gridcell" aria-label={`${isoDate}${holiday ? `, ${holiday.name}` : ""}${request ? `, ${request.leaveType.name}` : ""}`} title={holiday?.name ?? request?.leaveType.name}>{day}<span className="offsy-calendar-marker" /></span>;
              })}
            </div>
            <div className="offsy-calendar-legend"><span><i className="legend-today" />Today</span><span><i className="legend-leave" />Approved leave</span><span><i className="legend-holiday" />Holiday</span></div>
            {data.holidays.length > 0 && <div className="offsy-holiday-list">{data.holidays.filter((holiday) => holiday.holiday_date.startsWith(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`)).slice(0, 3).map((holiday) => <div className="offsy-holiday" key={holiday.id}><span><Sun size={14} />{holiday.name}</span><time>{formatDate(holiday.holiday_date, { month: "short", day: "numeric" })}</time></div>)}</div>}
          </div>
        </section>

        <section className="offsy-section offsy-activity-section">
          <div className="offsy-section-head"><div><span className="offsy-overline"><FileClock size={14} /> RECENT ACTIVITY</span><h2>Your requests</h2><p>All your recent time-off plans, in one place.</p></div><span className="offsy-request-count">{data.requests.length} total</span></div>
          {data.requests.length === 0 ? <EmptyState icon={<CalendarDays />} title="Your time-off story starts here" text="When you send your first request, it’ll show up here." /> : <div className="offsy-request-list">{data.requests.map((request) => <article className="offsy-request-row" key={request.id}><span className={`offsy-request-icon status-${request.status}`}><CalendarDays size={17} /></span><div className="offsy-request-main"><strong>{request.leaveType.name}</strong><span>{formatDate(request.start_date, { month: "short", day: "numeric" })} – {formatDate(request.end_date, { month: "short", day: "numeric", year: "numeric" })}</span></div><span className="offsy-request-days">{formatNumber(request.days_requested)} {Number(request.days_requested) === 1 ? "day" : "days"}</span><span className={`offsy-status status-${request.status}`}><i />{formatLeaveStatus(request.status)}</span><time className="offsy-request-date">Sent {formatDate(request.created_at.slice(0, 10), { month: "short", day: "numeric" })}</time></article>)}</div>}
        </section>

        <footer className="offsy-footer"><span><span className="offsy-footer-wordmark">offsy<span>.</span></span> A little time for you.</span><span>Keep a little room for yourself today <Heart size={13} /></span></footer>
      </div>
    </main>
  );
}

const logoUrl = new URL("../assets/offsy-logo-refined.png", import.meta.url).href;

function AuthScreen({ signUpMode, forgotMode, showPassword, busy, onSubmit, onSignUp, onForgot, onShowPassword }: {
  signUpMode: boolean;
  forgotMode: boolean;
  showPassword: boolean;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSignUp: () => void;
  onForgot: () => void;
  onShowPassword: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [socialBusy, setSocialBusy] = useState(false);
  const title = forgotMode ? "A fresh start" : signUpMode ? "Make room for you" : "Welcome back";
  const subtitle = forgotMode ? "We’ll email you a link to choose a new password." : signUpMode ? "Your time-off story starts here." : "Your time matters. Let’s make time off feel easy.";

  async function signInGoogle() {
    setSocialBusy(true);
    const { lovable } = await import("@/integrations/lovable");
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    setSocialBusy(false);
    if (result.error) toast.error(result.error.message);
  }

  return <main className="offsy-auth-page">
    <section className="offsy-auth-story"><Link to="/" className="offsy-auth-logo"><img src={logoUrl} alt="OFFSY" /></Link><div className="offsy-story-copy"><span className="offsy-overline"><Sparkles size={15} /> WORK WELL. REST BETTER.</span><h1>A little time<br />for <em>you.</em></h1><p>Your time matters. Manage your time off without the paperwork.</p><div className="offsy-story-art" aria-hidden="true"><div className="offsy-art-sun" /><div className="offsy-art-calendar"><div className="offsy-calendar-rings"><i /><i /><i /></div><span>YOUR<br />TIME</span><div className="offsy-art-check"><Check size={22} /></div></div><div className="offsy-art-cloud cloud-one" /><div className="offsy-art-cloud cloud-two" /><span className="offsy-art-flower">✳</span></div><span className="offsy-story-caption">Good things grow when you take a breath.</span></div><div className="offsy-auth-footer">A little space to pause, recharge, and come back brighter.</div></section>
    <section className="offsy-auth-main"><div className="offsy-auth-card"><div className="offsy-auth-mobile-logo"><img src={logoUrl} alt="OFFSY" /></div><span className="offsy-overline">{forgotMode ? "PASSWORD RESET" : signUpMode ? "CREATE YOUR ACCOUNT" : "YOUR TIME, YOUR WAY"}</span><h2>{title}</h2><p className="offsy-auth-subtitle">{subtitle}</p>
      <form className="offsy-auth-form" onSubmit={(event) => { if (signUpMode && !forgotMode) { const nameField = event.currentTarget.querySelector<HTMLInputElement>("input[name=fullName]"); if (nameField) setFullName(nameField.value); } onSubmit(event); }}>
        {signUpMode && !forgotMode && <label className="offsy-field"><span>Your name</span><Input name="fullName" autoComplete="name" required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Jamie Parker" /></label>}
        <label className="offsy-field"><span>Email address</span><Input name="email" type="email" autoComplete="email" required placeholder="you@company.com" /></label>
        {!forgotMode && <label className="offsy-field"><span>Password</span><div className="offsy-password-wrap"><Input name="password" type={showPassword ? "text" : "password"} autoComplete={signUpMode ? "new-password" : "current-password"} minLength={8} required placeholder="At least 8 characters" /><Button type="button" variant="ghost" size="sm" className="offsy-password-toggle" onClick={onShowPassword}>{showPassword ? "Hide" : "Show"}</Button></div></label>}
        {!forgotMode && !signUpMode && <button type="button" className="offsy-forgot-link" onClick={onForgot}>Forgot password?</button>}
        <Button type="submit" className="offsy-auth-submit" disabled={busy}>{busy ? "One moment…" : forgotMode ? "Send reset link" : signUpMode ? "Create account" : "Sign in"}<ArrowRight size={16} /></Button>
      </form>
      {!forgotMode && <><div className="offsy-auth-divider"><span>or continue with</span></div><Button type="button" variant="outline" className="offsy-google-button" disabled={socialBusy} onClick={() => void signInGoogle()}><GoogleMark />{socialBusy ? "Connecting…" : "Continue with Google"}</Button></>}
      <p className="offsy-auth-switch">{forgotMode ? "Remember your password?" : signUpMode ? "Already have an account?" : "New to OFFSY?"} <button type="button" onClick={forgotMode ? onForgot : onSignUp}>{forgotMode ? "Back to sign in" : signUpMode ? "Sign in" : "Create an account"}</button></p>
      <p className="offsy-auth-legal">By continuing, you agree to use your time thoughtfully and treat your colleagues with care.</p>
    </div><div className="offsy-auth-main-note"><Clock3 size={14} /> A little time for you.</div></section>
  </main>;
}

function GoogleMark() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>;
}

function StatCard({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: string; note: string; tone: string }) {
  return <article className={`offsy-stat-card tone-${tone}`}><span className="offsy-stat-icon">{icon}</span><span className="offsy-stat-label">{label}</span><strong>{value}</strong><span className="offsy-stat-note">{note}</span></article>;
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="offsy-empty"><span>{icon}</span><strong>{title}</strong><p>{text}</p></div>;
}

function calculateWorkingDays(start: string, end: string, holidays: OffsyHoliday[]) {
  if (!start || !end || end < start) return 0;
  const holidayDates = new Set(holidays.map((holiday) => holiday.holiday_date));
  const cursor = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  let count = 0;
  while (cursor <= last) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6 && !holidayDates.has(dateKey(cursor))) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatNumber(value: number) {
  return Number(value).toLocaleString("en", { maximumFractionDigits: 1 });
}