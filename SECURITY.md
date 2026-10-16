# Security

Please report vulnerabilities privately through the repository's Security tab when private reporting is available, or contact the repository owner privately. Do not post student information, passwords, tokens or database dumps in public issues.

This public repository contains application source and synthetic fixtures only. `.local`, environment files, exam-bank source documents, exports and backups must remain outside Git. Run `npm run security:secrets` before pushing; `npm run git:setup` installs local commit/push guards. The guard is an additional check, not a substitute for reviewing a diff.

Changes are checked by CI, including a production dependency audit. Dependency updates require review. Production is deployed separately after a database backup and functional verification. No automatic commits, deployment or stress test runs from CI.
