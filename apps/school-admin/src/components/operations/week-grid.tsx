import type { TimetableEntry, TimetableWeek, Weekday } from '@acadlyx/types';

const DAY: Record<Weekday, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
  SATURDAY: 'Saturday',
  SUNDAY: 'Sunday',
};
const TYPE: Record<string, string> = { BREAK: 'Break', LUNCH: 'Lunch', ASSEMBLY: 'Assembly' };

/**
 * Weekly timetable as a real data table: rows = periods (with times), columns = the school's
 * working days. Every lesson cell carries a full text description for assistive technology
 * ("Monday, P2 10:00–10:45, Mathematics, Grade 5 A, Ravi Kumar"); nothing relies on colour.
 */
export function WeekGrid({
  week,
  renderActions,
}: {
  week: TimetableWeek;
  renderActions?: (entry: TimetableEntry) => React.ReactNode;
}) {
  if (week.periods.length === 0)
    return (
      <p
        className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600"
        data-testid="timetable-empty"
      >
        {week.view === 'teacher'
          ? 'No lessons are scheduled for this teacher yet.'
          : 'No periods are configured for this branch and academic year yet.'}
      </p>
    );
  const at = new Map(week.entries.map((e) => [`${e.periodId}:${e.weekday}`, e]));
  const byTime = week.view === 'teacher';
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table
        className="w-full min-w-[40rem] border-collapse text-left text-sm"
        data-testid="timetable-grid"
      >
        <caption className="sr-only">
          Weekly timetable: {week.title}, {week.academicYearName}
        </caption>
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th scope="col" className="w-32 px-3 py-2">
              Period
            </th>
            {week.workingDays.map((d) => (
              <th key={d} scope="col" className="px-3 py-2">
                {DAY[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {week.periods.map((p) => {
            const instructional = p.type === 'INSTRUCTIONAL';
            return (
              <tr
                key={p.id}
                className={`border-t border-slate-100 align-top ${instructional ? '' : 'bg-slate-50'}`}
              >
                <th scope="row" className="px-3 py-2 font-medium">
                  {p.name}
                  <span className="block text-xs font-normal text-slate-500">
                    {p.startTime}–{p.endTime}
                    {instructional ? '' : ` · ${TYPE[p.type] ?? ''}`}
                  </span>
                </th>
                {week.workingDays.map((d) => {
                  if (!instructional)
                    return (
                      <td key={d} className="px-3 py-2 text-xs text-slate-500">
                        <span className="sr-only">
                          {DAY[d]}, {p.name}:{' '}
                        </span>
                        {TYPE[p.type]}
                      </td>
                    );
                  const e = byTime
                    ? week.entries.find((x) => x.weekday === d && x.periodId === p.id)
                    : at.get(`${p.id}:${d}`);
                  return (
                    <td key={d} className="px-3 py-2">
                      {e ? (
                        <div
                          role="group"
                          className="rounded-md bg-slate-100 px-2 py-1"
                          aria-label={`${DAY[d]}, ${p.name} ${p.startTime} to ${p.endTime}, ${e.subjectName}, ${e.sectionName}, ${e.teacherName}`}
                        >
                          <p className="font-medium" aria-hidden="true">
                            {e.subjectName}
                          </p>
                          <p className="text-xs text-slate-600" aria-hidden="true">
                            {week.view === 'teacher'
                              ? `${e.sectionName} · ${e.branchName}`
                              : e.teacherName}
                          </p>
                          {renderActions ? <div className="mt-1">{renderActions(e)}</div> : null}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">
                          <span className="sr-only">
                            {DAY[d]}, {p.name}:{' '}
                          </span>
                          Free
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
