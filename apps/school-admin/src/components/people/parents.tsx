'use client';

import type { ParentDetail } from '@acadlyx/types';
import { parentProfileSchema } from '@acadlyx/validation';
import { Badge, Button, Card } from '@acadlyx/web-ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  useUnsavedWarning,
} from '../setup/ui';
import { AccountPanel } from './account-panel';
import { ConfirmDialog } from '../shell/confirm-dialog';
import { AccountBadge, Dl, personName } from './shared';

function ParentFields({
  p,
  errors,
  prefix,
}: {
  p?: ParentDetail;
  errors: Record<string, string>;
  prefix: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <TextField
        idPrefix={prefix}
        name="parentCode"
        label="Parent code"
        hint="Optional unique code (used by imports), e.g. PAR-0001"
        defaultValue={p?.parentCode ?? ''}
        error={errors.parentCode}
      />
      <TextField
        idPrefix={prefix}
        name="firstName"
        label="First name"
        required
        defaultValue={p?.firstName ?? ''}
        error={errors.firstName}
      />
      <TextField
        idPrefix={prefix}
        name="middleName"
        label="Middle name"
        defaultValue={p?.middleName ?? ''}
        error={errors.middleName}
      />
      <TextField
        idPrefix={prefix}
        name="lastName"
        label="Last name"
        defaultValue={p?.lastName ?? ''}
        error={errors.lastName}
      />
      <TextField
        idPrefix={prefix}
        name="phone"
        type="tel"
        label="Mobile"
        hint="Needed for a parent login"
        defaultValue={p?.phone ?? ''}
        error={errors.phone}
      />
      <TextField
        idPrefix={prefix}
        name="email"
        type="email"
        label="Email"
        defaultValue={p?.email ?? ''}
        error={errors.email}
      />
    </div>
  );
}

export function CreateParentForm() {
  const router = useRouter();
  const { busy, notice, setNotice, run } = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = parentProfileSchema.safeParse(formValues(e.currentTarget));
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error.issues);
      setErrors(errs);
      return setNotice({ tone: 'danger', messages: Object.values(errs) });
    }
    setErrors({});
    let id = '';
    if (
      await run(async () => {
        id = (await bffApi<ParentDetail>('parents', { method: 'POST', body: parsed.data })).id;
      }, 'Parent added.')
    )
      router.push(`/people/parents/${id}`);
  }
  return (
    <Disclosure summary="Add a parent / guardian" testId="add-parent">
      <form
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-3"
        noValidate
        aria-label="Create parent"
      >
        <NoticeBox notice={notice} />
        <ParentFields errors={errors} prefix="np" />
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Add parent'}
          </Button>
        </div>
      </form>
    </Disclosure>
  );
}

export function ParentDetailView({
  parent,
  can,
}: {
  parent: ParentDetail;
  can: { manage: boolean; accounts: boolean; students: boolean };
}) {
  const { busy, notice, setNotice, run } = useAction();
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedWarning(dirty);
  const p = parent;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = parentProfileSchema.safeParse(formValues(e.currentTarget));
    if (!parsed.success)
      return setNotice({
        tone: 'danger',
        messages: Object.values(fieldErrors(parsed.error.issues)),
      });
    if (
      await run(
        () => bffApi(`parents/${p.id}`, { method: 'PATCH', body: parsed.data }),
        'Parent saved.',
      )
    ) {
      setEditing(false);
      setDirty(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <NoticeBox notice={notice} />
      <Card title="Profile">
        {editing ? (
          <form
            onSubmit={(e) => void save(e)}
            onChange={() => setDirty(true)}
            className="flex flex-col gap-3"
            noValidate
            aria-label="Edit parent"
          >
            <ParentFields p={p} errors={{}} prefix="ep" />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                Save
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setDirty(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <Dl
              items={[
                ['Parent code', p.parentCode],
                ['Mobile', p.phone],
                ['Email', p.email],
                [
                  'Profile',
                  <Badge key="a" tone={p.isActive ? 'success' : 'neutral'}>
                    {p.isActive ? 'Active' : 'Inactive'}
                  </Badge>,
                ],
                ['Login account', <AccountBadge key="l" account={p.account} />],
              ]}
            />
            {can.manage ? (
              <div className="mt-3 flex gap-2">
                <SmallButton onClick={() => setEditing(true)}>Edit profile</SmallButton>
                <SmallButton
                  disabled={busy}
                  onClick={() => {
                    if (p.isActive) setConfirmDeactivate(true);
                    else
                      void run(
                        () => bffApi(`parents/${p.id}/activate`, { method: 'POST' }),
                        'Parent activated.',
                      );
                  }}
                >
                  {p.isActive ? 'Deactivate' : 'Activate'}
                </SmallButton>
              </div>
            ) : null}
          </>
        )}
      </Card>
      <ConfirmDialog
        open={confirmDeactivate}
        title="Deactivate this parent profile?"
        confirmLabel="Deactivate"
        busy={busy}
        onCancel={() => {
          setConfirmDeactivate(false);
        }}
        onConfirm={() => {
          void run(
            () => bffApi(`parents/${p.id}/deactivate`, { method: 'POST' }),
            'Parent deactivated (links kept).',
          ).then(() => {
            setConfirmDeactivate(false);
          });
        }}
      >
        Existing links to children are kept, but the profile cannot be linked to more students while
        inactive. The login account is not changed.
      </ConfirmDialog>
      <Card title="Children">
        {p.children.length === 0 ? (
          <p className="text-sm">No linked students. Link from a student’s page.</p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="children">
            {p.children.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                {can.students ? (
                  <Link
                    className="font-medium underline-offset-2 hover:underline"
                    href={`/people/students/${c.studentId}`}
                  >
                    {personName(c.student)}
                  </Link>
                ) : (
                  <span className="font-medium">{personName(c.student)}</span>
                )}
                <span className="font-mono text-xs">{c.student.admissionNumber}</span>
                <span>{c.relationship.charAt(0) + c.relationship.slice(1).toLowerCase()}</span>
                {c.isPrimary ? <Badge tone="info">Primary</Badge> : null}
                {c.pickupAuthorized ? <Badge>Pickup</Badge> : null}
                {c.isEmergencyContact ? <Badge>Emergency</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {can.accounts ? <AccountPanel kind="parents" id={p.id} account={p.account} /> : null}
    </div>
  );
}
