PRAGMA defer_foreign_keys = true;

CREATE TABLE expense_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    item TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    category_id INTEGER NOT NULL REFERENCES category(id),
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO expense_new
    (id, date, item, amount_cents, category_id, notes, created_by, source, created_at)
SELECT id, date, item, amount_cents, category_id, notes, created_by, source, created_at
FROM expense;

DROP TABLE expense;
ALTER TABLE expense_new RENAME TO expense;

CREATE INDEX expense_date_index ON expense(date);
CREATE INDEX expense_category_index ON expense(category_id);
