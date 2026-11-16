import { verifiedAccessEmail } from "./access";

export interface Env { DB: D1Database; ACCESS_TEAM_DOMAIN?: string; ACCESS_POLICY_AUD?: string; AUTH_DISABLED?: string }

type Category = { id: number; name: string; monthly_budget_cents: number; sort_order: number; spent_cents?: number };
type Expense = { id: number; date: string; item: string; amount_cents: number; notes?: string; created_by: string; category: string; long_term_budget_id?: number | null; long_term_fund?: string | null };
type LongTermBudget = { id: number; name: string; amount_cents: number; expires_on: string | null; is_archived: number; spent_cents?: number };

const esc = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const money = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const redirect = (location: string) => new Response(null, { status: 303, headers: { location } });
const today = () => new Date().toISOString().slice(0, 10);
const twelveMonthsAgo = () => { const date = new Date(); date.setUTCFullYear(date.getUTCFullYear() - 1); return date.toISOString().slice(0, 10); };
const byline = (category: string, createdBy: string) => createdBy ? `${esc(category)} · ${esc(createdBy)}` : esc(category);
const localDateScript = `<script>
if (!window.__kodaLocalDateBound) {
  window.__kodaLocalDateBound = true;
  const setLocalDateDefaults = () => {
    document.querySelectorAll('input[data-default-local-date="true"]').forEach((input) => {
      if (input.value) return;
      const now = new Date();
      input.value = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
    });
  };
  setLocalDateDefaults();
  document.addEventListener("htmx:afterSwap", setLocalDateDefaults);
}
</script>`;

function month(value: string | null) {
  const selected = value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : today().slice(0, 7);
  const [year, number] = selected.split("-").map(Number);
  const at = new Date(Date.UTC(year, number - 1, 1));
  const prior = new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
  return { selected, prior, next, start: `${selected}-01`, end: `${next}-01`, label: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(at) };
}

function status(spent: number, budget: number) {
  const percentage = budget === 0 ? (spent ? 100 : 0) : Math.round(spent / budget * 100);
  if (spent > budget) return ["Over budget", "purple", percentage, 100] as const;
  if (percentage >= 90) return ["At limit", "red", percentage, percentage] as const;
  if (percentage >= 70) return ["Watch", "amber", percentage, percentage] as const;
  return ["On track", "green", percentage, percentage] as const;
}

const categoryOrderScript = `<script>
document.addEventListener("DOMContentLoaded", () => {
  const saveOrder = async (container) => {
    const order = Array.from(container.querySelectorAll("[data-category-id]")).map((item) => item.dataset.categoryId).join(",");
    const response = await fetch("/categories/order", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "order=" + encodeURIComponent(order) });
    if (!response.ok) window.location.reload();
  };
  document.querySelectorAll("[data-sortable-categories]").forEach((container) => {
    let dragged;
    container.querySelectorAll("[data-category-id]").forEach((item) => {
      item.addEventListener("dragstart", () => { dragged = item; item.classList.add("dragging"); });
      item.addEventListener("dragend", async () => { item.classList.remove("dragging"); if (dragged) await saveOrder(container); dragged = undefined; });
    });
    container.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (!dragged) return;
      const target = event.target.closest("[data-category-id]");
      if (!target || target === dragged) return;
      const rect = target.getBoundingClientRect();
      container.insertBefore(dragged, event.clientY < rect.top + rect.height / 2 ? target : target.nextSibling);
    });
  });
  document.querySelectorAll("[data-move-category]").forEach((button) => button.addEventListener("click", async () => {
    const item = button.closest("[data-category-id]");
    const container = item.parentElement;
    const previous = item.previousElementSibling;
    const next = item.nextElementSibling;
    if (button.dataset.moveCategory === "up" && previous) container.insertBefore(item, previous);
    if (button.dataset.moveCategory === "down" && next) container.insertBefore(next, item);
    await saveOrder(container);
  }));
  document.querySelectorAll("[data-delete-category]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete this category? Categories with expenses cannot be deleted.")) return;
    const response = await fetch("/categories/" + button.dataset.deleteCategory + "/delete", { method: "POST" });
    window.location.assign(new URL(response.url).pathname + new URL(response.url).search);
  }));
});
</script>`;

const themeScript = `<script>
if (!window.__kodaThemeBound) {
  window.__kodaThemeBound = true;
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button, .primary-button, .secondary-button, .icon-button");
    if (button && !button.matches(":disabled")) {
      button.classList.remove("is-clicked");
      void button.offsetWidth;
      button.classList.add("is-clicked");
      window.setTimeout(() => button.classList.remove("is-clicked"), 550);
    }
    const addExpense = event.target.closest(".header-action");
    if (addExpense instanceof HTMLAnchorElement) {
      event.preventDefault();
      if (addExpense.dataset.opening) return;
      addExpense.dataset.opening = "true";
      addExpense.classList.add("is-submitting");
      const label = addExpense.querySelector("span");
      if (label) label.textContent = "Opening…";
      window.setTimeout(() => window.location.assign(addExpense.href), 350);
      return;
    }
    if (!event.target.closest("#theme-toggle")) return;
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("koda-theme", next); } catch (e) {}
  });
  document.addEventListener("submit", (event) => {
    const button = event instanceof SubmitEvent ? event.submitter : null;
    if (!(button instanceof HTMLButtonElement) || !button.classList.contains("primary-button")) return;
    button.classList.add("is-submitting");
    button.disabled = true;
    button.dataset.originalLabel = button.innerHTML;
    button.textContent = "Saving…";
  });
}
</script>`;

