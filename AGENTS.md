# FinanceAcademy working rules

- Production: https://finacademy.kz, PostgreSQL VPS. Cloudflare serves only the old-domain redirect.
- Never run load/stress tests without a new explicit user instruction. The current active-attempt limit is 50. The former 300-student automation stays paused.
- Do not read or print secrets unnecessarily. Never commit `.local`, environment files, student exports, customer question-bank documents, screenshots containing real student data, or database backups. This GitHub repository is public.
- Commit completed, verified changes when the user requests it. Automatic commits are disabled by the owner. Review the staged diff and run the secret guard. Significant app changes require `npm test` and `npm run build:vps`. Do not bypass commit/push hooks.
- Push to the user-authorized origin only: https://github.com/Denzel-is/finacademy.kz.git. Never force-push, rewrite shared history, or discard uncommitted work to make a checkpoint.
- Deployments require a fresh backup, additive migration review, normal regression checks and health/revision checks. Preserve previous releases. Never restore an old database over newer student activity automatically.
- Keep the UI in Russian with Kazakh question support. Dates entered by administrators use the configured organization timezone, default Asia/Almaty.
