revoke all on function public.admin_review_employee(text,text,text,text[],text) from anon;
revoke all on function public.admin_update_work_status(text,text,text,text,date,date,text) from anon;
grant execute on function public.admin_review_employee(text,text,text,text[],text) to authenticated;
grant execute on function public.admin_update_work_status(text,text,text,text,date,date,text) to authenticated;
create index if not exists employee_work_status_updated_by_idx on public.employee_work_status(updated_by);