function page(title: string, active: string, body: string, code = 200) {
  const nav = (path: string, label: string, key: string) => `<a href="${path}" class="nav-link ${active === key ? "active" : ""}">${label}</a>`;
  const mobile = (path: string, label: string, key: string) => `<a href="${path}" class="mobile-nav-link ${active === key ? "active" : ""}">${label}</a>`;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0f766e"><script>(function(){try{var t=localStorage.getItem('koda-theme')||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;}catch(e){}})();</script><title>${esc(title)} | KODA</title><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/category-order.css"><script src="/htmx.min.js" defer></script><script src="/lucide.min.js" defer></script><script>document.addEventListener("DOMContentLoaded",()=>lucide.createIcons());document.addEventListener("htmx:afterSwap",()=>lucide.createIcons());</script></head><body hx-boost="true" hx-indicator="#page-loader"><div id="page-loader" class="page-loader htmx-indicator"></div><header class="site-header"><div class="shell header-inner"><a class="brand" href="/">Family Koda Control<span class="brand-version">v2.0</span></a><nav class="desktop-nav">${nav("/", "Dashboard", "dashboard")}${nav("/expenses", "Expenses", "expenses")}${nav("/budgets", "Budgets", "budgets")}</nav><button type="button" class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode" title="Toggle dark mode"><svg class="theme-icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg><svg class="theme-icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button><a href="/expenses" class="primary-button header-action" hx-boost="false"><i data-lucide="plus"></i><span>Add expense</span></a></div></header><main class="shell main-content">${body}</main><nav class="mobile-nav">${mobile("/", "Dashboard", "dashboard")}${mobile("/expenses", "Expenses", "expenses")}${mobile("/budgets", "Budgets", "budgets")}</nav>${categoryOrderScript}${themeScript}${localDateScript}</body></html>`, { status: code, headers: { "content-type": "text/html; charset=UTF-8" } });
}

async function query<T>(statement: D1PreparedStatement) { return (await statement.run<T>()).results; }
async function categories(db: D1Database) { return query<Category>(db.prepare("SELECT id, name, monthly_budget_cents, sort_order FROM category ORDER BY sort_order, name COLLATE NOCASE")); }
async function longTermBudgets(db: D1Database) { return query<LongTermBudget>(db.prepare("SELECT b.id, b.name, b.amount_cents, b.expires_on, b.is_archived, COALESCE(SUM(e.amount_cents), 0) AS spent_cents FROM long_term_budget b LEFT JOIN expense e ON e.long_term_budget_id=b.id GROUP BY b.id ORDER BY b.expires_on IS NULL DESC, b.expires_on, b.name COLLATE NOCASE")); }
function cents(value: string, zero = false) { const input = value.trim(); if (!/^\d+(?:\.\d{1,2})?$/.test(input)) return null; const [dollars, decimal = ""] = input.split("."); const result = Number(dollars) * 100 + Number((decimal + "00").slice(0, 2)); return result > 0 || (zero && result === 0) ? result : null; }
function validDate(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(`${value}T00:00:00Z`); return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value; }
function orderControls(includeDelete = false, categoryId?: number) { return `<div class="category-order-actions"><button type="button" class="category-order-button" data-move-category="up" title="Move category up" aria-label="Move category up"><i data-lucide="chevron-up"></i></button><button type="button" class="category-order-button" data-move-category="down" title="Move category down" aria-label="Move category down"><i data-lucide="chevron-down"></i></button>${includeDelete ? `<button type="button" class="category-order-button category-delete-button" data-delete-category="${categoryId}" title="Delete category" aria-label="Delete category"><i data-lucide="trash-2"></i></button>` : ""}</div>`; }

