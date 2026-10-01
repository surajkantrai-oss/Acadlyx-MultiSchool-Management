import {
  Caption,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Loading,
  Row,
  Section,
  Title,
  tokens,
  useTheme,
} from '@acadlyx/mobile-ui';
import type { PublishedResultSummary, ReportCard, SubjectResultView } from '@acadlyx/types';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { api } from '../../lib/api';
import { componentLabel, formatDate, OUTCOME_LABEL, outcomeTone } from '../../lib/format';
import { useLoad } from '../../lib/use-load';
import { useNav } from '../../nav/navigator';

/*
 * Results (Phase 9, decision L/M). Parents (a verified child: studentId) and students (own:
 * studentId = null) only ever read the CURRENT published snapshot — the server never returns live
 * or unpublished marks to these routes, and authorises the child from the signed-in parent.
 */

export function ResultsScreen({ studentId }: { studentId: string | null }) {
  const nav = useNav();
  const list = useLoad(() => api.mobile.results(studentId), [studentId]);
  return (
    <FlatList
      testID="results-list"
      data={list.data ?? []}
      keyExtractor={(r) => r.examId}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <>
          {list.loading && !list.data ? <Loading /> : null}
          {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        </>
      }
      renderItem={({ item }) => (
        <ResultCard item={item} onPress={() => nav.push(reportCardRoute(studentId, item))} />
      )}
      ListEmptyComponent={
        list.data && !list.error ? (
          <EmptyState
            title="No published results yet"
            detail="Results appear here once the school publishes them."
          />
        ) : null
      }
    />
  );
}

function ResultCard({ item, onPress }: { item: PublishedResultSummary; onPress: () => void }) {
  const summary = [
    item.percentageDisplay ? `${item.percentageDisplay}%` : null,
    item.grade ? `Grade ${item.grade}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card
      onPress={onPress}
      testID={`result-${item.examId}`}
      accessibilityLabel={`${item.examName}, ${item.academicYearName}, ${OUTCOME_LABEL[item.status]}${summary ? `, ${summary}` : ''}`}
    >
      <Text style={styles.strong}>{item.examName}</Text>
      <Caption>
        {item.academicYearName} · Published {formatDate(item.publishedAt.slice(0, 10))}
      </Caption>
      <View style={styles.chipRow}>
        <Chip label={OUTCOME_LABEL[item.status]} {...outcomeTone(item.status)} />
        {summary ? <Caption>{summary}</Caption> : null}
      </View>
    </Card>
  );
}

const reportCardRoute = (studentId: string | null, item: PublishedResultSummary) => ({
  key: `result-${item.examId}-${studentId ?? 'me'}`,
  title: item.examName,
  render: () => <ReportCardScreen studentId={studentId} examId={item.examId} />,
});

export function ReportCardScreen({
  studentId,
  examId,
}: {
  studentId: string | null;
  examId: string;
}) {
  const card = useLoad(() => api.mobile.reportCard(studentId, examId), [studentId, examId]);
  if (card.loading && !card.data) return <Loading />;
  if (card.error && !card.data) return <ErrorState message={card.error} onRetry={card.reload} />;
  return card.data ? <ReportCardView card={card.data} /> : null;
}

export function ReportCardView({ card }: { card: ReportCard }) {
  const theme = useTheme();
  return (
    <View testID="report-card">
      {/* School branding is server-driven (white-label theme + the snapshot's school name). */}
      <View style={[styles.brandBar, { backgroundColor: theme.brand }]}>
        <Text maxFontSizeMultiplier={1.6} style={[styles.brandText, { color: theme.onBrand }]}>
          {card.schoolName}
        </Text>
      </View>
      <Card>
        <Title>{card.studentName}</Title>
        <Caption>Admission no. {card.admissionNumber}</Caption>
        <Caption>
          {card.gradeName} · Section {card.sectionName}
        </Caption>
        <Caption>
          {card.examName} · {card.academicYearName}
        </Caption>
        {card.publicationVersion ? (
          <Caption>
            Result version {card.publicationVersion}
            {card.publishedAt ? ` · published ${formatDate(card.publishedAt.slice(0, 10))}` : ''}
          </Caption>
        ) : null}
      </Card>

      <Section title="Overall">
        <Card testID="overall">
          <Row>
            <Chip label={OUTCOME_LABEL[card.status]} {...outcomeTone(card.status)} />
            {card.grade ? <Text style={styles.strong}>Grade {card.grade}</Text> : null}
          </Row>
          <Text style={styles.big}>
            {card.obtained} / {card.maxMarks}
          </Text>
          {card.percentageDisplay ? <Caption>{card.percentageDisplay}%</Caption> : null}
        </Card>
      </Section>

      <Section title="Subjects">
        {card.subjects.map((s) => (
          <SubjectCard key={s.subjectName} subject={s} />
        ))}
      </Section>

      {card.remark ? (
        <Section title="Class teacher’s remark">
          <Card>
            <Text style={styles.body}>{card.remark}</Text>
          </Card>
        </Section>
      ) : null}
    </View>
  );
}

function SubjectCard({ subject: s }: { subject: SubjectResultView }) {
  return (
    <Card testID={`subject-${s.subjectName}`}>
      <Row>
        <Text style={styles.strong}>{s.subjectName}</Text>
        <Chip label={OUTCOME_LABEL[s.outcome]} {...outcomeTone(s.outcome)} />
      </Row>
      {s.outcome === 'EXEMPT' ? (
        <Caption>Exempt from this subject</Caption>
      ) : (
        <Caption>
          {s.obtained ?? '—'} / {s.maxMarks ?? '—'}
          {s.percentageDisplay ? ` · ${s.percentageDisplay}%` : ''}
          {s.grade ? ` · Grade ${s.grade}` : ''}
        </Caption>
      )}
      {s.components.length > 1 || s.components.some((c) => c.status !== 'MARKED') ? (
        <View style={styles.components}>
          {s.components.map((c) => (
            <View key={c.name} style={styles.componentRow}>
              <Text style={styles.componentName}>{c.name}</Text>
              <Text style={styles.componentValue}>{componentLabel(c)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 32 },
  strong: { fontSize: 16, fontWeight: '700', color: tokens.text, flexShrink: 1 },
  big: { fontSize: 24, fontWeight: '700', color: tokens.text, marginTop: 6 },
  body: { fontSize: 16, color: tokens.text, lineHeight: 22 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  brandBar: { borderRadius: 8, padding: 12, marginBottom: 8 },
  brandText: { fontSize: 18, fontWeight: '700' },
  components: { marginTop: 8, borderTopWidth: 1, borderTopColor: tokens.border, paddingTop: 6 },
  componentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 2,
  },
  componentName: { fontSize: 14, color: tokens.subtle, flexShrink: 1 },
  componentValue: { fontSize: 14, color: tokens.text },
});
