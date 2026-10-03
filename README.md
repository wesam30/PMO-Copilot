# PMO Copilot — Phase 2 Admin Portal MVP

## Architecture

- Static browser UI uses only Supabase's publishable key; no service-role key is committed or exposed.
- `register-employee` validates and normalizes Egyptian mobile numbers, creates a pending Auth account, registers employee and project details through `register_employee`, links the Auth UUID, and sends a Gmail-backed set-password link with the Employee ID.
- `portal.html` opens the production-style admin portal in `admin-portal.html`, with responsive styles in `portal.css` and behavior in `portal.js`.
- The admin portal separates account access, workforce availability, and project delivery status into different tabs and data fields.
- PostgreSQL RLS permits business-data access only to active accounts. Roles are separate from `job_title`: `engineer`, `manager`, `admin`.
- `project_assignments` maintains assignment history and enforces one active responsible engineer per project.
- `project_updates` keeps weekly versions; one current official update per project/week; its computed `variance` is `actual_percent - planned_percent`.
- `employee_work_status` is the future HR integration boundary. It stores leave type, reason, and expected return date without mixing those fields with login access.
- `admin_audit_log` records access, role, project-assignment, and workforce-status decisions.
- `communication_log` records approval, weekly-update, and portfolio-report email delivery outcomes.
- `admin-actions` is an authenticated Edge Function for approvals, project-change notifications, automatic weekly update delivery, and on-demand portfolio report email.

## Supabase Free Plan scope

This MVP uses Postgres, Auth, and three operational Edge Functions only. It does not use Storage, Realtime, cron, queues, or file attachments. Dashboard and report queries run on demand rather than polling.

## Manual administrator bootstrap (required)

Choose and activate the first trusted administrator directly in Supabase after deployment. Later approvals, account-status changes, roles, assignments, employee availability, and reports are handled through the portal.

## Deployment notes

1. Keep the existing personal Gmail SMTP configuration private; do not replace the sender until separately approved.
2. Apply the Phase 2 migrations followed by the admin portal and grant-hardening migrations when reproducing the database.
3. Keep database exports, operational snapshots, and employee data outside this repository.
4. Configure Edge Function secrets in Supabase; never commit SMTP credentials or service-role keys.

## Test checklist

- Registration sends a pending account and set-password email.
- Pending, inactive, and rejected accounts are denied business data.
- An admin can activate a role and create a single active project assignment.
- An engineer submits an assigned-project weekly update; duplicate current week submissions create a versioned replacement.
- The PMO coordinator receives every submitted weekly update automatically. When a direct manager email is supplied, the manager is the recipient and the coordinator is copied.
- Weekly update email uses the PMO Copilot dashboard template with fixed KPI cards, planned/actual/variance percentages, a project-status table, and detailed challenge, risk, action, and intervention fields.
- Manager and admin RLS views show portfolio data; engineers see only assigned projects and their own update history.
- Imported employee rows without an Auth account cannot be activated.
- Admin approval updates access and responsible projects atomically and records an audit event.
- Approval/project-change email failure does not roll back the approved database decision; delivery is recorded for retry.
- Reports can be printed/saved as PDF, downloaded as CSV, or emailed from the Reports tab.

## MVP completion gate

The implementation is ready for final acceptance when these two user-driven checks pass:

1. Sign in with the approved engineer test account, submit one update for the demo project, and confirm the coordinator receives the branded HTML report.
2. Sign in as the administrator, verify the update appears in project reporting, and send one portfolio report to the administrator's own email.

After acceptance, publish the static frontend and push the approved source to GitHub. Local `127.0.0.1` links are development previews only and are not a public deployment.

## Decision log

- Preserved stable Employee and Project IDs and did not migrate data to a new identity table.
- Used `access_role` independently of job title, specialty, and future review stage to support later workflow expansion.
- Chose database constraints and RLS for ownership/approval rules so the browser remains a thin client.
- Kept the implementation within the Supabase Free Plan; no paid services were enabled.
