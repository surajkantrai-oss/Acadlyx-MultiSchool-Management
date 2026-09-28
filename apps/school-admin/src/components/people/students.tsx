'use client';

import type {
  CreatedAccount,
  GuardianRelationship,
  ParentSummary,
  StudentDetail,
} from '@acadlyx/types';
import { GUARDIAN_RELATIONSHIPS, studentProfileSchema } from '@acadlyx/validation';
import { Alert, Badge, Button, Card } from '@acadlyx/web-ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { BffError, bffApi } from '@/lib/bff-client';
import {
  Disclosure,
  fieldErrors,
  formValues,
  NoticeBox,
  SelectField,
  SmallButton,
  TextField,
  useAction,
  useUnsavedWarning,
} from '../setup/ui';
import { AccountPanel } from './account-panel';
import { ConfirmDialog } from '../shell/confirm-dialog';
import { ACCOUNT_FILTER_OPTIONS, AccountBadge, Dl, personName } from './shared';
import { sectionOptions, type Structure } from './structure';

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  WITHDRAWN: 'Withdrawn',
  GRADUATED: 'Graduated',
};
const NEXT: Record<string, string[]> = {
  ACTIVE: ['INACTIVE', 'WITHDRAWN', 'GRADUATED'],
  INACTIVE: ['ACTIVE', 'WITHDRAWN', 'GRADUATED'],
  WITHDRAWN: ['ACTIVE'],
  GRADUATED: [],
};
const REL_LABEL = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();

export function StudentFilters({
  q,
  status,
  structure,
  selected,
  account = '',
  quality = '',
}: {
  q: string;
  status: string;
  structure: Structure;
  selected: Partial<Record<'academicYearId' | 'sectionId' | 'gradeId' | 'branchId', string>>;
  account?: string;
  quality?: string;
}) {
  const router = useRouter();
  return (
    <form
      role="search"
      aria-label="Filter students"
      className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const v = formValues(e.currentTarget);
        const qs = new URLSearchParams(
          Object.entries(v).filter(([, x]) => x) as [string, string][],
        );
        router.push(`/people/students${qs.size ? `?${qs.toString()}` : ''}`);
      }}
    >
      <TextField
        idPrefix="f"
        name="q"
        type="search"
        label="Search"
        hint="Name or admission number"
        defaultValue={q}
      />
      <SelectField
        idPrefix="f"
        name="status"
        label="Status"
        defaultValue={status}
        options={[
          { value: '', label: 'Any' },
          ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
        ]}
      />
      <SelectField
        idPrefix="f"
        name="account"
        label="Login"
        defaultValue={account}
        options={ACCOUNT_FILTER_OPTIONS}
      />
      <SelectField
        idPrefix="f"
        name="quality"
        label="Review"
        defaultValue={quality}
        options={[
          { value: '', label: 'Any' },
          { value: 'NO_ENROLLMENT', label: 'Not placed in a class' },
          { value: 'NO_GUARDIAN', label: 'No guardian linked' },
        ]}
      />
      {structure.years.length > 0 ? (
        <>
          <SelectField
            idPrefix="f"
            name="academicYearId"
            label="Academic year"
            defaultValue={selected.academicYearId ?? ''}
            options={[
              { value: '', label: 'Any' },
              ...structure.years.map((y) => ({ value: y.id, label: y.name })),
            ]}
          />
          <SelectField
            idPrefix="f"
            name="branchId"
            label="Branch"
            defaultValue={selected.branchId ?? ''}
            options={[
              { value: '', label: 'Any' },
              ...structure.branches.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
          <SelectField
            idPrefix="f"
            name="gradeId"
            label="Grade"
            defaultValue={selected.gradeId ?? ''}
            options={[
              { value: '', label: 'Any' },
              ...structure.grades.map((g) => ({ value: g.id, label: g.name })),
            ]}
          />
          <SelectField
            idPrefix="f"
            name="sectionId"
            label="Section"
            defaultValue={selected.sectionId ?? ''}
            options={[{ value: '', label: 'Any' }, ...sectionOptions(structure)]}
          />
        </>
      ) : null}
      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
  );
}

