CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'employee');
CREATE TYPE public.leave_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  avatar_url text,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  manager_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  is_paid boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_types TO authenticated;
GRANT ALL ON public.leave_types TO service_role;
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE RESTRICT,
  entitled_days numeric(7,2) NOT NULL DEFAULT 0 CHECK (entitled_days >= 0),
  used_days numeric(7,2) NOT NULL DEFAULT 0 CHECK (used_days >= 0 AND used_days <= entitled_days),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, leave_type_id)
);
GRANT SELECT ON public.leave_balances TO authenticated;
GRANT ALL ON public.leave_balances TO service_role;
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  holiday_date date NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays TO authenticated;
GRANT ALL ON public.holidays TO service_role;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date date NOT NULL,
  days_requested numeric(7,2) NOT NULL CHECK (days_requested > 0),
  reason text NOT NULL,
  status public.leave_request_status NOT NULL DEFAULT 'pending',
  reviewer_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  rejection_reason text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
GRANT SELECT ON public.leave_requests TO authenticated;
GRANT ALL ON public.leave_requests TO service_role;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX leave_requests_employee_created_idx ON public.leave_requests(employee_id, created_at DESC);
CREATE INDEX leave_requests_status_dates_idx ON public.leave_requests(status, start_date, end_date);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  request_id uuid REFERENCES public.leave_requests(id) ON DELETE SET NULL,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX notifications_user_created_idx ON public.notifications(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.offsy_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  initial_role public.app_role;
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''), split_part(COALESCE(NEW.email, ''), '@', 1), 'New employee')
  );

  PERFORM pg_advisory_xact_lock(hashtext('offsy_first_admin'));
  IF NOT EXISTS (SELECT 1 FROM public.user_roles LIMIT 1) THEN
    initial_role := 'admin';
  ELSE
    initial_role := 'employee';
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, initial_role);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.offsy_handle_new_user() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER offsy_create_profile_and_role
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.offsy_handle_new_user();

CREATE OR REPLACE FUNCTION public.offsy_guard_profile_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() = OLD.user_id AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.department_id IS DISTINCT FROM OLD.department_id OR NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN
      RAISE EXCEPTION 'Only an administrator can change department or manager assignments.';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.offsy_guard_profile_changes() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER offsy_profile_update_guard
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.offsy_guard_profile_changes();

