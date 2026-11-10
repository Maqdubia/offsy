# OFFSY leave-management app

## Goal
Build a working OFFSY leave-management application in this project, which currently contains only a blank TanStack Start template. Lovable Cloud has been enabled. Employee profile storage is required.

## User experience
- Replace the starter screen with a warm, branded OFFSY dashboard and provide public sign-in, registration, and password-reset screens.
- Add employee-facing dashboard, apply-for-leave, history, calendar, notifications, and profile experiences.
- Add manager and administrator views for requests and organization management, with server-checked roles and appropriate secure approval/rejection behavior.
- Apply the provided palette, tagline, responsive layouts, reusable UI patterns, and branded logo/favicon.

## Technical approach
- Use Cloud Auth, a profiles table, separate protected user_roles, and RLS-scoped leave-domain tables. Enforce request validation and manager/admin actions in secure backend/database operations; never simulate approvals in the browser.
- Preserve TanStack Start, generated Cloud integration files, and design-system tokens. Do not create Supabase Edge Functions.
- Implement first the shared design system, brand assets, auth flows and schema; then wire core employee and manager workflows and administrative views against real database rows.
- Add route-specific metadata and tests for critical leave rules; verify the visible app, build logs, and supported authenticated flows.

## Scope note
The provided project was a blank starter, so there were no pre-existing leave workflows, records, or integration settings to preserve. This is a new OFFSY application rather than a rebrand of an existing system.