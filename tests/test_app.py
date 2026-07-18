from __future__ import annotations

import os
import sqlite3

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CASHFLOW_DB_PATH", str(tmp_path / "test.db"))
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


def category_id(database_path, name: str) -> int:
    with sqlite3.connect(database_path) as database:
        row = database.execute("SELECT id FROM category WHERE name = ?", (name,)).fetchone()
    assert row is not None
    return row[0]


def all_budget_fields(database_path, replacement: dict[str, str] | None = None):
    replacement = replacement or {}
    with sqlite3.connect(database_path) as database:
        rows = database.execute(
            "SELECT id, name, monthly_budget_cents FROM category ORDER BY id"
        ).fetchall()
    return {
        f"budget_{row[0]}": replacement.get(row[1], f"{row[2] / 100:.2f}")
        for row in rows
    }


def test_dashboard_seeds_default_budget(client):
    response = client.get("/")

    assert response.status_code == 200
    assert "$850.00" in response.text
    assert "Transportation" in response.text
    assert "No expenses this month" in response.text


def test_create_expense_updates_month_dashboard(client):
    database_path = os.environ["CASHFLOW_DB_PATH"]
    transportation_id = category_id(database_path, "Transportation")

    response = client.post(
        "/expenses",
        data={
            "expense_date": "2026-07-15",
            "item": "Costco gas",
            "amount": "84.32",
            "category_id": transportation_id,
            "created_by": "Husband",
            "notes": "Gas refill",
            "month": "2026-07",
        },
        follow_redirects=False,
    )

    assert response.status_code == 303
    assert response.headers["location"] == "/expenses?month=2026-07&saved=true"
    dashboard = client.get("/?month=2026-07")
    assert "Costco gas" in dashboard.text
    assert "$84.32" in dashboard.text
    assert "$765.68" in dashboard.text


def test_overspending_is_visible(client):
    database_path = os.environ["CASHFLOW_DB_PATH"]
    transportation_id = category_id(database_path, "Transportation")
    client.post(
        "/expenses",
        data={
            "expense_date": "2026-07-10",
            "item": "Car repair",
            "amount": "280.00",
            "category_id": transportation_id,
            "created_by": "Wife",
            "notes": "",
            "month": "2026-07",
        },
    )

    dashboard = client.get("/?month=2026-07")
    assert "Over budget" in dashboard.text
    assert "140%" in dashboard.text
    assert "-$80.00 left" in dashboard.text


def test_expense_validation_does_not_write_invalid_amount(client):
    database_path = os.environ["CASHFLOW_DB_PATH"]
    home_id = category_id(database_path, "Home")

    response = client.post(
        "/expenses",
        data={
            "expense_date": "2026-07-15",
            "item": "AC filter",
            "amount": "0",
            "category_id": home_id,
            "created_by": "Husband",
            "notes": "",
            "month": "2026-07",
        },
    )

    assert response.status_code == 422
    assert "Amount must be greater than zero" in response.text
    with sqlite3.connect(database_path) as database:
        assert database.execute("SELECT COUNT(*) FROM expense").fetchone()[0] == 0


def test_budget_update_allows_zero(client):
    database_path = os.environ["CASHFLOW_DB_PATH"]
    fields = all_budget_fields(database_path, {"Activity": "0.00", "Home": "425.50"})

    response = client.post("/budgets", data=fields, follow_redirects=False)

    assert response.status_code == 303
    with sqlite3.connect(database_path) as database:
        values = dict(
            database.execute("SELECT name, monthly_budget_cents FROM category").fetchall()
        )
    assert values["Activity"] == 0
    assert values["Home"] == 42_550


def test_add_and_reject_duplicate_category(client):
    response = client.post(
        "/categories",
        data={"name": "Groceries", "monthly_budget": "500"},
        follow_redirects=False,
    )
    assert response.status_code == 303

    duplicate = client.post(
        "/categories",
        data={"name": "groceries", "monthly_budget": "200"},
        follow_redirects=False,
    )
    assert duplicate.status_code == 303
    assert "already+exists" in duplicate.headers["location"]