export function CreateStudentForm({
  structure,
  canEnroll,
}: {
  structure: Structure;
  canEnroll: boolean;
}) {
  const router = useRouter();
  const { busy, notice, setNotice, run } = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = formValues(form);
    const parsed = studentProfileSchema.safeParse(v);
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error.issues);
      setErrors(errs);
      setNotice({ tone: 'danger', messages: Object.values(errs) });
      return;
    }
    setErrors({});
    let createdId = '';
    const ok = await run(async () => {
      const s = await bffApi<StudentDetail>('students', {
        method: 'POST',
        body: {
          ...parsed.data,
          ...(v.sectionId ? { enrollment: { sectionId: v.sectionId } } : {}),
        },
      });
      createdId = s.id;
    }, `Student ${parsed.data.firstName} added.`);
    if (ok) {
      form.reset();
      router.push(`/people/students/${createdId}`);
    }
  }
  const sections = sectionOptions(structure, { usableOnly: true });
  return (
    <Disclosure summary="Add a student" testId="add-student">
      <form
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-3"
        noValidate
        aria-label="Create student"
      >
        <NoticeBox notice={notice} />
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            idPrefix="ns"
            name="admissionNumber"
            label="Admission number"
            required
            error={errors.admissionNumber}
          />
          <TextField
            idPrefix="ns"
            name="firstName"
            label="First name"
            required
            error={errors.firstName}
          />
          <TextField
            idPrefix="ns"
            name="middleName"
            label="Middle name"
            error={errors.middleName}
          />
          <TextField idPrefix="ns" name="lastName" label="Last name" error={errors.lastName} />
          <TextField
            idPrefix="ns"
            name="preferredName"
            label="Preferred name"
            error={errors.preferredName}
          />
          <TextField
            idPrefix="ns"
            name="dateOfBirth"
            type="date"
            label="Date of birth"
            error={errors.dateOfBirth}
          />
          <TextField
            idPrefix="ns"
            name="admissionDate"
            type="date"
            label="Admission date"
            error={errors.admissionDate}
          />
          {canEnroll && sections.length > 0 ? (
            <SelectField
              idPrefix="ns"
              name="sectionId"
              label="Enroll in section (optional)"
              options={[{ value: '', label: 'Not now' }, ...sections]}
            />
          ) : null}
        </div>
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Add student'}
          </Button>
        </div>
      </form>
    </Disclosure>
  );
}

