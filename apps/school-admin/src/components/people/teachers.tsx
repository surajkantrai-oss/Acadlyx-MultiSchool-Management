'use client';

import type { Subject, TeacherDetail } from '@acadlyx/types';
import { teacherProfileSchema } from '@acadlyx/validation';
import { Badge, Button, Card } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { bffApi } from '@/lib/bff-client';
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
import { AccountBadge, Dl } from './shared';
import { sectionOptions, type Structure } from './structure';

function TeacherFields({
  t,
  errors,
  prefix,
}: {
  t?: TeacherDetail;
  errors: Record<string, string>;
  prefix: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <TextField
        idPrefix={prefix}
        name="employeeId"
        label="Employee ID"
        required
        defaultValue={t?.employeeId ?? ''}
        error={errors.employeeId}
      />
      <TextField
        idPrefix={prefix}
        name="firstName"
        label="First name"
        required
        defaultValue={t?.firstName ?? ''}
        error={errors.firstName}
      />
      <TextField
        idPrefix={prefix}
        name="middleName"
        label="Middle name"
        defaultValue={t?.middleName ?? ''}
        error={errors.middleName}
      />
      <TextField
        idPrefix={prefix}
        name="lastName"
        label="Last name"
        defaultValue={t?.lastName ?? ''}
        error={errors.lastName}
      />
      <TextField
        idPrefix={prefix}
        name="email"
        type="email"
        label="Email"
        defaultValue={t?.email ?? ''}
        error={errors.email}
      />
      <TextField
        idPrefix={prefix}
        name="phone"
        type="tel"
        label="Mobile"
        defaultValue={t?.phone ?? ''}
        error={errors.phone}
      />
      <TextField
        idPrefix={prefix}
        name="joiningDate"
        type="date"
        label="Joining date"
        defaultValue={t?.joiningDate ?? ''}
        error={errors.joiningDate}
      />
    </div>
  );
}

export function CreateTeacherForm() {
  const router = useRouter();
  const { busy, notice, setNotice, run } = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = teacherProfileSchema.safeParse(formValues(e.currentTarget));
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error.issues);
      setErrors(errs);
      return setNotice({ tone: 'danger', messages: Object.values(errs) });
    }
    setErrors({});
    let id = '';
    if (
      await run(async () => {
        id = (await bffApi<TeacherDetail>('teachers', { method: 'POST', body: parsed.data })).id;
      }, 'Teacher added.')
    )
      router.push(`/people/teachers/${id}`);
  }
  return (
    <Disclosure summary="Add a teacher" testId="add-teacher">
      <form
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-3"
        noValidate
        aria-label="Create teacher"
      >
        <NoticeBox notice={notice} />
        <TeacherFields errors={errors} prefix="nt" />
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Add teacher'}
          </Button>
        </div>
      </form>
    </Disclosure>
  );
}

