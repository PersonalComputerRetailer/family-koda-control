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
  await env.DB.exec("DELETE FROM expense; DELETE FROM category WHERE id > 6;");
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
});
