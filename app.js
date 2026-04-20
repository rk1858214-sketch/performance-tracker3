if (!requireAuth()) {}

const REQUIRED_HEADERS = {
  date: ["التاريخ"],
  orderNo: ["رقم الاوردر"],
  employee: ["اسم المحضر"],
  rider: ["اسم الطيار"],
  processMinutes: ["مدة معالجة الطلب"],
  prepMinutes: ["مدة التحضير"],
  deliveryMinutes: ["مدة التوصيل"],
  completeDeliveryMinutes: ["مدة اكمال عملية التوصيل"],
  targetTime: ["الوقت المستهدف"],
  deliveryStatus: ["حالة التوصيل"],
  prepByMinutes: ["التحضير بالدقائق"],
  deliveryByMinutes: ["التوصيل بالدقائق"],
  notes: ["ملاحظات"]
};

const DONUT_COLORS = ["#ec4899", "#f472b6", "#fb7185", "#f59e0b", "#8b5cf6", "#14b8a6"];
const currentUser = getCurrentUser();
const branchConfigs = window.APP_CONFIG?.branches || [];

let allRows = [];
let filteredRows = [];
let branchStatuses = branchConfigs.map(item => ({
  name: item.name,
  status: "بانتظار المزامنة",
  rows: 0,
  error: "",
  url: item.url
}));

function safeText(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function average(arr) {
  return arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 0;
}

function scoreFromOrdersAndAverage(orders, avg) {
  return (!orders || !avg) ? 0 : +(orders / avg).toFixed(3);
}

function setLoading(show, text = "جارٍ تحميل البيانات...") {
  const overlay = document.getElementById("loadingOverlay");
  document.getElementById("loadingText").textContent = text;
  overlay.classList.toggle("hidden", !show);
}

function setError(msg) {
  const box = document.getElementById("errorBox");
  box.textContent = msg || "";
  box.classList.toggle("hidden", !msg);
}

function showSection(id) {
  document.querySelectorAll(".section").forEach(s => s.classList.toggle("active", s.id === id));
  document.querySelectorAll(".menu-btn").forEach(b => b.classList.toggle("active", b.dataset.section === id));
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[m]));
}

function parseExcelTime(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return +(v < 1 ? v * 1440 : v).toFixed(1);

  const text = safeText(v);
  if (!text) return 0;

  const direct = Number(text);
  if (!Number.isNaN(direct)) return +(direct < 1 ? direct * 1440 : direct).toFixed(1);

  const parts = text.split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 2) return +(parts[0] * 60 + parts[1]).toFixed(1);
  if (parts.length === 3) return +(parts[0] * 60 + parts[1] + parts[2] / 60).toFixed(1);

  return 0;
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result.map(v => safeText(v.replace(/^\uFEFF/, "")));
}

function parseCsv(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .filter(line => safeText(line) !== "");

  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line);
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = cols[index] ?? "";
    });
    return obj;
  });
}

function normalizeDate(value) {
  const text = safeText(value);
  if (!text) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) {
    const [d, m, y] = text.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(text)) {
    const [d, m, y] = text.split("-");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const asNumber = Number(text);
  if (!Number.isNaN(asNumber) && asNumber > 20000 && asNumber < 60000) {
    const base = new Date(Date.UTC(1899, 11, 30));
    base.setUTCDate(base.getUTCDate() + asNumber);
    return base.toISOString().slice(0, 10);
  }

  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);

  return text;
}

function normalizeDateValue(value) {
  const normalized = normalizeDate(value);
  if (!normalized) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [y, m, d] = normalized.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  return null;
}

function formatDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildNormalizedRows(rawRows, branchName) {
  return rawRows.map((row, index) => ({
    id: `${branchName}-${index}-${safeText(row["رقم الاوردر"])}`,
    branch: branchName,
    date: normalizeDate(row["التاريخ"]),
    orderNo: safeText(row["رقم الاوردر"]),
    employee: safeText(row["اسم المحضر"]),
    rider: safeText(row["اسم الطيار"]),
    processMinutes: parseExcelTime(row["مدة معالجة الطلب"]),
    prepMinutes: parseExcelTime(row["مدة التحضير"]),
    deliveryMinutes: parseExcelTime(row["مدة التوصيل"]),
    completeDeliveryMinutes: parseExcelTime(row["مدة اكمال عملية التوصيل"]),
    targetTime: safeText(row["الوقت المستهدف"]),
    deliveryStatus: safeText(row["حالة التوصيل"]),
    prepByMinutes: parseExcelTime(row["التحضير بالدقائق"]),
    deliveryByMinutes: parseExcelTime(row["التوصيل بالدقائق"]),
    notes: safeText(row["ملاحظات"])
  })).filter(item => item.orderNo || item.employee || item.rider);
}

