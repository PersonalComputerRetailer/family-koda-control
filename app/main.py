from __future__ import annotations

import calendar
import sqlite3
from contextlib import asynccontextmanager
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import urlencode

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.database import connection, initialize_database


BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=BASE_DIR / "templates")


def money(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    dollars = abs(cents) / 100
    return f"{sign}${dollars:,.2f}"


templates.env.filters["money"] = money


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="Family Koda Control", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


def selected_month(value: str | None) -> date:
    if value:
        try:
            return datetime.strptime(value, "%Y-%m").date().replace(day=1)
        except ValueError:
            pass
    return date.today().replace(day=1)


def month_context(value: str | None) -> dict[str, str]:
    month = selected_month(value)
    if month.month == 1:
        previous_month = date(month.year - 1, 12, 1)
    else:
        previous_month = date(month.year, month.month - 1, 1)
    if month.month == 12:
        next_month = date(month.year + 1, 1, 1)
    else:
        next_month = date(month.year, month.month + 1, 1)
    return {
        "month": month.strftime("%Y-%m"),
        "month_label": month.strftime("%B %Y"),
        "previous_month": previous_month.strftime("%Y-%m"),
        "next_month": next_month.strftime("%Y-%m"),
        "start": month.isoformat(),
        "end": next_month.isoformat(),
    }


def category_status(spent: int, budget: int) -> tuple[str, str, int, int]:
    percentage = round((spent / budget) * 100) if budget else (100 if spent else 0)
    bar_width = min(percentage, 100)
    if spent > budget:
        return "Over budget", "purple", percentage, bar_width
    if percentage >= 90:
        return "At limit", "red", percentage, bar_width
    if percentage >= 70:
        return "Watch", "amber", percentage, bar_width
    return "On track", "green", percentage, bar_width


def dashboard_data(month: dict[str, str]) -> dict:
    with connection() as database:
        household = database.execute("SELECT name FROM household WHERE id = 1").fetchone()
        rows = database.execute(
            """
            SELECT c.id, c.name, c.monthly_budget_cents,
                   COALESCE(SUM(e.amount_cents), 0) AS spent_cents
            FROM category c
            LEFT JOIN expense e ON e.category_id = c.id
                AND e.date >= ? AND e.date < ?
            GROUP BY c.id
            ORDER BY c.name COLLATE NOCASE
            """,
            (month["start"], month["end"]),
        ).fetchall()
        recent = database.execute(
            """
            SELECT e.id, e.date, e.item, e.amount_cents, e.created_by, c.name AS category
            FROM expense e
            JOIN category c ON c.id = e.category_id
            WHERE e.date >= ? AND e.date < ?
            ORDER BY e.date DESC, e.id DESC
            LIMIT 6
            """,
            (month["start"], month["end"]),
        ).fetchall()

    categories = []
    for row in rows:
        item = dict(row)
        status, color, percentage, bar_width = category_status(
            item["spent_cents"], item["monthly_budget_cents"]
        )
        item.update(
            status=status,
            status_color=color,
            percentage=percentage,
            bar_width=bar_width,
            remaining_cents=item["monthly_budget_cents"] - item["spent_cents"],
        )
        categories.append(item)

    total_budget = sum(item["monthly_budget_cents"] for item in categories)
    total_spent = sum(item["spent_cents"] for item in categories)
    return {
        "household_name": household["name"] if household else "Our Household",
        "categories": categories,
        "recent_expenses": recent,
        "total_budget_cents": total_budget,
        "total_spent_cents": total_spent,
        "remaining_cents": total_budget - total_spent,
    }


def list_categories():
    with connection() as database:
        return database.execute(
            "SELECT id, name, monthly_budget_cents FROM category ORDER BY name COLLATE NOCASE"
        ).fetchall()


def expense_page_data(month: dict[str, str], category_id: int | None = None) -> dict:
    categories = list_categories()
    query = """
        SELECT e.id, e.date, e.item, e.amount_cents, e.notes, e.created_by,
               c.name AS category, c.id AS category_id
        FROM expense e
        JOIN category c ON c.id = e.category_id
        WHERE e.date >= ? AND e.date < ?
    """
    parameters: list[str | int] = [month["start"], month["end"]]
    if category_id:
        query += " AND c.id = ?"
        parameters.append(category_id)
    query += " ORDER BY e.date DESC, e.id DESC"
    with connection() as database:
        expenses = database.execute(query, parameters).fetchall()
    return {
        "categories": categories,
        "expenses": expenses,
        "filtered_category": category_id,
        "expense_total_cents": sum(expense["amount_cents"] for expense in expenses),
    }


def cents_from_input(value: str, *, allow_zero: bool = False) -> int:
    try:
        amount = Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        raise ValueError("Enter a valid dollar amount.") from None
    cents = int(amount * 100)
    if cents < 0 or (cents == 0 and not allow_zero):
        raise ValueError("Amount must be greater than zero.")
    return cents


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request, month: str | None = None):
    month_data = month_context(month)
    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {**month_data, **dashboard_data(month_data), "page": "dashboard"},
    )


