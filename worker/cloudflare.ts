import app, { type Env } from './index.ts';
export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    if (env.MIGRATION_TARGET) {
      if (env.MIGRATION_MODE === 'redirect' && !new URL(request.url).pathname.startsWith('/api/')) {
        const url = new URL(request.url), target = new URL(env.MIGRATION_TARGET);
        url.host = target.host; url.protocol = target.protocol;
        return Response.redirect(url.toString(), 308);
      }
      const moved = env.MIGRATION_MODE === 'redirect';
      return Response.json({ error: moved ? `Платформа перенесена на ${env.MIGRATION_TARGET}. Откройте новый адрес и войдите снова.` : `Платформа переносится на ${env.MIGRATION_TARGET}. Войдите по новому адресу после окончания переноса.` }, {status:moved ? 410 : 503,headers:{...(moved ? {} : {'Retry-After':'300'}),'Cache-Control':'no-store'}});
    }
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    return app.fetch(request,env,context);
  },
};