function summarizeBy(rows, key, metric) {
  const map = new Map();

  rows.forEach(row => {
    const name = safeText(row[key]);
    const value = Number(row[metric] || 0);
    if (!name || value <= 0) return;

    if (!map.has(name)) {
      map.set(name, { name, orders: 0, total: 0 });
    }

    const item = map.get(name);
    item.orders += 1;
    item.total += value;
  });

  return Array.from(map.values()).map(item => {
    const avg = +(item.total / item.orders).toFixed(1);
    return {
      name: item.name,
      orders: item.orders,
      average: avg,
      score: scoreFromOrdersAndAverage(item.orders, avg)
    };
  }).sort((a, b) => b.score - a.score || a.average - b.average);
}

function summarizeBranches(rows) {
  const map = new Map();

  rows.forEach(row => {
    const name = safeText(row.branch);
    if (!name) return;

    if (!map.has(name)) {
      map.set(name, { name, orders: 0, process: [], prep: [], delivery: [] });
    }

    const item = map.get(name);
    item.orders += 1;
    if (row.processMinutes > 0) item.process.push(row.processMinutes);
    if (row.prepMinutes > 0) item.prep.push(row.prepMinutes);
    if (row.deliveryMinutes > 0) item.delivery.push(row.deliveryMinutes);
  });

  return Array.from(map.values()).map(item => ({
    name: item.name,
    orders: item.orders,
    avgProcess: average(item.process),
    avgPrep: average(item.prep),
    avgDelivery: average(item.delivery)
  })).sort((a, b) => a.avgPrep - b.avgPrep);
}