async function dashboard(db: D1Database, url: URL) {
  const range = month(url.searchParams.get("month"));
  const [household, categoryRows, recent, fundRows] = await Promise.all([
    db.prepare("SELECT name FROM household WHERE id = 1").first<{ name: string }>(),
    query<Category>(db.prepare("SELECT c.id, c.name, c.monthly_budget_cents, c.sort_order, COALESCE(SUM(e.amount_cents), 0) AS spent_cents FROM category c LEFT JOIN expense e ON e.category_id=c.id AND e.long_term_budget_id IS NULL AND e.date>=? AND e.date<? GROUP BY c.id ORDER BY c.sort_order, c.name COLLATE NOCASE").bind(range.start, range.end)),
    query<Expense>(db.prepare("SELECT e.id,e.date,e.item,e.amount_cents,e.created_by,c.name AS category,c.id AS category_id FROM expense e JOIN category c ON c.id=e.category_id WHERE e.date>=? AND e.date<? ORDER BY e.date DESC,e.id DESC LIMIT 6").bind(range.start, range.end)),
    longTermBudgets(db),
  ]);
  const rows = categoryRows.map((row) => ({ ...row, spent: Number(row.spent_cents ?? 0) }));
  const totalBudget = rows.reduce((sum, row) => sum + Number(row.monthly_budget_cents), 0);
  const totalSpent = rows.reduce((sum, row) => sum + row.spent, 0);
  const remaining = totalBudget - totalSpent;
  const cards = rows.map((row) => { const [label, color, percentage, width] = status(row.spent, row.monthly_budget_cents); return `<article class="category-card sortable-category status-${color}" draggable="true" data-category-id="${row.id}"><div class="category-topline"><div><h3><a class="category-link" href="/expenses?month=${range.selected}&category=${row.id}">${esc(row.name)}</a></h3><span class="status-label">${label}</span></div><div class="category-topline-actions"><strong>${percentage}%</strong>${orderControls()}</div></div><div class="progress-track"><span style="width:${width}%"></span></div><div class="category-numbers"><span><b>${money(row.spent)}</b> spent of ${money(row.monthly_budget_cents)}</span><span class="remaining ${row.monthly_budget_cents - row.spent < 0 ? "over" : ""}">${money(row.monthly_budget_cents - row.spent)} left</span></div></article>`; }).join("");
  const longTermCards = fundRows.filter((fund) => !fund.is_archived).map((fund) => { const spent = Number(fund.spent_cents ?? 0); const [label, color, percentage, width] = status(spent, Number(fund.amount_cents)); const expired = Boolean(fund.expires_on && fund.expires_on < today()); const expiry = expired ? `Expired ${fund.expires_on}` : fund.expires_on ? `Available until ${fund.expires_on}` : "No expiration"; return `<article class="category-card status-${color}"><div class="category-topline"><div><h3><a class="category-link" href="/expenses?long_term_budget=${fund.id}">${esc(fund.name)}</a></h3><span class="status-label">${expired ? "Expired" : label}</span></div><strong>${percentage}%</strong></div><div class="progress-track"><span style="width:${width}%"></span></div><div class="category-numbers"><span><b>${money(spent)}</b> used of ${money(Number(fund.amount_cents))}</span><span class="remaining ${Number(fund.amount_cents) - spent < 0 ? "over" : ""}">${money(Number(fund.amount_cents) - spent)} left</span></div><p class="field-hint">${esc(expiry)}</p></article>`; }).join("");
  const recentRows = recent.length ? `<div class="expense-list">${recent.map((row) => `<div class="expense-row"><div class="expense-avatar">${esc(row.item[0]?.toUpperCase())}</div><div class="expense-main"><strong>${esc(row.item)}</strong><span>${byline(row.category, row.created_by)}</span></div><div class="expense-amount"><strong>${money(Number(row.amount_cents))}</strong><span>${esc(row.date)}</span></div></div>`).join("")}</div>` : `<div class="empty-state"><h3>No expenses this month</h3><p>Add the first purchase to start tracking ${esc(range.label)}.</p><a href="/expenses" class="primary-button">Add expense</a></div>`;
  return page("Dashboard", "dashboard", `<section class="page-heading dashboard-heading"><div><p class="eyebrow">${esc(household?.name ?? "Our Household")}</p><h1>${esc(range.label)}</h1><p class="subheading">A clear view of this month's household spending.</p></div><div class="month-switcher"><a href="/?month=${range.prior}" class="icon-button"><i data-lucide="chevron-left"></i></a><form method="get"><input type="month" name="month" value="${range.selected}" onchange="this.form.requestSubmit()"></form><a href="/?month=${range.next}" class="icon-button"><i data-lucide="chevron-right"></i></a></div></section><p class="dashboard-totals"><strong>Budget:</strong> ${money(totalBudget)} · <strong>Spent:</strong> ${money(totalSpent)} · <strong>Remaining:</strong> ${money(remaining)}</p><section class="section-block"><div class="section-heading"><div><h2>Category budgets</h2><p>Drag to arrange your preferred order.</p></div><a href="/budgets" class="text-link">Edit budgets</a></div><div class="category-grid dashboard-categories" data-sortable-categories>${cards}</div></section>${longTermCards ? `<section class="section-block"><div class="section-heading"><div><h2>Long-term funds</h2><p>Bonus-funded spending outside the monthly plan.</p></div><a href="/budgets" class="text-link">Manage funds</a></div><div class="category-grid">${longTermCards}</div></section>` : ""}<section class="section-block recent-section"><div class="section-heading"><div><h2>Recent expenses</h2><p>Latest activity for ${esc(range.label)}.</p></div><a href="/expenses?month=${range.selected}" class="text-link">View all</a></div>${recentRows}</section>`);
}

