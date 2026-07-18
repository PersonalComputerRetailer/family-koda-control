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

beforeEach(async () => {
  await env.DB.exec("DELETE FROM expense; DELETE FROM category WHERE id > 6; UPDATE category SET sort_order=id;");
});

describe("category management", () => {
  it("accepts an expense without an added-by selection", async () => {
    const response = await fetch("/expenses", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ expense_date: "2026-07-15", item: "Costco gas", amount: "84.32", category_id: "3", created_by: "", notes: "", month: "2026-07" }) });
    expect(response.status).toBe(303);
    expect(await env.DB.prepare("SELECT created_by FROM expense").first<{ created_by: string }>("created_by")).toBe("");
  });

  it("persists a custom category order", async () => {
    const response = await fetch("/categories/order", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ order: "3,1,2,4,5,6" }) });
    expect(response.status).toBe(204);
    const rows = await env.DB.prepare("SELECT id FROM category ORDER BY sort_order").all<{ id: number }>();
    expect(rows.results.map((row) => row.id)).toEqual([3, 1, 2, 4, 5, 6]);
  });

  it("deletes an unused category", async () => {
    await fetch("/categories", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ name: "Groceries", monthly_budget: "500" }) });
    const grocery = await env.DB.prepare("SELECT id FROM category WHERE name='Groceries'").first<{ id: number }>();
    const response = await fetch(`/categories/${grocery!.id}/delete`, { method: "POST" });
    expect(response.status).toBe(303);
    expect(await env.DB.prepare("SELECT id FROM category WHERE name='Groceries'").first()).toBeNull();
  });

  it("protects a category that has recorded expenses", async () => {
    await fetch("/expenses", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ expense_date: "2026-07-15", item: "AC filter", amount: "20", category_id: "1", created_by: "", notes: "", month: "2026-07" }) });
    const response = await fetch("/categories/1/delete", { method: "POST" });
    expect(response.headers.get("location")).toContain("Move+or+delete");
    expect(await env.DB.prepare("SELECT id FROM category WHERE id=1").first()).not.toBeNull();
  });
});