function renderTable(id, headers, rows, empty = "لا توجد بيانات") {
  const table = document.getElementById(id);
  table.innerHTML = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${
    rows.length
      ? rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${headers.length}" style="text-align:center;color:#6b7280">${empty}</td></tr>`
  }</tbody>`;
}

function createDonutData(items) {
  const top = items.slice(0, 5);
  const total = top.reduce((sum, item) => sum + (item.orders || 0), 0) || 1;
  let start = 0;

  return top.map((item, index) => {
    const value = ((item.orders || 0) / total) * 100;
    const result = {
      ...item,
      color: DONUT_COLORS[index % DONUT_COLORS.length],
      start,
      end: start + value
    };
    start += value;
    return result;
  });
}

function renderDonut(chartId, legendId, items) {
  const chart = document.getElementById(chartId);
  const legend = document.getElementById(legendId);

  if (!items.length) {
    chart.style.background = "conic-gradient(#fbcfe8 0 100%)";
    legend.innerHTML = '<div style="color:#6b7280">لا توجد بيانات</div>';
    return;
  }

  chart.style.background = `conic-gradient(${items.map(item => `${item.color} ${item.start}% ${item.end}%`).join(",")})`;
  legend.innerHTML = items.map(item => `
    <div class="legend-item">
      <div class="legend-left">
        <span class="legend-dot" style="background:${item.color}"></span>
        <span class="legend-label">${escapeHtml(item.name)}</span>
      </div>
      <strong>${item.orders}</strong>
    </div>
  `).join("");
}

function populateFilters() {
  const fillSelect = (id, values) => {
    const select = document.getElementById(id);
    const current = select.value;

    select.innerHTML = `<option value="">الكل</option>${values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}`;

    if (values.includes(current)) {
      select.value = current;
    }
  };

  fillSelect("filterBranch", [...new Set(allRows.map(r => r.branch).filter(Boolean))]);
  fillSelect("filterEmployee", [...new Set(allRows.map(r => r.employee).filter(Boolean))].sort());
  fillSelect("filterRider", [...new Set(allRows.map(r => r.rider).filter(Boolean))].sort());
}

function applyFilters() {
  const dateFrom = document.getElementById("dateFrom")?.value || "";
  const dateTo = document.getElementById("dateTo")?.value || "";
  const branch = document.getElementById("filterBranch")?.value || "";
  const employee = document.getElementById("filterEmployee")?.value || "";
  const rider = document.getElementById("filterRider")?.value || "";

  const fromDate = dateFrom ? normalizeDateValue(dateFrom) : null;
  const toDate = dateTo ? normalizeDateValue(dateTo) : null;

  filteredRows = allRows.filter(row => {
    const rowDate = normalizeDateValue(row.date);
    if (!rowDate) return false;

    const matchFrom = !fromDate || rowDate >= fromDate;
    const matchTo = !toDate || rowDate <= toDate;
    const matchBranch = !branch || row.branch === branch;
    const matchEmployee = !employee || row.employee === employee;
    const matchRider = !rider || row.rider === rider;

    return matchFrom && matchTo && matchBranch && matchEmployee && matchRider;
  });

  updateDashboard();
}

function clearFilters() {
  const dateFromEl = document.getElementById("dateFrom");
  const dateToEl = document.getElementById("dateTo");
  const branchEl = document.getElementById("filterBranch");
  const employeeEl = document.getElementById("filterEmployee");
  const riderEl = document.getElementById("filterRider");

  if (dateFromEl) dateFromEl.value = "";
  if (dateToEl) dateToEl.value = "";
  if (branchEl) branchEl.value = "";
  if (employeeEl) employeeEl.value = "";
  if (riderEl) riderEl.value = "";

  filteredRows = [...allRows];
  updateDashboard();
}

function resetFilters() {
  clearFilters();
}

function setLastDaysFilter(days) {
  const validDates = allRows
    .map(row => normalizeDateValue(row.date))
    .filter(date => date instanceof Date && !Number.isNaN(date.getTime()));

  if (!validDates.length) return;

  validDates.sort((a, b) => a - b);
  const maxDate = validDates[validDates.length - 1];

  const fromDate = new Date(maxDate);
  fromDate.setDate(fromDate.getDate() - (days - 1));

  const dateFromEl = document.getElementById("dateFrom");
  const dateToEl = document.getElementById("dateTo");

  if (dateFromEl) dateFromEl.value = formatDateInputValue(fromDate);
  if (dateToEl) dateToEl.value = formatDateInputValue(maxDate);

  applyFilters();
}

function generateInsights(rows, branches, employees, riders) {
  const insights = [];
  if (!rows.length) return ["لم يتم تحميل أي صفوف. راجع الروابط أو صلاحيات مشاركة الشيتات."];

  const avgPrep = average(rows.map(r => r.prepMinutes).filter(v => v > 0));
  const avgDelivery = average(rows.map(r => r.deliveryMinutes).filter(v => v > 0));
  const slowBranches = branches.filter(branch => branch.avgPrep > avgPrep && avgPrep > 0).map(branch => branch.name);

  if (slowBranches.length) insights.push(`⚠️ الفروع الأبطأ من المتوسط في التحضير: ${slowBranches.join("، ")}`);

  const delayedOrders = rows.filter(r => /متاخر|متأخر/i.test(r.deliveryStatus)).length;
  if (delayedOrders) insights.push(`🚨 يوجد ${delayedOrders} أوردر بحالة توصيل متأخرة.`);
  if (avgDelivery > 30) insights.push("📦 متوسط التوصيل أعلى من 30 دقيقة، راجع خطوط السير والضغط التشغيلي.");
  if (employees[0]) insights.push(`🏆 أفضل محضر حاليًا: ${employees[0].name} بدرجة ${employees[0].score}.`);
  if (riders[0]) insights.push(`🛵 أفضل طيار حاليًا: ${riders[0].name} بدرجة ${riders[0].score}.`);

  return insights;
}

function renderInsights(list) {
  const box = document.getElementById("insightsBox");
  box.innerHTML = list.map(item => `<div class="insight-card">${escapeHtml(item)}</div>`).join("");
}

function compareLatestTwoDays(rows) {
  const days = [...new Set(rows.map(r => r.date).filter(Boolean))].sort();
  if (days.length < 2) return "البيانات المتاحة لا تكفي للمقارنة بين يومين.";

  const yesterday = days[days.length - 2];
  const today = days[days.length - 1];

  const todayRows = rows.filter(r => r.date === today);
  const yesterdayRows = rows.filter(r => r.date === yesterday);

  const todayPrep = average(todayRows.map(r => r.prepMinutes).filter(v => v > 0));
  const yesterdayPrep = average(yesterdayRows.map(r => r.prepMinutes).filter(v => v > 0));

  const delta = +(todayPrep - yesterdayPrep).toFixed(1);
  const dir = delta > 0 ? "أعلى" : delta < 0 ? "أقل" : "مساوٍ";

  return `${today}: ${todayPrep} د | ${yesterday}: ${yesterdayPrep} د | الفرق ${Math.abs(delta)} د (${dir})`;
}

function renderTrends(rows) {
  const map = new Map();

  rows.forEach(row => {
    if (!row.employee || !row.date || row.prepMinutes <= 0) return;

    if (!map.has(row.employee)) {
      map.set(row.employee, { name: row.employee, dates: new Set(), orders: 0, total: 0 });
    }

    const item = map.get(row.employee);
    item.dates.add(row.date);
    item.orders += 1;
    item.total += row.prepMinutes;
  });

  const top = Array.from(map.values()).map(item => {
    const avg = +(item.total / item.orders).toFixed(1);
    return {
      name: item.name,
      days: item.dates.size,
      orders: item.orders,
      avg,
      score: scoreFromOrdersAndAverage(item.orders, avg)
    };
  }).sort((a, b) => b.score - a.score).slice(0, 5);

  document.getElementById("trendList").innerHTML = top.length
    ? top.map((item, index) => `<div class="trend-item"><span>#${index + 1} ${escapeHtml(item.name)}</span><strong>${item.orders} أوردر | ${item.avg} د | ${item.score}</strong></div>`).join("")
    : '<div class="muted-note">لا توجد بيانات كافية.</div>';
}

