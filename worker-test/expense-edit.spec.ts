import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";

async function fetch(path: string, init?: RequestInit) {
  const context = createExecutionContext();
  const response = await worker.fetch(new Request(`https://koda-control.test${path}`, init), env, context);
  await waitOnExecutionContext(context);
  return response;
}

const form = (values: Record<string, string>) => new URLSearchParams(values).toString();

beforeEach(async () => { await env.DB.exec("DELETE FROM expense;"); });

describe("expense editing", () => {
  it("updates an expense while retaining its original author", async () => {
    await fetch("/expenses", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ expense_date: "2026-07-12", item: "Original item", amount: "10", category_id: "1", created_by: "Husband", notes: "Old note", month: "2026-07" }) });
    const expense = await env.DB.prepare("SELECT id, created_by FROM expense").first<{ id: number; created_by: string }>();
    const response = await fetch(`/expenses/${expense!.id}/edit`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ expense_date: "2026-07-13", item: "Updated item", amount: "25.50", category_id: "3", notes: "New note", month: "2026-07" }) });
    expect(response.status).toBe(303);
    const updated = await env.DB.prepare("SELECT item, amount_cents, category_id, notes, created_by FROM expense WHERE id=?").bind(expense!.id).first<{ item: string; amount_cents: number; category_id: number; notes: string; created_by: string }>();
    expect(updated).toMatchObject({ item: "Updated item", amount_cents: 2550, category_id: 3, notes: "New note", created_by: "Husband" });
  });

  it("links each dashboard category to its filtered month view", async () => {
    const body = await (await fetch("/?month=2026-07")).text();
    expect(body).toContain('/expenses?month=2026-07&category=3');
  });
});
