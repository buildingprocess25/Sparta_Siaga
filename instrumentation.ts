export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      const { validateProductionConfig } = await import('./lib/runtime-config');
      const { validatePrivateStorage } = await import('./lib/storage-config');
      validateProductionConfig();
      await validatePrivateStorage();
    } else {
      const { isDevelopmentReadOnlyMode } = await import('./lib/environment-policy');
      if (isDevelopmentReadOnlyMode()) {
        const { getProductionReadOnlyDbPool, verifyPostgresReadOnlyPermissions } = await import('./lib/db');
        try {
          const audit = await verifyPostgresReadOnlyPermissions(getProductionReadOnlyDbPool());
          console.log(
            `[Instrumentation] PostgreSQL Production Read-Only role '${audit.dbUser}' verified (transaction_read_only=${audit.txReadOnly}).`
          );
        } catch (err) {
          console.error('[Instrumentation] FATAL: Production Read-Only role verification failed:', err);
          throw err;
        }
      }
    }

    const { registerProcessLifecycle } = await import('./lib/process-lifecycle');
    registerProcessLifecycle();
  }
}
