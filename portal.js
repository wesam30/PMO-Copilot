import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const URL='https://ipapyfeuwcecjfkhkqfz.supabase.co';
const KEY='sb_publishable_90sFNIyh6JvfADbDyPGWHg_pkJ4Bkd-';
const PUBLIC_PORTAL_URL='https://wesam30.github.io/PMO-Copilot/admin-portal.html';
const sb=createClient(URL,KEY,{auth:{detectSessionInUrl:true,persistSession:true}});
const $=id=>document.getElementById(id);
const $$=selector=>[...document.querySelectorAll(selector)];
const authViews=['landing','login','create-password','pending'];
const state={me:null,employees:[],projects:[],assignments:[],updates:[],workStatuses:[],audit:[],communications:[],activeView:'overview'};
const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const label=value=>String(value??'').replaceAll('_',' ').replace(/\b\w/g,char=>char.toUpperCase());
const initials=name=>String(name||'PM').split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
const localDateString=date=>{const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,'0'),day=String(date.getDate()).padStart(2,'0');return `${year}-${month}-${day}`};
const weekStart=()=>{const date=new Date();date.setHours(12,0,0,0);date.setDate(date.getDate()-date.getDay());return localDateString(date)};
const monday=weekStart;
const statusPill=(value,text)=>`<span class="pill ${esc(value)}">${esc(text||label(value))}</span>`;
const show=(id,on=true)=>$(id)?.classList.toggle('hidden',!on);
const currentAssignment=projectId=>state.assignments.find(item=>item.project_id===projectId&&item.active);
const employeeProjects=employeeId=>state.assignments.filter(item=>item.employee_id===employeeId&&item.active).map(item=>state.projects.find(project=>project.project_id===item.project_id)).filter(Boolean);
const latestUpdate=projectId=>state.updates.filter(item=>item.project_id===projectId&&item.is_current).sort((a,b)=>String(b.week_start).localeCompare(String(a.week_start)))[0];
const workStatusFor=employeeId=>state.workStatuses.find(item=>item.employee_id===employeeId)||{work_status:'not_provided',source:'manual'};
const pendingApprovals=()=>state.employees.filter(item=>item.account_status==='pending'&&item.auth_user_id);
const unregisteredEmployees=()=>state.employees.filter(item=>!item.auth_user_id);

