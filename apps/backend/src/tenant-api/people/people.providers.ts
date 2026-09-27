import { ImportProcessor } from '../imports/import.processor.js';
import { ImportRunner } from '../imports/import-runner.js';
import { ImportsService } from '../imports/imports.service.js';
import { AccountsService } from './accounts.service.js';
import { ParentsService } from './parents.service.js';
import { StudentsService } from './students.service.js';
import { TeachersService } from './teachers.service.js';

export const PEOPLE_PROVIDERS = [
  StudentsService,
  ParentsService,
  TeachersService,
  AccountsService,
  ImportsService,
  ImportRunner,
  ImportProcessor,
];
