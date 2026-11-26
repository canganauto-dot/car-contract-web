// The directory handles staff memberships only. Contract data never enters this view.
const staffRoles = {
  administrator: "مدير الشركة",
  branch_manager: "مدير فرع",
  employee: "موظف",
};
const staffRights = {
  archive: { label: "عرض الأرشيف والنسخ الموقعة", scope: "assigned" },
  drafts: { label: "إنشاء المسودات وتعديلها", scope: "assigned" },
  manageBranch: { label: "إدارة عمليات الفرع", scope: "managed" },
  memberships: { label: "إدارة عضويات الشركة", scope: "company" },
  templates: { label: "تعديل قوالب الشركة", scope: "company" },
};
// UI capability checks. The service must authorize every request independently.
function staffCan(company, action, branchId) {
  const right = staffRights[action];
  if (
    !right ||
    !company ||
    company.active === false ||
    !Object.hasOwn(staffRoles, company.role)
  )
    return false;
  if (branchId && !company.branches.some((b) => b.id === branchId))
    return false;
  if (company.role === "administrator") return true;
  if (
    right.scope === "company" ||
    !branchId ||
    !company.branchIds.includes(branchId)
  )
    return false;
  const role = company.branchRoles?.[branchId] || company.role;
  return right.scope === "assigned" || role === "branch_manager";
}
function staffElement(tag, text) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  return el;
}
function staffSelect(label, options, selected) {
  const select = staffElement("select");
  select.setAttribute("aria-label", label);
  for (const [id, name] of options) select.add(new Option(name, id));
  if (selected != null) select.value = selected;
  return select;
}
function staffButton(text, action) {
  const button = staffElement("button", text);
  button.type = "button";
  button.onclick = action;
  return button;
}
function staffField(text, input) {
  const label = staffElement("label", text);
  label.append(input);
  return label;
}

// Disposable fixture data, never connected to a real staff account or archive.
class StaffPreview {
  constructor() {
    const branches = [...$("setupBranches").options].map((option) => ({
      id: option.value,
      name: option.value,
    }));
    this.company = cfg.companies.map((c) => ({
      id: c.id,
      name: c.name,
      branches,
    }));
    this.rows = new Map(
      this.company.map((c) => [
        c.id,
        Object.entries(staffRoles).map(([role, name], i) => ({
          id: c.id + "-" + role,
          name: name + " تجريبي",
          email: "member" + i + "@example.test",
          role,
          branchIds: role === "administrator" ? [] : [branches[0].id],
          active: true,
          version: 1,
        })),
      ]),
    );
    this.role = "administrator";
  }
  async session() {
    return {
      name: staffRoles[this.role] + " تجريبي",
      companies: this.company
        .map((c) => {
          const member = this.rows
            .get(c.id)
            .find((m) => m.id === c.id + "-" + this.role);
          return member?.active
            ? {
                ...c,
                role: member.role,
                branchIds: member.branchIds,
                branchRoles: member.branchRoles,
                memberId: member.id,
                branches:
                  member.role === "administrator"
                    ? c.branches
                    : c.branches.filter((b) => member.branchIds.includes(b.id)),
              }
            : null;
        })
        .filter(Boolean),
    };
  }
  async members(c) {
    return this.rows.get(c.id).map((m) => ({ ...m }));
  }
  async save(c, member, changes) {
    const rows = this.rows.get(c.id);
    if (!staffCan(c, "memberships") || member?.id === c.memberId)
      throw Error("لا يمكن تغيير هذه العضوية.");
    if (
      rows.some(
        (m) =>
          m.id !== member?.id &&
          m.email.toLowerCase() === changes.email.toLowerCase(),
      )
    )
      throw Error("البريد مسجل ضمن الشركة.");
    if (member) {
      const row = rows.find((m) => m.id === member.id);
      if (!row || row.version !== member.version)
        throw Error("تغيّرت العضوية. حدّث القائمة.");
      Object.assign(row, changes, { version: row.version + 1 });
    } else rows.push({ ...changes, id: crypto.randomUUID(), version: 1 });
  }
}

