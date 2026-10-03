alter table public.communication_log
  drop constraint if exists communication_log_event_type_check;

alter table public.communication_log
  add constraint communication_log_event_type_check
  check (event_type = any (array[
    'account_approved'::text,
    'account_changed'::text,
    'projects_changed'::text,
    'portfolio_report'::text,
    'weekly_update'::text
  ]));
