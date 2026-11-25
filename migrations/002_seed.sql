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

-- Problem C. Statement text lives in the frontend; the judge needs limits and tests.
INSERT INTO problems (slug, title, statement, difficulty, time_limit_ms) VALUES
('longest-unique-run', 'Longest Unique Run',
 E'Read one line of lowercase letters. Print the length of the longest contiguous substring with no repeated character.',
 'Medium', 1500);

INSERT INTO test_cases (problem_id, ordinal, input, expected)
SELECT id, 1, E'abcabcbb\n', E'3\n' FROM problems WHERE slug = 'longest-unique-run' UNION ALL
SELECT id, 2, E'bbbbb\n',    E'1\n' FROM problems WHERE slug = 'longest-unique-run' UNION ALL
SELECT id, 3, E'pwwkew\n',   E'3\n' FROM problems WHERE slug = 'longest-unique-run' UNION ALL
SELECT id, 4, E'a\n',        E'1\n' FROM problems WHERE slug = 'longest-unique-run' UNION ALL
SELECT id, 5, E'dvdf\n',     E'3\n' FROM problems WHERE slug = 'longest-unique-run' UNION ALL
SELECT id, 6, E'abcdefghijklmnopqrstuvwxyz\n', E'26\n' FROM problems WHERE slug = 'longest-unique-run' UNION ALL
-- 494 000 chars: an O(n^2) solution should time out, a sliding window passes
SELECT id, 7, repeat('abcdefghijklmnopqrstuvwxyz', 19000) || E'\n', E'26\n' FROM problems WHERE slug = 'longest-unique-run';
