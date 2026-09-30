import {
  Button,
  Caption,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Loading,
  Notice,
  Row,
  Section,
  Segmented,
  Title,
  tokens,
} from '@acadlyx/mobile-ui';
import type {
  AttendanceClass,
  AttendanceSheet,
  AttendanceStatus,
  ClassworkItem,
  ClassworkKind,
  ClassworkTarget,
} from '@acadlyx/types';
import {
  addDays,
  classworkSchema,
  localToday,
  TEACHER_ATTENDANCE_WINDOW_DAYS,
  weekdayOf,
} from '@acadlyx/validation';
import { useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../../lib/api';
import { errorCode, friendlyError } from '../../lib/errors';
import { ATTENDANCE_LABEL, dueLabel, formatDate, formatInstant } from '../../lib/format';
import { useLoad } from '../../lib/use-load';
import { useNav } from '../../nav/navigator';
import { WeekView } from '../shared/StudentScreens';

/*
 * Teacher mobile experience (Phase 8). Reuses the Phase 7 APIs and their rules verbatim — the
 * server limits a teacher to their assigned classes (Section) and subjects (Section + Subject),
 * the 7-day attendance window, versioned saves and lifecycles. The app only mirrors that.
 */
const personName = (p: {
  firstName: string;
  middleName?: string | null;
  lastName?: string | null;
}) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');

export function TeacherHome() {
  const nav = useNav();
  const data = useLoad(
    () =>
      Promise.all([
        api.ops.teacherWeek('me').catch(() => null),
        api.ops.attendanceClasses(),
        api.ops.classwork('assignments', { status: 'PUBLISHED', pageSize: 5 }),
        api.ops.classwork('homework', { pageSize: 5 }),
      ]),
    [],
  );
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  if (!data.data) return null;
  const [week, classes, assignments, homework] = data.data;
  const today = classes[0]?.today ?? null;
  const day = today ? weekdayOf(today) : null;
  const lessons = (week?.entries ?? [])
    .filter((e) => e.weekday === day)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const unmarked = classes.filter((c) => !c.markedToday && c.studentCount > 0);
  return (
    <>
      <Section title="Today’s lessons">
        {lessons.length === 0 ? (
          <EmptyState title="No lessons today" />
        ) : (
          lessons.map((l) => (
            <Card key={l.id}>
              <Row>
                <Text style={styles.strong}>{l.subjectName}</Text>
                <Text style={styles.muted}>
                  {l.startTime}–{l.endTime}
                </Text>
              </Row>
              <Caption>
                {l.periodName} · {l.sectionName} · {l.branchName}
              </Caption>
            </Card>
          ))
        )}
      </Section>
      <Section title="Attendance to take today">
        {unmarked.length === 0 ? (
          <EmptyState title="All your classes are marked for today" />
        ) : (
          unmarked.map((c) => (
            <Card
              key={c.sectionId}
              onPress={() => nav.push(sheetRoute(c))}
              accessibilityLabel={`${c.sectionName}, attendance not taken today. Open`}
            >
              <Text style={styles.strong}>{c.sectionName}</Text>
              <Caption>
                {c.branchName} · {c.studentCount} students · not taken yet
              </Caption>
            </Card>
          ))
        )}
      </Section>
      <Section title="Published assignments">
        {assignments.items.length === 0 ? (
          <EmptyState title="No published assignments" />
        ) : (
          assignments.items.map((w) => (
            <WorkRow key={w.id} item={w} today={today} onPress={() => nav.push(detailRoute(w))} />
          ))
        )}
      </Section>
      <Section title="Recent homework">
        {homework.items.length === 0 ? (
          <EmptyState title="No homework yet" />
        ) : (
          homework.items.map((w) => (
            <WorkRow key={w.id} item={w} today={today} onPress={() => nav.push(detailRoute(w))} />
          ))
        )}
      </Section>
      <Button label="My timetable" variant="secondary" onPress={() => nav.push(myTimetableRoute)} />
    </>
  );
}

function WorkRow({
  item,
  today,
  onPress,
}: {
  item: ClassworkItem;
  today: string | null;
  onPress: () => void;
}) {
  const due = today ? dueLabel(item.dueDate, today) : `Due ${formatDate(item.dueDate)}`;
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${item.title}, ${item.sectionName}, ${item.subjectName}, ${item.status}, ${due}`}
    >
      <Text style={styles.strong}>{item.title}</Text>
      <Caption>
        {item.sectionName} · {item.subjectName} · {due}
      </Caption>
      <View style={styles.chipRow}>
        <Chip label={statusLabel(item.status)} symbol={item.status === 'PUBLISHED' ? '●' : '○'} />
      </View>
    </Card>
  );
}
const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export const myTimetableRoute = {
  key: 'my-timetable',
  title: 'My timetable',
  render: () => <MyTimetable />,
};

function MyTimetable() {
  const week = useLoad(() => api.ops.teacherWeek('me'), []);
  if (week.loading && !week.data) return <Loading />;
  if (week.error) return <ErrorState message={week.error} onRetry={week.reload} />;
  return week.data ? (
    <>
      <Notice tone="info">Your timetable is managed by the school office.</Notice>
      <WeekView week={week.data} />
    </>
  ) : null;
}

// ---- Classes & attendance -------------------------------------------------------------------

export function ClassesScreen() {
  const nav = useNav();
  const list = useLoad(() => api.ops.attendanceClasses(), []);
  if (list.loading && !list.data) return <Loading />;
  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;
  if (!list.data || list.data.length === 0)
    return <EmptyState title="No classes assigned" detail="Ask the school office to assign you." />;
  return (
    <FlatList
      testID="classes-list"
      data={list.data}
      keyExtractor={(c) => c.sectionId}
      contentContainerStyle={styles.list}
      renderItem={({ item: c }) => (
        <Card
          testID={`class-${c.sectionId}`}
          onPress={() => nav.push(sheetRoute(c))}
          accessibilityLabel={`${c.sectionName}, ${String(c.studentCount)} students, attendance ${c.markedToday ? 'taken' : 'not taken'} today`}
        >
          <Row>
            <Text style={styles.strong}>{c.sectionName}</Text>
            <Chip
              label={c.markedToday ? 'Taken today' : 'Not taken'}
              symbol={c.markedToday ? '✓' : '○'}
              tone={c.markedToday ? 'good' : 'neutral'}
            />
          </Row>
          <Caption>
            {c.branchName} · {c.studentCount} students
          </Caption>
        </Card>
      )}
    />
  );
}

export const sheetRoute = (c: AttendanceClass) => ({
  key: `sheet-${c.sectionId}`,
  title: `${c.sectionName} attendance`,
  scroll: false,
  render: () => <AttendanceSheetScreen sectionId={c.sectionId} today={c.today} />,
});

const LOCKED: Record<string, string> = {
  FUTURE_DATE: 'Attendance cannot be recorded for a future date.',
  OUTSIDE_TEACHER_WINDOW: `Teachers can record or correct today and the previous ${String(TEACHER_ATTENDANCE_WINDOW_DAYS)} days only.`,
  YEAR_NOT_ACTIVE: 'This academic year is not open for attendance.',
  OUTSIDE_YEAR: 'That date is outside the academic year.',
  READ_ONLY: 'This class is read-only.',
};
const STATUS_ORDER: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];

export function AttendanceSheetScreen({ sectionId, today }: { sectionId: string; today: string }) {
  const [date, setDate] = useState(today);
  const sheet = useLoad(() => api.ops.attendanceSheet(sectionId, date), [sectionId, date]);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const s = sheet.data;
  const dates = Array.from({ length: TEACHER_ATTENDANCE_WINDOW_DAYS + 1 }, (_, i) =>
    addDays(today, -i),
  );

  const statusOf = (sheetRow: AttendanceSheet['roster'][number]) =>
    marks[sheetRow.studentId] ?? sheetRow.status ?? null;
  const dirty = Object.keys(marks).length > 0;

  const save = async () => {
    if (!s) return;
    const records = s.roster
      .map((r) => ({ studentId: r.studentId, status: statusOf(r), note: r.note }))
      .filter(
        (r): r is { studentId: string; status: AttendanceStatus; note: string | null } =>
          r.status !== null,
      );
    setBusy(true);
    setMessage(null);
    try {
      await api.ops.saveAttendance({
        sectionId,
        date,
        ...(s.session ? { expectedVersion: s.session.version } : {}),
        records,
      });
      setMarks({});
      setConflict(false);
      setMessage({ tone: 'info', text: 'Attendance saved.' });
      sheet.reload();
    } catch (e) {
      // Nothing is overwritten or queued: a newer save by someone else is shown for review.
      const code = errorCode(e);
      setConflict(code === 'ATTENDANCE_STALE' || code === 'STALE_VERSION');
      setMessage({ tone: 'error', text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  // Virtualised roster (a section can hold hundreds of students).
  return (
    <FlatList
      testID="attendance-roster"
      data={s?.roster ?? []}
      keyExtractor={(r) => r.studentId}
      contentContainerStyle={styles.list}
      extraData={marks}
      ListHeaderComponent={
        <>
          <Segmented
            accessibilityLabel="Attendance date"
            value={date}
            onChange={(d) => {
              if (dirty) setMessage({ tone: 'info', text: 'Unsaved marks were discarded.' });
              setMarks({});
              setDate(d);
            }}
            options={dates.map((d) => ({
              value: d,
              label: d === today ? 'Today' : formatDate(d).slice(0, 10),
            }))}
          />
          {sheet.loading && !s ? <Loading /> : null}
          {sheet.error ? <ErrorState message={sheet.error} onRetry={sheet.reload} /> : null}
          {s ? (
            <>
              <Caption>
                {formatDate(s.date)} · {s.sectionName} · {s.branchName}
                {s.session?.updatedByName
                  ? ` · Saved by ${s.session.updatedByName} ${formatInstant(s.session.updatedAt, s.timezone)}`
                  : ' · Not taken yet'}
              </Caption>
              {!s.editable && s.lockedReason ? (
                <Notice tone="info">{LOCKED[s.lockedReason] ?? 'This sheet is read-only.'}</Notice>
              ) : null}
              {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
              {conflict ? (
                <Button
                  label="Reload latest attendance"
                  variant="secondary"
                  onPress={() => {
                    setMarks({});
                    setConflict(false);
                    setMessage(null);
                    sheet.reload();
                  }}
                />
              ) : null}
              {s.editable ? (
                <Button
                  testID="mark-all-present"
                  label="Mark all present"
                  variant="secondary"
                  onPress={() =>
                    setMarks(
                      Object.fromEntries(s.roster.map((r) => [r.studentId, 'PRESENT' as const])),
                    )
                  }
                />
              ) : null}
            </>
          ) : null}
        </>
      }
      renderItem={({ item: r }) => {
        if (!s) return null;
        const current = statusOf(r);
        return (
          <Card>
            <Text style={styles.strong}>{personName(r)}</Text>
            <Caption>
              {r.admissionNumber}
              {current ? ` · ${ATTENDANCE_LABEL[current].label}` : ' · Not marked'}
            </Caption>
            {s.editable ? (
              <Segmented
                accessibilityLabel={`Attendance for ${personName(r)}`}
                value={current}
                onChange={(v) => setMarks((m) => ({ ...m, [r.studentId]: v }))}
                options={STATUS_ORDER.map((k) => ({
                  value: k,
                  label: ATTENDANCE_LABEL[k].label, // selected shows ✓ + text; never colour alone
                }))}
              />
            ) : null}
          </Card>
        );
      }}
      ListEmptyComponent={
        s && s.roster.length === 0 ? (
          <EmptyState title="No students in this class on this date" />
        ) : null
      }
      ListFooterComponent={
        s ? (
          <>
            {s.editable && s.roster.length > 0 ? (
              <Button
                testID="attendance-save"
                label={s.session ? 'Save corrections' : 'Save attendance'}
                busy={busy}
                disabled={!dirty && Boolean(s.session)}
                onPress={() => void save()}
              />
            ) : null}
          </>
        ) : null
      }
    />
  );
}

// ---- Homework & assignments -------------------------------------------------------------------

export function TeacherWorkScreen() {
  const nav = useNav();
  const [kind, setKind] = useState<ClassworkKind>('assignments');
  const [page, setPage] = useState(1);
  const list = useLoad(() => api.ops.classwork(kind, { page, pageSize: 20 }), [kind, page]);
  return (
    <FlatList
      testID="teacher-work-list"
      data={list.data?.items ?? []}
      keyExtractor={(w) => w.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <>
          <Segmented
            accessibilityLabel="Homework or assignments"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setPage(1);
            }}
            options={[
              { value: 'assignments', label: 'Assignments' },
              { value: 'homework', label: 'Homework' },
            ]}
          />
          <Button
            testID="work-new"
            label={kind === 'homework' ? 'New homework' : 'New assignment'}
            onPress={() => nav.push(formRoute(kind, list.reload))}
          />
          {list.loading && !list.data ? <Loading /> : null}
          {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        </>
      }
      renderItem={({ item: w }) => (
        <WorkRow item={w} today={null} onPress={() => nav.push(detailRoute(w, list.reload))} />
      )}
      ListEmptyComponent={list.data ? <EmptyState title="Nothing yet" /> : null}
      ListFooterComponent={
        list.data && list.data.totalPages > 1 ? (
          <Row>
            <Button
              label="Previous"
              variant="secondary"
              disabled={page <= 1}
              onPress={() => setPage(page - 1)}
            />
            <Caption>
              Page {page} of {list.data.totalPages}
            </Caption>
            <Button
              label="Next"
              variant="secondary"
              disabled={page >= list.data.totalPages}
              onPress={() => setPage(page + 1)}
            />
          </Row>
        ) : null
      }
    />
  );
}

const formRoute = (kind: ClassworkKind, onSaved: () => void) => ({
  key: `new-${kind}`,
  title: kind === 'homework' ? 'New homework' : 'New assignment',
  render: () => <ClassworkForm kind={kind} onSaved={onSaved} />,
});

function ClassworkForm({ kind, onSaved }: { kind: ClassworkKind; onSaved: () => void }) {
  const nav = useNav();
  const targets = useLoad(() => api.ops.classworkTargets(kind), [kind]);
  const [target, setTarget] = useState<ClassworkTarget | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (targets.loading && !targets.data) return <Loading />;
  if (targets.error) return <ErrorState message={targets.error} onRetry={targets.reload} />;
  if (!targets.data || targets.data.length === 0)
    return <EmptyState title="You have no class and subject to set work for" />;
  // Assigned today — the class's school-local date (branch time zone), never the device's.
  const assigned = target ? localToday(target.timezone) : null;

  const save = async (publish: boolean) => {
    if (!target || !subjectId || !assigned) return setError('Choose a class and subject.');
    const parsed = classworkSchema.safeParse({
      title,
      instructions,
      assignedDate: assigned,
      dueDate: due,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the form');
    setBusy(true);
    setError(null);
    try {
      const created = await api.ops.createClasswork(kind, {
        sectionId: target.sectionId,
        subjectId,
        title: parsed.data.title,
        instructions: parsed.data.instructions ?? null,
        assignedDate: parsed.data.assignedDate,
        dueDate: parsed.data.dueDate,
      });
      if (publish) await api.ops.transitionClasswork(kind, created.id, 'publish', created.version);
      onSaved();
      nav.pop();
    } catch (e) {
      setError(friendlyError(e)); // form contents are kept; nothing is queued
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.label}>Class</Text>
      <Segmented
        accessibilityLabel="Class"
        value={target?.sectionId ?? null}
        onChange={(id) => {
          setTarget(targets.data?.find((t) => t.sectionId === id) ?? null);
          setSubjectId(null);
        }}
        options={targets.data.map((t) => ({ value: t.sectionId, label: `${t.sectionName}` }))}
      />
      {target ? (
        <>
          <Text style={styles.label}>Subject</Text>
          <Segmented
            accessibilityLabel="Subject"
            value={subjectId}
            onChange={setSubjectId}
            options={target.subjects.map((s) => ({ value: s.id, label: s.name }))}
          />
        </>
      ) : null}
      <Text style={styles.label}>Title</Text>
      <TextInput
        testID="work-title"
        accessibilityLabel="Title"
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        maxLength={200}
      />
      <Text style={styles.label}>Instructions (optional)</Text>
      <TextInput
        accessibilityLabel="Instructions, optional"
        style={[styles.input, styles.multiline]}
        multiline
        textAlignVertical="top"
        value={instructions}
        onChangeText={setInstructions}
        maxLength={5000}
      />
      <Text style={styles.label}>Due date</Text>
      {assigned ? (
        <Segmented
          accessibilityLabel="Due date"
          value={due || null}
          onChange={setDue}
          options={[1, 2, 3, 7, 14].map((n) => {
            const d = addDays(assigned, n);
            return { value: d, label: formatDate(d).slice(0, 10) };
          })}
        />
      ) : (
        <Caption>Choose a class first.</Caption>
      )}
      <Caption>Assigned today; due on the selected school-local date.</Caption>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button testID="work-publish" label="Publish" busy={busy} onPress={() => void save(true)} />
      <Button
        label="Save as draft"
        variant="secondary"
        disabled={busy}
        onPress={() => void save(false)}
      />
    </KeyboardAvoidingView>
  );
}

const detailRoute = (item: ClassworkItem, onChanged?: () => void) => ({
  key: `teacher-${item.kind}-${item.id}`,
  title: item.kind === 'homework' ? 'Homework' : 'Assignment',
  render: () => <TeacherWorkDetail kind={item.kind} id={item.id} onChanged={onChanged} />,
});

function TeacherWorkDetail({
  kind,
  id,
  onChanged,
}: {
  kind: ClassworkKind;
  id: string;
  onChanged?: () => void;
}) {
  const nav = useNav();
  const item = useLoad(() => api.ops.classworkItem(kind, id), [kind, id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (item.loading && !item.data) return <Loading />;
  if (item.error) return <ErrorState message={item.error} onRetry={item.reload} />;
  const w = item.data;
  if (!w) return null;
  const act = async (action: 'publish' | 'close' | 'archive') => {
    setBusy(true);
    setError(null);
    try {
      await api.ops.transitionClasswork(kind, w.id, action, w.version);
      item.reload();
      onChanged?.();
    } catch (e) {
      setError(friendlyError(e));
      item.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Title>{w.title}</Title>
      <Caption>
        {w.sectionName} · {w.subjectName}
      </Caption>
      <View style={styles.chipRow}>
        <Chip label={statusLabel(w.status)} symbol={w.status === 'PUBLISHED' ? '●' : '○'} />
      </View>
      <Caption>
        Assigned {formatDate(w.assignedDate)} · Due {formatDate(w.dueDate)}
      </Caption>
      {w.instructions ? (
        <Card>
          <Text style={styles.body}>{w.instructions}</Text>
        </Card>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {w.can.publish ? (
        <Button label="Publish" busy={busy} onPress={() => void act('publish')} />
      ) : null}
      {w.can.close ? (
        <Button
          label="Close submissions"
          variant="secondary"
          busy={busy}
          onPress={() => void act('close')}
        />
      ) : null}
      {w.can.archive ? (
        <Button
          label="Archive"
          variant="secondary"
          busy={busy}
          onPress={() => void act('archive')}
        />
      ) : null}
      {kind === 'assignments' && w.status !== 'DRAFT' ? (
        <Button
          testID="view-submissions"
          label="View submissions"
          variant="secondary"
          onPress={() =>
            nav.push({
              key: `subs-${w.id}`,
              title: 'Submissions',
              scroll: false,
              render: () => <Submissions id={w.id} />,
            })
          }
        />
      ) : null}
    </>
  );
}

function Submissions({ id }: { id: string }) {
  const list = useLoad(() => api.mobile.submissions(id), [id]);
  if (list.loading && !list.data) return <Loading />;
  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;
  const l = list.data;
  if (!l) return null;
  return (
    <FlatList
      testID="submissions-list"
      data={l.rows}
      keyExtractor={(r) => r.studentId}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <>
          <Title>{l.title}</Title>
          <Caption>
            {l.className} · {l.subjectName} · due {formatDate(l.dueDate)}
          </Caption>
          <Notice tone="info">
            {l.submittedCount} of {l.recipientCount} submitted. Submissions are read-only; grading
            comes in a later release.
          </Notice>
        </>
      }
      renderItem={({ item: r }) => (
        <Card>
          <Row>
            <Text style={styles.strong}>{r.name}</Text>
            <Chip
              label={r.submission ? (r.submission.late ? 'Late' : 'On time') : 'Not submitted'}
              symbol={r.submission ? '✓' : '○'}
              tone={r.submission ? (r.submission.late ? 'warn' : 'good') : 'neutral'}
            />
          </Row>
          <Caption>
            {r.admissionNumber}
            {r.submission
              ? ` · submitted ${formatInstant(r.submission.firstSubmittedAt, l.timezone)}${r.submission.version > 1 ? ` · updated ${formatInstant(r.submission.lastSubmittedAt, l.timezone)} (version ${String(r.submission.version)})` : ''}`
              : ''}
          </Caption>
          {r.submission?.textContent ? (
            <Text style={styles.body}>{r.submission.textContent}</Text>
          ) : null}
          {r.submission?.externalUrl ? (
            <Text style={styles.link}>{r.submission.externalUrl}</Text>
          ) : null}
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 32 },
  strong: { fontSize: 16, fontWeight: '700', color: tokens.text, flexShrink: 1 },
  muted: { fontSize: 15, color: tokens.muted },
  body: { fontSize: 16, color: tokens.text, marginTop: 8, lineHeight: 22 },
  link: { fontSize: 15, color: '#1d4ed8', marginTop: 6 },
  chipRow: { marginVertical: 6 },
  label: { fontSize: 15, fontWeight: '600', color: tokens.text, marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: tokens.text,
    backgroundColor: tokens.surface,
    minHeight: 48,
  },
  multiline: { minHeight: 120 },
});
