import { RecordNotFound } from '@/components/record-not-found';

/** 404 inside the People area (the tenant was already resolved by the layout). */
export default function PeopleNotFound() {
  return <RecordNotFound back="/" backLabel="Back to the dashboard" />;
}
