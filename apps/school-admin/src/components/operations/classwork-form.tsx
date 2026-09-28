'use client';

import type { ClassworkItem, ClassworkKind, ClassworkTarget } from '@acadlyx/types';
import { CLASSWORK_INSTRUCTIONS_MAX, classworkSchema } from '@acadlyx/validation';
import { Button } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useId, useState } from 'react';
import { BffError, bffApi } from '@/lib/bff-client';
import { ConfirmDialog } from '../shell/confirm-dialog';
import {
  fieldErrors,
  formValues,
  NoticeBox,
  SelectField,
  TextField,
  useAction,
  useUnsavedWarning,
} from '../setup/ui';

const NOUN: Record<ClassworkKind, string> = { homework: 'homework', assignments: 'assignment' };

/**
 * Create / edit form for homework and assignments. Class and subject choices come from the
 * server's `targets` (teachers: only section + subject pairs they teach). New work starts as a
 * DRAFT; publishing is a separate, explicit action. Dates are school-local calendar dates.
 */
export function ClassworkForm({
  kind,
  targets,
  item,
  today,
}: {
  kind: ClassworkKind;
  targets: ClassworkTarget[];
  item?: ClassworkItem;
  today: string;
}) {
  const router = useRouter();
  const id = useId();
  const [sectionId, setSectionId] = useState(item?.sectionId ?? targets[0]?.sectionId ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const { busy, notice, setNotice, run } = useAction();
  useUnsavedWarning(dirty);
  const subjects = targets.find((t) => t.sectionId === sectionId)?.subjects ?? [];

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const parsed = classworkSchema.safeParse(v);
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error.issues);
      setErrors(errs);
      setNotice({ tone: 'danger', messages: Object.values(errs) });
      return;
    }
    setErrors({});
    let createdId: string | null = null;
    const ok = await run(
      async () => {
        if (item) {
          await bffApi(`${kind}/${item.id}`, {
            method: 'PATCH',
            body: { ...parsed.data, expectedVersion: item.version },
          });
        } else {
          const created = await bffApi<ClassworkItem>(kind, {
            method: 'POST',
            body: { ...parsed.data, sectionId: v.sectionId, subjectId: v.subjectId },
          });
          createdId = created.id;
        }
      },
      item ? 'Changes saved.' : `Draft ${NOUN[kind]} created.`,
    );
    if (ok) {
      setDirty(false);
      if (createdId) router.push(`/${kind}/${String(createdId)}`);
    }
  }

  if (!item && targets.length === 0)
    return (
      <p className="text-sm text-slate-600" data-testid="no-targets">
        There is no class and subject you can create {NOUN[kind]} for. Teachers need a current
        subject assignment in an active class.
      </p>
    );

  return (
    <form
      onSubmit={(e) => void submit(e)}
      onChange={() => {
        setDirty(true);
      }}
      noValidate
      aria-label={item ? `Edit ${NOUN[kind]}` : `New ${NOUN[kind]}`}
      className="flex flex-col gap-3"
    >
      <NoticeBox notice={notice} />
      {item ? (
        <p className="text-sm text-slate-600">
          {item.sectionName} · {item.subjectName}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            idPrefix={id}
            name="sectionId"
            label="Class"
            value={sectionId}
            onChange={(e) => {
              setSectionId(e.target.value);
            }}
            options={targets.map((t) => ({
              value: t.sectionId,
              label: `${t.sectionName} · ${t.branchName}`,
            }))}
          />
          <SelectField
            idPrefix={id}
            name="subjectId"
            label="Subject"
            options={subjects.map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>
      )}
      <TextField
        idPrefix={id}
        name="title"
        label="Title"
        required
        maxLength={200}
        defaultValue={item?.title ?? ''}
        error={errors.title}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-instructions`} className="text-sm font-medium text-slate-700">
          Instructions (optional)
        </label>
        <textarea
          id={`${id}-instructions`}
          name="instructions"
          rows={5}
          maxLength={CLASSWORK_INSTRUCTIONS_MAX}
          defaultValue={item?.instructions ?? ''}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          idPrefix={id}
          name="assignedDate"
          type="date"
          label="Assigned date"
          defaultValue={item?.assignedDate ?? today}
          error={errors.assignedDate}
        />
        <TextField
          idPrefix={id}
          name="dueDate"
          type="date"
          label="Due date"
          hint="Due on the selected school-local date"
          defaultValue={item?.dueDate ?? today}
          error={errors.dueDate}
        />
      </div>
      <div>
        <Button type="submit" disabled={busy}>
          {item ? 'Save changes' : 'Create draft'}
        </Button>
      </div>
    </form>
  );
}

/** Lifecycle actions (server-computed `can`, re-checked by the API). Impactful ones confirm. */
export function ClassworkActions({ kind, item }: { kind: ClassworkKind; item: ClassworkItem }) {
  const router = useRouter();
  const { busy, notice, setNotice, run } = useAction();
  const [confirm, setConfirm] = useState<null | 'archive' | 'close' | 'delete'>(null);

  const act = async (action: 'publish' | 'close' | 'archive' | 'delete') => {
    const ok = await run(
      () =>
        action === 'delete'
          ? bffApi(`${kind}/${item.id}`, { method: 'DELETE' })
          : bffApi(`${kind}/${item.id}/${action}`, {
              method: 'POST',
              body: { expectedVersion: item.version },
            }),
      action === 'publish'
        ? 'Published.'
        : action === 'close'
          ? 'Closed.'
          : action === 'archive'
            ? 'Archived.'
            : 'Draft deleted.',
    ).catch((error: unknown) => {
      if (error instanceof BffError && error.status === 409)
        setNotice({
          tone: 'danger',
          messages: ['This was changed by someone else. Reload the page.'],
        });
      return false;
    });
    setConfirm(null);
    if (ok && action === 'delete') router.push(`/${kind}`);
  };

  const copy = {
    archive: {
      title: `Archive this ${NOUN[kind]}?`,
      body: 'It will leave the current lists and become read-only. It is kept for history.',
      label: 'Archive',
    },
    close: {
      title: 'Close this assignment?',
      body: 'Closing marks the assignment as finished; it can no longer be edited.',
      label: 'Close assignment',
    },
    delete: {
      title: 'Delete this draft?',
      body: 'The draft is removed permanently. Published work is never deleted.',
      label: 'Delete draft',
    },
  };

  return (
    <div className="flex flex-col gap-2">
      <NoticeBox notice={notice} />
      <div className="flex flex-wrap gap-2">
        {item.can.publish ? (
          <Button disabled={busy} onClick={() => void act('publish')}>
            Publish
          </Button>
        ) : null}
        {item.can.close ? (
          <Button variant="secondary" disabled={busy} onClick={() => setConfirm('close')}>
            Close
          </Button>
        ) : null}
        {item.can.archive ? (
          <Button variant="secondary" disabled={busy} onClick={() => setConfirm('archive')}>
            Archive
          </Button>
        ) : null}
        {item.can.delete ? (
          <Button variant="secondary" disabled={busy} onClick={() => setConfirm('delete')}>
            Delete draft
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? copy[confirm].title : ''}
        confirmLabel={confirm ? copy[confirm].label : 'Confirm'}
        busy={busy}
        onCancel={() => {
          setConfirm(null);
        }}
        onConfirm={() => {
          if (confirm) void act(confirm);
        }}
      >
        {confirm ? copy[confirm].body : null}
      </ConfirmDialog>
    </div>
  );
}