async function expenses(db: D1Database, url: URL, form: Record<string, string> = {}, errors: Record<string, string> = {}, code = 200) {
  const range = month(url.searchParams.get("month") ?? form.month ?? null); const filter = Number(url.searchParams.get("category")); const categoryId = Number.isInteger(filter) && filter > 0 ? filter : undefined; const longTermFilter = Number(url.searchParams.get("long_term_budget")); const longTermBudgetId = Number.isInteger(longTermFilter) && longTermFilter > 0 ? longTermFilter : undefined; const fundRange = url.searchParams.get("fund_range") === "year" ? "year" : "all"; const [categoryRows, fundRows] = await Promise.all([categories(db), longTermBudgets(db)]);
  const allFundHistory = Boolean(longTermBudgetId && fundRange === "all"); let statement = "SELECT e.id,e.date,e.item,e.amount_cents,e.notes,e.created_by,e.long_term_budget_id,b.name AS long_term_fund,c.name AS category,c.id AS category_id FROM expense e JOIN category c ON c.id=e.category_id LEFT JOIN long_term_budget b ON b.id=e.long_term_budget_id WHERE 1=1"; const parameters: (string | number)[] = []; if (!allFundHistory) { statement += " AND e.date>=? AND e.date<?"; parameters.push(longTermBudgetId && fundRange === "year" ? twelveMonthsAgo() : range.start, range.end); } if (categoryId) { statement += " AND c.id=?"; parameters.push(categoryId); } if (longTermBudgetId) { statement += " AND e.long_term_budget_id=?"; parameters.push(longTermBudgetId); }
  const rows = await query<Expense>(db.prepare(statement + " ORDER BY e.date DESC,e.id DESC").bind(...parameters));
  const editId = Number(url.searchParams.get("edit"));
  const editing = Number.isInteger(editId) ? rows.find((row) => row.id === editId) : undefined;
  if (editing && Object.keys(form).length === 0) form = { expense_date: editing.date, item: editing.item, amount: (Number(editing.amount_cents) / 100).toFixed(2), category_id: String((editing as Expense & { category_id?: number }).category_id ?? categoryId ?? ""), long_term_budget_id: String(editing.long_term_budget_id ?? ""), notes: editing.notes ?? "", month: range.selected };
  if (!editing && !form.category_id && categoryId) form = { ...form, category_id: String(categoryId) };
  const error = (name: string) => errors[name] ? `<p class="field-error">${esc(errors[name])}</p>` : ""; const options = categoryRows.map((row) => `<option value="${row.id}" ${form.category_id === String(row.id) ? "selected" : ""}>${esc(row.name)}</option>`).join(""); const filters = categoryRows.map((row) => `<option value="${row.id}" ${categoryId === row.id ? "selected" : ""}>${esc(row.name)}</option>`).join("");
  const fundOptions = fundRows.filter((fund) => !fund.is_archived && (!fund.expires_on || fund.expires_on >= today() || form.long_term_budget_id === String(fund.id))).map((fund) => `<option value="${fund.id}" ${form.long_term_budget_id === String(fund.id) ? "selected" : ""}>${esc(fund.name)}${fund.expires_on ? ` (ends ${fund.expires_on})` : " (no expiration)"}</option>`).join("");
  const list = rows.length ? `<div class="expense-list full-list">${rows.map((row) => `<div class="expense-row"><div class="expense-avatar">${esc(row.item[0]?.toUpperCase())}</div><div class="expense-main"><strong>${esc(row.item)}</strong><span>${byline(row.category, row.created_by)}${row.notes ? ` · ${esc(row.notes)}` : ""}</span>${row.long_term_fund ? `<span class="long-term-fund-label">${esc(row.long_term_fund)}</span>` : ""}</div><div class="expense-amount"><strong>${money(Number(row.amount_cents))}</strong><span>${esc(row.date)}</span></div><a href="/expenses?month=${range.selected}&edit=${row.id}" class="delete-button" title="Edit expense" aria-label="Edit ${esc(row.item)}"><i data-lucide="pencil"></i></a><form method="post" action="/expenses/${row.id}/delete" hx-confirm="Delete this expense?"><input type="hidden" name="month" value="${range.selected}"><button class="delete-button" aria-label="Delete ${esc(row.item)}"><i data-lucide="trash-2"></i></button></form></div>`).join("")}</div>` : `<div class="empty-state compact"><h3>No matching expenses</h3><p>New purchases will appear here.</p></div>`;
  const total = rows.reduce((sum, row) => sum + Number(row.amount_cents), 0); const saved = url.searchParams.get("saved") === "true" ? '<div class="alert success">Expense saved successfully.</div>' : "";
  const selectedFund = fundRows.find((fund) => fund.id === longTermBudgetId); const historyTitle = selectedFund ? esc(selectedFund.name) : esc(range.label); const historySubtitle = selectedFund ? (fundRange === "all" ? "All activity" : "Last 12 months") : `${rows.length} purchases`; const filterControl = longTermBudgetId ? `<div class="fund-history-ranges"><a class="secondary-button fund-history-range ${fundRange === "all" ? "active" : ""}" href="/expenses?long_term_budget=${longTermBudgetId}">All time</a><a class="secondary-button fund-history-range ${fundRange === "year" ? "active" : ""}" href="/expenses?long_term_budget=${longTermBudgetId}&fund_range=year">Last 12 months</a></div>` : `<form method="get" class="filter-form"><input type="month" name="month" value="${range.selected}"><select name="category" onchange="this.form.requestSubmit()"><option value="">All categories</option>${filters}</select><button class="icon-button"><i data-lucide="list-filter"></i></button></form>`;
  return page("Expenses", "expenses", `<section class="page-heading"><div><p class="eyebrow">Household ledger</p><h1>Expenses</h1><p class="subheading">Record purchases with enough detail to understand where the money went.</p></div></section>${saved}<div class="expense-layout"><section class="form-panel"><div class="panel-heading"><div><h2>Add an expense</h2><p>Only date, purpose, amount, and category are required.</p></div></div><form method="post" action="${editing ? "/expenses/" + editing.id + "/edit" : "/expenses"}" class="stacked-form"><input type="hidden" name="month" value="${range.selected}"><div class="field"><label>Date</label><input type="date" name="expense_date" value="${esc(form.expense_date)}"${editing || form.expense_date ? "" : " data-default-local-date=true"} required>${error("expense_date")}</div><div class="field"><label>What was it for?</label><input type="text" name="item" maxlength="120" value="${esc(form.item)}" placeholder="Kids shoes from Amazon" required><p class="field-hint">Use the purchase purpose, not only the store name.</p>${error("item")}</div><div class="field-grid"><div class="field"><label>Amount</label><div class="money-input"><span>$</span><input type="number" name="amount" min="0.01" step="0.01" value="${esc(form.amount)}" required></div>${error("amount")}</div><div class="field added-by-field"><label>Added by <span>Optional</span></label><select name="created_by"><option value="">No selection</option><option value="Husband" ${form.created_by === "Husband" ? "selected" : ""}>Husband</option><option value="Wife" ${form.created_by === "Wife" ? "selected" : ""}>Wife</option></select></div></div><div class="field"><label>Category</label><select name="category_id" required><option value="">Choose a category</option>${options}</select>${error("category_id")}</div><div class="field"><label>Long-term fund <span>Optional</span></label><select name="long_term_budget_id"><option value="">Use monthly category budget</option>${fundOptions}</select><p class="field-hint">Fund spending is tracked separately from monthly category limits.</p></div><div class="field"><label>Notes <span>Optional</span></label><textarea name="notes" maxlength="500" rows="3">${esc(form.notes)}</textarea>${error("notes")}</div><button class="primary-button full-button" type="submit">${editing ? "Update expense" : "Save expense"}</button>${editing ? `<a class="text-link" href="/expenses?month=${range.selected}">Cancel edit</a>` : ""}</form></section><section class="history-panel"><div class="history-toolbar"><div><h2>${historyTitle}</h2><p>${historySubtitle} · ${money(total)}</p></div>${filterControl}</div>${list}</section></div>`, code);
}

