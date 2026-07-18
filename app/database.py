from __future__ import annotations

import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


DEFAULT_CATEGORIES = (
    ("Home", 30_000),
    ("Dine Out", 10_000),
    ("Transportation", 20_000),
    ("Allowance 1", 7_500),
    ("Allowance 2", 7_500),
    ("Activity", 10_000),
)


def database_path() -> Path:
    configured_path = os.getenv("CASHFLOW_DB_PATH")
    if configured_path:
        return Path(configured_path).expanduser()
    return Path(__file__).resolve().parent.parent / "data" / "cashflow.db"


def connect() -> sqlite3.Connection:
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def connection() -> Iterator[sqlite3.Connection]:
    database = connect()
    try:
        yield database
        database.commit()
    except Exception:
        database.rollback()
        raise
    finally:
        database.close()


def initialize_database() -> None:
    with connection() as database:
        database.executescript(
            """
            CREATE TABLE IF NOT EXISTS household (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS category (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                monthly_budget_cents INTEGER NOT NULL DEFAULT 0
                    CHECK (monthly_budget_cents >= 0),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS expense (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                item TEXT NOT NULL,
                amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
                category_id INTEGER NOT NULL REFERENCES category(id),
                notes TEXT NOT NULL DEFAULT '',
                created_by TEXT NOT NULL CHECK (created_by IN ('Husband', 'Wife')),
                source TEXT NOT NULL DEFAULT 'manual',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS expense_date_index ON expense(date);
            CREATE INDEX IF NOT EXISTS expense_category_index ON expense(category_id);
            """
        )
        database.execute(
            "INSERT OR IGNORE INTO household (id, name) VALUES (1, ?)",
            (os.getenv("HOUSEHOLD_NAME", "Our Household"),),
        )
        database.executemany(
            """
            INSERT OR IGNORE INTO category (name, monthly_budget_cents)
            VALUES (?, ?)
            """,
            DEFAULT_CATEGORIES,
        )
