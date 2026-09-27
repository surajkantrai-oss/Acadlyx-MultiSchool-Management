import type { GradeSubject, Subject } from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../../common/errors/domain-errors.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { ACADEMIC_ERRORS } from './academic-errors.js';
import { AcademicStore, changedFields, definedOnly, toSubject } from './academic-store.js';
import type {
  AssignGradeSubjectDto,
  CreateSubjectDto,
  ListSubjectsQueryDto,
  UpdateSubjectDto,
} from './academic.dto.js';
import { findGrade } from './grades.service.js';

/** Subject catalogue of the school plus the grade ↔ subject mapping. */
@Injectable()
export class SubjectsService {
  constructor(private readonly store: AcademicStore) {}

  list(query: ListSubjectsQueryDto): Promise<Subject[]> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const rows = await tx.subject.findMany({
        where: {
          schoolId: school.id,
          ...(query.active ? { isActive: query.active === 'true' } : {}),
          ...(query.q
            ? {
                OR: [
                  { name: { contains: query.q, mode: 'insensitive' } },
                  { code: { contains: query.q.toUpperCase() } },
                ],
              }
            : {}),
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toSubject);
    });
  }

  get(id: string): Promise<Subject> {
    return this.store.run(async (tx) => toSubject(await this.find(tx, id)));
  }

  create(dto: CreateSubjectDto): Promise<Subject> {
    return this.guard(() =>
      this.store.mutate(async (tx, school, events) => {
        await this.assertCodeFree(tx, school.id, dto.code);
        const created = await tx.subject.create({
          data: { tenantId: school.tenantId, schoolId: school.id, name: dto.name, code: dto.code },
        });
        events.push({
          action: 'SUBJECT_CREATED',
          resourceType: 'subject',
          resourceId: created.id,
          changedFields: ['name', 'code'],
          metadata: { code: created.code },
        });
        return toSubject(created);
      }),
    );
  }

  update(id: string, dto: UpdateSubjectDto): Promise<Subject> {
    return this.guard(() =>
      this.store.mutate(async (tx, school, events) => {
        const subject = await this.find(tx, id);
        const patch = definedOnly(dto);
        if (patch.code && patch.code !== subject.code)
          await this.assertCodeFree(tx, school.id, patch.code);
        const fields = changedFields(subject, patch);
        if (fields.length === 0) return toSubject(subject);
        const updated = await tx.subject.update({ where: { id }, data: patch });
        events.push({
          action: 'SUBJECT_UPDATED',
          resourceType: 'subject',
          resourceId: id,
          changedFields: fields,
        });
        return toSubject(updated);
      }),
    );
  }

  setActive(id: string, active: boolean): Promise<Subject> {
    return this.store.mutate(async (tx, _school, events) => {
      const subject = await this.find(tx, id);
      if (subject.isActive === active) return toSubject(subject);
      const updated = await tx.subject.update({ where: { id }, data: { isActive: active } });
      events.push({
        action: active ? 'SUBJECT_ACTIVATED' : 'SUBJECT_DEACTIVATED',
        resourceType: 'subject',
        resourceId: id,
        changedFields: ['isActive'],
      });
      return toSubject(updated);
    });
  }

  gradeSubjects(gradeId: string): Promise<GradeSubject[]> {
    return this.store.run(async (tx) => {
      const grade = await findGrade(this.store, tx, gradeId);
      return this.mappings(tx, grade.id);
    });
  }

  /** Assigns (or updates isRequired of) a subject for a grade. Both must be active to assign. */
  assign(gradeId: string, subjectId: string, dto: AssignGradeSubjectDto): Promise<GradeSubject[]> {
    return this.store.mutate(async (tx, school, events) => {
      const grade = await findGrade(this.store, tx, gradeId);
      const subject = await this.find(tx, subjectId);
      const existing = await tx.gradeSubject.findFirst({ where: { gradeId, subjectId } });
      if (existing) {
        if (dto.isRequired !== undefined && dto.isRequired !== existing.isRequired) {
          await tx.gradeSubject.update({
            where: { id: existing.id },
            data: { isRequired: dto.isRequired },
          });
          events.push({
            action: 'GRADE_SUBJECT_UPDATED',
            resourceType: 'grade_subject',
            resourceId: existing.id,
            changedFields: ['isRequired'],
            metadata: { gradeId, subjectId },
          });
        }
        return this.mappings(tx, grade.id);
      }
      if (!grade.isActive) throw ACADEMIC_ERRORS.gradeInactive();
      if (!subject.isActive) throw ACADEMIC_ERRORS.subjectInactive();
      const last = await tx.gradeSubject.aggregate({
        where: { gradeId },
        _max: { displayOrder: true },
      });
      const created = await tx.gradeSubject.create({
        data: {
          tenantId: school.tenantId,
          schoolId: school.id,
          gradeId,
          subjectId,
          isRequired: dto.isRequired ?? true,
          displayOrder: (last._max.displayOrder ?? -1) + 1,
        },
      });
      events.push({
        action: 'GRADE_SUBJECT_ASSIGNED',
        resourceType: 'grade_subject',
        resourceId: created.id,
        changedFields: ['isRequired'],
        metadata: { gradeId, subjectId },
      });
      return this.mappings(tx, grade.id);
    });
  }

  /** Removes a mapping (a mapping is not historical data; the subject itself remains). */
  remove(gradeId: string, subjectId: string): Promise<GradeSubject[]> {
    return this.store.mutate(async (tx, _school, events) => {
      const grade = await findGrade(this.store, tx, gradeId);
      const existing = await tx.gradeSubject.findFirst({ where: { gradeId: grade.id, subjectId } });
      if (!existing) throw ACADEMIC_ERRORS.gradeSubjectNotFound();
      await tx.gradeSubject.delete({ where: { id: existing.id } });
      events.push({
        action: 'GRADE_SUBJECT_REMOVED',
        resourceType: 'grade_subject',
        resourceId: existing.id,
        metadata: { gradeId, subjectId },
      });
      return this.mappings(tx, grade.id);
    });
  }

  private async mappings(tx: TenantTransaction, gradeId: string): Promise<GradeSubject[]> {
    const rows = await tx.gradeSubject.findMany({
      where: { gradeId },
      include: { subject: true },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      gradeId: r.gradeId,
      subjectId: r.subjectId,
      subjectName: r.subject.name,
      subjectCode: r.subject.code,
      subjectIsActive: r.subject.isActive,
      isRequired: r.isRequired,
      displayOrder: r.displayOrder,
    }));
  }

  private async find(tx: TenantTransaction, id: string) {
    const school = await this.store.school(tx);
    const subject = await tx.subject.findFirst({ where: { id, schoolId: school.id } });
    if (!subject) throw ACADEMIC_ERRORS.subjectNotFound();
    return subject;
  }

  private async assertCodeFree(
    tx: TenantTransaction,
    schoolId: string,
    code: string,
  ): Promise<void> {
    if (await tx.subject.findFirst({ where: { schoolId, code }, select: { id: true } }))
      throw ACADEMIC_ERRORS.duplicateSubjectCode();
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error, 'subjects_school_id_code_key'))
        throw ACADEMIC_ERRORS.duplicateSubjectCode();
      throw error;
    }
  }
}
