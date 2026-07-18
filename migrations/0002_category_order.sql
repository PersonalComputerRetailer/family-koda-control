ALTER TABLE category ADD COLUMN sort_order INTEGER;

UPDATE category
SET sort_order = id
WHERE sort_order IS NULL;

CREATE INDEX IF NOT EXISTS category_sort_order_index ON category(sort_order, name);
