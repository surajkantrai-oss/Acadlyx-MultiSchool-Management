import { submissionSchema, SUBMISSION_TEXT_MAX, SUBMISSION_URL_MAX } from '@acadlyx/validation';
import {
  BodyText,
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
  ClassworkKind,
  MobileAttendanceDay,
  MobileLesson,
  MobileStudentHome,
  MobileWorkItem,
  MobileWorkScope,
  TimetableWeek,
} from '@acadlyx/types';
import { type ReactNode, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../../lib/api';
import { errorCode, friendlyError } from '../../lib/errors';
import {
  ATTENDANCE_LABEL,
  dayName,
  dueLabel,
  formatDate,
  formatInstant,
  groupWeek,
  rateLabel,
} from '../../lib/format';
import { useLoad } from '../../lib/use-load';
import { useNav } from '../../nav/navigator';

/*
 * Screens shared by the Student (own data: studentId = null) and a Parent (a verified child:
 * studentId). Every request is authorised on the server from the signed-in user; `viewer` only
 * changes the UI (a parent never sees submission controls — decision C).
 */
export type Viewer = 'STUDENT' | 'PARENT';

export function LessonList({ lessons, empty }: { lessons: MobileLesson[]; empty: string }) {
  if (lessons.length === 0) return <EmptyState title={empty} />;
  return (
    <>
      {lessons.map((l) => (
        <Card key={l.id}>
          <Row>
            <Text style={styles.strong}>{l.subjectName}</Text>
            <Text style={styles.time}>
              {l.startTime}–{l.endTime}
            </Text>
          </Row>
          <Caption>
            {l.periodName} · {l.teacherName}
          </Caption>
        </Card>
      ))}
    </>
  );
}

export function WorkCard({
  item,
  today,
  onPress,
}: {
  item: MobileWorkItem;
  today: string | null;
  onPress: () => void;
}) {
  const due = today ? dueLabel(item.dueDate, today) : `Due ${formatDate(item.dueDate)}`;
  const state =
    item.kind === 'assignments'
      ? item.submission
        ? `Submitted${item.submission.late ? ' late' : ''}`
        : item.status === 'CLOSED'
          ? 'Closed'
          : 'Not submitted'
      : null;
  return (
    <Card
      onPress={onPress}
      testID={`work-${item.id}`}
      accessibilityLabel={`${item.title}, ${item.subjectName}, ${due}${state ? `, ${state}` : ''}`}
    >
      <Text style={styles.strong}>{item.title}</Text>
      <Caption>
        {item.subjectName} · {due}
      </Caption>
      {state ? (
        <View style={styles.chipRow}>
          <Chip
            label={state}
            symbol={item.submission ? '✓' : item.status === 'CLOSED' ? '■' : '○'}
            tone={item.submission ? (item.submission.late ? 'warn' : 'good') : 'neutral'}
          />
        </View>
      ) : null}
    </Card>
  );
}

export function HomeSummary({
  home,
  viewer,
  studentId,
}: {
  home: MobileStudentHome;
  viewer: Viewer;
  studentId: string | null;
}) {
  const nav = useNav();
  const today = home.class?.today ?? null;
  return (
    <>
      <Card>
        <Title>{home.name}</Title>
        <Caption>
          {home.class
            ? `${home.class.className} · ${home.class.branchName} · ${home.class.academicYearName}`
            : 'No current class'}
        </Caption>
        {home.class ? <Caption>Today: {formatDate(home.class.today)}</Caption> : null}
      </Card>
      {!home.class ? (
        <Notice tone="info">
          No current class is set up for {viewer === 'PARENT' ? 'your child' : 'you'} yet. Please
          contact the school.
        </Notice>
      ) : null}
      <Section title="Today’s timetable">
        <LessonList lessons={home.todayLessons} empty="No lessons today" />
      </Section>
      <Section title="Attendance">
        <Card
          onPress={() => nav.push(attendanceRoute(studentId))}
          accessibilityLabel={`Attendance, ${rateLabel(home.attendance?.attendanceRate ?? null)}. Open details`}
        >
          <Text style={styles.strong}>{rateLabel(home.attendance?.attendanceRate ?? null)}</Text>
          {home.attendance ? (
            <Caption>
              {home.attendance.counts.PRESENT} present · {home.attendance.counts.LATE} late ·{' '}
              {home.attendance.counts.ABSENT} absent · {home.attendance.counts.EXCUSED} excused
            </Caption>
          ) : null}
        </Card>
      </Section>
      <Section title="Assignments due">
        {home.assignmentsDue.length === 0 ? (
          <EmptyState title="Nothing due" />
        ) : (
          home.assignmentsDue.map((w) => (
            <WorkCard
              key={w.id}
              item={w}
              today={today}
              onPress={() => nav.push(workDetailRoute(studentId, viewer, w))}
            />
          ))
        )}
      </Section>
      <Section title="Recent homework">
        {home.homework.length === 0 ? (
          <EmptyState title="No homework right now" />
        ) : (
          home.homework.map((w) => (
            <WorkCard
              key={w.id}
              item={w}
              today={today}
              onPress={() => nav.push(workDetailRoute(studentId, viewer, w))}
            />
          ))
        )}
      </Section>
    </>
  );
}

// ---- Attendance -------------------------------------------------------------------------------

export const attendanceRoute = (studentId: string | null) => ({
  key: `attendance-${studentId ?? 'me'}`,
  title: 'Attendance',
  scroll: false,
  render: () => <AttendanceScreen studentId={studentId} />,
});

const PAGE = 20;

export function AttendanceScreen({ studentId }: { studentId: string | null }) {
  const summary = useLoad(() => api.mobile.attendance(studentId), [studentId]);
  const [days, setDays] = useState<MobileAttendanceDay[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const more = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.mobile.attendanceDays(studentId, { page: page + 1, pageSize: PAGE });
      setDays((d) => [...d, ...next.items]);
      setTotal(next.total);
      setPage(next.page);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, [page, studentId]);

  if (summary.loading && !summary.data) return <Loading />;
  if (summary.error) return <ErrorState message={summary.error} onRetry={summary.reload} />;
  const s = summary.data;
  // Virtualised: the marked-days history can grow over years; pages load on demand.
  return (
    <FlatList
      testID="attendance-days"
      data={days}
      keyExtractor={(d) => `${d.date}-${d.className}`}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <>
          <Card>
            <Title>{rateLabel(s?.attendanceRate ?? null)}</Title>
            {s ? <Caption>{s.academicYearName}</Caption> : null}
            <Caption>
              Present and late days count as attended; excused days are not counted.
            </Caption>
            {s ? (
              <View style={styles.chipWrap}>
                {(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as const).map((k) => (
                  <Chip
                    key={k}
                    label={`${ATTENDANCE_LABEL[k].label} ${String(s.counts[k])}`}
                    symbol={ATTENDANCE_LABEL[k].symbol}
                    tone={ATTENDANCE_LABEL[k].tone}
                  />
                ))}
              </View>
            ) : null}
          </Card>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Marked days
          </Text>
        </>
      }
      renderItem={({ item: d }) => (
        <Card>
          <Row>
            <Text style={styles.strong}>{formatDate(d.date)}</Text>
            <Chip
              label={ATTENDANCE_LABEL[d.status].label}
              symbol={ATTENDANCE_LABEL[d.status].symbol}
              tone={ATTENDANCE_LABEL[d.status].tone}
            />
          </Row>
          <Caption>{d.className}</Caption>
          {d.note ? <Caption>Note: {d.note}</Caption> : null}
        </Card>
      )}
      ListEmptyComponent={total === 0 ? <EmptyState title="No days marked yet" /> : null}
      ListFooterComponent={
        <>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {total === null || days.length < total ? (
            <Button
              label={days.length === 0 ? 'Show marked days' : 'Show more'}
              variant="secondary"
              busy={busy}
              onPress={() => void more()}
            />
          ) : null}
        </>
      }
    />
  );
}

