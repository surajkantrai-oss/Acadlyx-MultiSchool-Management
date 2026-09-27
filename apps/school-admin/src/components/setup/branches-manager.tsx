'use client';

import type { Branch } from '@acadlyx/types';
import { branchSchema } from '@acadlyx/validation';
import { Badge, Button, EmptyState } from '@acadlyx/web-ui';
import { type FormEvent, useState } from 'react';
import { bffApi } from '@/lib/bff-client';
import {
  Disclosure,
  fieldErrors,
  formValues,
  NoticeBox,
  SmallButton,
  TextField,
  useAction,
} from './ui';

function BranchForm({
  initial,
  defaultTimezone,
  submitLabel,
  busy,
  onSubmit,
  idPrefix,
}: {
  initial?: Branch;
  defaultTimezone: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (data: Record<string, unknown>) => Promise<boolean>;
  idPrefix: string;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const parsed = branchSchema.safeParse(formValues(form));
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    if (await onSubmit(parsed.data)) {
      if (!initial) form.reset();
    }
  }
  const v = (x: string | null | undefined) => x ?? '';
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-3"
      noValidate
      aria-label={submitLabel}
    >
      {Object.keys(errors).length > 0 ? (
        <p role="alert" className="text-sm text-red-700">
          Please correct the highlighted fields.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          idPrefix={idPrefix}
          name="name"
          label="Branch name"
          defaultValue={v(initial?.name)}
          required
          error={errors.name}
        />
        <TextField
          idPrefix={idPrefix}
          name="code"
          label="Code"
          hint="e.g. MAIN"
          defaultValue={v(initial?.code)}
          required
          maxLength={20}
          error={errors.code}
        />
        <TextField
          idPrefix={idPrefix}
          name="timezone"
          label="Time zone"
          hint="IANA name"
          defaultValue={initial?.timezone ?? defaultTimezone}
          required
          error={errors.timezone}
        />
        <TextField
          idPrefix={idPrefix}
          name="email"
          type="email"
          label="Email"
          defaultValue={v(initial?.email)}
          error={errors.email}
        />
        <TextField
          idPrefix={idPrefix}
          name="phone"
          type="tel"
          label="Phone"
          defaultValue={v(initial?.phone)}
          error={errors.phone}
        />
        <TextField
          idPrefix={idPrefix}
          name="addressLine1"
          label="Address line 1"
          defaultValue={v(initial?.addressLine1)}
          error={errors.addressLine1}
        />
        <TextField
          idPrefix={idPrefix}
          name="addressLine2"
          label="Address line 2"
          defaultValue={v(initial?.addressLine2)}
          error={errors.addressLine2}
        />
        <TextField
          idPrefix={idPrefix}
          name="city"
          label="City"
          defaultValue={v(initial?.city)}
          error={errors.city}
        />
        <TextField
          idPrefix={idPrefix}
          name="state"
          label="State / region"
          defaultValue={v(initial?.state)}
          error={errors.state}
        />
        <TextField
          idPrefix={idPrefix}
          name="postalCode"
          label="Postal code"
          defaultValue={v(initial?.postalCode)}
          error={errors.postalCode}
        />
        <TextField
          idPrefix={idPrefix}
          name="country"
          label="Country"
          hint="2-letter ISO code"
          maxLength={2}
          defaultValue={v(initial?.country)}
          error={errors.country}
        />
      </div>
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function BranchesManager({
  branches,
  canManage,
  defaultTimezone,
}: {
  branches: Branch[];
  canManage: boolean;
  defaultTimezone: string;
}) {
  const { busy, notice, run } = useAction();
  const action = (b: Branch, verb: 'activate' | 'deactivate' | 'set-primary', done: string) =>
    void run(() => bffApi(`branches/${b.id}/${verb}`, { method: 'POST' }), done);

  return (
    <div className="flex flex-col gap-4">
      <NoticeBox notice={notice} />
      {canManage ? (
        <Disclosure summary="Add a branch" testId="add-branch" open={branches.length === 0}>
          <BranchForm
            idPrefix="new-branch"
            defaultTimezone={defaultTimezone}
            submitLabel="Create branch"
            busy={busy}
            onSubmit={(data) =>
              run(
                () => bffApi('branches', { method: 'POST', body: data }),
                `Branch ${String(data.name)} created.`,
              )
            }
          />
        </Disclosure>
      ) : null}
      {branches.length === 0 ? (
        <EmptyState title="No branches yet">
          Add the school’s first campus — it becomes the primary branch.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm" data-testid="branches-table">
            <caption className="sr-only">Branches</caption>
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">
                  Name
                </th>
                <th scope="col" className="px-4 py-2">
                  Code
                </th>
                <th scope="col" className="px-4 py-2">
                  City
                </th>
                <th scope="col" className="px-4 py-2">
                  Time zone
                </th>
                <th scope="col" className="px-4 py-2">
                  Status
                </th>
                {canManage ? (
                  <th scope="col" className="px-4 py-2">
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id} className="border-t border-slate-100 align-top">
                  <th scope="row" className="px-4 py-2 font-medium">
                    {b.name} {b.isPrimary ? <Badge tone="info">Primary</Badge> : null}
                  </th>
                  <td className="px-4 py-2 font-mono">{b.code}</td>
                  <td className="px-4 py-2">{b.city ?? '—'}</td>
                  <td className="px-4 py-2">{b.timezone}</td>
                  <td className="px-4 py-2">
                    <Badge tone={b.isActive ? 'success' : 'neutral'}>
                      {b.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  {canManage ? (
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        {!b.isPrimary && b.isActive ? (
                          <SmallButton
                            disabled={busy}
                            label={`Make ${b.name} the primary branch`}
                            onClick={() =>
                              action(b, 'set-primary', `${b.name} is now the primary branch.`)
                            }
                          >
                            Make primary
                          </SmallButton>
                        ) : null}
                        {b.isActive && !b.isPrimary ? (
                          <SmallButton
                            disabled={busy}
                            label={`Deactivate ${b.name}`}
                            onClick={() => action(b, 'deactivate', `${b.name} deactivated.`)}
                          >
                            Deactivate
                          </SmallButton>
                        ) : null}
                        {!b.isActive ? (
                          <SmallButton
                            disabled={busy}
                            label={`Activate ${b.name}`}
                            onClick={() => action(b, 'activate', `${b.name} activated.`)}
                          >
                            Activate
                          </SmallButton>
                        ) : null}
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-slate-600 underline">
                          Edit {b.name}
                        </summary>
                        <div className="mt-3">
                          <BranchForm
                            idPrefix={`branch-${b.id}`}
                            initial={b}
                            defaultTimezone={defaultTimezone}
                            submitLabel="Save branch"
                            busy={busy}
                            onSubmit={(data) =>
                              run(
                                () => bffApi(`branches/${b.id}`, { method: 'PATCH', body: data }),
                                `${String(data.name)} saved.`,
                              )
                            }
                          />
                        </div>
                      </details>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