async function saveExpense(request: Request, db: D1Database, verifiedEmail: string) {
  const data = await request.formData(); const form = Object.fromEntries(["expense_date", "item", "amount", "category_id", "long_term_budget_id", "created_by", "notes", "month"].map((key) => [key, String(data.get(key) ?? "").trim()])); const errors: Record<string, string> = {};
  if (form.item.length < 3) errors.item = "Describe what the purchase was for."; else if (form.item.length > 120) errors.item = "Keep the item description under 120 characters."; if (!validDate(form.expense_date)) errors.expense_date = "Choose a valid date."; const amount = cents(form.amount); if (amount === null) errors.amount = "Amount must be greater than zero."; if (form.created_by && !["Husband", "Wife"].includes(form.created_by)) errors.created_by = "Choose a valid household member."; if (form.notes.length > 500) errors.notes = "Keep notes under 500 characters."; const categoryId = Number(form.category_id); if (!(await categories(db)).some((category) => category.id === categoryId)) errors.category_id = "Choose a valid category."; const longTermBudgetId = form.long_term_budget_id ? Number(form.long_term_budget_id) : null; if (form.long_term_budget_id && !(await longTermBudgets(db)).some((fund) => fund.id === longTermBudgetId && !fund.is_archived && (!fund.expires_on || fund.expires_on >= today()))) errors.long_term_budget_id = "Choose an active long-term fund.";
  if (Object.keys(errors).length) return expenses(db, new URL(`/expenses?month=${encodeURIComponent(form.month || today().slice(0, 7))}`, request.url), form, errors, 422);
  const creator = verifiedEmail || form.created_by;
  await db.prepare("INSERT INTO expense (date,item,amount_cents,category_id,long_term_budget_id,notes,created_by,source) VALUES (?,?,?,?,?,?,?,'manual')").bind(form.expense_date, form.item, amount, categoryId, longTermBudgetId, form.notes, creator).run(); return redirect(`/expenses?month=${form.expense_date.slice(0, 7)}&saved=true`);
}

