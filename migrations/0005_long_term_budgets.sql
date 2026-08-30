CREATE TABLE long_term_budget (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    expires_on TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE expense ADD COLUMN long_term_budget_id INTEGER REFERENCES long_term_budget(id);

CREATE INDEX expense_long_term_budget_index ON expense(long_term_budget_id);
