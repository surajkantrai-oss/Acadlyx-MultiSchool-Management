import { RecordNotFound } from '@/components/record-not-found';

/** 404 for a class that does not exist or is outside the user's scope. */
export default function ClassNotFound() {
  return <RecordNotFound back="/classes" backLabel="Back to classes" />;
}
