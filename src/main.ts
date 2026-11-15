import { createApp } from './server/app.ts';
import { createContext, formatSetupCode, type Context } from './server/context.ts';
import { fearGreed } from './sources/feargreed.ts';
import { backupDaily } from './storage/index.ts';

let ctx: Context;
try {
  ctx = createContext();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
const { app, collection } = createApp(ctx);

void fearGreed();
collection.start();

const backup = (): void => {
  try {
    const file = backupDaily(ctx.db);
    if (file) console.log(`Database backed up to ${file}`);
  } catch (err) {
    app.log.error(err);
  }
};
backup();
setInterval(backup, 60 * 60_000).unref();

await app.listen({ host: ctx.host, port: ctx.port });
console.log(`Stashboard is running at http://${ctx.host}:${ctx.port}`);
const { setupCode } = ctx.auth;
if (setupCode) {
  const where =
    ctx.config.domain && !ctx.local ? `https://${ctx.config.domain}/setup` : `http://${ctx.host}:${ctx.port}/setup`;
  console.log(
    `No account yet. Create one at ${where} with this setup code: ${formatSetupCode(setupCode)}  [setup-code]`,
  );
  if (ctx.local) console.log('Until then the dashboard is open on this machine only.');
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      ctx.db.close();
      process.exit(0);
    });
  });
}
