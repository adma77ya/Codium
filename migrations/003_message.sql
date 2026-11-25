-- Compiler output / runtime error details shown to the submitter.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS message TEXT;
