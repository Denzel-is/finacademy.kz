ALTER TABLE users ADD COLUMN login_key TEXT;
UPDATE users SET login_key=lower(trim(login));
CREATE UNIQUE INDEX idx_users_login_key ON users(login_key);
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN creation_key TEXT;
ALTER TABLE groups ADD COLUMN creation_digest TEXT;
CREATE UNIQUE INDEX idx_groups_creation_key ON groups(creation_key) WHERE creation_key IS NOT NULL;
ALTER TABLE assignments ADD COLUMN minutes INTEGER CHECK(minutes BETWEEN 1 AND 240);
UPDATE users SET role='admin' WHERE role='superadmin';