export function TeacherDetailView({
  teacher,
  structure,
  subjects,
  can,
}: {
  teacher: TeacherDetail;
  structure: Structure;
  subjects: Subject[];
  can: { manage: boolean; assign: boolean; accounts: boolean };
}) {
  const { busy, notice, setNotice, run } = useAction();
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<'SUBJECT_TEACHER' | 'CLASS_TEACHER'>('SUBJECT_TEACHER');
  const [dirty, setDirty] = useState(false);
  useUnsavedWarning(dirty);
  const t = teacher;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = teacherProfileSchema.safeParse(formValues(e.currentTarget));
    if (!parsed.success)
      return setNotice({
        tone: 'danger',
        messages: Object.values(fieldErrors(parsed.error.issues)),
      });
    if (
      await run(
        () => bffApi(`teachers/${t.id}`, { method: 'PATCH', body: parsed.data }),
        'Teacher saved.',
      )
    ) {
      setEditing(false);
      setDirty(false);
    }
  }
  const current = t.assignments.filter((a) => !a.endedAt);
  const ended = t.assignments.filter((a) => a.endedAt);
  const sections = sectionOptions(structure, { usableOnly: true });
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
            aria-label="Edit teacher"
          >
            <TeacherFields t={t} errors={{}} prefix="et" />
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
                  'Employee ID',
                  <span key="e" className="font-mono">
                    {t.employeeId}
                  </span>,
                ],
                ['Email', t.email],
                ['Mobile', t.phone],
                ['Joining date', t.joiningDate],
                [
                  'Profile',
                  <Badge key="s" tone={t.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {t.status.toLowerCase()}
                  </Badge>,
                ],
                ['Login account', <AccountBadge key="l" account={t.account} />],
              ]}
            />
            {can.manage ? (
              <div className="mt-3 flex gap-2">
                <SmallButton onClick={() => setEditing(true)}>Edit profile</SmallButton>
                <SmallButton
                  disabled={busy}
                  onClick={() => {
                    if (t.status === 'ACTIVE') setConfirmDeactivate(true);
                    else
                      void run(
                        () =>
                          bffApi(`teachers/${t.id}/status`, {
                            method: 'POST',
                            body: { status: 'ACTIVE' },
                          }),
                        'Teacher activated.',
                      );
                  }}
                >
                  {t.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                </SmallButton>
              </div>
            ) : null}
          </>
        )}
      </Card>
      <ConfirmDialog
        open={confirmDeactivate}
        title="Deactivate this teacher?"
        confirmLabel="Deactivate teacher"
        busy={busy}
        onCancel={() => {
          setConfirmDeactivate(false);
        }}
        onConfirm={() => {
          void run(
            () =>
              bffApi(`teachers/${t.id}/status`, { method: 'POST', body: { status: 'INACTIVE' } }),
            'Teacher deactivated (login account unchanged).',
          ).then(() => {
            setConfirmDeactivate(false);
          });
        }}
      >
        An inactive teacher cannot be given new classes. Current and past assignments stay visible,
        and the login account is not changed.
      </ConfirmDialog>
      <Card title="Assignments">
        {current.length === 0 ? (
          <p className="text-sm">No current assignments.</p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="assignments">
            {current.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">
                  {a.academicYearName} · {a.branchName} · {a.gradeName} {a.sectionName}
                </span>
                <span>
                  {a.type === 'CLASS_TEACHER' ? (
                    <Badge tone="info">Class teacher</Badge>
                  ) : (
                    a.subjectName
                  )}
                </span>
                {can.assign ? (
                  <span className="ml-auto">
                    <SmallButton
                      disabled={busy}
                      label={`End assignment ${a.gradeName} ${a.sectionName} ${a.subjectName ?? 'class teacher'}`}
                      onClick={() =>
                        void run(
                          () =>
                            bffApi(`teachers/${t.id}/assignments/${a.id}/end`, { method: 'POST' }),
                          'Assignment ended (kept in history).',
                        )
                      }
                    >
                      End
                    </SmallButton>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {can.assign && t.status === 'ACTIVE' && sections.length > 0 ? (
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            aria-label="Assign teacher"
            onSubmit={(e) => {
              e.preventDefault();
              const v = formValues(e.currentTarget);
              void run(
                () =>
                  bffApi(`teachers/${t.id}/assignments`, {
                    method: 'POST',
                    body: {
                      type,
                      sectionId: v.sectionId,
                      ...(type === 'SUBJECT_TEACHER' ? { subjectId: v.subjectId } : {}),
                    },
                  }),
                'Teacher assigned.',
              );
            }}
          >
            <SelectField
              idPrefix="as"
              name="type"
              label="Role"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              options={[
                { value: 'SUBJECT_TEACHER', label: 'Subject teacher' },
                { value: 'CLASS_TEACHER', label: 'Class teacher' },
              ]}
            />
            <SelectField idPrefix="as" name="sectionId" label="Section" options={sections} />
            {type === 'SUBJECT_TEACHER' ? (
              <SelectField
                idPrefix="as"
                name="subjectId"
                label="Subject"
                hint="Must be configured for the section's grade"
                options={subjects
                  .filter((s) => s.isActive)
                  .map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
              />
            ) : null}
            <Button type="submit" disabled={busy}>
              Assign
            </Button>
          </form>
        ) : null}
        {ended.length > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-slate-600 underline">
              Past assignments ({ended.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-600">
              {ended.map((a) => (
                <li key={a.id}>
                  {a.academicYearName} · {a.gradeName} {a.sectionName} ·{' '}
                  {a.subjectName ?? 'Class teacher'} — ended{' '}
                  {new Date(a.endedAt ?? '').toLocaleDateString()}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>
      {can.accounts ? <AccountPanel kind="teachers" id={t.id} account={t.account} /> : null}
    </div>
  );
}
