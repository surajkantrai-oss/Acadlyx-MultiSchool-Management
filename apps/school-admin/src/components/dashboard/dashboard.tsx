import type { DashboardSummary, ImportJob, ProfileKind } from '@acadlyx/types';
import { Badge, Card } from '@acadlyx/web-ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

const IMPORT_TONE: Record<
  ImportJob['status'],
  'neutral' | 'success' | 'warning' | 'danger' | 'info'
> = {
  READY: 'info',
  QUEUED: 'warning',
  PROCESSING: 'warning',
  COMPLETED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};
const IMPORT_TYPE: Record<ImportJob['type'], string> = {
  STUDENTS: 'Students',
  PARENTS: 'Parents / guardians',
  TEACHERS: 'Teachers',
};
const KIND_LABEL: Record<ProfileKind, string> = {
  students: 'Students',
  parents: 'Parents / guardians',
  teachers: 'Teachers',
};

function Tile({ label, value, href }: { label: string; value: number; href?: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <dt className="text-xs text-slate-500">
        {href ? (
          <Link href={href} className="underline-offset-2 hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </dt>
      <dd className="text-xl font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  // Card renders its own <section> + <h2>; this wrapper only carries the test hook.
  return (
    <div data-testid={testId}>
      <Card title={title}>{children}</Card>
    </div>
  );
}

/**
 * Operational dashboard (Phase 6). Every number comes from the workspace API; blocks the user
 * cannot read are absent from the response and therefore not rendered (no zeroed placeholders,
 * no modules from later phases).
 */
export function Dashboard({ d, contextParams }: { d: DashboardSummary; contextParams: string }) {
  const ctxLabel = [
    d.context.academicYear?.name ?? 'All years',
    d.context.branch?.name ?? 'All branches',
  ].join(' · ');
  const withCtx = (href: string) => `${href}${href.includes('?') ? '&' : '?'}${contextParams}`;
  return (
    <div className="flex flex-col gap-4" data-testid="dashboard">
      <p className="text-sm text-slate-600" data-testid="dashboard-context">
        Showing <strong>{ctxLabel}</strong>
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {d.students ? (
          <Section title="Students" testId="people-summary">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Tile
                label="Active"
                value={d.students.byStatus.ACTIVE}
                href="/people/students?status=ACTIVE"
              />
              <Tile
                label="Enrolled in context"
                value={d.students.enrolled}
                href={withCtx('/classes')}
              />
              <Tile
                label="Inactive"
                value={d.students.byStatus.INACTIVE}
                href="/people/students?status=INACTIVE"
              />
              <Tile
                label="Withdrawn"
                value={d.students.byStatus.WITHDRAWN}
                href="/people/students?status=WITHDRAWN"
              />
              <Tile
                label="Graduated"
                value={d.students.byStatus.GRADUATED}
                href="/people/students?status=GRADUATED"
              />
            </dl>
          </Section>
        ) : null}
        {d.teachers || d.parents || d.classes ? (
          <Section title="Teachers, guardians and classes" testId="dashboard-staff">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {d.teachers ? (
                <>
                  <Tile
                    label="Active teachers"
                    value={d.teachers.byStatus.ACTIVE}
                    href="/people/teachers?status=ACTIVE"
                  />
                  <Tile
                    label="Inactive teachers"
                    value={d.teachers.byStatus.INACTIVE}
                    href="/people/teachers?status=INACTIVE"
                  />
                </>
              ) : null}
              {d.parents ? (
                <>
                  <Tile
                    label="Parents / guardians"
                    value={d.parents.total}
                    href="/people/parents"
                  />
                  <Tile label="Guardian links" value={d.parents.guardianLinks} />
                </>
              ) : null}
              {d.classes ? (
                <>
                  <Tile
                    label="Classes in context"
                    value={d.classes.sections}
                    href={withCtx('/classes')}
                  />
                  <Tile label="Active classes" value={d.classes.activeSections} />
                </>
              ) : null}
            </dl>
          </Section>
        ) : null}
        {d.accounts ? (
          <Section title="Login access" testId="dashboard-accounts">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Login account state by profile type</caption>
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="py-1 pr-3">
                      Profiles
                    </th>
                    <th scope="col" className="py-1 pr-3">
                      No login
                    </th>
                    <th scope="col" className="py-1 pr-3">
                      Pending activation
                    </th>
                    <th scope="col" className="py-1 pr-3">
                      Active
                    </th>
                    <th scope="col" className="py-1">
                      Suspended / disabled
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(KIND_LABEL) as ProfileKind[]).map((k) => {
                    const a = d.accounts?.[k];
                    if (!a) return null;
                    return (
                      <tr key={k} className="border-t border-slate-100">
                        <th scope="row" className="py-1.5 pr-3 font-medium">
                          {KIND_LABEL[k]}
                        </th>
                        <td className="py-1.5 pr-3">
                          <Link
                            className="underline-offset-2 hover:underline"
                            href={`/people/access?kind=${k}&state=NONE`}
                          >
                            {a.NONE}
                          </Link>
                        </td>
                        <td className="py-1.5 pr-3">
                          <Link
                            className="underline-offset-2 hover:underline"
                            href={`/people/access?kind=${k}&state=PENDING_ACTIVATION`}
                          >
                            {a.PENDING_ACTIVATION}
                          </Link>
                        </td>
                        <td className="py-1.5 pr-3">{a.ACTIVE}</td>
                        <td className="py-1.5">{a.SUSPENDED + a.DISABLED}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Many students and guardians never need a login — “No login” is not an error.
            </p>
          </Section>
        ) : null}
        {d.dataQuality ? (
          <Section title="Records to review" testId="dashboard-quality">
            <ul className="flex flex-col gap-2 text-sm">
              <li className="flex justify-between gap-3">
                <Link
                  className="underline-offset-2 hover:underline"
                  href={`/people/students?quality=NO_ENROLLMENT${d.context.academicYear ? `&academicYearId=${d.context.academicYear.id}` : ''}`}
                >
                  Active students not placed in a class
                  {d.context.academicYear ? ` (${d.context.academicYear.name})` : ''}
                </Link>
                <strong>{d.dataQuality.activeStudentsWithoutEnrollment}</strong>
              </li>
              <li className="flex justify-between gap-3">
                <Link
                  className="underline-offset-2 hover:underline"
                  href="/people/students?quality=NO_GUARDIAN"
                >
                  Active students with no guardian linked
                </Link>
                <strong>{d.dataQuality.activeStudentsWithoutGuardian}</strong>
              </li>
              {d.teachers ? (
                <li className="flex justify-between gap-3">
                  <Link
                    className="underline-offset-2 hover:underline"
                    href="/people/teachers?quality=NO_ASSIGNMENT"
                  >
                    Active teachers with no current class
                  </Link>
                  <strong>{d.dataQuality.activeTeachersWithoutAssignment}</strong>
                </li>
              ) : null}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              These can be perfectly valid (for example a teacher who joined this week).
            </p>
          </Section>
        ) : null}
      </div>
      {d.activity ? (
        <Section title="Recent activity" testId="dashboard-activity">
          {d.activity.length === 0 ? (
            <p className="text-sm text-slate-600">No recent activity yet.</p>
          ) : (
            <ol
              className="flex flex-col divide-y divide-slate-100 text-sm"
              aria-label="Most recent school events"
            >
              {d.activity.map((a) => (
                <li
                  key={a.key}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1.5"
                >
                  <span>
                    <span className="font-medium text-slate-900">{a.message}</span>
                    {a.subject ? (
                      <>
                        {' — '}
                        {a.href ? (
                          <Link className="underline-offset-2 hover:underline" href={a.href}>
                            {a.subject}
                          </Link>
                        ) : (
                          a.subject
                        )}
                      </>
                    ) : a.href ? (
                      <>
                        {' — '}
                        <Link className="underline-offset-2 hover:underline" href={a.href}>
                          view
                        </Link>
                      </>
                    ) : null}
                  </span>
                  <span className="text-xs text-slate-500">
                    {a.actorName ? `${a.actorName} · ` : ''}
                    <time dateTime={a.at}>{a.at.slice(0, 16).replace('T', ' ')} UTC</time>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      ) : null}
      {d.imports ? (
        <Section title="Recent imports" testId="dashboard-imports">
          {d.imports.recent.length === 0 ? (
            <p className="text-sm text-slate-600">
              No imports yet.{' '}
              <Link className="underline" href="/people/imports">
                Open bulk import
              </Link>
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Five most recent imports</caption>
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="py-1 pr-3">
                      Import
                    </th>
                    <th scope="col" className="py-1 pr-3">
                      Status
                    </th>
                    <th scope="col" className="py-1 pr-3">
                      Rows
                    </th>
                    <th scope="col" className="py-1 pr-3">
                      Imported
                    </th>
                    <th scope="col" className="py-1 pr-3">
                      Failed
                    </th>
                    <th scope="col" className="py-1">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.imports.recent.map((j) => (
                    <tr key={j.id} className="border-t border-slate-100">
                      <th scope="row" className="py-1.5 pr-3 font-medium">
                        <Link
                          className="underline-offset-2 hover:underline"
                          href={`/people/imports/${j.id}`}
                        >
                          {IMPORT_TYPE[j.type]}
                        </Link>
                      </th>
                      <td className="py-1.5 pr-3">
                        <Badge tone={IMPORT_TONE[j.status]}>{j.status.toLowerCase()}</Badge>
                      </td>
                      <td className="py-1.5 pr-3">{j.totalRows}</td>
                      <td className="py-1.5 pr-3">{j.succeededRows}</td>
                      <td className="py-1.5 pr-3">{j.failedRows}</td>
                      <td className="py-1.5">
                        <time dateTime={j.createdAt}>{j.createdAt.slice(0, 10)}</time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.imports.pending > 0 ? (
            <p className="mt-2 text-sm">
              {d.imports.pending} import(s) waiting for confirmation or processing.
            </p>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}