async function updateExpense(request: Request, id: number, db: D1Database) {
  const data = await request.formData();
  const form = Object.fromEntries(["expense_date", "item", "amount", "category_id", "long_term_budget_id", "notes", "month"].map((key) => [key, String(data.get(key) ?? "").trim()]));
  const errors: Record<string, string> = {};
  if (form.item.length < 3) errors.item = "Describe what the purchase was for.";
  else if (form.item.length > 120) errors.item = "Keep the item description under 120 characters.";
  if (!validDate(form.expense_date)) errors.expense_date = "Choose a valid date.";
  const amount = cents(form.amount);
  if (amount === null) errors.amount = "Amount must be greater than zero.";
  if (form.notes.length > 500) errors.notes = "Keep notes under 500 characters.";
  const categoryId = Number(form.category_id);
  if (!(await categories(db)).some((category) => category.id === categoryId)) errors.category_id = "Choose a valid category.";
  const longTermBudgetId = form.long_term_budget_id ? Number(form.long_term_budget_id) : null; if (form.long_term_budget_id && !(await longTermBudgets(db)).some((fund) => fund.id === longTermBudgetId && !fund.is_archived && (!fund.expires_on || fund.expires_on >= today()))) errors.long_term_budget_id = "Choose an active long-term fund.";
  if (Object.keys(errors).length) return expenses(db, new URL("/expenses?month=" + encodeURIComponent(form.month || today().slice(0, 7)) + "&edit=" + id, request.url), form, errors, 422);
  const existing = await db.prepare("SELECT id FROM expense WHERE id=?").bind(id).first();
  if (!existing) return redirect("/expenses?error=Expense+not+found.");
  await db.prepare("UPDATE expense SET date=?, item=?, amount_cents=?, category_id=?, long_term_budget_id=?, notes=? WHERE id=?").bind(form.expense_date, form.item, amount, categoryId, longTermBudgetId, form.notes, id).run();
  return redirect("/expenses?month=" + form.expense_date.slice(0, 7) + "&saved=true");
}

function longTermFundRow(fund: LongTermBudget) { const spent = Number(fund.spent_cents ?? 0); const expiry = fund.expires_on ?? ""; if (fund.is_archived) return `<div class="budget-row"><span>${esc(fund.name)}<small>Archived · ${money(spent)} used</small></span><strong>${money(Number(fund.amount_cents))}</strong><form method="post" action="/long-term-budgets/${fund.id}/unarchive"><button class="secondary-button" type="submit"><i data-lucide="archive-restore"></i>Unarchive</button></form></div>`; return `<form method="post" action="/long-term-budgets/${fund.id}/update" class="budget-row long-term-fund-row"><div class="long-term-fund-details"><div class="budget-name-control"><label for="fund-name-${fund.id}">Fund name</label><input id="fund-name-${fund.id}" type="text" name="name" minlength="2" maxlength="50" value="${esc(fund.name)}" required></div><label class="long-term-field"><span>Amount</span><span class="money-input compact-money"><span>$</span><input type="number" name="amount" min="0.01" step="0.01" value="${(Number(fund.amount_cents) / 100).toFixed(2)}" required></span></label><label class="long-term-field"><span>Expiration date</span><input type="date" name="expires_on" value="${esc(expiry)}"></label></div><div class="long-term-fund-actions"><button class="secondary-button" type="submit"><i data-lucide="save"></i>Save</button><button class="secondary-button" type="submit" formaction="/long-term-budgets/${fund.id}/archive"><i data-lucide="archive"></i>Archive</button><button class="secondary-button fund-delete-button" type="submit" formaction="/long-term-budgets/${fund.id}/delete" hx-confirm="Delete this unused fund?"><i data-lucide="trash-2"></i>Delete</button></div></form>`; }
async function budgets(db: D1Database, url: URL) {
  const rows = await categories(db); const saved = url.searchParams.get("saved") === "true" ? '<div class="alert success">Budget settings saved.</div>' : ""; const error = url.searchParams.get("error");
  const inputs = rows.map((row) => `<div class="budget-row sortable-category" draggable="true" data-category-id="${row.id}"><div class="budget-name-control"><input type="text" name="category_name_${row.id}" minlength="2" maxlength="50" value="${esc(row.name)}" required>${orderControls(true, row.id)}</div><span class="money-input compact-money"><span>$</span><input type="number" name="budget_${row.id}" min="0" step="0.01" value="${(row.monthly_budget_cents / 100).toFixed(2)}" required></span></div>`).join("");
  const fundRows = await longTermBudgets(db); const fundItems = fundRows.length ? fundRows.map(longTermFundRow).join("") : `<div class="empty-state compact"><p>No long-term funds yet.</p></div>`;
  return page("Budget Settings", "budgets", `<section class="page-heading"><div><p class="eyebrow">Monthly plan</p><h1>Budget settings</h1><p class="subheading">Drag categories into your preferred order.</p></div></section>${saved}${error ? `<div class="alert error">${esc(error)}</div>` : ""}<div class="budget-layout"><section class="budget-panel"><div class="panel-heading"><div><h2>Category limits</h2><p>Update budgets, order categories, or remove unused categories.</p></div></div><form method="post" action="/budgets"><div class="budget-rows" data-sortable-categories>${inputs}</div><div class="panel-actions"><button class="primary-button" type="submit">Save budgets</button></div></form></section><aside class="add-category-panel"><div class="panel-heading small-heading"><div><h2>Add category</h2><p>Create another monthly spending bucket.</p></div></div><form method="post" action="/categories" class="stacked-form"><div class="field"><label>Name</label><input type="text" name="name" minlength="2" maxlength="50" placeholder="Groceries" required></div><div class="field"><label>Monthly budget</label><div class="money-input"><span>$</span><input type="number" name="monthly_budget" min="0.01" step="0.01" required></div></div><button class="secondary-button full-button" type="submit">Add category</button></form></aside></div><section class="section-block"><div class="section-heading"><div><h2>Long-term funds</h2><p>Set aside a bonus for special occasions. Leave the expiration date blank for an unlimited fund.</p></div></div><div class="budget-layout"><section class="budget-panel"><div class="budget-rows">${fundItems}</div></section><aside class="add-category-panel"><form method="post" action="/long-term-budgets" class="stacked-form"><div class="field"><label>Name</label><input type="text" name="name" minlength="2" maxlength="50" value="Special occasions" required></div><div class="field"><label>Amount</label><div class="money-input"><span>$</span><input type="number" name="amount" min="0.01" step="0.01" required></div></div><div class="field"><label>Expiration date <span>Optional</span></label><input type="date" name="expires_on"><p class="field-hint">Blank means no expiration.</p></div><button class="secondary-button full-button" type="submit">Add long-term fund</button></form></aside></div></section>`);
}

