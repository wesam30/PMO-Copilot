import "jsr:@supabase/functions-js@2.5.0/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.95.0";

const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const cors = (request: Request) => ({ "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || request.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" });
const json = (request: Request, status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...cors(request) } });
const clean = (value: unknown, length: number) => typeof value === "string" ? value.trim().slice(0, length) : "";
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const date = /^\d{4}-\d{2}-\d{2}$/;
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] || char);
const normalizeEgyptianMobile = (value: unknown) => {
  const digits: Record<string, string> = { "٠":"0", "١":"1", "٢":"2", "٣":"3", "٤":"4", "٥":"5", "٦":"6", "٧":"7", "٨":"8", "٩":"9" };
  const normalized = clean(value, 40).replace(/[٠-٩]/g, digit => digits[digit]).replace(/[\s()\-]/g, "");
  if (/^01[0125]\d{8}$/.test(normalized)) return normalized;
  const international = normalized.match(/^\+?20(1[0125]\d{8})$/);
  return international ? `0${international[1]}` : "";
};

async function smtpMail(to: string, subject: string, html: string, text: string) {
  const username = Deno.env.get("GMAIL_SMTP_USER")?.trim();
  const password = Deno.env.get("GMAIL_SMTP_APP_PASSWORD")?.replace(/\s/g, "");
  if (!username || !password) throw new Error("Gmail SMTP is not configured.");
  const socket = await Deno.connectTls({ hostname: "smtp.gmail.com", port: 465 });
  const encoder = new TextEncoder(); const decoder = new TextDecoder(); let buffer = "";
  const encode = (value: string) => btoa(String.fromCharCode(...new TextEncoder().encode(value)));
  const read = async () => { while (!buffer.includes("\n")) { const data = new Uint8Array(4096); const size = await socket.read(data); if (size === null) throw new Error("SMTP connection closed."); buffer += decoder.decode(data.subarray(0, size)); } const index = buffer.indexOf("\n"); const line = buffer.slice(0, index + 1); buffer = buffer.slice(index + 1); return line; };
  const expect = async (allowed: number[]) => { while (true) { const line = await read(); const match = line.match(/^(\d{3})([ -])/); if (match && match[2] === " ") { if (!allowed.includes(Number(match[1]))) throw new Error("SMTP delivery failed."); return; } } };
  const command = async (value: string, allowed: number[]) => { await socket.write(encoder.encode(value + "\r\n")); await expect(allowed); };
  try {
    await expect([220]); await command("EHLO pmo-copilot", [250]); await command("AUTH PLAIN " + encode("\0" + username + "\0" + password), [235]); await command(`MAIL FROM:<${username}>`, [250]); await command(`RCPT TO:<${to}>`, [250, 251]); await command("DATA", [354]);
    const boundary = `pmo-${crypto.randomUUID()}`;
    const message = [`From: PMO Copilot <${username}>`, `To: <${to}>`, `Subject: =?UTF-8?B?${encode(subject)}?=`, "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "", text, `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "", html, `--${boundary}--`, ""].join("\r\n").replace(/^\./gm, "..");
    await socket.write(encoder.encode(message + "\r\n.\r\n")); await expect([250]); await command("QUIT", [221]);
  } finally { socket.close(); }
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(request) });
  if (request.method !== "POST") return json(request, 405, { success: false, message: "Method not allowed." });
  try {
    const input = await request.json();
    const employeeName = clean(input.employeeName, 120), employeeEmail = clean(input.email, 254).toLowerCase(), mobile = normalizeEgyptianMobile(input.mobile), whatsapp = normalizeEgyptianMobile(input.whatsapp), jobTitle = clean(input.jobTitle, 120), employmentStartDate = clean(input.employmentStartDate, 10);
    const projects = Array.isArray(input.projects) ? input.projects.slice(0, 20).map((item: unknown) => ({ projectName: clean(typeof item === "string" ? item : (item as Record<string, unknown>)?.projectName, 200) })).filter((item: { projectName: string }) => item.projectName) : [];
    if (employeeName.length < 2 || jobTitle.length < 2 || !email.test(employeeEmail) || !mobile || !whatsapp || !date.test(employmentStartDate) || !projects.length) return json(request, 400, { success: false, message: "Enter valid Egyptian mobile and WhatsApp numbers: 01XXXXXXXXX or +20 1XXXXXXXXX." });
    const url = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json(request, 500, { success: false, message: "Service configuration error." });
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const randomPassword = crypto.randomUUID() + crypto.randomUUID();
    const { data: authData, error: authError } = await admin.auth.admin.createUser({ email: employeeEmail, password: randomPassword, email_confirm: true, user_metadata: { employee_name: employeeName } });
    if (authError || !authData.user) return json(request, 409, { success: false, message: "Employee already exists." });
    const { data: registration, error: registrationError } = await admin.rpc("register_employee", { p_employee_name: employeeName, p_email: employeeEmail, p_mobile: mobile, p_whatsapp: whatsapp, p_job_title: jobTitle, p_employment_start_date: employmentStartDate, p_projects: projects });
    if (registrationError) { await admin.auth.admin.deleteUser(authData.user.id); const duplicate = registrationError.code === "23505" || registrationError.message.toLowerCase().includes("duplicate"); return json(request, duplicate ? 409 : 500, { success: false, message: duplicate ? "Employee already exists." : "Unable to register employee." }); }
    const employeeId = Array.isArray(registration) ? registration[0]?.employee_id : registration?.employee_id;
    const { error: linkError } = await admin.from("employees").update({ auth_user_id: authData.user.id, account_status: "pending" }).eq("employee_id", employeeId);
    if (linkError) return json(request, 500, { success: false, message: "Unable to link the new account." });
    const publicOrigin = (Deno.env.get("ALLOWED_ORIGIN") || "").replace(/\/+$/, "");
    if (!publicOrigin) return json(request, 500, { success: false, message: "Public portal URL is not configured." });
    const { data: linkData, error: linkError2 } = await admin.auth.admin.generateLink({ type: "recovery", email: employeeEmail, options: { redirectTo: `${publicOrigin}/admin-portal.html` } });
    if (linkError2 || !linkData.properties?.action_link) return json(request, 500, { success: false, message: "Account created, but the password link could not be generated." });
    const actionLink = linkData.properties.action_link;
    const safeName = escapeHtml(employeeName), safeId = escapeHtml(employeeId);
    await smtpMail(employeeEmail, "PMO Copilot – Registration successful", `<div style="margin:0 auto;max-width:640px;color:#172B44;font-family:Arial,sans-serif"><div style="padding:28px 34px;background:linear-gradient(120deg,#0B2545,#1467D9);color:#fff"><h2 style="margin:0;font-size:25px">PMO Copilot</h2></div><div style="padding:34px;border:1px solid #DCE5EF;border-top:0"><p style="display:inline-block;margin:0 0 16px;padding:7px 12px;border-radius:999px;background:#E9F8F0;color:#14804F;font-size:13px;font-weight:700">Registration successful</p><h1 style="margin:0 0 14px;color:#0B2545;font-size:28px">Welcome to PMO Copilot</h1><p>Hello ${safeName},</p><p>Your registration details and project information were received successfully. Keep the Employee ID below—it will be used to sign in after your account is approved.</p><div style="margin:24px 0;padding:22px;border:1px solid #CFDCEB;border-radius:12px;background:#F7FAFF;text-align:center"><span style="display:block;margin-bottom:6px;color:#62758A;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Your Employee ID</span><strong style="color:#1467D9;font-size:25px">${safeId}</strong></div><p><a href="${actionLink}" style="display:block;padding:14px 18px;border-radius:9px;background:#1467D9;color:#fff;text-align:center;text-decoration:none;font-weight:700">Create your password</a></p><div style="margin-top:24px;padding:16px 18px;border-left:4px solid #F0B51A;background:#FFF9E8;color:#5A4A1D"><strong>What happens next?</strong><br>Your account is pending PMO administrator review. You can create your password now, and access will become available after your role and assigned projects are approved.</div></div></div>`, `Hello ${employeeName},\n\nRegistration successful.\nYour Employee ID: ${employeeId}\n\nCreate your password: ${actionLink}\n\nYour account remains pending PMO administrator approval.`);
    return json(request, 201, { success: true, message: "Registration completed successfully. Check your email to set your password; access is pending approval.", employeeId });
  } catch (error) { console.error(error); return json(request, 500, { success: false, message: "Unable to register employee." }); }
});
