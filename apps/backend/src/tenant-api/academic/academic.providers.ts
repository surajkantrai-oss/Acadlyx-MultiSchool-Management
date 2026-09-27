import { AcademicStore } from './academic-store.js';
import { AcademicYearsService } from './academic-years.service.js';
import { BranchesService } from './branches.service.js';
import { GradesService } from './grades.service.js';
import { SchoolService } from './school.service.js';
import { SectionsService } from './sections.service.js';
import { SubjectsService } from './subjects.service.js';

export const ACADEMIC_PROVIDERS = [
  AcademicStore,
  SchoolService,
  BranchesService,
  AcademicYearsService,
  GradesService,
  SectionsService,
  SubjectsService,
];