function message(text,type='error',id='global-message'){
  const el=$(id); if(!el)return; el.textContent=text; el.className=`notice ${type}`; el.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function clearMessage(id='global-message'){const el=$(id);if(el)el.classList.add('hidden')}
function clearCallbackUrl(){history.replaceState({},document.title,location.pathname)}
function openAuthView(id){authViews.forEach(view=>show(view,view===id));show('portal',false);show('auth-shell',true);if(id==='login')$('employee-id')?.focus()}
function passwordIsStrong(value){return value.length>=8&&/\d/.test(value)&&/[^\w\s]/.test(value)}
function recoveryErrorMessage(error){
  const details=`${error?.code||''} ${error?.message||''}`.toLowerCase();
  if(error?.status===429||details.includes('rate limit'))return 'Too many reset requests. Please wait one hour, then try once. You can also use the latest reset email already sent.';
  return 'Unable to send the reset email right now. Please wait a few minutes and try again.';
}
function callbackParams(){return {hash:new URLSearchParams(location.hash.replace(/^#/,'')),query:new URLSearchParams(location.search)}}
function isPasswordCallback(){const {hash,query}=callbackParams();const type=hash.get('type')||query.get('type');return type==='recovery'||type==='invite'||Boolean(hash.get('access_token'))||Boolean(query.get('code'))||Boolean(hash.get('error'))}
async function establishPasswordSession(){
  const {hash,query}=callbackParams(),code=query.get('code'),accessToken=hash.get('access_token'),refreshToken=hash.get('refresh_token');
  if(code){const {data,error}=await sb.auth.exchangeCodeForSession(code);if(!error&&data.session)return data.session}
  if(accessToken&&refreshToken){const {data,error}=await sb.auth.setSession({access_token:accessToken,refresh_token:refreshToken});if(!error&&data.session)return data.session}
  const {data:{session}}=await sb.auth.getSession();return session;
}

$('show-login').onclick=()=>openAuthView('login');
$('back-login').onclick=()=>openAuthView('landing');
$('back-pending').onclick=async()=>{await sb.auth.signOut();clearCallbackUrl();openAuthView('landing')};
$('back-create-password').onclick=async()=>{await sb.auth.signOut();clearCallbackUrl();openAuthView('login')};
$('logout').onclick=async()=>{await sb.auth.signOut();clearCallbackUrl();openAuthView('landing')};
$$('.toggle-password').forEach(button=>button.onclick=()=>{const input=$(button.dataset.toggle);const visible=input.type==='text';input.type=visible?'password':'text';button.textContent=visible?'Show':'Hide'});
$('new-password').oninput=()=>{const value=$('new-password').value;$('password-strength').innerHTML=!value?'Use at least 8 characters, including a number and a symbol.':passwordIsStrong(value)?'<strong>Strong password</strong> — requirements met.':'Use at least 8 characters, including a number and a symbol.'};
$('sign-in').onclick=async()=>{
  message('Signing in…','info','login-message');
  try{
    const response=await fetch(`${URL}/functions/v1/employee-login`,{method:'POST',headers:{'Content-Type':'application/json','apikey':KEY},body:JSON.stringify({employeeId:$('employee-id').value,password:$('password').value})});
    const data=await response.json();
    if(!data.success){message(data.message||'Unable to sign in.','error','login-message');if(data.status==='pending')openAuthView('pending');return}
    await sb.auth.setSession(data.session); await load();
  }catch{message('Unable to sign in. Please try again.','error','login-message')}
};
$('forgot').onclick=()=>show('recovery-panel');
$('send-recovery').onclick=async()=>{const email=$('recovery-email').value.trim();if(!email){message('Enter your work email address.','error','login-message');return}const button=$('send-recovery');button.disabled=true;button.textContent='Sending reset link…';const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:PUBLIC_PORTAL_URL});message(error?recoveryErrorMessage(error):'If the account exists, a new reset link was sent. Use the latest email.',error?'error':'ok','login-message');button.disabled=false;button.textContent='Send password reset link'};
$('create-password-submit').onclick=async()=>{const password=$('new-password').value,confirm=$('confirm-password').value;if(!passwordIsStrong(password)){message('Use at least 8 characters, including a number and a symbol.','error','password-message');return}if(password!==confirm){message('Passwords do not match.','error','password-message');return}const button=$('create-password-submit');button.disabled=true;button.textContent='Saving password…';const {error}=await sb.auth.updateUser({password});if(error){message(error.message,'error','password-message');button.disabled=false;button.textContent='Create password & continue';return}message('Password created successfully.','ok','password-message');clearCallbackUrl();button.textContent='Continuing…';await load()};

async function populateCreatePassword(){const {data:{user}}=await sb.auth.getUser();const name=user?.user_metadata?.employee_name||user?.user_metadata?.full_name;const employeeId=user?.user_metadata?.employee_id;if(name)$('password-welcome').textContent=`Welcome, ${name}. Create a secure password to continue.`;if(employeeId){$('password-employee-id').textContent=`Employee ID: ${employeeId}`;$('password-employee-id').hidden=false}}
async function handlePasswordCallback(){
  if(!isPasswordCallback())return false;
  const {hash,query}=callbackParams(),callbackError=hash.get('error_description')||query.get('error_description');
  if(callbackError){openAuthView('login');message(callbackError.replaceAll('+',' ')+' Request a new reset link.','error','login-message');return true}
  const session=await establishPasswordSession();
  if(!session){openAuthView('login');message('Your password link is invalid or has expired. Request a new reset link and use the latest email.','error','login-message');return true}
  const type=hash.get('type')||query.get('type');
  if(type==='recovery'){$('password-title').textContent='Set a new password';$('password-welcome').textContent='Choose a new secure password for your PMO Copilot account.';$('create-password-submit').textContent='Save new password & continue'}
  await populateCreatePassword();openAuthView('create-password');return true;
}

async function load(){
  const {data:{user}}=await sb.auth.getUser(); if(!user){openAuthView('landing');return}
  const {data:profile,error}=await sb.from('employees').select('*').eq('auth_user_id',user.id).maybeSingle();
  if(error||!profile){console.error('Employee profile load failed',error);openAuthView('pending');return}
  state.me=profile;
  if(profile.account_status!=='active'){openAuthView('pending');return}
  show('auth-shell',false);show('portal',true);
  $('header-name').textContent=profile.employee_name;$('header-role').textContent=label(profile.access_role||'employee');$('admin-avatar').textContent=initials(profile.employee_name);
  configureNavigation(); await refreshData(); openView('overview');
}

function configureNavigation(){
  const role=state.me.access_role;
  const allowed={admin:['overview','approvals','accounts','employees','projects','reports'],manager:['overview','employees','projects','reports'],engineer:['overview','weekly','projects']}[role]||['overview'];
  $$('.nav-item').forEach(button=>{
    const view=button.dataset.view;
    button.classList.toggle('hidden',!allowed.includes(view));
    button.onclick=()=>openView(view);
  });
  $$('[data-open-view]').forEach(button=>button.onclick=()=>openView(button.dataset.openView));
}
function openView(view){
  state.activeView=view; $$('.portal-view').forEach(panel=>panel.classList.toggle('hidden',panel.dataset.viewPanel!==view));$$('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.view===view));clearMessage();
  if(view==='reports')renderReports();
}

async function refreshData(){
  const leadership=['admin','manager'].includes(state.me.access_role);
  const queries=[
    sb.from('employees').select('employee_id,employee_name,email,mobile,job_title,project_count,created_at,auth_user_id,account_status,access_role,specialty,review_stage,is_demo').order('created_at'),
    sb.from('projects').select('project_id,project_name,employee_id,created_at').order('project_id'),
    sb.from('project_assignments').select('assignment_id,project_id,employee_id,assigned_at,ended_at,active').order('assigned_at'),
    sb.from('project_updates').select('*').eq('is_current',true).order('week_start',{ascending:false}),
    sb.from('employee_work_status').select('*')
  ];
  if(state.me.access_role==='admin'){queries.push(sb.from('admin_audit_log').select('*').order('created_at',{ascending:false}).limit(20));queries.push(sb.from('communication_log').select('*').order('created_at',{ascending:false}).limit(20))}
  const results=await Promise.all(queries); const failed=results.find(result=>result.error); if(failed)message(`Some portal data could not be loaded: ${failed.error.message}`,'error');
  [state.employees,state.projects,state.assignments,state.updates,state.workStatuses,state.audit,state.communications]=results.map(result=>result.data||[]);
  if(!leadership)state.employees=[state.me];
  renderAll();
}

function employeeCompliance(employee){
  if(employee.account_status!=='active')return 'not_required';
  const work=workStatusFor(employee.employee_id);if(work.work_status==='on_leave')return 'on_leave';
  const projects=employeeProjects(employee.employee_id);if(!projects.length)return 'not_required';
  const updates=projects.map(project=>latestUpdate(project.project_id)).filter(Boolean).sort((a,b)=>String(b.week_start).localeCompare(String(a.week_start)));const last=updates[0];if(!last||last.week_start<weekStart())return 'overdue';return last.submission_state==='late'?'late':'regular';
}
function counts(){
  const account={pending:0,active:0,suspended:0,rejected:0,not_registered:0};state.employees.forEach(item=>{if(!item.auth_user_id){account.not_registered++;return}account[item.account_status]=(account[item.account_status]||0)+1});
  const workforce={regular:0,overdue:0,on_leave:0,not_required:0,not_provided:0};state.employees.filter(item=>item.account_status==='active').forEach(item=>{const value=employeeCompliance(item);workforce[value]=(workforce[value]||0)+1;if(workStatusFor(item.employee_id).work_status==='not_provided')workforce.not_provided++});
  const projects={on_track:0,at_risk:0,delayed:0,completed:0,not_started:0,no_update:0};state.projects.forEach(project=>{const update=latestUpdate(project.project_id);projects[update?.project_status||'no_update']++});
  return {account,workforce,projects};
}
function summaryCards(){const c=counts();return `<div class="summary-grid"><article class="card summary-card"><h3>Account Status</h3><div class="metric-row four"><div class="metric purple"><strong>${c.account.not_registered}</strong><small>Not registered</small></div><div class="metric blue"><strong>${c.account.pending}</strong><small>Pending</small></div><div class="metric green"><strong>${c.account.active}</strong><small>Active</small></div><div class="metric red"><strong>${c.account.suspended}</strong><small>Suspended</small></div></div></article><article class="card summary-card"><h3>Employee Status</h3><div class="metric-row four"><div class="metric green"><strong>${c.workforce.regular}</strong><small>On time</small></div><div class="metric amber"><strong>${c.workforce.late||0}</strong><small>Late</small></div><div class="metric red"><strong>${c.workforce.overdue}</strong><small>Overdue</small></div><div class="metric purple"><strong>${c.workforce.on_leave}</strong><small>On leave</small></div></div></article><article class="card summary-card"><h3>Project Status</h3><div class="metric-row"><div class="metric green"><strong>${c.projects.on_track}</strong><small>On track</small></div><div class="metric amber"><strong>${c.projects.at_risk}</strong><small>At risk</small></div><div class="metric red"><strong>${c.projects.delayed}</strong><small>Delayed</small></div></div><small class="muted">${c.projects.no_update} project(s) without a weekly update</small></article></div>`}

function renderAll(){
  $('approval-badge').textContent=pendingApprovals().length;
  renderOverview();renderApprovals();renderAccounts();renderEmployees();renderProjects();renderWeekly();if(state.activeView==='reports')renderReports();
}
function renderOverview(){
  if(state.me.access_role==='engineer'){renderEngineerOverview();return}
  const pending=pendingApprovals().slice(0,4);const risks=state.projects.map(project=>({project,update:latestUpdate(project.project_id)})).filter(item=>['at_risk','delayed'].includes(item.update?.project_status)).slice(0,5);
  $('overview-content').innerHTML=summaryCards()+`<div class="section-grid"><article class="card"><h2>Needs attention</h2><div class="list">${risks.length?risks.map(({project,update})=>`<div class="list-item"><span><strong>${esc(project.project_name)}</strong><small>${esc(update.risk||update.challenge||'Review the latest update')}</small></span>${statusPill(update.project_status)}</div>`).join(''):'<div class="empty"><strong>No reported project risks</strong>Projects without updates are listed in the Projects tab.</div>'}</div></article><article class="card"><h2>Pending approvals</h2><div class="list">${pending.length?pending.map(employee=>`<div class="list-item"><span><strong>${esc(employee.employee_name)}</strong><small>${esc(employee.employee_id)}</small></span><button class="secondary quick-review" data-id="${esc(employee.employee_id)}">Review</button></div>`).join(''):'<div class="empty"><strong>All caught up</strong>No pending accounts.</div>'}</div></article></div>`;
  $$('.quick-review').forEach(button=>button.onclick=()=>openReview(button.dataset.id));
}
function renderEngineerOverview(){
  const projects=employeeProjects(state.me.employee_id),compliance=employeeCompliance(state.me);const projectRows=projects.map(project=>({project,update:latestUpdate(project.project_id)}));
  const submittedThisWeek=projectRows.filter(item=>item.update?.week_start===monday()).length;
  const submissionTone=projects.length>0&&submittedThisWeek===projects.length?'green':'amber';
  $('overview-content').innerHTML=`<div class="summary-grid"><article class="card summary-card"><h3>My Account</h3><div class="metric-row"><div class="metric green"><strong>${state.me.account_status==='active'?'Active':'—'}</strong><small>Access</small></div><div class="metric blue"><strong>${esc(label(state.me.access_role))}</strong><small>Role</small></div><div class="metric purple"><strong>${projects.length}</strong><small>Projects</small></div></div></article><article class="card summary-card"><h3>My Update Status</h3><div class="metric-row"><div class="metric ${compliance==='regular'?'green':'amber'}"><strong>${esc(label(compliance))}</strong><small>Weekly compliance</small></div><div class="metric ${submissionTone}"><strong>${submittedThisWeek}/${projects.length}</strong><small>Updates submitted</small></div><div class="metric blue"><strong>${monday()}</strong><small>Current week</small></div></div></article><article class="card summary-card"><h3>My Project Health</h3><div class="metric-row"><div class="metric green"><strong>${projectRows.filter(item=>item.update?.project_status==='on_track').length}</strong><small>On track</small></div><div class="metric amber"><strong>${projectRows.filter(item=>item.update?.project_status==='at_risk').length}</strong><small>At risk</small></div><div class="metric red"><strong>${projectRows.filter(item=>item.update?.project_status==='delayed').length}</strong><small>Delayed</small></div></div></article></div><div class="section-grid"><article class="card"><h2>My projects</h2><div class="list">${projectRows.map(({project,update})=>`<div class="list-item"><span><strong>${esc(project.project_name)}</strong><small>${update?`Last update ${esc(update.week_start)} · ${esc(update.actual_percent)}%`:'No weekly update submitted yet'}</small></span>${statusPill(update?.project_status||'not_started',update?null:'No update')}</div>`).join('')||'<div class="empty"><strong>No assigned projects</strong>Contact your PMO coordinator.</div>'}</div></article><article class="card"><h2>Weekly responsibility</h2><p class="muted">Submit one clear update for each assigned project. Your PMO coordinator receives the report automatically.</p><button id="go-weekly">Open Weekly Update</button></article></div>`;
  $('go-weekly').onclick=()=>openView('weekly');
}
function renderApprovals(){
  const pending=pendingApprovals();
  $('approval-content').innerHTML=pending.length?pending.map(employee=>{const projects=employeeProjects(employee.employee_id);return `<article class="card approval-card"><div class="employee-head"><span class="avatar">${esc(initials(employee.employee_name))}</span><div><h3>${esc(employee.employee_name)}</h3><div class="employee-meta"><span>${esc(employee.employee_id)}</span><span>${esc(employee.job_title)}</span><span>${esc(employee.email)}</span></div></div>${statusPill('pending','Pending approval')}</div><div class="project-chips">${projects.length?projects.map(project=>`<span class="project-chip">${esc(project.project_name)} · ${esc(project.project_id)}</span>`).join(''):'<span class="muted">No registered projects</span>'}</div><div class="card-actions"><button class="review-employee" data-id="${esc(employee.employee_id)}">Review &amp; edit</button><button class="secondary request-change" data-id="${esc(employee.employee_id)}">Request changes</button><button class="danger-link reject-employee" data-id="${esc(employee.employee_id)}">Reject</button></div></article>`}).join(''):'<div class="card empty"><strong>No pending approvals</strong>New registrations will appear here automatically.</div>';
  $$('.review-employee').forEach(button=>button.onclick=()=>openReview(button.dataset.id));$$('.request-change').forEach(button=>button.onclick=()=>openReview(button.dataset.id,'pending'));$$('.reject-employee').forEach(button=>button.onclick=()=>openReview(button.dataset.id,'rejected'));
}
function renderAccounts(){
  const cards=[['Not registered',unregisteredEmployees().length,'Imported employee data awaiting account setup'],['Pending approval',pendingApprovals().length,'Registered accounts awaiting PMO review'],['Active',state.employees.filter(item=>item.auth_user_id&&item.account_status==='active').length,'Can sign in and use allowed data'],['Suspended',state.employees.filter(item=>item.auth_user_id&&item.account_status==='suspended').length,'Access is blocked; data is retained']];
  $('accounts-content').innerHTML=`<div class="status-sections four">${cards.map(([title,count,description])=>`<article class="card status-section"><h3>${esc(title)}</h3><div class="count">${count}</div><small class="muted">${esc(description)}</small></article>`).join('')}</div><div class="card" style="margin-top:18px"><div class="table-wrap"><table><thead><tr><th>Employee</th><th>Account</th><th>Role</th><th>Auth account</th><th>Action</th></tr></thead><tbody>${state.employees.map(employee=>`<tr><td><strong>${esc(employee.employee_name)}</strong><br><small>${esc(employee.employee_id)}</small></td><td>${employee.auth_user_id?statusPill(employee.account_status):statusPill('not_registered','Not registered')}</td><td>${esc(label(employee.access_role||'not assigned'))}</td><td>${employee.auth_user_id?'Created':'Not created'}</td><td><button class="secondary manage-account" data-id="${esc(employee.employee_id)}">${employee.auth_user_id?'Manage':'Create access'}</button></td></tr>`).join('')}</tbody></table></div></div>`;
  $$('.manage-account').forEach(button=>button.onclick=()=>openReview(button.dataset.id));
}
function renderEmployees(){
  $('employees-content').innerHTML=`<div class="card"><div class="table-wrap"><table><thead><tr><th>Employee</th><th>Job title</th><th>Update compliance</th><th>Availability</th><th>Return date</th><th></th></tr></thead><tbody>${state.employees.map(employee=>{const work=workStatusFor(employee.employee_id);const compliance=employeeCompliance(employee);return `<tr><td><strong>${esc(employee.employee_name)}</strong><br><small>${esc(employee.employee_id)}</small></td><td>${esc(employee.job_title)}</td><td>${statusPill(compliance)}</td><td>${statusPill(work.work_status)}</td><td>${esc(work.expected_return_date||'—')}</td><td>${state.me.access_role==='admin'?`<button class="secondary edit-work" data-id="${esc(employee.employee_id)}">Edit</button>`:''}</td></tr>`}).join('')}</tbody></table></div></div>`;
  $$('.edit-work').forEach(button=>button.onclick=()=>openWorkStatus(button.dataset.id));
}
function renderProjects(){
  $('projects-content').innerHTML=`<div class="card"><div class="table-wrap"><table><thead><tr><th>Project</th><th>Responsible employee</th><th>Latest week</th><th>Progress</th><th>Project status</th><th>Next action</th></tr></thead><tbody>${state.projects.map(project=>{const assignment=currentAssignment(project.project_id);const employee=state.employees.find(item=>item.employee_id===assignment?.employee_id);const update=latestUpdate(project.project_id);return `<tr><td><strong>${esc(project.project_name)}</strong><br><small>${esc(project.project_id)}</small></td><td>${esc(employee?.employee_name||assignment?.employee_id||'Unassigned')}</td><td>${esc(update?.week_start||'No update')}</td><td>${update?`${esc(update.actual_percent)}% <small>(${esc(update.variance)}%)</small>`:'—'}</td><td>${statusPill(update?.project_status||'not_started',update?null:'No update')}</td><td>${esc(update?.next_action||'—')}</td></tr>`}).join('')}</tbody></table></div></div>`;
}

function openReview(employeeId,presetStatus){
  const employee=state.employees.find(item=>item.employee_id===employeeId);if(!employee)return;const imported=!employee.auth_user_id;const assigned=new Set(employeeProjects(employeeId).map(project=>project.project_id));const status=imported?'active':presetStatus||employee.account_status;const role=employee.access_role||'engineer';
  $('review-dialog-content').innerHTML=`<h2>${imported?'Create account access':status==='active'?'Review & activate':'Manage account'} — ${esc(employee.employee_name)}</h2><p>${esc(employee.employee_id)} · ${esc(employee.job_title)} · ${esc(employee.email)}</p><div class="form-grid"><label>Account status<select id="review-status" ${imported?'disabled':''}><option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="rejected">Rejected</option></select></label><label>Access role<select id="review-role"><option value="engineer">Engineer</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label><div class="full"><label>Responsible projects</label><div class="checkbox-list">${state.projects.map(project=>`<label class="check-row"><input type="checkbox" name="review-project" value="${esc(project.project_id)}" ${assigned.has(project.project_id)?'checked':''}><span>${esc(project.project_name)}</span><small>${esc(project.project_id)}</small></label>`).join('')}</div><small class="muted">Projects can be assigned here only when the access role is Engineer.</small></div><label class="full">Change note<textarea id="review-note" rows="3" placeholder="Optional note for the audit log or employee email"></textarea></label></div>${imported?'<div class="warning-note">This will preserve the Employee ID and project history, create secure sign-in access, activate the selected role, and email a password setup link.</div>':''}<div class="dialog-actions"><button class="secondary" value="cancel">Cancel</button><button type="button" id="save-review">${imported?'Create account &amp; send invitation':'Save &amp; notify'}</button></div>`;
  $('review-status').value=status;$('review-role').value=role;
  const syncProjects=()=>{const engineer=$('review-role').value==='engineer';$$('[name="review-project"]').forEach(input=>input.disabled=!engineer)};$('review-role').onchange=syncProjects;syncProjects();
  $('save-review').onclick=async()=>{const selectedRole=$('review-role').value;const projectIds=selectedRole==='engineer'?$$('[name="review-project"]:checked').map(input=>input.value):[];await reviewEmployee({employeeId,status:$('review-status').value,role:selectedRole,projectIds,note:$('review-note').value},imported)};
  $('review-dialog').showModal();
}
async function reviewEmployee(payload,createAccess=false){
  const button=$('save-review');button.disabled=true;button.textContent=createAccess?'Creating account…':'Saving…';
  const {data:{session}}=await sb.auth.getSession();
  try{
    const action=createAccess?'invite_imported_employee':'review_employee';const response=await fetch(`${URL}/functions/v1/admin-actions`,{method:'POST',headers:{'Content-Type':'application/json','apikey':KEY,'Authorization':`Bearer ${session.access_token}`},body:JSON.stringify({action,...payload})});const data=await response.json();if(!response.ok||!data.success)throw new Error(data.message||'Unable to update employee.');$('review-dialog').close();const successText=createAccess?'Account created, access activated, and password invitation sent.':'Account updated and notification email sent.';const fallbackText=createAccess?'Account created and activated, but the invitation email was not delivered. Use Forgot password to resend the setup link.':'Account updated. Email delivery was not completed; it is recorded in the log.';message(data.emailSent?successText:fallbackText,data.emailSent?'ok':'info');await refreshData();
  }catch(error){message(error.message,'error');button.disabled=false;button.textContent=createAccess?'Create account & send invitation':'Save & notify'}
}

function openWorkStatus(employeeId){const employee=state.employees.find(item=>item.employee_id===employeeId);const work=workStatusFor(employeeId);$('work-status-dialog-content').innerHTML=`<h2>Employee status — ${esc(employee.employee_name)}</h2><p>This is operational availability, not account access.</p><div class="form-grid"><label>Status<select id="work-status"><option value="not_provided">Not provided</option><option value="available">Available</option><option value="on_leave">On leave</option><option value="unavailable">Unavailable</option></select></label><label>Leave type<input id="leave-type" value="${esc(work.leave_type||'')}"></label><label>Leave start<input id="leave-start" type="date" value="${esc(work.leave_start_date||'')}"></label><label>Expected return<input id="return-date" type="date" value="${esc(work.expected_return_date||'')}"></label><label class="full">Reason<textarea id="leave-reason" rows="3">${esc(work.leave_reason||'')}</textarea></label></div><div class="dialog-actions"><button class="secondary" value="cancel">Cancel</button><button type="button" id="save-work-status">Save employee status</button></div>`;$('work-status').value=work.work_status;$('save-work-status').onclick=async()=>{const {error}=await sb.rpc('admin_update_work_status',{p_employee_id:employeeId,p_work_status:$('work-status').value,p_leave_type:$('leave-type').value||null,p_leave_reason:$('leave-reason').value||null,p_leave_start_date:$('leave-start').value||null,p_expected_return_date:$('return-date').value||null,p_source:'manual'});if(error){message(error.message);return}$('work-status-dialog').close();message('Employee availability updated.','ok');await refreshData()};$('work-status-dialog').showModal()}

function reportRows(){return state.projects.map(project=>{const assignment=currentAssignment(project.project_id);const employee=state.employees.find(item=>item.employee_id===assignment?.employee_id);const update=latestUpdate(project.project_id);return {project_id:project.project_id,project_name:project.project_name,employee:employee?.employee_name||'Unassigned',week:update?.week_start||'',planned:update?.planned_percent??'',actual:update?.actual_percent??'',variance:update?.variance??'',status:update?.project_status||'no_update',risk:update?.risk||update?.challenge||'',next_action:update?.next_action||''}})}
function renderReports(){const rows=reportRows();$('reports-content').innerHTML=`<div class="card"><div class="form-grid"><label>Manager name<input id="report-manager-name" placeholder="Manager name"></label><label>Manager email<input id="report-manager-email" type="email" placeholder="manager@company.com"></label></div><div class="report-toolbar"><button id="send-report">Send to manager</button><button class="secondary" id="download-report">Download CSV</button><button class="secondary" id="print-report">Print / Save PDF</button></div><div class="report-note">The report is generated on demand to stay within the Supabase Free Plan. Sending is recorded in the communication log.</div><div class="report-preview"><h2>Portfolio report</h2><p class="muted">Generated ${esc(new Date().toLocaleString())} · ${rows.length} projects</p><div class="table-wrap"><table><thead><tr><th>Project</th><th>Engineer</th><th>Latest week</th><th>Actual</th><th>Status</th><th>Risk / next action</th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${esc(row.project_name)}</strong><br><small>${esc(row.project_id)}</small></td><td>${esc(row.employee)}</td><td>${esc(row.week||'No update')}</td><td>${row.actual===''?'—':`${esc(row.actual)}%`}</td><td>${statusPill(row.status,row.status==='no_update'?'No update':null)}</td><td>${esc(row.risk||'—')}<br><small>${esc(row.next_action||'—')}</small></td></tr>`).join('')}</tbody></table></div></div></div>`;
  $('print-report').onclick=()=>window.print();$('download-report').onclick=downloadReport;$('send-report').onclick=sendReport;
}
function downloadReport(){const rows=reportRows();const columns=['project_id','project_name','employee','week','planned','actual','variance','status','risk','next_action'];const csv=[columns.join(','),...rows.map(row=>columns.map(column=>`"${String(row[column]??'').replaceAll('"','""')}"`).join(','))].join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`PMO-portfolio-${new Date().toISOString().slice(0,10)}.csv`;link.click();URL.revokeObjectURL(link.href)}
async function sendReport(){const recipientName=$('report-manager-name').value.trim(),recipientEmail=$('report-manager-email').value.trim();if(!recipientEmail){message('Enter the manager email address.');return}const button=$('send-report');button.disabled=true;button.textContent='Sending…';const {data:{session}}=await sb.auth.getSession();try{const response=await fetch(`${URL}/functions/v1/admin-actions`,{method:'POST',headers:{'Content-Type':'application/json','apikey':KEY,'Authorization':`Bearer ${session.access_token}`},body:JSON.stringify({action:'send_portfolio_report',recipientName,recipientEmail})});const data=await response.json();if(!response.ok||!data.success)throw new Error(data.message||'Unable to send report.');message('Portfolio report sent and recorded.','ok');await refreshData()}catch(error){message(error.message);button.disabled=false;button.textContent='Send to manager'}}

function renderWeekly(){
  if(state.me.access_role!=='engineer'){$('weekly-content').innerHTML='<div class="card empty"><strong>Engineer workspace</strong>Weekly submission is available to engineer accounts.</div>';return}
  const projects=employeeProjects(state.me.employee_id);$('weekly-content').innerHTML=`<div class="card"><div class="report-note"><strong>Automatic delivery:</strong> every submitted update is sent to the PMO coordinator. Add your direct manager email only when they should receive it too; the PMO coordinator will remain copied.</div><div class="form-grid" style="margin-top:16px"><label>Assigned project<select id="update-project">${projects.map(project=>`<option value="${esc(project.project_id)}">${esc(project.project_name)}</option>`).join('')}</select></label><label>Week starting<input id="update-week" value="${monday()}" readonly></label><label>Planned progress %<input id="update-planned" type="number" min="0" max="100"></label><label>Actual progress %<input id="update-actual" type="number" min="0" max="100"></label><label>Project status<select id="update-status"><option value="not_started">Not started</option><option value="on_track">On track</option><option value="at_risk">At risk</option><option value="delayed">Delayed</option><option value="completed">Completed</option></select></label><label>Priority<select id="update-priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label><label class="full">Challenge<textarea id="update-challenge"></textarea></label><label class="full">Risk<textarea id="update-risk"></textarea></label><label class="full">Next action<textarea id="update-next" required></textarea></label><label>Target date<input id="update-target" type="date"></label><label>Direct manager email (optional)<input id="update-manager-email" type="email" placeholder="manager@company.com"></label><label class="full">Manager intervention details<textarea id="update-intervention"></textarea></label><label class="full">Completion exception (only if completed below 100%)<textarea id="update-exception"></textarea></label></div><button id="submit-update" ${projects.length?'':'disabled'}>Submit update &amp; send report</button></div>`;
  const note=$('weekly-content').querySelector('.report-note');
  if(note)note.innerHTML='<strong>Submission window:</strong> the reporting week starts on Sunday. Submit by 2:00 PM Cairo time to be marked on time; later submissions remain open and are marked late. The report is sent immediately to the PMO coordinator.';
  $('submit-update').onclick=submitUpdate;
}
async function submitUpdate(){
  const button=$('submit-update'),intervention=$('update-intervention').value.trim(),managerEmail=$('update-manager-email').value.trim();
  if(managerEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(managerEmail)){message('Enter a valid direct manager email or leave it blank.');return}
  button.disabled=true;button.textContent='Saving update…';
  const {data:update,error}=await sb.rpc('submit_project_update',{p_project_id:$('update-project').value,p_week_start:$('update-week').value,p_planned_percent:Number($('update-planned').value),p_actual_percent:Number($('update-actual').value),p_project_status:$('update-status').value,p_challenge:$('update-challenge').value,p_risk:$('update-risk').value,p_priority:$('update-priority').value,p_next_action:$('update-next').value,p_target_date:$('update-target').value||null,p_manager_intervention_required:Boolean(intervention),p_manager_intervention_details:intervention||null,p_completed_exception:$('update-exception').value||null});
  if(error){message(error.message);button.disabled=false;button.textContent='Submit update & send report';return}
  const updateId=update?.update_id||update?.[0]?.update_id;
  await sendWeeklyReport(updateId,managerEmail,button);
}
async function sendWeeklyReport(updateId,managerEmail,button){
  button.disabled=true;button.textContent='Sending report…';
  const {data:{session}}=await sb.auth.getSession();
  try{const response=await fetch(`${URL}/functions/v1/admin-actions`,{method:'POST',headers:{'Content-Type':'application/json','apikey':KEY,'Authorization':`Bearer ${session.access_token}`},body:JSON.stringify({action:'send_weekly_update_report',updateId,directManagerEmail:managerEmail||null})});const result=await response.json();if(!response.ok||!result.success)throw new Error(result.message||'Report delivery failed.');message(managerEmail?'Weekly update submitted. Report sent to your manager with the PMO coordinator copied.':'Weekly update submitted and sent to the PMO coordinator.','ok');await refreshData();openView('overview')}
  catch(reportError){message(`The weekly update was saved, but the email report could not be sent: ${reportError.message}`,'error');button.disabled=false;button.textContent='Retry report delivery';button.onclick=()=>sendWeeklyReport(updateId,managerEmail,button)}
}

sb.auth.onAuthStateChange(async(event,session)=>{if(session&&(event==='PASSWORD_RECOVERY'||(event==='SIGNED_IN'&&isPasswordCallback()))){await populateCreatePassword();openAuthView('create-password')}});
(async()=>{const handled=await handlePasswordCallback();if(!handled)await load()})();
