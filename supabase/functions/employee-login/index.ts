import "jsr:@supabase/functions-js@2.5.0/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.95.0";

const json = (request: Request, status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || request.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" } });

Deno.serve(async request => {
  if (request.method === "OPTIONS") return json(request, 200, {});
  if (request.method !== "POST") return json(request, 405, { success: false, message: "Method not allowed." });
  try {
    const { employeeId, password } = await request.json();
    if (typeof employeeId !== "string" || typeof password !== "string" || !employeeId.trim() || !password) return json(request, 400, { success: false, message: "Employee ID and password are required." });
    const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json(request, 500, { success: false, message: "Service configuration error." });
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: employee } = await admin.from("employees").select("email, account_status, access_role, employee_id, employee_name").eq("employee_id", employeeId.trim().toUpperCase()).maybeSingle();
    if (!employee) return json(request, 401, { success: false, message: "Invalid Employee ID or password." });
    if (employee.account_status !== "active") return json(request, 403, { success: false, status: employee.account_status, message: `This account is ${employee.account_status}. Contact your PMO administrator.` });
    const { data, error } = await admin.auth.signInWithPassword({ email: employee.email, password });
    if (error || !data.session) return json(request, 401, { success: false, message: "Invalid Employee ID or password." });
    return json(request, 200, { success: true, session: data.session, employee: { employeeId: employee.employee_id, employeeName: employee.employee_name, role: employee.access_role } });
  } catch { return json(request, 500, { success: false, message: "Unable to sign in." }); }
});