// ---- Homework & assignments ---------------------------------------------------------------------

export const workRoute = (studentId: string | null, viewer: Viewer, kind: ClassworkKind) => ({
  key: `work-${kind}-${studentId ?? 'me'}`,
  title: kind === 'homework' ? 'Homework' : 'Assignments',
  scroll: false,
  render: () => <WorkListScreen studentId={studentId} viewer={viewer} kind={kind} />,
});

export function WorkListScreen({
  studentId,
  viewer,
  kind,
  header,
}: {
  studentId: string | null;
  viewer: Viewer;
  kind: ClassworkKind;
  /** Rendered above the list, inside it (so everything scrolls together). */
  header?: ReactNode;
}) {
  const nav = useNav();
  const [scope, setScope] = useState<MobileWorkScope>('current');
  const [page, setPage] = useState(1);
  const list = useLoad(
    () => api.mobile.work(studentId, kind, { scope, page, pageSize: PAGE }),
    [studentId, kind, scope, page],
  );
  // Virtualised list of one server page (≤ 20); Previous/Next keep the server pagination.
  return (
    <FlatList
      testID={`work-list-${kind}`}
      data={list.loading ? [] : (list.data?.items ?? [])}
      keyExtractor={(w) => w.id}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <>
          {header}
          <Segmented
            accessibilityLabel="Which work to show"
            value={scope}
            onChange={(v) => {
              setScope(v);
              setPage(1);
            }}
            options={[
              { value: 'current', label: 'Current' },
              { value: 'past', label: 'Archived' },
            ]}
          />
          {list.loading ? <Loading /> : null}
          {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        </>
      }
      renderItem={({ item: w }) => (
        <WorkCard
          item={w}
          today={null}
          onPress={() => nav.push(workDetailRoute(studentId, viewer, w))}
        />
      )}
      ListEmptyComponent={
        list.data && !list.loading && !list.error ? (
          <EmptyState title={scope === 'current' ? 'Nothing here right now' : 'No archived work'} />
        ) : null
      }
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

export const workDetailRoute = (
  studentId: string | null,
  viewer: Viewer,
  item: MobileWorkItem,
) => ({
  key: `detail-${item.kind}-${item.id}`,
  title: item.kind === 'homework' ? 'Homework' : 'Assignment',
  render: () => (
    <WorkDetailScreen studentId={studentId} viewer={viewer} kind={item.kind} id={item.id} />
  ),
});

export function WorkDetailScreen({
  studentId,
  viewer,
  kind,
  id,
}: {
  studentId: string | null;
  viewer: Viewer;
  kind: ClassworkKind;
  id: string;
}) {
  const item = useLoad(() => api.mobile.workItem(studentId, kind, id), [studentId, kind, id]);
  const [current, setCurrent] = useState<MobileWorkItem | null>(null);
  const w = current ?? item.data;
  if (item.loading && !w) return <Loading />;
  if (item.error && !w) return <ErrorState message={item.error} onRetry={item.reload} />;
  if (!w) return null;
  return (
    <>
      <Title>{w.title}</Title>
      <Caption>
        {w.subjectName} · {w.className}
        {w.teacherName ? ` · ${w.teacherName}` : ''}
      </Caption>
      <View style={styles.chipWrap}>
        <Chip label={`Assigned ${formatDate(w.assignedDate)}`} />
        <Chip
          label={`Due ${formatDate(w.dueDate)}`}
          symbol={w.overdue ? '!' : undefined}
          tone={w.overdue ? 'warn' : 'neutral'}
        />
        {w.status === 'CLOSED' ? <Chip label="Closed" symbol="■" /> : null}
        {w.status === 'ARCHIVED' ? <Chip label="Archived" symbol="■" /> : null}
      </View>
      {w.instructions ? (
        <Card>
          <BodyText>{w.instructions}</BodyText>
        </Card>
      ) : null}
      {kind === 'assignments' ? (
        <SubmissionPanel item={w} viewer={viewer} onChange={setCurrent} onReload={item.reload} />
      ) : null}
    </>
  );
}

// ---- Submission (decisions C–L) -----------------------------------------------------------------

const BLOCKED: Record<string, string> = {
  ASSIGNMENT_CLOSED: 'This assignment is closed. Submissions are read-only.',
  ASSIGNMENT_ARCHIVED: 'This assignment is archived.',
  NOT_IN_CLASS: 'You are no longer in this class, so you can’t submit to it.',
  ACADEMIC_YEAR_CLOSED: 'This academic year is closed.',
};

function SubmissionPanel({
  item,
  viewer,
  onChange,
  onReload,
}: {
  item: MobileWorkItem;
  viewer: Viewer;
  onChange: (item: MobileWorkItem) => void;
  onReload: () => void;
}) {
  const sub = item.submission;
  const [editing, setEditing] = useState(false);
  const tz = item.timezone;
  return (
    <Section title={viewer === 'PARENT' ? 'Your child’s submission' : 'Your submission'}>
      {sub ? (
        <Card>
          <Row>
            <Chip
              label={sub.late ? 'Submitted late' : 'Submitted on time'}
              symbol="✓"
              tone={sub.late ? 'warn' : 'good'}
            />
            <Caption>Version {sub.version}</Caption>
          </Row>
          <Caption>First submitted {formatInstant(sub.firstSubmittedAt, tz)}</Caption>
          {sub.version > 1 ? (
            <Caption>Last updated {formatInstant(sub.lastSubmittedAt, tz)}</Caption>
          ) : null}
          {sub.textContent ? <Text style={styles.answer}>{sub.textContent}</Text> : null}
          {sub.externalUrl ? (
            <Text
              accessibilityRole="link"
              style={styles.link}
              onPress={() => void Linking.openURL(sub.externalUrl ?? '')}
            >
              {sub.externalUrl}
            </Text>
          ) : null}
        </Card>
      ) : (
        <Caption>
          {viewer === 'PARENT' ? 'Not submitted yet.' : 'You haven’t submitted yet.'}
        </Caption>
      )}
      {sub ? <GradePanel item={item} /> : null}
      {viewer === 'STUDENT' && item.blockedReason && item.blockedReason !== 'READ_ONLY' ? (
        <Notice tone="info">{BLOCKED[item.blockedReason] ?? 'Submissions are closed.'}</Notice>
      ) : null}
      {viewer === 'STUDENT' && item.canSubmit && !editing ? (
        <Button
          testID="submission-start"
          label={sub ? 'Update submission' : 'Submit work'}
          onPress={() => setEditing(true)}
        />
      ) : null}
      {viewer === 'STUDENT' && item.canSubmit && editing ? (
        <SubmissionForm
          item={item}
          onDone={(next) => {
            onChange(next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          onReload={onReload}
        />
      ) : null}
    </Section>
  );
}

/**
 * Phase 9 (decisions P/Q): only a PUBLISHED grade of the LATEST submission version is ever sent;
 * after a resubmission the new version shows "Awaiting grading" (an older grade is never reused).
 */
function GradePanel({ item }: { item: MobileWorkItem }) {
  const g = item.grade;
  if (!g)
    return item.awaitingGrading ? (
      <Card testID="grade-awaiting">
        <Chip label="Awaiting grading" symbol="…" />
        <Caption>
          Version {item.submission?.version ?? 1} hasn’t been graded yet.
          {item.maxMarks ? ` Marked out of ${item.maxMarks}.` : ''}
        </Caption>
      </Card>
    ) : null;
  return (
    <Card testID="grade-published">
      <Row>
        <Text style={styles.strong}>
          {g.marksAwarded !== null && g.maxMarks ? `${g.marksAwarded} / ${g.maxMarks}` : 'Feedback'}
        </Text>
        <Chip label="Graded" symbol="✓" tone="good" />
      </Row>
      <Caption>
        For submission version {g.submissionVersion} · {formatInstant(g.publishedAt, item.timezone)}
      </Caption>
      {g.feedback ? <Text style={styles.answer}>{g.feedback}</Text> : null}
    </Card>
  );
}

function SubmissionForm({
  item,
  onDone,
  onCancel,
  onReload,
}: {
  item: MobileWorkItem;
  onDone: (item: MobileWorkItem) => void;
  onCancel: () => void;
  onReload: () => void;
}) {
  const sub = item.submission;
  const [text, setText] = useState(sub?.textContent ?? '');
  const [url, setUrl] = useState(sub?.externalUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const save = async () => {
    const parsed = submissionSchema.safeParse({ text, url });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check your answer');
    setBusy(true); // disabled while in flight — the server also rejects duplicates (version check)
    setError(null);
    try {
      onDone(
        await api.mobile.submit(item.id, {
          text: parsed.data.text,
          url: parsed.data.url,
          expectedVersion: sub?.version ?? 0,
        }),
      );
    } catch (e) {
      // The typed text stays in the form so nothing is lost; nothing is queued for later.
      setError(friendlyError(e));
      setStale(errorCode(e) === 'SUBMISSION_STALE');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Card>
        <Text style={styles.label} nativeID="answer-label">
          Your answer
        </Text>
        <TextInput
          testID="submission-text"
          accessibilityLabel="Your answer"
          accessibilityLabelledBy="answer-label"
          style={[styles.input, styles.multiline]}
          multiline
          maxLength={SUBMISSION_TEXT_MAX}
          value={text}
          onChangeText={setText}
          textAlignVertical="top"
        />
        <Caption>
          {text.length} / {SUBMISSION_TEXT_MAX}
        </Caption>
        <Text style={styles.label} nativeID="link-label">
          Link (optional, must start with https://)
        </Text>
        <TextInput
          testID="submission-url"
          accessibilityLabel="Link, optional, must start with https"
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          maxLength={SUBMISSION_URL_MAX}
          value={url}
          onChangeText={setUrl}
          placeholder="https://"
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        {stale ? <Button label="Reload latest" variant="secondary" onPress={onReload} /> : null}
        {busy ? <ActivityIndicator /> : null}
        <Button
          testID="submission-save"
          label={sub ? 'Save new version' : 'Submit'}
          busy={busy}
          onPress={() => void save()}
        />
        <Button label="Cancel" variant="secondary" disabled={busy} onPress={onCancel} />
      </Card>
    </KeyboardAvoidingView>
  );
}

// ---- Timetable ------------------------------------------------------------------------------

export function WeekView({ week }: { week: TimetableWeek }) {
  const days = groupWeek(week.workingDays, week.entries);
  return (
    <>
      <Caption>
        {week.title} · {week.academicYearName} · times are the school’s local time
      </Caption>
      {days.map(({ day, lessons }) => (
        <Section key={day} title={dayName(day)}>
          {lessons.length === 0 ? (
            <Caption>No lessons</Caption>
          ) : (
            lessons.map((l) => (
              <Card key={l.id}>
                <Row>
                  <Text style={styles.strong}>{l.subjectName}</Text>
                  <Text style={styles.time}>
                    {l.startTime}–{l.endTime}
                  </Text>
                </Row>
                <Caption>
                  {l.periodName} ·{' '}
                  {week.view === 'teacher' ? `${l.sectionName} · ${l.branchName}` : l.teacherName}
                </Caption>
              </Card>
            ))
          )}
        </Section>
      ))}
    </>
  );
}

export function TimetableScreen({ studentId }: { studentId: string | null }) {
  const week = useLoad(() => api.mobile.timetable(studentId), [studentId]);
  if (week.loading && !week.data) return <Loading />;
  if (week.error) return <ErrorState message={week.error} onRetry={week.reload} />;
  return week.data ? <WeekView week={week.data} /> : null;
}

export function WorkHub({ studentId, viewer }: { studentId: string | null; viewer: Viewer }) {
  const [kind, setKind] = useState<ClassworkKind>('assignments');
  return (
    <WorkListScreen
      key={kind}
      studentId={studentId}
      viewer={viewer}
      kind={kind}
      header={
        <Segmented
          accessibilityLabel="Homework or assignments"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'assignments', label: 'Assignments' },
            { value: 'homework', label: 'Homework' },
          ]}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 32 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: tokens.text, marginBottom: 8 },
  strong: { fontSize: 16, fontWeight: '700', color: tokens.text, flexShrink: 1 },
  time: { fontSize: 15, color: tokens.muted, fontVariant: ['tabular-nums'] },
  chipRow: { marginTop: 8 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 },
  answer: { fontSize: 16, color: tokens.text, marginTop: 10, lineHeight: 22 },
  link: { fontSize: 16, color: '#1d4ed8', textDecorationLine: 'underline', marginTop: 8 },
  label: { fontSize: 15, fontWeight: '600', color: tokens.text, marginTop: 8, marginBottom: 4 },
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
  multiline: { minHeight: 140 },
});
