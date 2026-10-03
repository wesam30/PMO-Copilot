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
    const { data: linkData, error: linkError2 } = await admin.auth.admin.generateLink({ type: "recovery", email: employeeEmail });
    if (linkError2 || !linkData.properties?.action_link) return json(request, 500, { success: false, message: "Account created, but the password link could not be generated." });
    const actionLink = linkData.properties.action_link;
    const safeName = escapeHtml(employeeName), safeId = escapeHtml(employeeId);
    await smtpMail(employeeEmail, "PMO Copilot – Set your password", `<div style="font-family:Arial,sans-serif;max-width:600px;color:#172B44"><div style="background:#0B2545;color:#fff;padding:22px"><h2 style="margin:0">PMO Copilot</h2></div><div style="padding:24px;border:1px solid #DCE3EB"><p>Hello ${safeName},</p><p>Your registration is pending administrator approval.</p><p><strong>Employee ID:</strong> ${safeId}</p><p><a href="${actionLink}" style="display:inline-block;padding:12px 18px;background:#0B2545;color:#fff;text-decoration:none;border-radius:6px">Set your password</a></p><p>This secure link lets you set your password. You will receive access after an administrator activates your account.</p></div></div>`, `Hello ${employeeName},\n\nYour registration is pending administrator approval.\nEmployee ID: ${employeeId}\n\nSet your password: ${actionLink}`);
    return json(request, 201, { success: true, message: "Registration completed successfully. Check your email to set your password; access is pending approval.", employeeId });
  } catch (error) { console.error(error); return json(request, 500, { success: false, message: "Unable to register employee." }); }
});