CREATE OR REPLACE FUNCTION public.offsy_submit_leave_request(
  _leave_type_id uuid,
  _start_date date,
  _end_date date,
  _reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requester uuid := auth.uid();
  requested_days numeric(7,2);
  balance_row public.leave_balances%ROWTYPE;
  pending_days numeric(7,2);
  request_id uuid;
  manager_user uuid;
BEGIN
  IF requester IS NULL THEN RAISE EXCEPTION 'Sign in to submit a leave request.'; END IF;
  IF _start_date IS NULL OR _end_date IS NULL OR _end_date < _start_date THEN
    RAISE EXCEPTION 'Choose a valid start and end date.';
  END IF;
  IF _start_date < CURRENT_DATE THEN RAISE EXCEPTION 'Leave cannot start in the past.'; END IF;
  IF NULLIF(trim(_reason), '') IS NULL THEN RAISE EXCEPTION 'Add a reason for your request.'; END IF;
  IF length(trim(_reason)) > 2000 THEN RAISE EXCEPTION 'Keep the reason under 2,000 characters.'; END IF;

  PERFORM 1 FROM public.profiles WHERE user_id = requester FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Your employee profile is not ready yet.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leave_types WHERE id = _leave_type_id AND is_active) THEN
    RAISE EXCEPTION 'Choose an active leave type.';
  END IF;

  SELECT count(*)::numeric INTO requested_days
  FROM generate_series(_start_date, _end_date, interval '1 day') AS day
  WHERE extract(isodow FROM day) < 6
    AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.holiday_date = day::date);
  IF requested_days <= 0 THEN RAISE EXCEPTION 'The selected dates contain no working days.'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.leave_requests r
    WHERE r.employee_id = requester
      AND r.status IN ('pending', 'approved')
      AND daterange(r.start_date, r.end_date, '[]') && daterange(_start_date, _end_date, '[]')
  ) THEN RAISE EXCEPTION 'These dates overlap another pending or approved request.'; END IF;

  SELECT * INTO balance_row FROM public.leave_balances
  WHERE employee_id = requester AND leave_type_id = _leave_type_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No balance is set up for this leave type yet. Ask your administrator.'; END IF;
  SELECT COALESCE(sum(days_requested), 0) INTO pending_days
  FROM public.leave_requests WHERE employee_id = requester AND leave_type_id = _leave_type_id AND status = 'pending';
  IF balance_row.entitled_days - balance_row.used_days - pending_days < requested_days THEN
    RAISE EXCEPTION 'There are not enough available days for this request.';
  END IF;

  INSERT INTO public.leave_requests(employee_id, leave_type_id, start_date, end_date, days_requested, reason)
  VALUES (requester, _leave_type_id, _start_date, _end_date, requested_days, trim(_reason))
  RETURNING id INTO request_id;

  INSERT INTO public.notifications(user_id, title, message, request_id)
  VALUES (requester, 'Request sent', 'Your leave request has been submitted successfully.', request_id);

  SELECT manager_id INTO manager_user FROM public.profiles WHERE user_id = requester;
  IF manager_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, title, message, request_id)
    VALUES (manager_user, 'A request needs review', 'A new leave request is waiting for your review.', request_id);
  END IF;
  RETURN request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.offsy_submit_leave_request(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offsy_submit_leave_request(uuid, date, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.offsy_review_leave_request(
  _request_id uuid,
  _decision public.leave_request_status,
  _rejection_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reviewer uuid := auth.uid();
  request_row public.leave_requests%ROWTYPE;
  manager_match boolean;
BEGIN
  IF reviewer IS NULL THEN RAISE EXCEPTION 'Sign in to review requests.'; END IF;
  IF _decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Choose approve or reject.'; END IF;
  IF _decision = 'rejected' AND NULLIF(trim(_rejection_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Add a reason when declining a request.';
  END IF;
  IF length(COALESCE(_rejection_reason, '')) > 2000 THEN RAISE EXCEPTION 'Keep the feedback under 2,000 characters.'; END IF;

  SELECT employee_id INTO request_row.employee_id FROM public.leave_requests WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'This request could not be found.'; END IF;
  PERFORM 1 FROM public.profiles WHERE user_id = request_row.employee_id FOR UPDATE;
  SELECT * INTO request_row FROM public.leave_requests WHERE id = _request_id FOR UPDATE;
  IF request_row.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been reviewed.'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id = request_row.employee_id AND manager_id = reviewer
  ) INTO manager_match;
  IF NOT public.has_role(reviewer, 'admin') AND NOT (public.has_role(reviewer, 'manager') AND manager_match) THEN
    RAISE EXCEPTION 'You are not allowed to review this employee’s requests.';
  END IF;

  IF _decision = 'approved' THEN
    UPDATE public.leave_balances
    SET used_days = used_days + request_row.days_requested, updated_at = now()
    WHERE employee_id = request_row.employee_id AND leave_type_id = request_row.leave_type_id
      AND used_days + request_row.days_requested <= entitled_days;
    IF NOT FOUND THEN RAISE EXCEPTION 'The employee’s available balance has changed.'; END IF;
  END IF;

  UPDATE public.leave_requests
  SET status = _decision,
      reviewer_id = reviewer,
      rejection_reason = CASE WHEN _decision = 'rejected' THEN trim(_rejection_reason) ELSE NULL END,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = _request_id;

  INSERT INTO public.notifications(user_id, title, message, request_id)
  VALUES (
    request_row.employee_id,
    CASE WHEN _decision = 'approved' THEN 'Time off approved' ELSE 'Request update' END,
    CASE WHEN _decision = 'approved' THEN 'Great news! Your leave request has been approved.' ELSE 'Your leave request was not approved. View the manager’s feedback.' END,
    _request_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.offsy_review_leave_request(uuid, public.leave_request_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offsy_review_leave_request(uuid, public.leave_request_status, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.offsy_cancel_leave_request(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requester uuid := auth.uid();
  request_row public.leave_requests%ROWTYPE;
BEGIN
  IF requester IS NULL THEN RAISE EXCEPTION 'Sign in to cancel a request.'; END IF;
  SELECT employee_id INTO request_row.employee_id FROM public.leave_requests WHERE id = _request_id;
  IF NOT FOUND OR request_row.employee_id <> requester THEN RAISE EXCEPTION 'This request cannot be cancelled.'; END IF;
  PERFORM 1 FROM public.profiles WHERE user_id = requester FOR UPDATE;
  SELECT * INTO request_row FROM public.leave_requests WHERE id = _request_id FOR UPDATE;
  IF request_row.status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'This request can no longer be cancelled.'; END IF;
  IF request_row.status = 'approved' THEN
    IF request_row.start_date <= CURRENT_DATE THEN RAISE EXCEPTION 'Approved leave that has started cannot be cancelled here.'; END IF;
    UPDATE public.leave_balances
    SET used_days = GREATEST(0, used_days - request_row.days_requested), updated_at = now()
    WHERE employee_id = requester AND leave_type_id = request_row.leave_type_id;
  END IF;
  UPDATE public.leave_requests SET status = 'cancelled', updated_at = now() WHERE id = _request_id;
  INSERT INTO public.notifications(user_id, title, message, request_id)
  VALUES (requester, 'Request cancelled', 'Your leave request has been cancelled.', _request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.offsy_cancel_leave_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offsy_cancel_leave_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.offsy_set_employee_balance(_employee_id uuid, _leave_type_id uuid, _entitled_days numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_used numeric(7,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrator access is required.'; END IF;
  IF _entitled_days IS NULL OR _entitled_days < 0 THEN RAISE EXCEPTION 'Enter a valid number of available days.'; END IF;
  SELECT used_days INTO current_used FROM public.leave_balances
  WHERE employee_id = _employee_id AND leave_type_id = _leave_type_id FOR UPDATE;
  IF FOUND THEN
    IF _entitled_days < current_used THEN RAISE EXCEPTION 'The allowance cannot be lower than days already used.'; END IF;
    UPDATE public.leave_balances SET entitled_days = _entitled_days, updated_at = now()
    WHERE employee_id = _employee_id AND leave_type_id = _leave_type_id;
  ELSE
    INSERT INTO public.leave_balances(employee_id, leave_type_id, entitled_days)
    VALUES (_employee_id, _leave_type_id, _entitled_days);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.offsy_set_employee_balance(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offsy_set_employee_balance(uuid, uuid, numeric) TO authenticated;

CREATE POLICY departments_read_authenticated ON public.departments FOR SELECT TO authenticated USING (true);
CREATE POLICY departments_admin_manage ON public.departments FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY profiles_read_scope ON public.profiles FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR
  (public.has_role(auth.uid(), 'manager') AND manager_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.profiles team WHERE team.user_id = profiles.user_id AND team.manager_id = auth.uid())
);
CREATE POLICY profiles_update_scope ON public.profiles FOR UPDATE TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')) WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY roles_read_scope ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY roles_admin_manage ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY leave_types_read_authenticated ON public.leave_types FOR SELECT TO authenticated USING (true);
CREATE POLICY leave_types_admin_manage ON public.leave_types FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY balances_read_scope ON public.leave_balances FOR SELECT TO authenticated USING (
  employee_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR
  (public.has_role(auth.uid(), 'manager') AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = leave_balances.employee_id AND p.manager_id = auth.uid()
  ))
);
CREATE POLICY holidays_read_authenticated ON public.holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY holidays_admin_manage ON public.holidays FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY requests_read_scope ON public.leave_requests FOR SELECT TO authenticated USING (
  employee_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR
  (public.has_role(auth.uid(), 'manager') AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = leave_requests.employee_id AND p.manager_id = auth.uid()
  ))
);
CREATE POLICY notifications_read_own ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
