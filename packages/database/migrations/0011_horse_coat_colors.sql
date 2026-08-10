ALTER TABLE horses
  ADD COLUMN coat_color TEXT NOT NULL DEFAULT 'chestnut'
  CHECK (coat_color IN ('black', 'chestnut', 'gray', 'cream'));

WITH distributed AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS sequence
  FROM horses
  WHERE name <> 'ジョサンブラック'
)
UPDATE horses
SET coat_color = CASE (
  SELECT sequence % 3 FROM distributed WHERE distributed.id = horses.id
)
  WHEN 0 THEN 'chestnut'
  WHEN 1 THEN 'gray'
  ELSE 'cream'
END
WHERE name <> 'ジョサンブラック';

UPDATE horses SET coat_color = 'black' WHERE name = 'ジョサンブラック';
