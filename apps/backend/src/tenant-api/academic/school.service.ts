import type { AcademicSettings, School, SchoolSetupStatus } from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { badRequest, isUniqueViolation } from '../../common/errors/domain-errors.js';
import { ACADEMIC_ERRORS } from './academic-errors.js';
import {
  AcademicStore,
  changedFields,
  definedOnly,
  toAcademicSettings,
  toSchool,
} from './academic-store.js';
import type { UpdateAcademicSettingsDto, UpdateSchoolDto } from './academic.dto.js';

@Injectable()
export class SchoolService {
  constructor(private readonly store: AcademicStore) {}

  get(): Promise<School> {
    return this.store.run(async (tx) => toSchool(await this.store.school(tx)));
  }

  async update(dto: UpdateSchoolDto): Promise<School> {
    try {
      return await this.store.mutate(async (tx, school, events) => {
        const patch = definedOnly(dto);
        const board = patch.board !== undefined ? patch.board : school.board;
        if (board !== 'OTHER') {
          if (patch.boardName) {
            throw badRequest(
              'BOARD_NAME_ONLY_FOR_OTHER',
              'A custom board name is only allowed when the board is Other',
            );
          }
          if (school.boardName !== null) patch.boardName = null;
        }
        const fields = changedFields(school, patch);
        if (fields.length === 0) return toSchool(school);
        const updated = await tx.school.update({ where: { id: school.id }, data: patch });
        events.push({
          action: 'SCHOOL_UPDATED',
          resourceType: 'school',
          resourceId: school.id,
          changedFields: fields,
        });
        return toSchool(updated);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'schools_tenant_code_key'))
        throw ACADEMIC_ERRORS.duplicateSchoolCode();
      throw error;
    }
  }

  settings(): Promise<AcademicSettings> {
    return this.store.run(async (tx) => toAcademicSettings(await this.store.school(tx)));
  }

  updateSettings(dto: UpdateAcademicSettingsDto): Promise<AcademicSettings> {
    return this.store.mutate(async (tx, school, events) => {
      const patch = definedOnly(dto);
      if (patch.workingDays) {
        // Stored in calendar order regardless of how the client listed them.
        const order = [
          'MONDAY',
          'TUESDAY',
          'WEDNESDAY',
          'THURSDAY',
          'FRIDAY',
          'SATURDAY',
          'SUNDAY',
        ];
        patch.workingDays = [...patch.workingDays].sort(
          (a, b) => order.indexOf(a) - order.indexOf(b),
        );
      }
      const fields = changedFields(school, patch);
      if (fields.length === 0) return toAcademicSettings(school);
      const updated = await tx.school.update({ where: { id: school.id }, data: patch });
      events.push({
        action: 'ACADEMIC_CONFIGURATION_UPDATED',
        resourceType: 'school',
        resourceId: school.id,
        changedFields: fields,
      });
      return toAcademicSettings(updated);
    });
  }

  /** Setup progress for the dashboard. Real counts only — no invented metrics. */
  setupStatus(): Promise<SchoolSetupStatus> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const bySchool = { schoolId: school.id };
      const [
        branches,
        activeBranches,
        primary,
        academicYears,
        current,
        grades,
        sections,
        subjects,
        gradeSubjects,
      ] = await Promise.all([
        tx.branch.count({ where: bySchool }),
        tx.branch.count({ where: { ...bySchool, isActive: true } }),
        tx.branch.count({ where: { ...bySchool, isPrimary: true } }),
        tx.academicYear.count({ where: bySchool }),
        tx.academicYear.findFirst({ where: { ...bySchool, isCurrent: true } }),
        tx.grade.count({ where: { ...bySchool, isActive: true } }),
        tx.section.count({ where: { ...bySchool, isActive: true } }),
        tx.subject.count({ where: { ...bySchool, isActive: true } }),
        tx.gradeSubject.count({ where: bySchool }),
      ]);
      return {
        counts: {
          branches,
          activeBranches,
          academicYears,
          grades,
          sections,
          subjects,
          gradeSubjects,
        },
        currentAcademicYear: current ? { id: current.id, name: current.name } : null,
        checklist: {
          schoolProfile: Boolean(school.board && (school.email || school.phone)),
          primaryBranch: primary > 0,
          currentAcademicYear: current !== null,
          grades: grades > 0,
          sections: sections > 0,
          subjects: subjects > 0,
        },
      };
    });
  }
}
