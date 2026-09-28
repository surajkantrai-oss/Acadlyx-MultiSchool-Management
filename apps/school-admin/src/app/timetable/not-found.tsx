import { RecordNotFound } from '@/components/record-not-found';

/** 404 for a timetable (class or teacher) that does not exist or is outside the user's scope. */
export default function TimetableNotFound() {
  return <RecordNotFound back="/timetable" backLabel="Back to timetable" />;
}
