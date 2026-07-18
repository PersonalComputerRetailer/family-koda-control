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

INSERT OR IGNORE INTO household (id, name) VALUES (1, 'Our Household');
INSERT OR IGNORE INTO category (name, monthly_budget_cents) VALUES
    ('Home', 30000),
    ('Dine Out', 10000),
    ('Transportation', 20000),
    ('Allowance 1', 7500),
    ('Allowance 2', 7500),
    ('Activity', 10000);
