'use client';

import { usePathname } from 'next/navigation';
import { Breadcrumbs } from './breadcrumbs';

const PAGES: Record<string, [string, string]> = {
  '/settings/school': ['School setup', 'School profile'],
  '/settings/branches': ['School setup', 'Branches'],
  '/settings/academic-years': ['School setup', 'Academic years'],
  '/settings/academic': ['School setup', 'Academic settings'],
  '/settings/grades': ['Academics', 'Grades & sections'],
  '/settings/subjects': ['Academics', 'Subjects'],
};

/** Breadcrumb for the Phase 4 setup pages, matching the workspace navigation groups. */
export function SettingsCrumbs() {
  const page = PAGES[usePathname()];
  return page ? <Breadcrumbs items={[{ label: page[0] }, { label: page[1] }]} /> : null;
}
