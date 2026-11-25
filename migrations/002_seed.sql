-- Seed problems + test cases so the judge has real work to do.
-- Input/output formats are deliberately simple (stdin -> stdout).

INSERT INTO problems (slug, title, statement, difficulty) VALUES
('two-sum', 'Two Sum',
 E'The first line has n and the target. The second line has n integers. Print the 0-based indices i<j (space separated) whose values add up to the target. Exactly one answer exists.',
 'Easy'),
('valid-brackets', 'Valid Brackets',
 E'Read one line made of ()[]{} characters. Print YES if the brackets are balanced and correctly nested, otherwise NO.',
 'Easy');

INSERT INTO test_cases (problem_id, ordinal, input, expected)
SELECT id, 1, E'4 9\n2 7 11 15\n', E'0 1\n' FROM problems WHERE slug = 'two-sum' UNION ALL
SELECT id, 2, E'3 6\n3 2 4\n', E'1 2\n' FROM problems WHERE slug = 'two-sum' UNION ALL
SELECT id, 3, E'2 6\n3 3\n', E'0 1\n' FROM problems WHERE slug = 'two-sum' UNION ALL
SELECT id, 1, E'()[]{}\n',  E'YES\n' FROM problems WHERE slug = 'valid-brackets' UNION ALL
SELECT id, 2, E'([{}])\n',  E'YES\n' FROM problems WHERE slug = 'valid-brackets' UNION ALL
SELECT id, 3, E'(]\n',      E'NO\n'  FROM problems WHERE slug = 'valid-brackets' UNION ALL
SELECT id, 4, E'((\n',      E'NO\n'  FROM problems WHERE slug = 'valid-brackets';
