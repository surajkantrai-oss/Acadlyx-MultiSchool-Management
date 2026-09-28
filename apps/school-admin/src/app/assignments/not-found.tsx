import { RecordNotFound } from '@/components/record-not-found';

/** 404 for work that does not exist or is outside the user's scope. */
export default function NotFound() {
  return <RecordNotFound back="/assignments" backLabel="Back to the list" />;
}
