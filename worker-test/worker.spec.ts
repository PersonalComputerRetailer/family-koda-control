import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";

const defaults = new Map([
  ["Home", 30000], ["Dine Out", 10000], ["Transportation", 20000],
  ["Allowance 1", 7500], ["Allowance 2", 7500], ["Activity", 10000],
]);

async function fetch(path: string, init?: RequestInit) {
  const context = createExecutionContext();
  const response = await worker.fetch(new Request(`https://koda-control.test${path}`, init), env, context);
  await waitOnExecutionContext(context);
  return response;
}

const form = (values: Record<string, string>) => new URLSearchParams(values).toString();

beforeEach(async () => {
  await env.DB.exec("DELETE FROM expense; DELETE FROM long_term_budget; DELETE FROM category WHERE id > 6;");
  await env.DB.batch([...defaults].map(([name, amount]) => env.DB.prepare("UPDATE category SET monthly_budget_cents=? WHERE name=?").bind(amount, name)));
});

describe("cash flow Worker", () => {
  it("seeds the $850 default budget", async () => {
    expect(await (await fetch("/?month=2026-07")).text()).toContain("$850.00");
  });

  it("records an expense and updates the month dashboard", async () => {
    const saved = await fetch("/expenses", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ expense_date: "2026-07-15", item: "Costco gas", amount: "84.32", category_id: "3", created_by: "Husband", notes: "Gas refill", month: "2026-07" }) });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/expenses?month=2026-07&saved=true");
    expect(await (await fetch("/?month=2026-07")).text()).toContain("$765.68");
  });

  it("shows a category over its budget", async () => {
    await fetch("/expenses", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ expense_date: "2026-07-10", item: "Car repair", amount: "280.00", category_id: "3", created_by: "Wife", notes: "", month: "2026-07" }) });
    const body = await (await fetch("/?month=2026-07")).text();
    expect(body).toContain("Over budget");
    expect(body).toContain("140%");
    expect(body).toContain("-$80.00 left");
  });

  it("rejects a zero-dollar expense without writing it", async () => {
    const response = await fetch("/expenses", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ expense_date: "2026-07-15", item: "AC filter", amount: "0", category_id: "1", created_by: "Husband", notes: "", month: "2026-07" }) });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("Amount must be greater than zero.");
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM expense").first<{ count: number }>("count")).toBe(0);
  });

  it("allows zero-dollar budgets", async () => {
    const result = await fetch("/budgets", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ budget_1: "425.50", budget_2: "100.00", budget_3: "200.00", budget_4: "75.00", budget_5: "75.00", budget_6: "0.00" }) });
    expect(result.status).toBe(303);
    expect(await env.DB.prepare("SELECT monthly_budget_cents AS value FROM category WHERE name='Activity'").first<{ value: number }>("value")).toBe(0);
  });

  it("adds categories and rejects duplicates case-insensitively", async () => {
    expect((await fetch("/categories", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ name: "Groceries", monthly_budget: "500" }) })).status).toBe(303);
    const duplicate = await fetch("/categories", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ name: "groceries", monthly_budget: "200" }) });
    expect(duplicate.headers.get("location")).toContain("already+exists");
  });
  it("tracks an unlimited special-occasions fund separately from monthly budgets", async () => {
    const created = await fetch("/long-term-budgets", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ name: "Special occasions", amount: "1000", expires_on: "" }) });
    expect(created.status).toBe(303);
    const fund = await env.DB.prepare("SELECT id, expires_on FROM long_term_budget WHERE name=?").bind("Special occasions").first<{ id: number; expires_on: string | null }>();
    expect(fund).toMatchObject({ expires_on: null });
    const saved = await fetch("/expenses", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ expense_date: "2026-07-15", item: "Birthday decorations", amount: "200", category_id: "6", created_by: "", notes: "", long_term_budget_id: String(fund!.id), month: "2026-07" }) });
    expect(saved.status).toBe(303);
    const dashboard = await (await fetch("/?month=2026-07")).text();
    expect(dashboard).toContain("Special occasions");
    expect(dashboard).toContain("$800.00 left");
    expect(dashboard).toContain("<strong>Spent:</strong> $0.00");
    expect(dashboard).toContain(`/expenses?long_term_budget=${fund!.id}`);
    expect(await (await fetch(`/expenses?long_term_budget=${fund!.id}`)).text()).toContain("Birthday decorations");
    expect(await (await fetch(`/expenses?long_term_budget=${fund!.id}`)).text()).toContain(`long-term-fund-label">Special occasions`);
    await fetch("/expenses", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ expense_date: "2025-01-15", item: "Old decorations", amount: "25", category_id: "6", created_by: "", notes: "", long_term_budget_id: String(fund!.id), month: "2025-01" }) });
    const allTime = await (await fetch(`/expenses?long_term_budget=${fund!.id}`)).text();
    expect(allTime).toContain("All time");
    expect(allTime).toContain("Old decorations");
    const lastYear = await (await fetch(`/expenses?long_term_budget=${fund!.id}&fund_range=year`)).text();
    expect(lastYear).toContain("Last 12 months");
    expect(lastYear).not.toContain("Old decorations");
  });
  it("edits unused funds, blocks deleting used funds, and archives them", async () => {
    await fetch("/long-term-budgets", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ name: "Holiday fund", amount: "400", expires_on: "" }) });
    const fund = await env.DB.prepare("SELECT id FROM long_term_budget WHERE name=?").bind("Holiday fund").first<{ id: number }>();
    const updated = await fetch(`/long-term-budgets/${fund!.id}/update`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ name: "Holiday gifts", amount: "450", expires_on: "" }) });
    expect(updated.status).toBe(303);
    expect(await env.DB.prepare("SELECT amount_cents FROM long_term_budget WHERE id=?").bind(fund!.id).first<{ amount_cents: number }>("amount_cents")).toBe(45000);
    expect((await fetch(`/long-term-budgets/${fund!.id}/delete`, { method: "POST" })).status).toBe(303);
    expect(await env.DB.prepare("SELECT id FROM long_term_budget WHERE id=?").bind(fund!.id).first()).toBeNull();
    await fetch("/long-term-budgets", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ name: "Birthday fund", amount: "300", expires_on: "" }) });
    const used = await env.DB.prepare("SELECT id FROM long_term_budget WHERE name=?").bind("Birthday fund").first<{ id: number }>();
    await fetch("/expenses", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ expense_date: "2026-07-15", item: "Birthday cake", amount: "30", category_id: "6", created_by: "", notes: "", long_term_budget_id: String(used!.id), month: "2026-07" }) });
    const blocked = await fetch(`/long-term-budgets/${used!.id}/delete`, { method: "POST" });
    expect(blocked.headers.get("location")).toContain("Archive");
    await fetch(`/long-term-budgets/${used!.id}/archive`, { method: "POST" });
    expect(await env.DB.prepare("SELECT is_archived FROM long_term_budget WHERE id=?").bind(used!.id).first<{ is_archived: number }>("is_archived")).toBe(1);
  });
});
