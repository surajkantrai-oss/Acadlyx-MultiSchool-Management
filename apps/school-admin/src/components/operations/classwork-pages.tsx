import type { ClassworkItem, ClassworkKind } from '@acadlyx/types';
import { localToday } from '@acadlyx/validation';
import { Badge, Card, EmptyState } from '@acadlyx/web-ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pager } from '@/components/people/shared';
import { SearchBox } from '@/components/people/search-box';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';
import { ClassworkActions, ClassworkForm } from './classwork-form';

/**
 * Homework and Assignments pages share this module (one implementation for both kinds, like
 * the API). Teachers see work of the classes they teach and manage only their own subjects —
 * the API enforces this; the UI only reflects the server-computed `can` flags.
 */
const META: Record<
  ClassworkKind,
  {
    title: string;
    noun: string;
    read: 'homework.read' | 'assignment.read';
    manage: 'homework.manage' | 'assignment.manage';
    statuses: string[];
  }
> = {
  homework: {
    title: 'Homework',
    noun: 'homework',
    read: 'homework.read',
    manage: 'homework.manage',
    statuses: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
  },
  assignments: {
    title: 'Assignments',
    noun: 'assignment',
    read: 'assignment.read',
    manage: 'assignment.manage',
    statuses: ['DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED'],
  },
};
const TONE: Record<string, 'neutral' | 'success' | 'warning' | 'info'> = {
  DRAFT: 'warning',
  PUBLISHED: 'success',
  CLOSED: 'info',
  ARCHIVED: 'neutral',
};
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export async function ClassworkListPage({
  kind,
  searchParams,
}: {
  kind: ClassworkKind;
  searchParams: Promise<{ q?: string; status?: string; page?: string; sectionId?: string }>;
}) {
  const m = META[kind];
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can(m.read)) return <NoAccess what={m.noun} />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? '').slice(0, 100);
  const status = m.statuses.includes(sp.status ?? '') ? sp.status : undefined;
  const sectionId =
    sp.sectionId && /^[0-9a-f-]{36}$/i.test(sp.sectionId) ? sp.sectionId : undefined;
  const list = await load(() =>
    ctx.ops.classwork(kind, {
      ...(q ? { q } : {}),
      ...(status ? { status } : {}),
      ...(sectionId ? { sectionId } : {}),
      page,
      pageSize: 20,
    }),
  );
  return (
    <>
      <Breadcrumbs items={[{ label: 'Academics' }, { label: m.title }]} />
      <PageHeader title={m.title}>
        {kind === 'homework'
          ? 'Short class tasks for a class and subject. Drafts are visible only to their author and administrators until published.'
          : 'Formal tasks for a class and subject with a due date. Student submissions arrive with the mobile apps.'}
      </PageHeader>
      {ctx.can(m.manage) ? (
        <p>
          <Link
            href={`/${kind}/new`}
            className="inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            New {m.noun}
          </Link>
        </p>
      ) : null}
      <SearchBox
        base={`/${kind}`}
        q={q}
        label={`Search ${m.noun}`}
        hint="Title"
        hidden={sectionId ? { sectionId } : {}}
        status={{
          value: status ?? '',
          options: [
            { value: '', label: 'Current (not archived)' },
            ...m.statuses.map((s) => ({ value: s, label: label(s) })),
          ],
        }}
      />
      {!list.ok ? (
        <LoadError status={list.status} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title={q || status || sectionId ? `No ${m.noun} matches` : `No ${m.noun} yet`}>
          {!(q || status) && ctx.can(m.manage)
            ? `Create the first ${m.noun} for your class.`
            : null}
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm" data-testid={`${kind}-table`}>
              <caption className="sr-only">{m.title}</caption>
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    Title
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Class
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Subject
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Due
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((i) => (
                  <tr key={i.id} className="border-t border-slate-100">
                    <th scope="row" className="px-4 py-2 font-medium">
                      <Link
                        className="underline-offset-2 hover:underline"
                        href={`/${kind}/${i.id}`}
                      >
                        {i.title}
                      </Link>
                    </th>
                    <td className="px-4 py-2">{i.sectionName}</td>
                    <td className="px-4 py-2">{i.subjectName}</td>
                    <td className="px-4 py-2">
                      <time dateTime={i.dueDate}>{i.dueDate}</time>
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={TONE[i.status] ?? 'neutral'}>{label(i.status)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={page}
            totalPages={list.data.totalPages}
            total={list.data.total}
            base={`/${kind}`}
            params={{ q, status, sectionId }}
          />
        </>
      )}
    </>
  );
}

export async function ClassworkNewPage({ kind }: { kind: ClassworkKind }) {
  const m = META[kind];
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can(m.manage)) return <NoAccess what={`creating ${m.noun}`} />;
  const targets = await load(() => ctx.ops.classworkTargets(kind));
  if (!targets.ok) return <LoadError status={targets.status} />;
  // School-local "today" of the first target's branch (the server re-validates dates anyway).
  const tz = targets.data[0]?.timezone ?? 'UTC';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Academics' },
          { label: m.title, href: `/${kind}` },
          { label: `New ${m.noun}` },
        ]}
      />
      <PageHeader title={`New ${m.noun}`}>
        It is saved as a draft; publish it when ready.
      </PageHeader>
      <Card title="Details">
        <ClassworkForm kind={kind} targets={targets.data} today={localToday(tz)} />
      </Card>
    </>
  );
}

export async function ClassworkDetailPage({
  kind,
  params,
}: {
  kind: ClassworkKind;
  params: Promise<{ id: string }>;
}) {
  const m = META[kind];
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can(m.read)) return <NoAccess what={m.noun} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const item = await load(() => ctx.ops.classworkItem(kind, id));
  if (!item.ok) {
    if (item.status === 404) notFound();
    return <LoadError status={item.status} />;
  }
  const i: ClassworkItem = item.data;
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Academics' }, { label: m.title, href: `/${kind}` }, { label: i.title }]}
      />
      <PageHeader title={i.title}>
        {i.sectionName} · {i.subjectName} · {i.branchName} · {i.academicYearName}
      </PageHeader>
      <dl
        className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm"
        data-testid="classwork-header"
      >
        <div>
          <dt className="text-xs text-slate-500">Status</dt>
          <dd>
            <Badge tone={TONE[i.status] ?? 'neutral'}>{label(i.status)}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Assigned</dt>
          <dd>{i.assignedDate}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Due</dt>
          <dd>{i.dueDate} (school-local date)</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Teacher</dt>
          <dd>{i.teacher?.name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Created by</dt>
          <dd>{i.createdByName ?? '—'}</dd>
        </div>
        {kind === 'assignments' ? (
          <div>
            <dt className="text-xs text-slate-500">Maximum marks</dt>
            <dd>{i.maxMarks ?? 'Feedback only'}</dd>
          </div>
        ) : null}
      </dl>
      {kind === 'assignments' && i.status !== 'DRAFT' && ctx.can('assignment_grade.manage') ? (
        <p>
          <Link
            href={`/assignments/${i.id}/grading`}
            className="inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Submissions &amp; grading
          </Link>
        </p>
      ) : null}
      {i.instructions ? (
        <Card title="Instructions">
          <p className="whitespace-pre-wrap">{i.instructions}</p>
        </Card>
      ) : null}
      <ClassworkActions kind={kind} item={i} />
      {i.can.edit ? (
        <Card title="Edit">
          <ClassworkForm kind={kind} targets={[]} item={i} today={localToday(i.timezone)} />
        </Card>
      ) : null}
    </>
  );
}