function renderBranchStatus() {
  const grid = document.getElementById("branchStatusGrid");
  grid.innerHTML = branchStatuses.map(item => `
    <div class="source-card">
      <div class="source-card-top">
        <strong>${escapeHtml(item.name)}</strong>
        <span class="status ${item.error ? "error" : item.rows ? "done" : "ready"}">${escapeHtml(item.status)}</span>
      </div>
      <div class="source-meta">${item.rows} صف</div>
      ${item.error ? `<div class="source-error">${escapeHtml(item.error)}</div>` : `<div class="source-url">${escapeHtml(item.url)}</div>`}
    </div>
  `).join("");

  document.getElementById("connectedBranches").textContent = branchStatuses.filter(item => item.rows > 0).length;
}

function applyRoleUI() {
  document.getElementById("currentUserLabel").textContent = currentUser?.username || "—";
  document.getElementById("currentUserSide").textContent = currentUser?.username || "—";
  document.getElementById("currentRoleSide").textContent = currentUser?.role || "—";
  document.getElementById("roleHint").textContent = currentUser?.role === "admin"
    ? "admin يملك صلاحية كاملة للتصدير والمزامنة والإعدادات."
    : "viewer مخصص للعرض والتحليل فقط.";
}

function updateDashboard() {
  const rows = filteredRows;

  const employees = summarizeBy(rows, "employee", "prepMinutes");
  const riders = summarizeBy(rows, "rider", "deliveryMinutes");
  const branches = summarizeBranches(rows);

  const totalOrders = rows.length;
  const avgPrep = average(rows.map(r => r.prepMinutes).filter(v => v > 0));
  const avgDelivery = average(rows.map(r => r.deliveryMinutes).filter(v => v > 0));
  const avgProcess = average(rows.map(r => r.processMinutes).filter(v => v > 0));

  document.getElementById("totalOrders").textContent = totalOrders;
  document.getElementById("avgPrep").textContent = `${avgPrep} د`;
  document.getElementById("avgDelivery").textContent = `${avgDelivery} د`;
  document.getElementById("avgProcess").textContent = `${avgProcess} د`;
  document.getElementById("totalRowsSide").textContent = allRows.length;
  document.getElementById("lastSync").textContent = new Date().toLocaleString("ar-EG");

  const bestEmployee = employees[0];
  const bestRider = riders[0];
  const bestBranch = branches[0];

  document.getElementById("bestEmployee").textContent = bestEmployee?.name || "—";
  document.getElementById("bestEmployeeMetric").textContent = bestEmployee
    ? `Score ${bestEmployee.score} | ${bestEmployee.orders} أوردر | ${bestEmployee.average} د`
    : "لا توجد بيانات";

  document.getElementById("bestRider").textContent = bestRider?.name || "—";
  document.getElementById("bestRiderMetric").textContent = bestRider
    ? `Score ${bestRider.score} | ${bestRider.orders} أوردر | ${bestRider.average} د`
    : "لا توجد بيانات";

  document.getElementById("bestBranch").textContent = bestBranch?.name || "—";
  document.getElementById("bestBranchMetric").textContent = bestBranch
    ? `${bestBranch.avgPrep} دقيقة متوسط التحضير`
    : "لا توجد بيانات";

  document.getElementById("bestEmployeeSide").textContent = bestEmployee?.name || "—";
  document.getElementById("bestRiderSide").textContent = bestRider?.name || "—";
  document.getElementById("bestBranchSide").textContent = bestBranch?.name || "—";

  renderInsights(generateInsights(rows, branches, employees, riders));
  renderDonut("employeeDonut", "employeeLegend", createDonutData(employees));
  renderDonut("riderDonut", "riderLegend", createDonutData(riders));
  renderDonut("branchDonut", "branchLegend", createDonutData(branches));

  renderTable(
    "employeesTable",
    ["اسم المحضر", "عدد الأوردرات", "متوسط التحضير", "Score"],
    employees.map(x => [escapeHtml(x.name), x.orders, `${x.average} دقيقة`, x.score])
  );

  renderTable(
    "ridersTable",
    ["اسم الطيار", "عدد الأوردرات", "متوسط التوصيل", "Score"],
    riders.map(x => [escapeHtml(x.name), x.orders, `${x.average} دقيقة`, x.score])
  );

  renderTable(
    "branchesTable",
    ["الفرع", "عدد الأوردرات", "متوسط المعالجة", "متوسط التحضير", "متوسط التوصيل"],
    branches.map(x => [escapeHtml(x.name), x.orders, `${x.avgProcess} د`, `${x.avgPrep} د`, `${x.avgDelivery} د`])
  );

  document.getElementById("compareDaysBox").textContent = compareLatestTwoDays(rows);
  renderTrends(rows);
}