export function StudentDetailView({
  student,
  structure,
  can,
}: {
  student: StudentDetail;
  structure: Structure;
  can: { manage: boolean; enroll: boolean; accounts: boolean; parents: boolean };
}) {
  const { busy, notice, setNotice, run } = useAction();
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    label: string;
    action: () => Promise<boolean>;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedWarning(dirty);
  const s = student;
  const post = (path: string, body: unknown, done: string) =>
    run(() => bffApi(`students/${s.id}/${path}`, { method: 'POST', body }), done);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = studentProfileSchema.safeParse(formValues(e.currentTarget));
    if (!parsed.success)
      return setNotice({
        tone: 'danger',
        messages: Object.values(fieldErrors(parsed.error.issues)),
      });
    if (
      await run(
        () => bffApi(`students/${s.id}`, { method: 'PATCH', body: parsed.data }),
        'Student saved.',
      )
    ) {
      setEditing(false);
      setDirty(false);
    }
  }

  const sections = sectionOptions(structure, { usableOnly: true });
  const active = s.enrollments.filter((e) => e.status === 'ACTIVE');
  return (
    <div className="flex flex-col gap-4">
      <NoticeBox notice={notice} />
      <Card title="Profile">
        {editing && can.manage ? (
          <form
            onSubmit={(e) => void save(e)}
            onChange={() => setDirty(true)}
            className="flex flex-col gap-3"
            aria-label="Edit student"
            noValidate
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField
                idPrefix="es"
                name="admissionNumber"
                label="Admission number"
                defaultValue={s.admissionNumber}
                required
              />
              <TextField
                idPrefix="es"
                name="firstName"
                label="First name"
                defaultValue={s.firstName}
                required
              />
              <TextField
                idPrefix="es"
                name="middleName"
                label="Middle name"
                defaultValue={s.middleName ?? ''}
              />
              <TextField
                idPrefix="es"
                name="lastName"
                label="Last name"
                defaultValue={s.lastName ?? ''}
              />
              <TextField
                idPrefix="es"
                name="preferredName"
                label="Preferred name"
                defaultValue={s.preferredName ?? ''}
              />
              <TextField
                idPrefix="es"
                name="dateOfBirth"
                type="date"
                label="Date of birth"
                defaultValue={s.dateOfBirth ?? ''}
              />
              <TextField
                idPrefix="es"
                name="admissionDate"
                type="date"
                label="Admission date"
                defaultValue={s.admissionDate ?? ''}
              />
            </div>
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
                [
                  'Admission number',
                  <span key="a" className="font-mono">
                    {s.admissionNumber}
                  </span>,
                ],
                ['Preferred name', s.preferredName],
                ['Date of birth', s.dateOfBirth],
                ['Admission date', s.admissionDate],
                [
                  'Status',
                  <Badge key="s" tone={s.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {STATUS_LABEL[s.status]}
                  </Badge>,
                ],
                ['Login account', <AccountBadge key="l" account={s.account} />],
              ]}
            />
            {can.manage ? (
              <div className="mt-3">
                <SmallButton onClick={() => setEditing(true)}>Edit profile</SmallButton>
              </div>
            ) : null}
          </>
        )}
      </Card>

      {can.manage ? (
        <Card title="Status">
          {NEXT[s.status]?.length ? (
            <form
              className="flex flex-wrap items-end gap-3"
              aria-label="Change status"
              onSubmit={(e) => {
                e.preventDefault();
                const v = formValues(e.currentTarget);
                const label = STATUS_LABEL[v.status ?? ''] ?? v.status ?? '';
                setConfirm({
                  title: `Change status to ${label}?`,
                  body:
                    v.status === 'WITHDRAWN' || v.status === 'GRADUATED'
                      ? `${personName(s)}'s current class placement will end. ${v.status === 'GRADUATED' ? 'Graduation cannot be undone by a status change.' : 'The student can be re-admitted later.'}`
                      : `${personName(s)} will be marked ${label.toLowerCase()}.`,
                  label: `Mark ${label.toLowerCase()}`,
                  action: () =>
                    post(
                      'status',
                      { status: v.status, reason: v.reason || undefined },
                      `Status changed to ${label}.`,
                    ),
                });
              }}
            >
              <SelectField
                idPrefix="st"
                name="status"
                label="New status"
                options={(NEXT[s.status] ?? []).map((x) => ({
                  value: x,
                  label: STATUS_LABEL[x] ?? x,
                }))}
              />
              <TextField idPrefix="st" name="reason" label="Reason (optional)" maxLength={200} />
              <Button type="submit" variant="secondary" disabled={busy}>
                Change status
              </Button>
            </form>
          ) : (
            <p className="text-sm">
              Graduated is final. Corrections need an administrative correction, not a status
              change.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Withdrawal/graduation also ends the active enrollment. The login account is not changed.
          </p>
        </Card>
      ) : null}

      <Card title="Academic placement">
        {s.enrollments.length === 0 ? (
          <p className="text-sm">Not placed in a class yet.</p>
        ) : (
          <ol
            className="flex flex-col gap-2"
            data-testid="enrollment-history"
            aria-label="Enrollment history"
          >
            {s.enrollments.map((e) => (
              <li key={e.enrollmentId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{e.academicYearName}</span>
                <span>
                  {e.gradeName} {e.sectionName} · {e.branchName}
                </span>
                <Badge tone={e.status === 'ACTIVE' ? 'success' : 'neutral'}>
                  {e.status.toLowerCase()}
                </Badge>
                <span className="text-xs text-slate-500">
                  {e.startDate} – {e.endDate ?? 'now'}
                </span>
                {can.enroll && e.status === 'ACTIVE' ? (
                  <span className="ml-auto flex flex-wrap gap-2">
                    <form
                      className="flex items-end gap-2"
                      aria-label={`Transfer from ${e.gradeName} ${e.sectionName}`}
                      onSubmit={(ev) => {
                        ev.preventDefault();
                        const v = formValues(ev.currentTarget);
                        void post(
                          `enrollments/${e.enrollmentId}/transfer`,
                          { sectionId: v.sectionId },
                          'Student transferred.',
                        );
                      }}
                    >
                      <SelectField
                        idPrefix={`tr-${e.enrollmentId}`}
                        name="sectionId"
                        label="Transfer to"
                        options={sections.filter(
                          (o) => o.yearId === e.academicYearId && o.value !== e.sectionId,
                        )}
                      />
                      <Button type="submit" variant="secondary" disabled={busy}>
                        Transfer
                      </Button>
                    </form>
                    <SmallButton
                      disabled={busy}
                      label={`Mark ${e.academicYearName} completed`}
                      onClick={() => {
                        setConfirm({
                          title: `Complete ${e.academicYearName} enrollment?`,
                          body: `${personName(s)} will no longer be placed in ${e.gradeName} ${e.sectionName}. The history is kept.`,
                          label: 'Complete enrollment',
                          action: () =>
                            post(
                              `enrollments/${e.enrollmentId}/end`,
                              { status: 'COMPLETED' },
                              'Enrollment completed.',
                            ),
                        });
                      }}
                    >
                      Complete
                    </SmallButton>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {can.enroll && s.status === 'ACTIVE' && sections.length > 0 ? (
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            aria-label="Enroll student"
            onSubmit={(e) => {
              e.preventDefault();
              const v = formValues(e.currentTarget);
              void post(
                'enrollments',
                { sectionId: v.sectionId, ...(v.startDate ? { startDate: v.startDate } : {}) },
                'Student enrolled.',
              );
            }}
          >
            <SelectField
              idPrefix="en"
              name="sectionId"
              label="Enroll in section"
              options={sections.filter((o) => !active.some((a) => a.academicYearId === o.yearId))}
            />
            <TextField idPrefix="en" name="startDate" type="date" label="Start date (optional)" />
            <Button type="submit" variant="secondary" disabled={busy}>
              Enroll
            </Button>
          </form>
        ) : null}
      </Card>

      <Card title="Guardians">
        {s.guardians.length === 0 ? (
          <p className="text-sm">No guardians linked.</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="guardians">
            {s.guardians.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2 text-sm">
                {can.parents ? (
                  <Link
                    className="font-medium underline-offset-2 hover:underline"
                    href={`/people/parents/${g.parentId}`}
                  >
                    {personName(g.parent)}
                  </Link>
                ) : (
                  <span className="font-medium">{personName(g.parent)}</span>
                )}
                <span>{REL_LABEL(g.relationship)}</span>
                {g.isPrimary ? <Badge tone="info">Primary</Badge> : null}
                {g.pickupAuthorized ? <Badge>Pickup</Badge> : null}
                {g.isEmergencyContact ? <Badge>Emergency</Badge> : null}
                {g.parent.phone ? (
                  <span className="text-xs text-slate-500">{g.parent.phone}</span>
                ) : null}
                {can.manage ? (
                  <span className="ml-auto flex gap-2">
                    {!g.isPrimary ? (
                      <SmallButton
                        disabled={busy}
                        label={`Make ${personName(g.parent)} primary`}
                        onClick={() =>
                          void run(
                            () =>
                              bffApi(`students/${s.id}/guardians/${g.id}`, {
                                method: 'PATCH',
                                body: { isPrimary: true },
                              }),
                            'Primary guardian changed.',
                          )
                        }
                      >
                        Make primary
                      </SmallButton>
                    ) : null}
                    <SmallButton
                      disabled={busy}
                      label={`Unlink ${personName(g.parent)}`}
                      onClick={() => {
                        setConfirm({
                          title: `Unlink ${personName(g.parent)}?`,
                          body: `${personName(g.parent)} will no longer be a guardian of ${personName(s)}. The parent profile is kept.`,
                          label: 'Unlink guardian',
                          action: () =>
                            run(
                              () =>
                                bffApi(`students/${s.id}/guardians/${g.id}`, { method: 'DELETE' }),
                              'Guardian unlinked (the parent profile is kept).',
                            ),
                        });
                      }}
                    >
                      Unlink
                    </SmallButton>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {can.manage && can.parents ? <LinkGuardian studentId={s.id} busy={busy} run={run} /> : null}
      </Card>

      <div>
        {can.accounts ? (
          <AccountPanel kind="students" id={s.id} account={s.account} />
        ) : (
          <section id="login-account" aria-label="Login account">
            <Card title="Login account">
              <AccountBadge account={s.account} />
            </Card>
          </section>
        )}
      </div>

      <Card title="Status history">
        {s.statusHistory.length === 0 ? (
          <p className="text-sm">No status changes recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="status-history">
              <caption className="sr-only">Status history, newest first</caption>
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="py-1 pr-3">
                    Date
                  </th>
                  <th scope="col" className="py-1 pr-3">
                    From
                  </th>
                  <th scope="col" className="py-1 pr-3">
                    To
                  </th>
                  <th scope="col" className="py-1 pr-3">
                    Reason
                  </th>
                  <th scope="col" className="py-1">
                    By
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.statusHistory.map((h) => (
                  <tr key={`${h.at}-${h.toStatus}`} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3">
                      <time dateTime={h.at}>{h.at.slice(0, 10)}</time>
                    </td>
                    <td className="py-1.5 pr-3">
                      {h.fromStatus ? STATUS_LABEL[h.fromStatus] : '—'}
                    </td>
                    <th scope="row" className="py-1.5 pr-3 font-medium">
                      {STATUS_LABEL[h.toStatus]}
                    </th>
                    <td className="py-1.5 pr-3">{h.reason ?? '—'}</td>
                    <td className="py-1.5">{h.actorName ?? 'System'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        confirmLabel={confirm?.label ?? 'Confirm'}
        busy={busy}
        onCancel={() => {
          setConfirm(null);
        }}
        onConfirm={() => {
          const action = confirm?.action;
          if (!action) return;
          void action().then(() => {
            setConfirm(null);
          });
        }}
      >
        {confirm?.body}
      </ConfirmDialog>
    </div>
  );
}

function LinkGuardian({
  studentId,
  busy,
  run,
}: {
  studentId: string;
  busy: boolean;
  run: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;
}) {
  const [results, setResults] = useState<ParentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = formValues(e.currentTarget).q ?? '';
    setError(null);
    try {
      const page = await bffApi<{ items: ParentSummary[] }>(
        `parents?q=${encodeURIComponent(q)}&pageSize=10`,
      );
      setResults(page.items);
    } catch (err) {
      setError(
        err instanceof BffError && err.status === 403
          ? 'You cannot search parents.'
          : 'Search failed. Try again.',
      );
    }
  }
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <form
        role="search"
        aria-label="Find a parent to link"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => void search(e)}
      >
        <TextField
          idPrefix="gs"
          name="q"
          type="search"
          label="Find parent"
          hint="Name, phone, email or parent code"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
        <Link href="/people/parents" className="pb-2 text-sm underline">
          Add a new parent
        </Link>
      </form>
      {error ? (
        <div className="mt-2">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      {results?.length === 0 ? <p className="mt-2 text-sm">No parents found.</p> : null}
      {results && results.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2" aria-label="Parent search results">
          {results.map((p) => (
            <li key={p.id}>
              <form
                className="flex flex-wrap items-end gap-3 text-sm"
                aria-label={`Link ${personName(p)}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = formValues(e.currentTarget);
                  void run(
                    () =>
                      bffApi(`students/${studentId}/guardians`, {
                        method: 'POST',
                        body: {
                          parentId: p.id,
                          relationship: v.relationship as GuardianRelationship,
                          isPrimary: v.isPrimary === 'on',
                          pickupAuthorized: v.pickup === 'on',
                          isEmergencyContact: v.emergency === 'on',
                        },
                      }),
                    `${personName(p)} linked.`,
                  ).then((ok) => {
                    if (ok) setResults(null);
                  });
                }}
              >
                <span className="min-w-40 font-medium">
                  {personName(p)}{' '}
                  <span className="text-xs text-slate-500">
                    {p.parentCode ?? ''} {p.phone ?? ''}
                  </span>
                </span>
                <SelectField
                  idPrefix={`lg-${p.id}`}
                  name="relationship"
                  label="Relationship"
                  options={GUARDIAN_RELATIONSHIPS.map((r) => ({ value: r, label: REL_LABEL(r) }))}
                />
                <label htmlFor={`lg-${p.id}-isPrimary`} className="flex items-center gap-1 pb-2">
                  <input
                    id={`lg-${p.id}-isPrimary`}
                    type="checkbox"
                    name="isPrimary"
                    className="h-4 w-4"
                    aria-label={`Primary — ${personName(p)}`}
                  />{' '}
                  Primary
                </label>
                <label htmlFor={`lg-${p.id}-pickup`} className="flex items-center gap-1 pb-2">
                  <input
                    id={`lg-${p.id}-pickup`}
                    type="checkbox"
                    name="pickup"
                    className="h-4 w-4"
                    aria-label={`Pickup — ${personName(p)}`}
                  />{' '}
                  Pickup
                </label>
                <label htmlFor={`lg-${p.id}-emergency`} className="flex items-center gap-1 pb-2">
                  <input
                    id={`lg-${p.id}-emergency`}
                    type="checkbox"
                    name="emergency"
                    className="h-4 w-4"
                    aria-label={`Emergency — ${personName(p)}`}
                  />{' '}
                  Emergency
                </label>
                <Button type="submit" disabled={busy || !p.isActive}>
                  {p.isActive ? 'Link' : 'Inactive'}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export type { CreatedAccount };
