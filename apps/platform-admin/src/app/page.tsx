import { APP_NAME } from '@acadlyx/constants';
import { AppShell, Card } from '@acadlyx/web-ui';
import { api } from '@/lib/api';

// Rendered per request so the API status is live and builds do not require the backend.
export const dynamic = 'force-dynamic';

async function getApiStatus(): Promise<string> {
  try {
    const health = await api.health(AbortSignal.timeout(3_000));
    return health.status === 'ok' ? 'Connected' : 'Degraded';
  } catch {
    return 'Unreachable';
  }
}

export default async function DashboardPage() {
  const apiStatus = await getApiStatus();

  return (
    <AppShell productName={APP_NAME} area="Platform Admin">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Acadlyx Platform Admin</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Dashboard">
          Internal console for the Acadlyx team. Tenant management, branding, feature flags and
          subscriptions arrive in Phase 2.
        </Card>
        <Card title="API status">
          <span data-testid="api-status">{apiStatus}</span>
        </Card>
      </div>
    </AppShell>
  );
}