async function fetchBranchData(branch) {
  const result = {
    name: branch.name,
    url: branch.url,
    status: "تم التحميل",
    rows: 0,
    error: ""
  };

  try {
    const response = await fetch(branch.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    const rawRows = parseCsv(text);
    if (!rawRows.length) throw new Error("الشيت فارغ");

    const normalized = buildNormalizedRows(rawRows, branch.name);
    result.rows = normalized.length;
    result.status = normalized.length ? "تم التحميل" : "لا توجد صفوف";

    return { result, rows: normalized };
  } catch (error) {
    result.status = "فشل التحميل";
    result.error = error?.message || "Failed to fetch";
    return { result, rows: [] };
  }
}

async function syncData() {
  setLoading(true, "جارٍ مزامنة البيانات من Google Sheets...");
  setError("");

  const combined = [];
  const statuses = [];

  for (const branch of branchConfigs) {
    const { result, rows } = await fetchBranchData(branch);
    statuses.push(result);
    combined.push(...rows);
  }

  branchStatuses = statuses;
  renderBranchStatus();
  allRows = combined;
  populateFilters();
  filteredRows = [...allRows];
  updateDashboard();

  if (!allRows.length) {
    setError("لم يتم تحميل أي صفوف. راجع الروابط أو صلاحيات مشاركة الشيتات.");
  } else if (statuses.some(item => item.error)) {
    setError("تم تحميل بعض الفروع، لكن توجد فروع بها مشكلة في الرابط أو الصلاحيات.");
  }

  setLoading(false);
}

function exportExcelReport() {
  if (!allRows.length) {
    setError("لا توجد بيانات للتصدير");
    return;
  }

  const exportRows = filteredRows.map(row => ({
    الفرع: row.branch,
    التاريخ: row.date,
    رقم_الاوردر: row.orderNo,
    اسم_المحضر: row.employee,
    اسم_الطيار: row.rider,
    مدة_المعالجة: row.processMinutes,
    مدة_التحضير: row.prepMinutes,
    مدة_التوصيل: row.deliveryMinutes,
    مدة_اكمال_التوصيل: row.completeDeliveryMinutes,
    الوقت_المستهدف: row.targetTime,
    حالة_التوصيل: row.deliveryStatus,
    ملاحظات: row.notes
  }));

  const ws = XLSX.utils.json_to_sheet(exportRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, "performance-tracker-report.xlsx");
}

function exportPDFReport() {
  window.print();
}

function initDarkMode() {
  const applyMode = isDark => document.body.classList.toggle("dark", isDark);
  const stored = localStorage.getItem("performanceTrackerDarkMode") === "true";

  applyMode(stored);

  document.getElementById("darkModeBtn").addEventListener("click", () => {
    const next = !document.body.classList.contains("dark");
    applyMode(next);
    localStorage.setItem("performanceTrackerDarkMode", String(next));
  });
}

document.querySelectorAll(".menu-btn").forEach(btn => {
  btn.addEventListener("click", () => showSection(btn.dataset.section));
});

initDarkMode();
applyRoleUI();
syncData();

window.applyFilters = applyFilters;
window.resetFilters = resetFilters;
window.clearFilters = clearFilters;
window.setLastDaysFilter = setLastDaysFilter;
window.syncData = syncData;
window.exportExcelReport = exportExcelReport;
window.exportPDFReport = exportPDFReport;