@app.get("/expenses", response_class=HTMLResponse)
def expenses(
    request: Request,
    month: str | None = None,
    category: int | None = None,
    saved: bool = False,
):
    month_data = month_context(month)
    return templates.TemplateResponse(
        request,
        "expenses.html",
        {
            **month_data,
            **expense_page_data(month_data, category),
            "page": "expenses",
            "saved": saved,
            "today": date.today().isoformat(),
            "form": {"category_id": category} if category else {},
            "errors": {},
        },
    )


@app.post("/expenses", response_class=HTMLResponse)
def create_expense(
    request: Request,
    expense_date: str = Form(...),
    item: str = Form(...),
    amount: str = Form(...),
    category_id: int = Form(...),
    created_by: str = Form(...),
    notes: str = Form(""),
    month: str | None = Form(None),
):
    errors: dict[str, str] = {}
    item = item.strip()
    notes = notes.strip()
    if len(item) < 3:
        errors["item"] = "Describe what the purchase was for."
    elif len(item) > 120:
        errors["item"] = "Keep the item description under 120 characters."
    try:
        parsed_date = date.fromisoformat(expense_date)
    except ValueError:
        errors["expense_date"] = "Choose a valid date."
        parsed_date = date.today()
    try:
        amount_cents = cents_from_input(amount)
    except ValueError as exc:
        errors["amount"] = str(exc)
        amount_cents = 0
    if created_by not in {"Husband", "Wife"}:
        errors["created_by"] = "Choose who added this expense."
    if len(notes) > 500:
        errors["notes"] = "Keep notes under 500 characters."

    categories = list_categories()
    if category_id not in {category["id"] for category in categories}:
        errors["category_id"] = "Choose a valid category."

    month_data = month_context(month or parsed_date.strftime("%Y-%m"))
    if errors:
        return templates.TemplateResponse(
            request,
            "expenses.html",
            {
                **month_data,
                **expense_page_data(month_data),
                "page": "expenses",
                "saved": False,
                "today": date.today().isoformat(),
                "form": {
                    "expense_date": expense_date,
                    "item": item,
                    "amount": amount,
                    "category_id": category_id,
                    "created_by": created_by,
                    "notes": notes,
                },
                "errors": errors,
            },
            status_code=422,
        )

    with connection() as database:
        database.execute(
            """
            INSERT INTO expense
                (date, item, amount_cents, category_id, notes, created_by, source)
            VALUES (?, ?, ?, ?, ?, ?, 'manual')
            """,
            (expense_date, item, amount_cents, category_id, notes, created_by),
        )
    query = urlencode({"month": parsed_date.strftime("%Y-%m"), "saved": "true"})
    return RedirectResponse(f"/expenses?{query}", status_code=303)


@app.post("/expenses/{expense_id}/delete")
def delete_expense(expense_id: int, month: str = Form(...)):
    with connection() as database:
        database.execute("DELETE FROM expense WHERE id = ?", (expense_id,))
    return RedirectResponse(f"/expenses?{urlencode({'month': month})}", status_code=303)


@app.get("/budgets", response_class=HTMLResponse)
def budgets(request: Request, saved: bool = False, error: str | None = None):
    return templates.TemplateResponse(
        request,
        "budgets.html",
        {
            "page": "budgets",
            "categories": list_categories(),
            "saved": saved,
            "error": error,
        },
    )


@app.post("/budgets")
async def update_budgets(request: Request):
    form = await request.form()
    categories = list_categories()
    updates: list[tuple[int, int]] = []
    try:
        for category in categories:
            field = f"budget_{category['id']}"
            cents = cents_from_input(str(form.get(field, "")), allow_zero=True)
            updates.append((cents, category["id"]))
    except ValueError:
        return RedirectResponse(
            "/budgets?" + urlencode({"error": "Budgets must be valid amounts of zero or more."}),
            status_code=303,
        )
    with connection() as database:
        database.executemany(
            "UPDATE category SET monthly_budget_cents = ? WHERE id = ?", updates
        )
    return RedirectResponse("/budgets?saved=true", status_code=303)


@app.post("/categories")
def create_category(name: str = Form(...), monthly_budget: str = Form(...)):
    clean_name = name.strip()
    if len(clean_name) < 2 or len(clean_name) > 50:
        return RedirectResponse(
            "/budgets?" + urlencode({"error": "Category names must be 2 to 50 characters."}),
            status_code=303,
        )
    try:
        budget_cents = cents_from_input(monthly_budget)
    except ValueError as exc:
        return RedirectResponse(
            "/budgets?" + urlencode({"error": str(exc)}), status_code=303
        )
    try:
        with connection() as database:
            database.execute(
                "INSERT INTO category (name, monthly_budget_cents) VALUES (?, ?)",
                (clean_name, budget_cents),
            )
    except sqlite3.IntegrityError:
        return RedirectResponse(
            "/budgets?" + urlencode({"error": "That category already exists."}),
            status_code=303,
        )
    return RedirectResponse("/budgets?saved=true", status_code=303)


@app.get("/health")
def health():
    return {"status": "ok"}
