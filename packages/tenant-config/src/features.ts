/**
 * Central registry of Acadlyx modules that can be enabled per tenant (blueprint §2.1, §4.4).
 *
 * This is configuration only: listing a feature here does NOT implement it. Modules are built
 * in their own phases. Adding a module = adding an entry here; no schema migration required.
 */
export const FEATURE_REGISTRY = [
  { key: 'STUDENTS', label: 'Students', group: 'People' },
  { key: 'PARENTS', label: 'Parents', group: 'People' },
  { key: 'TEACHERS', label: 'Teachers', group: 'People' },
  { key: 'ATTENDANCE', label: 'Attendance', group: 'Academics' },
  { key: 'HOMEWORK', label: 'Homework', group: 'Academics' },
  { key: 'ASSIGNMENTS', label: 'Assignments', group: 'Academics' },
  { key: 'STUDY_MATERIALS', label: 'Study materials', group: 'Academics' },
  { key: 'TIMETABLE', label: 'Timetable', group: 'Academics' },
  { key: 'EXAMS', label: 'Exams', group: 'Assessment' },
  { key: 'RESULTS', label: 'Results & report cards', group: 'Assessment' },
  { key: 'FEES', label: 'Fees', group: 'Finance' },
  { key: 'PAYMENTS', label: 'Online payments', group: 'Finance' },
  { key: 'LEAVE', label: 'Student leave', group: 'Operations' },
  { key: 'NOTICES', label: 'Notices', group: 'Communication' },
  { key: 'EVENTS', label: 'Events & calendar', group: 'Communication' },
  { key: 'DOCUMENTS', label: 'Documents', group: 'Communication' },
  { key: 'MESSAGING', label: 'Messaging', group: 'Communication' },
  { key: 'ADMISSIONS', label: 'Admissions', group: 'Operations' },
  { key: 'TRANSPORT', label: 'Transport', group: 'Operations' },
  { key: 'ANALYTICS', label: 'Analytics', group: 'Operations' },
] as const;

export type FeatureKey = (typeof FEATURE_REGISTRY)[number]['key'];
export type FeatureDefinition = (typeof FEATURE_REGISTRY)[number];

export const FEATURE_KEYS: readonly FeatureKey[] = FEATURE_REGISTRY.map((f) => f.key);

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}