async function updateBudgets(request: Request, db: D1Database) {
  const form = await request.formData();
  const current = await categories(db);
  const updates: { id: number; name: string; amount: number }[] = [];
  const names = new Set<string>();
  for (const category of current) {
    const name = String(form.get("category_name_" + category.id) ?? category.name).trim();
    const amount = cents(String(form.get("budget_" + category.id) ?? ""), true);
    if (name.length < 2 || name.length > 50) return redirect("/budgets?error=Category+names+must+be+2+to+50+characters.");
    if (amount === null) return redirect("/budgets?error=Budgets+must+be+valid+amounts+of+zero+or+more.");
    const normalized = name.toLocaleLowerCase();
    if (names.has(normalized)) return redirect("/budgets?error=Category+names+must+be+unique.");
    names.add(normalized);
    updates.push({ id: category.id, name, amount });
  }
  try {
    await db.batch(updates.flatMap((update) => [
      db.prepare("UPDATE category SET name=? WHERE id=?").bind(update.name, update.id),
      db.prepare("UPDATE category SET monthly_budget_cents=? WHERE id=?").bind(update.amount, update.id),
    ]));
  } catch {
    return redirect("/budgets?error=That+category+name+already+exists.");
  }
  return redirect("/budgets?saved=true");
}
async function updateLongTermBudget(request: Request, id: number, db: D1Database) { const form = await request.formData(); const name = String(form.get("name") ?? "").trim(); const amount = cents(String(form.get("amount") ?? "")); const expiresOn = String(form.get("expires_on") ?? "").trim(); if (name.length < 2 || name.length > 50) return redirect("/budgets?error=Fund+names+must+be+2+to+50+characters."); if (amount === null) return redirect("/budgets?error=Long-term+funds+must+have+an+amount+greater+than+zero."); if (expiresOn && (!validDate(expiresOn) || expiresOn < today())) return redirect("/budgets?error=Choose+a+valid+future+expiration+date+or+leave+it+blank."); try { const result = await db.prepare("UPDATE long_term_budget SET name=?, amount_cents=?, expires_on=? WHERE id=? AND is_archived=0").bind(name, amount, expiresOn || null, id).run(); if (!result.meta.changes) return redirect("/budgets?error=That+fund+is+not+available+to+edit."); } catch { return redirect("/budgets?error=That+long-term+fund+already+exists."); } return redirect("/budgets?saved=true"); }
async function archiveLongTermBudget(id: number, db: D1Database) { const result = await db.prepare("UPDATE long_term_budget SET is_archived=1 WHERE id=? AND is_archived=0").bind(id).run(); return result.meta.changes ? redirect("/budgets?saved=true") : redirect("/budgets?error=That+fund+is+not+available+to+archive."); }
async function unarchiveLongTermBudget(id: number, db: D1Database) { const result = await db.prepare("UPDATE long_term_budget SET is_archived=0 WHERE id=? AND is_archived=1").bind(id).run(); return result.meta.changes ? redirect("/budgets?saved=true") : redirect("/budgets?error=That+fund+is+not+available+to+unarchive."); }
async function deleteLongTermBudget(id: number, db: D1Database) { if (await db.prepare("SELECT id FROM expense WHERE long_term_budget_id=? LIMIT 1").bind(id).first()) return redirect("/budgets?error=Funds+with+expenses+are+kept+for+history.+Archive+this+fund+instead."); const result = await db.prepare("DELETE FROM long_term_budget WHERE id=?").bind(id).run(); return result.meta.changes ? redirect("/budgets?saved=true") : redirect("/budgets?error=Long-term+fund+not+found."); }
async function addLongTermBudget(request: Request, db: D1Database) { const form = await request.formData(); const name = String(form.get("name") ?? "").trim(); const amount = cents(String(form.get("amount") ?? "")); const expiresOn = String(form.get("expires_on") ?? "").trim(); if (name.length < 2 || name.length > 50) return redirect("/budgets?error=Fund+names+must+be+2+to+50+characters."); if (amount === null) return redirect("/budgets?error=Long-term+funds+must+have+an+amount+greater+than+zero."); if (expiresOn && (!validDate(expiresOn) || expiresOn < today())) return redirect("/budgets?error=Choose+a+valid+future+expiration+date+or+leave+it+blank."); try { await db.prepare("INSERT INTO long_term_budget (name,amount_cents,expires_on) VALUES (?,?,?)").bind(name, amount, expiresOn || null).run(); } catch { return redirect("/budgets?error=That+long-term+fund+already+exists."); } return redirect("/budgets?saved=true"); }
async function addCategory(request: Request, db: D1Database) { const form = await request.formData(); const name = String(form.get("name") ?? "").trim(); const budget = cents(String(form.get("monthly_budget") ?? "")); if (name.length < 2 || name.length > 50) return redirect("/budgets?error=Category+names+must+be+2+to+50+characters."); if (budget === null) return redirect("/budgets?error=Amount+must+be+greater+than+zero."); try { const next = await db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM category").first<{ next_order: number }>(); await db.prepare("INSERT INTO category (name,monthly_budget_cents,sort_order) VALUES (?,?,?)").bind(name, budget, next?.next_order ?? 1).run(); } catch { return redirect("/budgets?error=That+category+already+exists."); } return redirect("/budgets?saved=true"); }
async function orderCategories(request: Request, db: D1Database) { const form = await request.formData(); const ids = String(form.get("order") ?? "").split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0); const current = await categories(db); if (ids.length !== current.length || new Set(ids).size !== current.length || !current.every((category) => ids.includes(category.id))) return new Response("Invalid category order", { status: 400 }); await db.batch(ids.map((id, index) => db.prepare("UPDATE category SET sort_order=? WHERE id=?").bind(index + 1, id))); return new Response(null, { status: 204 }); }
async function deleteCategory(id: number, db: D1Database) { if (await db.prepare("SELECT id FROM expense WHERE category_id=? LIMIT 1").bind(id).first()) return redirect("/budgets?error=Move+or+delete+this+category%27s+expenses+before+deleting+it."); await db.prepare("DELETE FROM category WHERE id=?").bind(id).run(); return redirect("/budgets?saved=true"); }

export default { async fetch(request, env): Promise<Response> { const url = new URL(request.url); const identity = await verifiedAccessEmail(request, env); if (identity instanceof Response) return identity; if (request.method === "GET" && url.pathname === "/") return dashboard(env.DB, url); if (request.method === "GET" && url.pathname === "/expenses") return expenses(env.DB, url); if (request.method === "POST" && url.pathname === "/expenses") return saveExpense(request, env.DB, identity); const parts = url.pathname.split("/"); const editedId = parts.length === 4 && parts[1] === "expenses" && parts[3] === "edit" ? Number(parts[2]) : 0; if (request.method === "POST" && Number.isInteger(editedId) && editedId > 0) return updateExpense(request, editedId, env.DB); const deletedId = parts.length === 4 && parts[1] === "expenses" && parts[3] === "delete" ? Number(parts[2]) : 0; if (request.method === "POST" && Number.isInteger(deletedId) && deletedId > 0) { const form = await request.formData(); await env.DB.prepare("DELETE FROM expense WHERE id=?").bind(deletedId).run(); return redirect("/expenses?month=" + encodeURIComponent(String(form.get("month") ?? month(null).selected))); } if (request.method === "GET" && url.pathname === "/budgets") return budgets(env.DB, url); if (request.method === "POST" && url.pathname === "/budgets") return updateBudgets(request, env.DB); if (request.method === "POST" && url.pathname === "/categories") return addCategory(request, env.DB); if (request.method === "POST" && url.pathname === "/long-term-budgets") return addLongTermBudget(request, env.DB); const longTermParts = url.pathname.split("/"); const longTermId = longTermParts.length === 4 && longTermParts[1] === "long-term-budgets" ? Number(longTermParts[2]) : 0; if (request.method === "POST" && Number.isInteger(longTermId) && longTermId > 0 && longTermParts[3] === "update") return updateLongTermBudget(request, longTermId, env.DB); if (request.method === "POST" && Number.isInteger(longTermId) && longTermId > 0 && longTermParts[3] === "archive") return archiveLongTermBudget(longTermId, env.DB); if (request.method === "POST" && Number.isInteger(longTermId) && longTermId > 0 && longTermParts[3] === "unarchive") return unarchiveLongTermBudget(longTermId, env.DB); if (request.method === "POST" && Number.isInteger(longTermId) && longTermId > 0 && longTermParts[3] === "delete") return deleteLongTermBudget(longTermId, env.DB); if (request.method === "POST" && url.pathname === "/categories/order") return orderCategories(request, env.DB); const categoryDeleteId = parts.length === 4 && parts[1] === "categories" && parts[3] === "delete" ? Number(parts[2]) : 0; if (request.method === "POST" && Number.isInteger(categoryDeleteId) && categoryDeleteId > 0) return deleteCategory(categoryDeleteId, env.DB); if (request.method === "GET" && url.pathname === "/health") return Response.json({ status: "ok" }); return new Response("Not found", { status: 404 }); } } satisfies ExportedHandler<Env>;
