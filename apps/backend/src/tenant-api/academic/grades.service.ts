import type { Grade } from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../../common/errors/domain-errors.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { ACADEMIC_ERRORS } from './academic-errors.js';
import {
  AcademicStore,
  assertCompleteOrder,
  changedFields,
  definedOnly,
  toGrade,
} from './academic-store.js';
import type { CreateGradeDto, UpdateGradeDto } from './academic.dto.js';

/** Grade catalogue: explicit display order (never alphabetical), deactivate instead of delete. */
@Injectable()
export class GradesService {
  constructor(private readonly store: AcademicStore) {}

  list(): Promise<Grade[]> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const rows = await tx.grade.findMany({
        where: { schoolId: school.id },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toGrade);
    });
  }

  get(id: string): Promise<Grade> {
    return this.store.run(async (tx) => toGrade(await findGrade(this.store, tx, id)));
  }

  create(dto: CreateGradeDto): Promise<Grade> {
    return this.guard(() =>
      this.store.mutate(async (tx, school, events) => {
        await this.assertCodeFree(tx, school.id, dto.code);
        const last = await tx.grade.aggregate({
          where: { schoolId: school.id },
          _max: { displayOrder: true },
        });
        const created = await tx.grade.create({
          data: {
            tenantId: school.tenantId,
            schoolId: school.id,
            name: dto.name,
            code: dto.code,
            displayOrder: (last._max.displayOrder ?? -1) + 1,
          },
        });
        events.push({
          action: 'GRADE_CREATED',
          resourceType: 'grade',
          resourceId: created.id,
          changedFields: ['name', 'code'],
          metadata: { code: created.code },
        });
        return toGrade(created);
      }),
    );
  }

  update(id: string, dto: UpdateGradeDto): Promise<Grade> {
    return this.guard(() =>
      this.store.mutate(async (tx, school, events) => {
        const grade = await findGrade(this.store, tx, id);
        const patch = definedOnly(dto);
        if (patch.code && patch.code !== grade.code)
          await this.assertCodeFree(tx, school.id, patch.code);
        const fields = changedFields(grade, patch);
        if (fields.length === 0) return toGrade(grade);
        const updated = await tx.grade.update({ where: { id }, data: patch });
        events.push({
          action: 'GRADE_UPDATED',
          resourceType: 'grade',
          resourceId: id,
          changedFields: fields,
        });
        return toGrade(updated);
      }),
    );
  }

  setActive(id: string, active: boolean): Promise<Grade> {
    return this.store.mutate(async (tx, _school, events) => {
      const grade = await findGrade(this.store, tx, id);
      if (grade.isActive === active) return toGrade(grade);
      const updated = await tx.grade.update({ where: { id }, data: { isActive: active } });
      events.push({
        action: active ? 'GRADE_ACTIVATED' : 'GRADE_DEACTIVATED',
        resourceType: 'grade',
        resourceId: id,
        changedFields: ['isActive'],
      });
      return toGrade(updated);
    });
  }

  /** Complete new order in one transaction (deferred unique constraint allows the permutation). */
  reorder(ids: string[]): Promise<Grade[]> {
    return this.store.mutate(async (tx, school, events) => {
      const grades = await tx.grade.findMany({
        where: { schoolId: school.id },
        select: { id: true },
      });
      assertCompleteOrder(
        grades.map((g) => g.id),
        ids,
      );
      for (const [index, gradeId] of ids.entries()) {
        await tx.grade.update({ where: { id: gradeId }, data: { displayOrder: index } });
      }
      events.push({
        action: 'GRADE_REORDERED',
        resourceType: 'grade',
        changedFields: ['displayOrder'],
        metadata: { count: ids.length },
      });
      const rows = await tx.grade.findMany({
        where: { schoolId: school.id },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toGrade);
    });
  }

  private async assertCodeFree(
    tx: TenantTransaction,
    schoolId: string,
    code: string,
  ): Promise<void> {
    if (await tx.grade.findFirst({ where: { schoolId, code }, select: { id: true } }))
      throw ACADEMIC_ERRORS.duplicateGradeCode();
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error, 'grades_school_id_code_key'))
        throw ACADEMIC_ERRORS.duplicateGradeCode();
      throw error;
    }
  }
}

export async function findGrade(store: AcademicStore, tx: TenantTransaction, id: string) {
  const school = await store.school(tx);
  const grade = await tx.grade.findFirst({ where: { id, schoolId: school.id } });
  if (!grade) throw ACADEMIC_ERRORS.gradeNotFound();
  return grade;
}