class StaffService {
  async request(path, method = "GET", body, version) {
    const headers = { Accept: "application/json" };
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
      headers["X-Staff-Request"] = "1";
      if (this.csrf) headers["X-CSRF-Token"] = this.csrf;
      if (version != null) headers["If-Match"] = '"' + String(version) + '"';
    }
    const response = await fetch(
      new URL("api/staff/" + path, document.baseURI),
      {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (response.status === 401 && path === "session") return null;
    if (!response.ok)
      throw Object.assign(
        Error(
          {
            401: "انتهت الجلسة أو بيانات الدخول غير صحيحة.",
            403: "الحساب لا يملك هذه الصلاحية.",
            409: "تغيّرت العضوية أو البريد مستخدم. حدّث القائمة.",
            412: "تغيّرت العضوية. حدّث القائمة قبل الحفظ.",
          }[response.status] || "تعذّر إكمال الطلب لدى خدمة المستخدمين.",
        ),
        { status: response.status },
      );
    return response.status === 204 ? null : response.json();
  }
  async session() {
    const value = await this.request("session");
    this.csrf = value?.csrf;
    return value;
  }
  login(email, password) {
    return this.request("login", "POST", { email, password });
  }
  logout() {
    return this.request("logout", "POST", {});
  }
  members(c) {
    return this.request("companies/" + encodeURIComponent(c.id) + "/members");
  }
  save(c, member, changes) {
    const path = "companies/" + encodeURIComponent(c.id) + "/members";
    return this.request(
      member ? path + "/" + encodeURIComponent(member.id) : path,
      member ? "PATCH" : "POST",
      changes,
      member?.version,
    );
  }
}

const StaffConsole = {
  init() {
    if (seed.offline) return;
    this.preview = !document.querySelector(
      'meta[name="contract-staff-api"][content="enabled"]',
    );
    if(Cloud.enabled){this.preview=false;this.companyId=Cloud.company.id;}
    this.api = Cloud.enabled ? Cloud.staff() : this.preview ? new StaffPreview() : new StaffService();
    const shortcut = staffButton("", () => Workspace.open("staff"));
    shortcut.id = "staffShortcut";
    shortcut.title = "حسابي وصلاحياتي";
    shortcut.setAttribute("aria-label", shortcut.title);
    shortcut.innerHTML = Archive.icon("staff");
    $("settingsShortcut").before(shortcut);
    const tab = staffButton("المستخدمون والصلاحيات", () =>
      Workspace.tab("staff"),
    );
    tab.id = "tab-staff";
    tab.dataset.settingsTab = "staff";
    tab.setAttribute("role", "tab");
    tab.tabIndex = -1;
    tab.setAttribute("aria-controls", "staffSettings");
    $("settingsTabs").append(tab);
    this.panel = staffElement("section");
    this.panel.id = "staffSettings";
    this.panel.dataset.settingsPanel = "staff";
    this.panel.hidden = true;
    this.panel.setAttribute("role", "tabpanel");
    this.panel.setAttribute("aria-labelledby", tab.id);
    $("settingsContent").append(this.panel);
    this.notice = staffElement("p");
    this.notice.setAttribute("role", "status");
    this.notice.className = "staff-status";
    this.body = staffElement("div");
    this.panel.append(this.notice, this.body);
    this.ticket = 0;
  },
  async refresh(message = "") {
    const ticket = ++this.ticket;
    this.body.replaceChildren();
    this.notice.textContent = "جارٍ تحميل الحساب…";
    try {
      const session = await this.api.session();
      if (ticket !== this.ticket) return;
      if (session)
        session.companies = (
          session.active === false ? [] : session.companies
        ).filter(
          (c) => c.active !== false && Object.hasOwn(staffRoles, c.role),
        );
      this.session = session;
      if (!session) {
        this.notice.textContent = "";
        this.login();
        return;
      }
      const c =
        session.companies.find((c) => c.id === (Cloud.enabled?Cloud.company.id:this.companyId)) ||
        session.companies[0];
      this.companyId = c?.id;
      const rows = staffCan(c, "memberships") ? await this.api.members(c) : [];
      if (ticket !== this.ticket) return;
      this.notice.textContent = message;
      this.render(c, rows);
    } catch (error) {
      if (ticket !== this.ticket) return;
      if (error.status === 401) {
        this.session = null;
        this.login();
        this.notice.textContent = error.message;
        return;
      }
      this.body.replaceChildren(
        staffButton("إعادة الاتصال", () => this.refresh()),
      );
      if (!this.preview && this.session) this.body.append(this.logoutButton());
      this.notice.textContent = error.message;
    }
  },
  logoutButton() {
    return staffButton("تسجيل الخروج", async () => {
      try {
        await this.api.logout();
        this.session = null;
        await this.refresh();
      } catch (error) {
        this.notice.textContent = error.message;
      }
    });
  },
  login() {
    const form = staffElement("form");
    form.className = "staff-form";
    const email = staffElement("input"),
      pass = staffElement("input");
    email.type = "email";
    email.autocomplete = "username";
    pass.type = "password";
    pass.autocomplete = "current-password";
    email.required = pass.required = true;
    const go = staffElement("button", "تسجيل الدخول");
    form.append(
      staffElement("h3", "حساب الموظف"),
      staffField("البريد الإلكتروني", email),
      staffField("كلمة المرور", pass),
      go,
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      go.disabled = true;
      try {
        await this.api.login(email.value.trim(), pass.value);
        await this.refresh();
      } catch (error) {
        this.notice.textContent = error.message;
      } finally {
        pass.value = "";
        go.disabled = false;
      }
    };
    this.body.replaceChildren(form);
  },
  render(c, rows) {
    const head = staffElement("section");
    head.className = "staff-head";
    head.append(staffElement("h3", this.session.name));
    if (this.preview) {
      const role = staffSelect(
        "معاينة الدور",
        Object.entries(staffRoles),
        this.api.role,
      );
      role.onchange = () => {
        this.api.role = role.value;
        this.refresh();
      };
      head.append(
        staffElement(
          "small",
          "معاينة ببيانات تجريبية. تُمسح تغييرات المعاينة عند إغلاق الصفحة.",
        ),
        staffField("معاينة الدور", role),
      );
    } else head.append(this.logoutButton());
    if(Cloud.enabled){
      const change=staffElement("button","تغيير كلمة مروري");change.type="button";head.append(change);
      change.onclick=()=>{
        const dlg=document.createElement("dialog"),form=document.createElement("form");
        const current=document.createElement("input"),next=document.createElement("input");current.type=next.type="password";current.autocomplete="current-password";next.autocomplete="new-password";current.required=next.required=true;next.minLength=12;next.maxLength=128;
        const save=staffElement("button","حفظ"),close=staffElement("button","إلغاء"),status=staffElement("output");close.type="button";close.onclick=()=>dlg.close();
        form.append(staffField("كلمة المرور الحالية",current),staffField("كلمة المرور الجديدة",next),save,close,status);
        form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{await Cloud.call("password",{current:current.value,password:next.value});dlg.close();this.notice.textContent="تم تغيير كلمة المرور.";}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};
        dlg.append(form);document.body.append(dlg);dlg.onclose=()=>dlg.remove();dlg.showModal();current.focus();
      };
    }
    this.body.replaceChildren(head);
    if (!c) {
      head.append(staffElement("p", "لا توجد عضوية شركة نشطة لهذا الحساب."));
      return;
    }
    const company = staffSelect(
      "الشركة",
      this.session.companies.map((x) => [x.id, x.name]),
      c.id,
    );
    company.onchange = () => {
      if(Cloud.enabled)return Cloud.switchCompany(company.value);
      this.companyId = company.value;
      this.refresh();
    };
    head.append(
      ...(!c.sharedBrand?[staffField("الشركة",company)]:[]),
      staffElement(
        "p",
        staffRoles[c.role] +
          " · " +
          (c.role === "administrator"
            ? "كل فروع الشركة"
            : c.branches
                .filter((b) => c.branchIds.includes(b.id))
                .map((b) => b.name)
                .join("، ") || "لم يُسند فرع"),
      ),
    );
    const assigned = c.branches.filter((b) => staffCan(c, "archive", b.id));
    if (assigned.length) {
      const branch = staffSelect(
        "صلاحياتي في الفرع",
        assigned.map((b) => [b.id, b.name]),
      );
      const rights = staffElement("p");
      rights.setAttribute("aria-live", "polite");
      branch.onchange = () => {
        rights.textContent = Object.entries(staffRights)
          .filter(([key]) => staffCan(c, key, branch.value))
          .map(([, right]) => right.label)
          .join(" · ");
      };
      branch.onchange();
      head.append(staffField("صلاحياتي في الفرع", branch), rights);
    }
    if (staffCan(c,"memberships")){
      this.directory(c,rows);
      if(Cloud.enabled)this.approvals(c);
    }
    const details = staffElement("details");
    details.open = c.role !== "administrator";
    details.append(staffElement("summary", "صلاحيات الأدوار"));
    const table = staffElement("table");
    const h = table.createTHead().insertRow();
    for (const name of ["الصلاحية", ...Object.values(staffRoles)])
      h.append(staffElement("th", name));
    const body = table.createTBody();
    for (const { label, scope } of Object.values(staffRights)) {
      const tr = body.insertRow();
      for (const text of [
        label,
        scope === "company" ? "متاح" : "كل فروع الشركة",
        scope === "assigned"
          ? "الفروع المسندة"
          : scope === "managed"
            ? "الفروع التي يديرها"
            : "—",
        scope === "assigned" ? "الفروع المسندة" : "—",
      ])
        tr.insertCell().textContent = text;
    }
    details.append(table);
    this.body.append(details);
  },
  async approvals(c){
    const section=staffElement("section"),list=staffElement("ul");section.className="staff-directory";
    section.append(staffElement("h3","طلبات الدخول واعتماد التصاميم"),list);this.body.append(section);
    try{
      const rows=await Cloud.call("pending",{company:c.id});
      for(const q of rows){
        const row=staffElement("li");
        row.append(staffElement("b",q.kind==="access"?"طلب دخول":"تعديل تصميم"),staffElement("span",q.name+" · "+q.subject+(q.kind==="design"?" · "+q.pages+" صفحة":"")));
        const decision=action=>Cloud.call(action,{company:c.id,requestId:q.id});
        if(q.kind==="design")row.append(staffButton("تنزيل التصميم للمراجعة",async()=>{try{download("design.json",JSON.stringify(await Cloud.call("inspect",{company:c.id,requestId:q.id}),null,2),"application/json");}catch(error){this.notice.textContent=error.message;}}));
        row.append(staffButton("مراجعة الطلب",()=>ReviewDialog.open({
          title:q.kind==="access"?"مراجعة طلب الدخول":"مراجعة التصميم",subject:q.name+" · "+q.subject,
          choices:[{name:q.kind==="access"?"تحديد صلاحيات الموظف":"اعتماد التصميم",apply:()=>q.kind==="access"?this.edit(c,null,q):decision("approve_design")},
                   {name:"رفض الطلب",apply:()=>decision("reject")}],
          after:()=>this.body.isConnected&&this.refresh()
        })));
        list.append(row);
      }
      if(!rows.length)list.append(staffElement("li","لا توجد طلبات بانتظار الموافقة."));
    }catch(error){list.textContent=error.message;}
  },
  directory(c, rows) {
    const section = staffElement("section");
    section.className = "staff-directory";
    const bar = staffElement("div");
    bar.className = "staff-controls";
    const query = staffElement("input");
    query.type = "search";
    query.placeholder = Cloud.enabled ? "ابحث بالاسم أو اسم المستخدم" : "ابحث بالاسم أو البريد";
    query.setAttribute("aria-label", query.placeholder);
    const role = staffSelect("تصفية الدور", [
      ["", "كل الأدوار"],
      ...Object.entries(staffRoles),
    ]);
    const branch = staffSelect("تصفية الفرع", [
      ["", "كل الفروع"],
      ...c.branches.map((b) => [b.id, b.name]),
    ]);
    const status = staffSelect("حالة العضوية", [
      ["", "كل الحالات"],
      ["active", "نشط"],
      ["inactive", "موقوف"],
    ]);
    bar.append(
      query,
      role,
      branch,
      status,
      staffButton("إضافة مستخدم", () => this.edit(c)),
    );
    const list = staffElement("ul");
    const draw = () => {
      list.replaceChildren();
      for (const m of rows) {
        if (
          (role.value && role.value !== m.role) ||
          (status.value && (status.value === "active") !== m.active) ||
          (branch.value &&
            m.role !== "administrator" &&
            !m.branchIds.includes(branch.value)) ||
          !(m.name + " " + m.email)
            .toLowerCase()
            .includes(query.value.trim().toLowerCase())
        )
          continue;
        const li = staffElement("li"),
          identity = staffElement("div");
        identity.append(
          staffElement("strong", m.name),
          staffElement("small", m.email),
        );
        const scope =
          m.role === "administrator"
            ? "كل الفروع"
            : c.branches
                .filter((b) => m.branchIds.includes(b.id))
                .map((b) => b.name)
                .join("، ");
        li.append(
          identity,
          staffElement("span", staffRoles[m.role] + " · " + scope),
          staffElement("span", m.active ? "نشط" : "موقوف"),
        );
        if (m.id !== c.memberId)
          li.append(staffButton("تعديل", () => this.edit(c, m)));
        list.append(li);
      }
      if (!list.children.length)
        list.append(staffElement("li", "لا توجد نتائج."));
    };
    query.oninput = role.onchange = branch.onchange = status.onchange = draw;
    section.append(staffElement("h3", "عضويات الشركة"), bar, list);
    this.body.append(section);
    draw();
  },
  edit(c, member, request) {
    if (!staffCan(c, "memberships") || member?.id === c.memberId) return;
    const dialog = staffElement("dialog"),
      form = staffElement("form");
    dialog.className = "app-ui staff-dialog";
    form.className = "staff-form";
    const name = staffElement("input"),
      email = staffElement("input");
    name.required = email.required = true;
    name.maxLength = 120;
    email.type = "email";
    email.maxLength = 254;
    email.dir = "ltr";
    name.value = member?.name || request?.name || "";
    email.value = member?.email || request?.subject || "";
    const pass=staffElement("input");
    if(Cloud.enabled){email.type="text";email.readOnly=!!member||!!request;
      pass.type="password";pass.autocomplete="new-password";pass.minLength=12;pass.maxLength=128;pass.required=!member;}
    const role = staffSelect(
      "الدور",
      Object.entries(staffRoles),
      member?.role || "employee",
    );
    const department=staffSelect("القسم",[["contracts","العقود"],["sales","المبيعات"],["finance","المالية"]],member?.department||"contracts");
    const nameCaption=staffField("الاسم",name);
    const updateNameCaption=()=>{
      const full=department.value==="sales"||["administrator","branch_manager"].includes(role.value);
      const label=nameCaption.firstChild;label.textContent=full?"الاسم الثنائي":"الاسم";
      name.placeholder=full?"الاسم الأول واسم الأب أو العائلة":"";
    };
    role.addEventListener("change",updateNameCaption);department.addEventListener("change",updateNameCaption);updateNameCaption();
    const scopes=staffElement("fieldset");scopes.append(staffElement("legend","الشركات المخوّلة"));
    const choices=(this.session.companies||[]).filter(x=>x.role==="administrator").map(x=>{
      const input=staffElement("input");input.type="checkbox";input.value=x.id;
      input.checked=x.id===c.id || !!member?.companies?.includes(x.id);
      scopes.append(staffField(x.name,input));return input;
    });
    const scopeState=()=>{department.disabled=role.value!=="employee";for(const input of choices){input.disabled=input.value===c.id||role.value!=="employee";if(input.disabled)input.checked=true;}};
    role.addEventListener("change",scopeState);scopeState();
    const status = staffSelect(
      "حالة العضوية",
      [
        ["active", "نشط"],
        ["inactive", "موقوف"],
      ],
      member?.active === false ? "inactive" : "active",
    );
    const branches = staffElement("fieldset");
    branches.append(staffElement("legend", "الفروع المسندة"));
    const assignments = c.branches.map((b) => {
      const input = staffElement("input");
      input.type = "checkbox";
      input.value = b.id;
      input.checked = !!member?.branchIds.includes(b.id);
      const label = staffElement("label");
      label.append(input, document.createTextNode(b.name));
      const branchRole = staffSelect(
        "صلاحية فرع " + b.name,
        [
          ["branch_manager", "مدير فرع"],
          ["employee", "موظف"],
        ],
        member?.branchRoles?.[b.id] || "branch_manager",
      );
      const group = staffElement("div");
      group.append(label, branchRole);
      branches.append(group);
      const update = () => {
        branchRole.hidden = !input.checked || role.value !== "branch_manager";
      };
      input.onchange = update;
      return { input, branchRole, update };
    });
    role.onchange = () => {
      branches.hidden = role.value === "administrator";
      assignments.forEach((a) => a.update());
    };
    role.onchange();
    const msg = staffElement("p");
    msg.setAttribute("role", "alert");
    const save = staffElement("button", "حفظ"),
      cancel = staffButton("إلغاء", () => dialog.close());
    const actions = staffElement("div");
    actions.className = "row-buttons";
    actions.append(save, cancel);
    form.append(
      staffElement(
        "h3",
        (member ? "تعديل عضوية" : "إضافة مستخدم") + " · " + c.name,
      ),
      nameCaption,
      staffField(Cloud.enabled ? "اسم المستخدم" : "البريد الإلكتروني", email),
      ...(Cloud.enabled ? [staffField(member?"كلمة مرور جديدة (اختياري)":"كلمة المرور",pass)] : []),
      staffField("الدور", role),
      ...(Cloud.formsReady ? [staffField("القسم",department),...(c.sharedBrand?[]:[scopes])] : []),
      staffField("حالة العضوية", status),
      branches,
      msg,
      actions,
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      const selected = branches.hidden
        ? []
        : assignments.filter((a) => a.input.checked);
      const branchIds = selected.map((a) => a.input.value);
      const branchRoles = Object.fromEntries(
        selected.map((a) => [
          a.input.value,
          role.value === "employee" ? "employee" : a.branchRole.value,
        ]),
      );
      if((!member||status.value==="active")&&(department.value==="sales"||["administrator","branch_manager"].includes(role.value))&&!/^[^\s0-9٠-٩]+(?:\s+[^\s0-9٠-٩]+)+$/u.test(name.value.trim())){
        msg.textContent="أدخل الاسم الأول واسم الأب أو العائلة حتى يظهر الاسم على الاستمارة.";name.focus();return;
      }
      if (!name.value.trim() || (!branches.hidden && !branchIds.length)) {
        msg.textContent = "أدخل الاسم واختر فرعاً واحداً على الأقل.";
        return;
      }
      if (
        role.value === "branch_manager" &&
        !Object.values(branchRoles).includes("branch_manager")
      ) {
        msg.textContent = "حدّد فرعاً يديره المستخدم أو اختر دور موظف.";
        return;
      }
      save.disabled = cancel.disabled = true;
      try {
        await this.api.save(c, member, {
          name: name.value.trim(),
          email: email.value.trim(),
          ...(Cloud.enabled ? {password:pass.value,requestId:request?.id,department:role.value==="employee"?department.value:"contracts",companies:choices.filter(x=>x.checked).map(x=>x.value)} : {}),
          role: role.value,
          branchIds,
          branchRoles,
          active: status.value === "active",
        });
        dialog.close();
        await this.refresh("حُفظت العضوية.");
      } catch (error) {
        msg.textContent = error.message;
        if (error.status === 401 || error.status === 403) {
          dialog.close();
          await this.refresh(error.message);
        }
      } finally {
        save.disabled = cancel.disabled = false;
      }
    };
    dialog.oncancel = (e) => {
      if (save.disabled) e.preventDefault();
    };
    dialog.onclose = () => dialog.remove();
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
    name.focus();
  },
};
