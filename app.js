// app.js — UI glue for the static demo
(function () {
  "use strict";

  // ---- Onboarding ----
  const ONBOARDING_KEY = "libschedpay.onboarding.dismissed";
  const onboarding = document.getElementById("onboarding");
  function showOnboarding() {
    if (localStorage.getItem(ONBOARDING_KEY) === "1") return;
    onboarding.hidden = false;
  }
  function hideOnboarding(never) {
    onboarding.hidden = true;
    if (never) localStorage.setItem(ONBOARDING_KEY, "1");
  }
  document.getElementById("onboardingClose").addEventListener("click", () => hideOnboarding(false));
  document.getElementById("onboardingStart").addEventListener("click", () => {
    hideOnboarding(document.getElementById("onboardingNever").checked);
  });
  document.getElementById("showOnboarding").addEventListener("click", () => {
    document.getElementById("onboardingNever").checked = false;
    onboarding.hidden = false;
  });
  // show on first visit
  showOnboarding();

  // ---- Tabs ----
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + target));
    });
  });

  // ---- Card collapse ----
  document.querySelectorAll("[data-collapse]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.collapse;
      const body = document.getElementById(id);
      const isCollapsed = body.classList.toggle("collapsed");
      btn.textContent = isCollapsed ? "展开 ▾" : "收起 ▴";
    });
  });

  // ---- Toast ----
  function toast(msg, type) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.toggle("err", type === "err");
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  // ---- Helpers ----
  function $(id) { return document.getElementById(id); }
  function show(el) { el && el.classList.remove("hidden"); }
  function hide(el) { el && el.classList.add("hidden"); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function uniqueNames(text) {
    const out = [];
    const seen = new Set();
    text.split(/\n|,|，|、/).map(s => s.trim()).filter(Boolean).forEach(n => {
      const key = n.replace(/\s+/g, "");
      if (!seen.has(key)) { seen.add(key); out.push(n); }
    });
    return out;
  }
  function parseShifts(text) {
    const lines = text.split(/\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) throw new Error("请至少录入一个班次");
    return lines.map((line, i) => {
      const m = line.match(/^(.+?)\s+(\d{1,2}(?::\d{2})?)\s*(?:到|-|—|至)\s*(\d{1,2}(?::\d{2})?)\s*(\d+)\s*人?$/);
      if (!m) throw new Error(`无法识别班次：${line}`);
      const start = _normaliseTime(m[2]);
      const end = _normaliseTime(m[3]);
      const dur = _duration(start, end);
      const req = Number(m[4]);
      if (!Number.isFinite(dur) || dur <= 0) throw new Error(`班次时间不合法：${line}`);
      if (!Number.isInteger(req) || req < 0) throw new Error(`班次人数不合法：${line}`);
      return {
        id: ["morning", "afternoon", "evening", "night", "late_night"][i] || `shift_${i + 1}`,
        name: m[1].trim(),
        start, end,
        duration_hours: dur,
        required_people: req,
      };
    });
  }
  function _normaliseTime(v) {
    v = String(v).trim();
    if (v.includes(":")) return v;
    return `${String(v).padStart(2, "0")}:00`;
  }
  function _duration(start, end) {
    const toMin = s => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };
    return (toMin(end) - toMin(start)) / 60;
  }
  function _dateRange(start, end) {
    if (!start || !end) return [];
    const out = [];
    const a = new Date(start + "T00:00:00Z");
    const b = new Date(end + "T00:00:00Z");
    if (isNaN(a) || isNaN(b) || a > b) return [];
    while (a <= b) {
      const y = a.getUTCFullYear();
      const m = String(a.getUTCMonth() + 1).padStart(2, "0");
      const d = String(a.getUTCDate()).padStart(2, "0");
      out.push(`${y}-${m}-${d}`);
      a.setUTCDate(a.getUTCDate() + 1);
    }
    return out;
  }
  function _dayOfWeek(iso) {
    return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(iso + "T00:00:00Z").getUTCDay()];
  }
  function _dateShort(iso) { return iso.slice(5); }
  function showErr(box, msgs) {
    if (!msgs || !msgs.length) { hide(box); return; }
    box.innerHTML = "<strong>错误：</strong>" + msgs.map(escapeHtml).join("；");
    show(box);
  }
  function showWarn(box, msgs) {
    if (!msgs || !msgs.length) { hide(box); return; }
    box.innerHTML = "<strong>提示：</strong>" + msgs.map(escapeHtml).join("；");
    show(box);
  }

  // ============================================================
  // 排班
  // ============================================================
  const sched = {
    start: "2026-09-07", end: "2026-09-13",
    shifts: [], people: [],
    constraints: new Set(),
    allocation_mode: "by_duration",  // 固定为按班岗时长分别平均
    result: null,
  };

  function loadSchedPeople(text) {
    const names = uniqueNames(text);
    sched.people = names;
    updateSchedRealtime();
    renderConstraintGrid();
  }
  function loadSchedShifts(text) {
    sched.shifts = parseShifts(text);
    updateSchedRealtime();
  }
  function applyScenario(kind) {
    if (kind === "35") {
      $("schedStart").value = "2026-09-07";
      $("schedEnd").value = "2026-09-13";
      $("schedShifts").value = "早班 09:00-11:00 5\n下午班 14:00-16:00 5\n晚班 19:00-22:00 5";
      const names = [];
      for (let i = 1; i <= 35; i++) names.push(`同学${String(i).padStart(2, "0")}`);
      $("schedPeople").value = names.join("\n");
    } else if (kind === "10") {
      $("schedStart").value = "2026-09-07";
      $("schedEnd").value = "2026-09-09";
      $("schedShifts").value = "早班 09:00-11:00 2\n下午班 14:00-16:00 2\n晚班 19:00-22:00 3";
      $("schedPeople").value = "甲\n乙\n丙\n丁\n戊\n己\n庚\n辛\n壬\n癸";
    } else if (kind === "constraint") {
      $("schedStart").value = "2026-09-14";
      $("schedEnd").value = "2026-09-20";
      $("schedShifts").value = "早班 09:00-11:00 3\n下午班 14:00-16:00 3\n晚班 19:00-22:00 4";
      $("schedPeople").value = "甲\n乙\n丙\n丁\n戊\n己";
      setTimeout(() => presetConstraints(), 50);
    }
    syncSchedInputs();
  }
  function presetConstraints() {
    const start = $("schedStart").value;
    const end = $("schedEnd").value;
    const days = _dateRange(start, end);
    if (days.length < 2) return;
    sched.constraints.add(`甲|${days[0]}|afternoon`);
    sched.constraints.add(`乙|${days[1]}|morning`);
    renderConstraintGrid();
  }
  function syncSchedInputs() {
    sched.start = $("schedStart").value;
    sched.end = $("schedEnd").value;
    try { loadSchedShifts($("schedShifts").value); }
    catch (e) { return; }
    loadSchedPeople($("schedPeople").value);
  }
  function updateSchedRealtime() {
    const start = $("schedStart").value;
    const end = $("schedEnd").value;
    const days = _dateRange(start, end);
    $("rtDays").textContent = `${days.length} 天`;

    let slots = 0, hours = 0;
    if (sched.shifts.length) {
      for (const s of sched.shifts) slots += s.required_people * days.length;
      for (const s of sched.shifts) hours += s.duration_hours * s.required_people * days.length;
    }
    $("rtSlots").textContent = slots || "—";
    $("rtHours").textContent = hours ? `${hours}h` : "—";

    const people = sched.people.length;
    $("rtPeople").textContent = `${people} 人`;
    $("rtAvgHours").textContent = (people && hours) ? `${(hours / people).toFixed(1)}h` : "—";

    // 按桶平均
    const buckets = new Map();
    if (sched.shifts.length && days.length) {
      for (const s of sched.shifts) {
        const slots = s.required_people * days.length;
        const hrs = slots * s.duration_hours;
        const cur = buckets.get(s.duration_hours) || { slots: 0, hours: 0 };
        cur.slots += slots; cur.hours += hrs;
        buckets.set(s.duration_hours, cur);
      }
    }
    $("rtAvg2h").textContent = people && buckets.get(2) ? `${(buckets.get(2).slots / people).toFixed(1)} 次` : "—";
    $("rtAvg3h").textContent = people && buckets.get(3) ? `${(buckets.get(3).slots / people).toFixed(1)} 次` : "—";
  }

  function renderConstraintGrid() {
    const wrap = $("schedConstraintGrid");
    if (!sched.shifts.length || !sched.people.length) {
      wrap.innerHTML = '<p style="color:var(--ink-3);font-size:14px;margin:0">先在第 1 步确认班次和人员。</p>';
      return;
    }
    const start = $("schedStart").value;
    const end = $("schedEnd").value;
    let days;
    try { days = _dateRange(start, end); }
    catch (e) { wrap.innerHTML = `<p style="color:var(--err)">${escapeHtml(e.message)}</p>`; return; }

    let html = `<div class="gh">人员</div>` + days.map(d => `<div class="gh">${_dayOfWeek(d)}<br><span style="color:var(--ink-3);font-size:10.5px">${_dateShort(d)}</span></div>`).join("");
    for (const shift of sched.shifts) {
      html += `<div class="gh" style="grid-column:1/-1;text-align:left;background:transparent;padding:10px 0 0;font-weight:600">${escapeHtml(shift.name)}（${shift.start}–${shift.end}）</div>`;
      for (const person of sched.people) {
        html += `<div class="rl">${escapeHtml(person)}</div>`;
        for (const day of days) {
          const key = `${person}|${day}|${shift.id}`;
          const checked = sched.constraints.has(key) ? "checked" : "";
          const letter = _dayOfWeek(day).slice(-1);
          html += `<div class="cl"><label><input type="checkbox" data-key="${escapeHtml(key)}" ${checked}><span>${letter}</span></label></div>`;
        }
      }
    }
    wrap.innerHTML = html;
    wrap.querySelectorAll("input[type=checkbox]").forEach(input => {
      input.addEventListener("change", () => {
        if (input.checked) sched.constraints.add(input.dataset.key);
        else sched.constraints.delete(input.dataset.key);
      });
    });
  }
  function buildSchedulePayload() {
    syncSchedInputs();
    const days = _dateRange(sched.start, sched.end);
    const people = sched.people.map(name => {
      const unavailable = [];
      for (const key of sched.constraints) {
        const [n, date, shift_id] = key.split("|");
        if (n === name) unavailable.push({ date, shift_id });
      }
      return { name, unavailable };
    });
    return {
      cycle: { start_date: sched.start, end_date: sched.end },
      days: days.map(d => ({ date: d })),
      shifts: sched.shifts,
      people,
      allocation_mode: sched.allocation_mode,
      assignments: [],
    };
  }
  function renderSchedTable(validation) {
    const wrap = $("schedTableWrap");
    const days = _dateRange(sched.start, sched.end);
    const map = {};
    for (const r of validation.shift_results) map[`${r.date}|${r.shift_id}`] = r;

    let html = '<div class="table-scroll"><table class="t"><thead><tr><th style="width:160px">班次</th>';
    for (const d of days) html += `<th>${_dayOfWeek(d)}<br><span style="color:var(--ink-3);font-size:12px">${_dateShort(d)}</span></th>`;
    html += "</tr></thead><tbody>";
    for (const shift of sched.shifts) {
      for (let slot = 0; slot < shift.required_people; slot++) {
        const isFirst = slot === 0;
        html += `<tr>${isFirst ? `<td rowspan="${shift.required_people}" class="name">${escapeHtml(shift.name)}<br><span style="color:var(--ink-3);font-size:13px">${shift.duration_hours}小时 / 需${shift.required_people}人</span></td>` : ""}`;
        for (const d of days) {
          const r = map[`${d}|${shift.id}`];
          const names = r ? r.assigned_people : [];
          html += `<td>${escapeHtml(names[slot] || "")}</td>`;
        }
        html += "</tr>";
      }
    }
    html += "</tbody></table></div>";

    html += '<div class="table-scroll"><table class="t"><thead><tr><th>姓名</th><th class="num">总班次</th><th class="num">总工时</th></tr></thead><tbody>';
    for (const p of validation.people) {
      const total = Object.values(p.morning_or_shift_counts || {}).reduce((a, b) => a + b, 0);
      html += `<tr><td class="name">${escapeHtml(p.name)}</td><td class="num">${total}</td><td class="num">${escapeHtml(p.assigned_hours)}h</td></tr>`;
    }
    html += "</tbody></table></div>";
    wrap.innerHTML = html;
    show(wrap);
  }
  function renderSchedSummary(v) {
    const t = v.totals;
    $("schedSummary").innerHTML = `
      <div class="stat"><span>计划岗位</span><strong>${t.planned_slots}</strong></div>
      <div class="stat"><span>已排岗位</span><strong>${t.filled_slots}</strong></div>
      <div class="stat"><span>空缺</span><strong class="${t.vacancy_slots > 0 ? 'err' : ''}">${t.vacancy_slots}</strong></div>
      <div class="stat"><span>计划工时</span><strong>${t.planned_hours}h</strong></div>
      <div class="stat"><span>已排工时</span><strong>${t.filled_hours}h</strong></div>
      <div class="stat"><span>状态</span><strong class="${v.ok ? 'ok' : 'err'}">${v.ok ? '✓ 通过' : '✗ 异常'}</strong></div>
    `;
    show($("schedSummary"));
  }
  function generateSched() {
    hide($("schedErrors"));
    hide($("schedWarnings"));
    let payload;
    try { payload = buildSchedulePayload(); }
    catch (e) { showErr($("schedErrors"), [e.message]); return; }
    try {
      const result = Schedule.generate(payload);
      sched.result = result;
      renderSchedSummary(result.validation);
      showWarn($("schedWarnings"), result.validation.warnings);
      renderSchedTable(result.validation);
      $("schedExport").disabled = !result.validation.ok;
      toast(result.validation.ok ? "✓ 排班生成完成" : "⚠ 有异常，请查看");
    } catch (e) {
      showErr($("schedErrors"), [e.message]);
    }
  }
  function exportSchedXlsx() {
    if (!sched.result) return;
    const v = sched.result.validation;
    const wb = XLSX.utils.book_new();
    const days = _dateRange(sched.start, sched.end);
    const map = {};
    for (const r of v.shift_results) map[`${r.date}|${r.shift_id}`] = r;
    const aoa1 = [];
    aoa1.push([`书库排班表 ${sched.start}—${sched.end}`]);
    aoa1.push(["班次", ...days.map(d => `${_dayOfWeek(d)} ${d}`)]);
    for (const shift of sched.shifts) {
      for (let slot = 0; slot < shift.required_people; slot++) {
        const row = [slot === 0 ? `${shift.name}\n${shift.duration_hours}小时 / 需${shift.required_people}人` : ""];
        for (const d of days) {
          const r = map[`${d}|${shift.id}`];
          row.push(r && r.assigned_people[slot] ? r.assigned_people[slot] : "");
        }
        aoa1.push(row);
      }
    }
    aoa1.push([""]);
    aoa1.push(["姓名", ...sched.shifts.map(s => s.name), "总班次", "总时长(h)"]);
    for (const p of v.people) {
      const row = [p.name];
      let totalShifts = 0;
      for (const s of sched.shifts) {
        const c = (p.morning_or_shift_counts || {})[s.id] || 0;
        totalShifts += c;
        row.push(c);
      }
      row.push(totalShifts);
      row.push(Number(p.assigned_hours) || 0);
      aoa1.push(row);
    }
    const ws1 = XLSX.utils.aoa_to_sheet(aoa1);
    ws1["!merges"] = [];
    ws1["!cols"] = [{ wch: 22 }, ...days.map(() => ({ wch: 13 }))];
    XLSX.utils.book_append_sheet(wb, ws1, "排班表");
    const aoa2 = [["日期", "班次", "姓名", "时长(h)"]];
    for (const r of v.shift_results) {
      for (const name of r.assigned_people) {
        const shift = sched.shifts.find(s => s.id === r.shift_id);
        aoa2.push([r.date, shift ? shift.name : r.shift_id, name, shift ? shift.duration_hours : ""]);
      }
    }
    const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
    ws2["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws2, "记录");
    XLSX.writeFile(wb, `排班表_${sched.start}.xlsx`);
    toast("✓ Excel 已下载");
  }

  $("schedStart").addEventListener("change", () => { syncSchedInputs(); renderConstraintGrid(); });
  $("schedEnd").addEventListener("change", () => { syncSchedInputs(); renderConstraintGrid(); });
  $("schedShifts").addEventListener("change", () => { syncSchedInputs(); renderConstraintGrid(); });
  $("schedPeople").addEventListener("input", () => { syncSchedInputs(); renderConstraintGrid(); });

  // 排班：上传名单
  $("schedPeopleUploadBtn").addEventListener("click", () => $("schedPeopleUpload").click());
  $("schedPeopleUpload").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    $("schedPeopleUploadHint").textContent = `已选: ${file.name}`;
    try {
      let names = [];
      if (file.name.endsWith(".csv")) {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        const startIdx = /[一-龥]?[姓名]|[Nn]ame/.test(lines[0] || "") ? 1 : 0;
        for (let i = startIdx; i < lines.length; i++) {
          const cols = lines[i].split(/[,\t]/).map(s => s.trim());
          if (cols[0]) names.push(cols[0]);
        }
      } else if (file.name.endsWith(".json")) {
        const data = JSON.parse(await file.text());
        const list = data.people || data;
        for (const r of list) if (r && r.name) names.push(String(r.name));
      } else if (file.name.endsWith(".xlsx")) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        if (!aoa.length) { alert("xlsx 文件为空"); return; }
        let nameCol = 0, headerRow = 0;
        for (let r = 0; r < Math.min(5, aoa.length); r++) {
          const row = aoa[r].map(c => String(c).toLowerCase().trim());
          const nIdx = row.findIndex(c => /[一-鿿]?姓名|name/.test(c));
          if (nIdx >= 0) { nameCol = nIdx; headerRow = r; break; }
        }
        for (let r = headerRow + 1; r < aoa.length; r++) {
          const n = String(aoa[r][nameCol] || "").trim();
          if (n) names.push(n);
        }
      } else {
        alert("暂支持 .xlsx / .csv / .json");
        return;
      }
      if (!names.length) { alert("未识别到姓名"); return; }
      $("schedPeople").value = names.join("\n");
      syncSchedInputs();
      toast(`✓ 已从 ${file.name} 导入 ${names.length} 人`);
    } catch (err) {
      alert("解析失败: " + err.message);
    }
  });
  document.querySelectorAll("[data-scenario]").forEach(b => b.addEventListener("click", () => applyScenario(b.dataset.scenario)));
  $("schedGenerate").addEventListener("click", generateSched);
  $("schedValidate").addEventListener("click", generateSched);
  $("schedExport").addEventListener("click", exportSchedXlsx);
  $("schedBack1").addEventListener("click", () => {
    $("sched1").classList.add("collapsed");
    document.querySelector("[data-collapse='sched1']").textContent = "展开 ▾";
  });

  // ============================================================
  // 工时 - 模块 A: 实际工时
  // ============================================================
  const stl = {
    start: "2026-09-01", end: "2026-09-30", cap: 33,
    rows: [], result: null, transfers: [],
  };
  function setStlRows(rows) {
    stl.rows = rows.map(r => ({
      name: r.name || "",
      actual_hours: r.actual_hours == null ? "" : r.actual_hours,
      issued_hours: r.issued_hours == null ? "" : r.issued_hours,
    }));
    renderStlTableA();
    renderStlTableB();
    updateStlRealtime();
  }
  function renderStlTableA() {
    const tbody = $("stlTable").querySelector("tbody");
    tbody.innerHTML = "";
    stl.rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="color:var(--ink-3);font-size:14px">${i + 1}</td>
        <td><input type="text" data-i="${i}" data-f="name" value="${escapeHtml(r.name)}" placeholder="姓名"></td>
        <td class="num"><input type="number" min="0" step="1" inputmode="numeric" data-i="${i}" data-f="actual_hours" value="${r.actual_hours === "" ? "" : r.actual_hours}" placeholder="0"></td>
        <td><button class="btn btn-ghost" data-del="${i}" style="padding:4px 8px;font-size:12.5px">×</button></td>
      `;
      tbody.appendChild(tr);
    });
    $("stlCount").textContent = `${stl.rows.length} 人`;
    $("stlBCount").textContent = `${stl.rows.length} 人`;
    tbody.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("input", e => {
        const i = Number(e.target.dataset.i);
        const f = e.target.dataset.f;
        let v = e.target.value;
        if (f === "actual_hours") {
          // 强制整数（去掉小数部分）
          v = String(v).split(".")[0].replace(/[^\d]/g, "");
          if (e.target.value !== v) e.target.value = v;
          stl.rows[i].issued_hours = "";  // 重置下发
        }
        stl.rows[i][f] = v;
        if (f === "actual_hours") {
          updateStlRealtime();
          renderStlTableB();
        }
      });
    });
    tbody.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", e => {
        const i = Number(e.target.dataset.del);
        stl.rows.splice(i, 1);
        renderStlTableA();
        renderStlTableB();
        updateStlRealtime();
      });
    });
  }
  function renderStlTableB() {
    const tbody = $("stlTableB").querySelector("tbody");
    tbody.innerHTML = "";
    stl.rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="col-num" style="color:var(--ink-3);font-size:14px">${i + 1}</td>
        <td class="col-name"><input type="text" data-i="${i}" data-f="name" value="${escapeHtml(r.name)}" placeholder="姓名"></td>
        <td class="num col-actual"><input type="number" min="0" step="1" inputmode="numeric" data-i="${i}" data-f="actual_hours" value="${r.actual_hours === "" ? "" : r.actual_hours}" placeholder="0"></td>
        <td class="num col-issued"><input type="number" min="0" step="0.5" data-i="${i}" data-f="issued_hours" value="${r.issued_hours === "" ? "" : r.issued_hours}" placeholder="0"></td>
        <td class="col-diff" data-diff="${i}">—</td>
        <td class="col-status" data-status="${i}">—</td>
      `;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("focus", e => {
        // 移动端键盘弹起时把输入框滚到视图中
        setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 200);
      });
      inp.addEventListener("input", e => {
        const i = Number(e.target.dataset.i);
        const f = e.target.dataset.f;
        let v = e.target.value;
        if (f === "actual_hours") {
          v = String(v).split(".")[0].replace(/[^\d]/g, "");
          if (e.target.value !== v) e.target.value = v;
        }
        stl.rows[i][f] = v;
        if (f === "name") {
          const ta = $("stlTable").querySelector(`input[data-i="${i}"][data-f="name"]`);
          if (ta) ta.value = v;
        } else if (f === "actual_hours") {
          const ta = $("stlTable").querySelector(`input[data-i="${i}"][data-f="actual_hours"]`);
          if (ta) ta.value = v;
        }
        updateRowDiffB(i);
        if (f === "actual_hours" || f === "issued_hours") recalculateStl();
      });
    });
    stl.rows.forEach((_, i) => updateRowDiffB(i));
  }
  function updateRowDiffB(i) {
    const r = stl.rows[i];
    const a = Number(r.actual_hours), b = Number(r.issued_hours);
    const row = $("stlTableB").querySelector("tbody").children[i];
    const diffCell = $("stlTableB").querySelector(`[data-diff="${i}"]`);
    const statusCell = $("stlTableB").querySelector(`[data-status="${i}"]`);
    if (!diffCell || !statusCell) return;
    if (!Number.isFinite(a) || !Number.isFinite(b) || r.actual_hours === "" || r.issued_hours === "") {
      diffCell.textContent = "—";
      diffCell.className = "col-diff";
      diffCell.innerHTML = "—";
      statusCell.innerHTML = '<span class="pill mute">—</span>';
      if (row) row.classList.remove("row-pos", "row-neg");
      return;
    }
    const d = a - b;
    const sign = d > 0 ? "+" : (d < 0 ? "" : "");
    diffCell.innerHTML = `<strong>${sign}${d}</strong>`;
    diffCell.className = "col-diff " + (d > 0 ? "pos" : d < 0 ? "neg" : "");
    const cls = d > 0 ? "ok" : d < 0 ? "err" : "mute";
    const txt = d > 0 ? "应收" : d < 0 ? "应转出" : "无差额";
    statusCell.innerHTML = `<span class="pill ${cls}">${txt}</span>`;
    if (row) {
      row.classList.toggle("row-pos", d > 0);
      row.classList.toggle("row-neg", d < 0);
    }
  }
  function updateStlRealtime() {
    let total = 0;
    for (const r of stl.rows) {
      const a = Number(r.actual_hours);
      if (Number.isFinite(a)) total += a;
    }
    $("stlActualTotal").textContent = total ? `${total}h` : "—";
    $("stlPersonCount").textContent = stl.rows.length;
  }
  function recalculateStl() {
    try {
      const cap = Number($("stlCapB").value) || 0;
      const result = Settlement.calculate(stl.rows, String(cap));
      stl.result = result;
      writeStlTransfers(result.transfers);
      renderStlResult(result, null);
    } catch (e) {
      // 暂不显示错误
    }
  }
  function applyStlScenario(kind) {
    if (kind === "35") {
      $("stlStart").value = "2026-09-01";
      $("stlEnd").value = "2026-09-30";
      $("stlCap").value = "33";
      $("stlCapB").value = "33";
      const rows = [];
      for (let i = 1; i <= 35; i++) {
        const name = `同学${String(i).padStart(2, "0")}`;
        // 整数工时：在 25~32 之间分布
        rows.push({ name, actual_hours: 25 + (i % 8), issued_hours: "" });
      }
      setStlRows(rows);
    } else if (kind === "balanced") {
      $("stlStart").value = "2026-09-01";
      $("stlEnd").value = "2026-09-30";
      $("stlCap").value = "33";
      $("stlCapB").value = "33";
      setStlRows([
        { name: "收款A", actual_hours: 40, issued_hours: "" },
        { name: "付款B", actual_hours: 26, issued_hours: "" },
        { name: "收款C", actual_hours: 38, issued_hours: "" },
        { name: "付款D", actual_hours: 28, issued_hours: "" },
      ]);
    } else if (kind === "unbalanced") {
      $("stlStart").value = "2026-09-01";
      $("stlEnd").value = "2026-09-30";
      $("stlCap").value = "40";
      $("stlCapB").value = "40";
      setStlRows([
        { name: "甲", actual_hours: 70, issued_hours: "" },
        { name: "乙", actual_hours: 20, issued_hours: "" },
      ]);
    }
  }
  function readStlTransfers() {
    return $("stlTransfers").value.split(/\n/).map(s => s.trim()).filter(Boolean).map(line => {
      const [payer, receiver, hours] = line.split("|").map(s => s.trim());
      return { payer, receiver, hours };
    });
  }
  function writeStlTransfers(transfers) {
    $("stlTransfers").value = transfers.map(t => `${t.payer}|${t.receiver}|${t.hours}`).join("\n");
  }
  function renderStlResult(result, transferValidation) {
    const t = result.totals;
    const ok = transferValidation ? transferValidation.ok : t.difference_hours === "0";
    $("stlResult").innerHTML = `
      <div class="stat"><span>实际总工时</span><strong>${t.actual_hours}</strong></div>
      <div class="stat"><span>下发总工时</span><strong>${t.issued_hours}</strong></div>
      <div class="stat"><span>总差额</span><strong class="${Number(t.difference_hours) === 0 ? 'ok' : 'err'}">${t.difference_hours}</strong></div>
      <div class="stat"><span>应收</span><strong class="ok">${t.receivable_hours}</strong></div>
      <div class="stat"><span>应转出</span><strong class="err">${t.payable_hours}</strong></div>
      <div class="stat"><span>未配平</span><strong>${t.external_adjustment_hours}</strong></div>
      <div class="stat"><span>状态</span><strong class="${ok ? 'ok' : 'err'}">${ok ? '✓ 已配平' : '✗ 需调整'}</strong></div>
    `;
    show($("stlResult"));
    if (transferValidation) showErr($("stlTransferErrors"), transferValidation.errors);
    else hide($("stlTransferErrors"));
    $("stlExportFinal").disabled = !ok;
  }
  function fillCap() {
    const cap = Number($("stlCapB").value) || 0;
    stl.rows = stl.rows.map(r => ({ ...r, issued_hours: cap }));
    renderStlTableB();
    recalculateStl();
    toast(`✓ 已按上限 ${cap} 填入`);
  }
  function fillActual() {
    const cap = Number($("stlCapB").value) || 0;
    stl.rows = stl.rows.map(r => ({ ...r, issued_hours: Math.min(Number(r.actual_hours) || 0, cap) }));
    renderStlTableB();
    recalculateStl();
    toast("✓ 已按实际填入（不超过上限）");
  }
  function clearIssued() {
    stl.rows = stl.rows.map(r => ({ ...r, issued_hours: "" }));
    renderStlTableB();
    recalculateStl();
  }
  function validateStlTransfers() {
    try {
      const transfers = readStlTransfers();
      const v = Settlement.validateTransfers(stl.rows, transfers, String($("stlCapB").value));
      stl.transfers = transfers;
      renderStlResult(stl.result, v);
      if (v.ok) toast("✓ 配平通过");
      else toast("尚未配平", "err");
    } catch (e) { toast(e.message, "err"); }
  }
  function buildSettlementXlsx(kind, draft) {
    const wb = XLSX.utils.book_new();
    if (kind === "settlement") {
      const result = Settlement.calculate(stl.rows, String($("stlCapB").value));
      const t = result.totals;
      const aoa1 = [[`工时核算 ${$("stlStart").value}—${$("stlEnd").value}`], ["姓名", "实际工时", "官方下发工时", "差值", "状态", "说明"]];
      for (const p of result.people) {
        const actual = Number(p.actual_hours), issued = Number(p.issued_hours);
        const diff = actual - issued;
        aoa1.push([p.name, actual, issued, { f: `B${aoa1.length}-C${aoa1.length}`, v: diff },
          { f: `IF(D${aoa1.length}>0,"应收",IF(D${aoa1.length}<0,"应转出","无差额"))`, v: diff > 0 ? "应收" : diff < 0 ? "应转出" : "无差额" }, ""]);
      }
      aoa1.push(["合计",
        { f: `SUM(B3:B${aoa1.length - 1})`, v: Number(t.actual_hours) },
        { f: `SUM(C3:C${aoa1.length - 1})`, v: Number(t.issued_hours) },
        { f: `SUM(D3:D${aoa1.length - 1})`, v: Number(t.difference_hours) },
        "", `未配平差额：${t.external_adjustment_hours}`]);
      const ws1 = XLSX.utils.aoa_to_sheet(aoa1);
      ws1["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
      ws1["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 28 }];
      XLSX.utils.book_append_sheet(wb, ws1, "差值明细");

      const transfers = readStlTransfers();
      const byReceiver = {};
      for (const tr of transfers) {
        if (!tr.payer || !tr.receiver || !tr.hours) continue;
        if (!byReceiver[tr.receiver]) byReceiver[tr.receiver] = { receiver: tr.receiver, total: 0, items: [] };
        byReceiver[tr.receiver].total += Number(tr.hours);
        byReceiver[tr.receiver].items.push([tr.payer, Number(tr.hours)]);
      }
      const groups = Object.values(byReceiver);
      const aoa2 = [[`工时转账表${$("stlStart").value.slice(5, 7)}月`]];
      if (!groups.length) aoa2.push(["暂无人工转账配平记录"]);
      else for (const g of groups) {
        for (let i = 0; i < g.items.length; i++) {
          const [payer, h] = g.items[i];
          aoa2.push([i === 0 ? `${g.receiver}${g.total}` : "", `${payer}-${h}`]);
        }
      }
      const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
      ws2["!cols"] = [{ wch: 30 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws2, "转账公示");

      const tv = Settlement.validateTransfers(stl.rows, transfers, String($("stlCapB").value));
      const aoa3 = [["校验项", "结果"],
        ["实际工时总额", Number(t.actual_hours)],
        ["官方下发总额", Number(t.issued_hours)],
        ["总差额", Number(t.difference_hours)],
        ["可配对转账工时", Number(t.draft_transfer_hours)],
        ["未配平差额", Number(t.external_adjustment_hours)],
        ["说明", result.checks.net_difference_is_zero ? "已平衡" : "存在外部差额"],
        ["人工转账配平", tv.ok ? "通过" : "未完成"],
        ["配平说明", tv.errors.join("；") || "无"]];
      const ws3 = XLSX.utils.aoa_to_sheet(aoa3);
      ws3["!cols"] = [{ wch: 28 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws3, "校验");
      XLSX.writeFile(wb, `${draft ? "转账核算草案" : "转账表"}_${$("stlStart").value}_${$("stlEnd").value}.xlsx`);
    } else if (kind === "settlement_summary") {
      const normalized = Settlement.calculate(
        stl.rows.map(r => ({ name: r.name, actual_hours: r.actual_hours, issued_hours: 0 })),
        "0"
      ).people;
      const aoa = [[`实际到岗工时一览 ${$("stlStart").value}—${$("stlEnd").value}`], ["序号", "姓名", "实际工时", "备注"]];
      let totalActual = 0;
      normalized.forEach((p, idx) => {
        const actual = Number(p.actual_hours);
        totalActual += actual;
        aoa.push([idx + 1, p.name, actual, ""]);
      });
      aoa.push(["合计", "", { f: `SUM(C3:C${aoa.length - 1})`, v: totalActual }, ""]);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
      ws["!cols"] = [{ wch: 10 }, { wch: 22 }, { wch: 16 }, { wch: 28 }];
      XLSX.utils.book_append_sheet(wb, ws, "实际工时一览");
      XLSX.writeFile(wb, `实际工时一览_${$("stlStart").value}_${$("stlEnd").value}.xlsx`);
    } else if (kind === "settlement_public") {
      const transfers = readStlTransfers();
      const byReceiver = {};
      for (const tr of transfers) {
        if (!tr.payer || !tr.receiver || !tr.hours) continue;
        if (!byReceiver[tr.receiver]) byReceiver[tr.receiver] = { receiver: tr.receiver, total: 0, items: [] };
        byReceiver[tr.receiver].total += Number(tr.hours);
        byReceiver[tr.receiver].items.push([tr.payer, Number(tr.hours)]);
      }
      const groups = Object.values(byReceiver);
      const aoa = [[`工时转账表${$("stlStart").value.slice(5, 7)}月`]];
      if (!groups.length) aoa.push(["暂无人工转账配平记录"]);
      else for (const g of groups) {
        for (let i = 0; i < g.items.length; i++) {
          const [payer, h] = g.items[i];
          aoa.push([i === 0 ? `${g.receiver}${g.total}` : "", `${payer}-${h}`]);
        }
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 30 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws, "人工转账配平表");
      XLSX.writeFile(wb, `人工转账配平表_${$("stlStart").value}_${$("stlEnd").value}.xlsx`);
    }
  }

  // 工时事件
  $("stlAdd").addEventListener("click", () => { stl.rows.push({ name: "", actual_hours: "", issued_hours: "" }); renderStlTableA(); renderStlTableB(); updateStlRealtime(); });
  $("stlBulkPaste").addEventListener("click", () => {
    const text = prompt("按名单顺序，每行一个工时（数字）。例如：\\n28\\n40\\n20");
    if (!text) return;
    const lines = text.split(/\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length !== stl.rows.length) {
      alert(`当前名单有 ${stl.rows.length} 人，你粘贴了 ${lines.length} 行，请让两边完全一致。`);
      return;
    }
    stl.rows = stl.rows.map((r, i) => ({ ...r, actual_hours: lines[i], issued_hours: "" }));
    renderStlTableA();
    renderStlTableB();
    updateStlRealtime();
    toast("✓ 已按顺序填入");
  });
  // Cap 双向绑定：A 模块和 B 模块的 cap 同步
  function syncCap(source, other) {
    const v = $(source).value;
    $(other).value = v;
    $("stlCapLabel").textContent = v;
  }
  $("stlCap").addEventListener("input", () => syncCap("stlCap", "stlCapB"));
  $("stlCapB").addEventListener("input", () => syncCap("stlCapB", "stlCap"));
  // 同步日期（A 和 B 两个模块的日期）
  function syncDate(source, other) {
    $(other).value = $(source).value;
  }
  $("stlStart").addEventListener("change", () => syncDate("stlStart", "stlStart"));
  $("stlEnd").addEventListener("change", () => syncDate("stlEnd", "stlEnd"));
  $("stlStart").addEventListener("change", () => syncDate("stlStart", "stlStart"));
  $("stlEnd").addEventListener("change", () => syncDate("stlEnd", "stlEnd"));

  $("stlFillCap").addEventListener("click", fillCap);
  $("stlFillActual").addEventListener("click", fillActual);
  $("stlClearIssued").addEventListener("click", clearIssued);
  $("stlGoToB").addEventListener("click", () => {
    document.getElementById("panel-settlement").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => {
      $("stlTableB").scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  });
  $("stlValidateTransfers").addEventListener("click", validateStlTransfers);
  $("stlExportDraft").addEventListener("click", () => { try { buildSettlementXlsx("settlement", true); toast("✓ 核算草案已下载"); } catch (e) { toast(e.message, "err"); } });
  $("stlExportFinal").addEventListener("click", () => { try { buildSettlementXlsx("settlement", false); toast("✓ Excel 已下载"); } catch (e) { toast(e.message, "err"); } });
  $("stlExportPublic").addEventListener("click", () => { try { buildSettlementXlsx("settlement_public", false); toast("✓ 公示表已下载"); } catch (e) { toast(e.message, "err"); } });
  $("stlExportSummary").addEventListener("click", () => { try { buildSettlementXlsx("settlement_summary", false); toast("✓ 一览表已下载"); } catch (e) { toast(e.message, "err"); } });

  $("stlUploadBtn").addEventListener("click", () => $("stlUpload").click());
  $("stlUpload").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    $("stlUploadHint").textContent = `已选: ${file.name}`;
    try {
      let names = [], hours = [];
      if (file.name.endsWith(".csv")) {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        const startIdx = /[一-龥]?[姓名]|[Nn]ame/.test(lines[0] || "") ? 1 : 0;
        for (let i = startIdx; i < lines.length; i++) {
          const cols = lines[i].split(/[,\t]/).map(s => s.trim());
          if (cols.length >= 2 && cols[0] && cols[1] !== "") {
            names.push(cols[0]);
            hours.push(Math.floor(parseFloat(cols[1]) || 0));
          }
        }
      } else if (file.name.endsWith(".json")) {
        const text = await file.text();
        const data = JSON.parse(text);
        const list = data.people || data;
        for (const r of list) {
          if (r && r.name) {
            names.push(String(r.name));
            hours.push(Math.floor(parseFloat(r.actual_hours || r.hours) || 0));
          }
        }
      } else if (file.name.endsWith(".xlsx")) {
        // 用 SheetJS 解析 .xlsx
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        if (!aoa.length) { alert("xlsx 文件为空"); return; }
        // 找到"姓名"列和"实际工时"列（不区分大小写 / 中英文）
        let nameCol = 0, hoursCol = 1;
        let headerRow = 0;
        for (let r = 0; r < Math.min(5, aoa.length); r++) {
          const row = aoa[r].map(c => String(c).toLowerCase().trim());
          const nIdx = row.findIndex(c => /[一-鿿]?姓名|name/.test(c));
          const hIdx = row.findIndex(c => /实际|工时|actual/.test(c));
          if (nIdx >= 0) {
            nameCol = nIdx;
            headerRow = r;
            if (hIdx >= 0) hoursCol = hIdx;
            break;
          }
        }
        for (let r = headerRow + 1; r < aoa.length; r++) {
          const row = aoa[r];
          const n = String(row[nameCol] || "").trim();
          if (!n) continue;
          names.push(n);
          const h = parseFloat(row[hoursCol]);
          hours.push(Number.isFinite(h) ? Math.floor(h) : 0);
        }
      } else {
        alert("暂支持 .xlsx / .csv / .json");
        return;
      }
      if (!names.length) { alert("未识别到姓名/工时数据"); return; }
      setStlRows(names.map((n, i) => ({ name: n, actual_hours: hours[i] })));
      toast(`✓ 已从 ${file.name} 导入 ${names.length} 人`);
    } catch (err) {
      alert("解析失败: " + err.message);
    }
  });

  // ============================================================
  // Init
  // ============================================================
  applyScenario("35");
  applyStlScenario("35");
  $("stlCapLabel").textContent = $("stlCapB").value;
  updateSchedRealtime();
})();
