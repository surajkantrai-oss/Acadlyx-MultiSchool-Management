'use client';

import {
  TENANT_DOMAIN_TYPES,
  type TenantDomain,
  type TenantDomainType,
} from '@acadlyx/tenant-config';
import { domainSchema } from '@acadlyx/validation';
import { Alert, Badge, Button, EmptyState, Field, inputClassName } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatDate } from '@/lib/status';

const TYPE_LABELS: Record<TenantDomainType, string> = {
  PLATFORM_SUBDOMAIN: 'Platform subdomain',
  CUSTOM: 'Custom domain',
  ADMIN: 'Admin domain',
};

export function DomainManager({
  tenantId,
  domains,
}: {
  tenantId: string;
  domains: TenantDomain[];
}) {
  const router = useRouter();
  const [domain, setDomain] = useState('');
  const [type, setType] = useState<TenantDomainType>('CUSTOM');
  const [isPrimary, setIsPrimary] = useState(domains.length === 0);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  async function mutate(fn: () => Promise<unknown>) {
    setRemoving(null);
    setError(null);
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    const parsed = domainSchema.safeParse(domain);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }
    setFieldError(undefined);
    await mutate(async () => {
      await api.platform.addDomain(tenantId, { domain: parsed.data, type, isPrimary });
      setDomain('');
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Alert tone="info">
        DNS verification is not automated yet. “Mark verified” records a manual confirmation. In
        production only verified domains resolve to the school; in development
        <code className="mx-1">*.localhost</code>domains resolve without verification.
      </Alert>
      {error ? <Alert>{error}</Alert> : null}

      {domains.length === 0 ? (
        <EmptyState title="No domains yet">Add the first domain below.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {domains.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="font-mono">{d.domain}</span>
              <Badge>{TYPE_LABELS[d.type]}</Badge>
              {d.isPrimary ? <Badge tone="info">Primary</Badge> : null}
              {d.verifiedAt ? (
                <Badge tone="success">Verified {formatDate(d.verifiedAt)}</Badge>
              ) : (
                <Badge tone="warning">Unverified</Badge>
              )}
              <span className="ml-auto flex gap-2">
                {!d.isPrimary ? (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void mutate(() =>
                        api.platform.updateDomain(tenantId, d.id, { isPrimary: true }),
                      )
                    }
                  >
                    Set primary
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      api.platform.updateDomain(tenantId, d.id, { verified: !d.verifiedAt }),
                    )
                  }
                >
                  {d.verifiedAt ? 'Mark unverified' : 'Mark verified'}
                </Button>
                {removing === d.id ? (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() => void mutate(() => api.platform.removeDomain(tenantId, d.id))}
                    >
                      Confirm remove
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setRemoving(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setRemoving(d.id);
                    }}
                  >
                    Remove
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={onAdd}
        noValidate
        className="grid gap-4 rounded-lg border border-slate-200 bg-white p-6 sm:grid-cols-4 sm:items-end"
      >
        <div className="sm:col-span-2">
          <Field
            id="domain"
            label="Add domain"
            hint="Host name only, e.g. portal.school.com"
            error={fieldError}
          >
            <input
              id="domain"
              className={`${inputClassName} font-mono`}
              value={domain}
              maxLength={253}
              aria-invalid={fieldError ? true : undefined}
              onChange={(e) => {
                setDomain(e.target.value);
              }}
            />
          </Field>
        </div>
        <Field id="type" label="Type">
          <select
            id="type"
            className={inputClassName}
            value={type}
            onChange={(e) => {
              setType(e.target.value as TenantDomainType);
            }}
          >
            {TENANT_DOMAIN_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => {
                setIsPrimary(e.target.checked);
              }}
            />
            Primary for this type
          </label>
          <Button type="submit" disabled={busy}>
            Add domain
          </Button>
        </div>
      </form>
    </div>
  );
}
