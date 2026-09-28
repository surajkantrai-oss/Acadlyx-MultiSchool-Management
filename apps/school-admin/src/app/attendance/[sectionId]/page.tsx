import { isIsoDate } from '@acadlyx/validation';
import { addDays } from '@acadlyx/validation';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AttendanceSheetEditor } from '@/components/operations/attendance-sheet';
import { Pager } from '@/components/people/shared';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

const STATUS_LABEL = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  EXCUSED: 'Excused',
} as const;

/**
 * One class on one school-local date: the roster sheet (editable within the caller's rules),
 * date navigation, the recent attendance days (paginated) and the correction log.
 */
export default async function AttendanceSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ date?: string; page?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('attendance.read')) return <NoAccess what="attendance" />;
  const { sectionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(sectionId)) notFound();
  const sp = await searchParams;
  const date = sp.date && isIsoDate(sp.date) ? sp.date : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const sheet = await load(() => ctx.ops.attendanceSheet(sectionId, date));
  if (!sheet.ok) {
    if (sheet.status === 404) notFound();
    return <LoadError status={sheet.status} />;
  }
  const s = sheet.data;
  const [history, changes] = await Promise.all([
    load(() => ctx.ops.attendanceHistory(sectionId, { page, pageSize: 10 })),
    s.session ? load(() => ctx.ops.attendanceChanges(sectionId, s.date)) : null,
  ]);
  const href = (d: string) => `/attendance/${sectionId}?date=${d}`;
  const corrections = changes?.ok
    ? changes.data.filter((c) => c.fromStatus !== null || c.fromNote !== null)
    : [];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Academics' },
          { label: 'Attendance', href: '/attendance' },
          { label: s.sectionName },
        ]}
      />
      <PageHeader title={`${s.sectionName} — attendance`}>
        {s.branchName} · {s.academicYearName} · times and dates are school-local ({s.timezone})
      </PageHeader>

      <nav aria-label="Attendance date" className="flex flex-wrap items-end gap-3">
        <Link
          className="rounded-md px-3 py-1.5 text-sm ring-1 ring-slate-300 hover:bg-white"
          href={href(addDays(s.date, -1))}
        >
          ← Previous day
        </Link>
        <form method="get" className="flex items-end gap-2">
          <label className="flex flex-col text-xs font-medium text-slate-600">
            Date
            <input
              type="date"
              name="date"
              defaultValue={s.date}
              max={s.today}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-md px-3 py-1.5 text-sm ring-1 ring-slate-300 hover:bg-white"
          >
            Go
          </button>
        </form>
        {s.date < s.today ? (
          <Link
            className="rounded-md px-3 py-1.5 text-sm ring-1 ring-slate-300 hover:bg-white"
            href={href(addDays(s.date, 1))}
          >
            Next day →
          </Link>
        ) : null}
        {s.date !== s.today ? (
          <Link className="text-sm underline" href={href(s.today)}>
            Today
          </Link>
        ) : null}
      </nav>

      <AttendanceSheetEditor sheet={s} />

      {corrections.length ? (
        <section
          aria-labelledby="corrections-heading"
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="corrections-heading" className="text-base font-semibold">
            Corrections on {s.date}
          </h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="attendance-corrections">
              <caption className="sr-only">
                Corrections to this day’s attendance, newest first
              </caption>
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="py-1 pr-3">
                    When
                  </th>
                  <th scope="col" className="py-1 pr-3">
                    Student
                  </th>
                  <th scope="col" className="py-1 pr-3">
                    Change
                  </th>
                  <th scope="col" className="py-1">
                    By
                  </th>
                </tr>
              </thead>
              <tbody>
                {corrections.map((c) => (
                  <tr key={`${c.at}-${c.admissionNumber}`} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3">
                      <time dateTime={c.at}>{c.at.slice(0, 16).replace('T', ' ')} UTC</time>
                    </td>
                    <th scope="row" className="py-1.5 pr-3 font-medium">
                      {c.studentName}{' '}
                      <span className="font-mono text-xs text-slate-500">{c.admissionNumber}</span>
                    </th>
                    <td className="py-1.5 pr-3">
                      {c.fromStatus ? STATUS_LABEL[c.fromStatus] : '—'} → {STATUS_LABEL[c.toStatus]}
                      {c.toNote !== c.fromNote ? (
                        <span className="text-slate-500"> (note updated)</span>
                      ) : null}
                    </td>
                    <td className="py-1.5">{c.changedByName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="history-heading" className="flex flex-col gap-3">
        <h2 id="history-heading" className="text-lg font-semibold">
          Recorded days
        </h2>
        {!history.ok ? (
          <LoadError status={history.status} />
        ) : history.data.items.length === 0 ? (
          <p className="text-sm text-slate-600">
            No attendance has been recorded for this class yet.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm" data-testid="attendance-history">
                <caption className="sr-only">Recorded attendance days, newest first</caption>
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2">
                      Date
                    </th>
                    <th scope="col" className="px-4 py-2 text-right">
                      Present
                    </th>
                    <th scope="col" className="px-4 py-2 text-right">
                      Absent
                    </th>
                    <th scope="col" className="px-4 py-2 text-right">
                      Late
                    </th>
                    <th scope="col" className="px-4 py-2 text-right">
                      Excused
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.items.map((d) => (
                    <tr key={d.sessionId} className="border-t border-slate-100">
                      <th scope="row" className="px-4 py-2 font-medium">
                        <Link className="underline-offset-2 hover:underline" href={href(d.date)}>
                          {d.date}
                        </Link>
                      </th>
                      <td className="px-4 py-2 text-right">{d.counts.PRESENT}</td>
                      <td className="px-4 py-2 text-right">{d.counts.ABSENT}</td>
                      <td className="px-4 py-2 text-right">{d.counts.LATE}</td>
                      <td className="px-4 py-2 text-right">{d.counts.EXCUSED}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={page}
              totalPages={history.data.totalPages}
              total={history.data.total}
              base={`/attendance/${sectionId}`}
              params={{ date: s.date }}
            />
          </>
        )}
      </section>
    </>
  );
}
