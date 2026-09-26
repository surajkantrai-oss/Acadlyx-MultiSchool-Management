'use client';

import type { FeatureKey, TenantFeatureState } from '@acadlyx/tenant-config';
import { Alert } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';

export function FeatureToggles({
  tenantId,
  features,
}: {
  tenantId: string;
  features: TenantFeatureState[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<FeatureKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = [...new Set(features.map((f) => f.group))];

  async function toggle(feature: TenantFeatureState) {
    setError(null);
    setPending(feature.key);
    try {
      await api.platform.setFeature(tenantId, feature.key, !feature.enabled);
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Alert tone="info">
        Feature flags are configuration only. Enabling a module here does not build it — each module
        ships in its own phase and will honour these flags.
      </Alert>
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-6 md:grid-cols-2">
        {groups.map((group) => (
          <fieldset key={group} className="rounded-lg border border-slate-200 bg-white p-4">
            <legend className="px-1 text-sm font-semibold">{group}</legend>
            <ul className="flex flex-col gap-2">
              {features
                .filter((f) => f.group === group)
                .map((feature) => (
                  <li key={feature.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex flex-col">
                      <span>{feature.label}</span>
                      <span className="font-mono text-xs text-slate-400">{feature.key}</span>
                    </span>
                    <button
                      id={`feature-${feature.key}`}
                      type="button"
                      role="switch"
                      aria-label={feature.label}
                      aria-checked={feature.enabled}
                      disabled={pending !== null}
                      onClick={() => void toggle(feature)}
                      className={`relative h-6 w-11 rounded-full transition disabled:opacity-50 ${feature.enabled ? 'bg-emerald-600' : 'bg-slate-300'}`}
                    >
                      <span
                        aria-hidden
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${feature.enabled ? 'left-5' : 'left-0.5'}`}
                      />
                    </button>
                  </li>
                ))}
            </ul>
          </fieldset>
        ))}
      </div>
    </div>
  );
}
