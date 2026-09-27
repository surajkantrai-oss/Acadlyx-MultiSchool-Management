import type { Section } from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../../common/errors/domain-errors.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { ACADEMIC_ERRORS } from './academic-errors.js';
import {
  AcademicStore,
  assertCompleteOrder,
  changedFields,
  definedOnly,
  toSection,
} from './academic-store.js';
import type {
  CreateSectionDto,
  ListSectionsQueryDto,
  ReorderSectionsDto,
  UpdateSectionDto,
} from './academic.dto.js';

interface Scope {
  branchId: string;
  academicYearId: string;
  gradeId: string;
}

/**
 * Sections are scoped to (branch, academic year, grade): e.g. Grade 5 · A at Main Campus in
 * 2026–27. Composite foreign keys guarantee all three belong to the same school and tenant. A
 * section's scope never changes after creation (not updatable at the database level).
 */
@Injectable()
export class SectionsService {
  constructor(private readonly store: AcademicStore) {}

  list(query: ListSectionsQueryDto): Promise<Section[]> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const rows = await tx.section.findMany({
        where: { schoolId: school.id, ...definedOnly(query) },
        orderBy: [{ grade: { displayOrder: 'asc' } }, { displayOrder: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toSection);
    });
  }

  get(id: string): Promise<Section> {
    return this.store.run(async (tx) => toSection(await this.find(tx, id)));
  }

  create(dto: CreateSectionDto): Promise<Section> {
    return this.guard(() =>
      this.store.mutate(async (tx, school, events) => {
        const scope = {
          branchId: dto.branchId,
          academicYearId: dto.academicYearId,
          gradeId: dto.gradeId,
        };
        await this.assertScopeWritable(tx, school.id, scope);
        await this.assertCodeFree(tx, scope, dto.code);
        const last = await tx.section.aggregate({ where: scope, _max: { displayOrder: true } });
        const created = await tx.section.create({
          data: {
            tenantId: school.tenantId,
            schoolId: school.id,
            ...scope,
            name: dto.name,
            code: dto.code,
            capacity: dto.capacity ?? null,
            displayOrder: (last._max.displayOrder ?? -1) + 1,
          },
        });
        events.push({
          action: 'SECTION_CREATED',
          resourceType: 'section',
          resourceId: created.id,
          changedFields: Object.keys(
            definedOnly({ name: dto.name, code: dto.code, capacity: dto.capacity }),
          ),
          metadata: { ...scope, code: created.code },
        });
        return toSection(created);
      }),
    );
  }

  update(id: string, dto: UpdateSectionDto): Promise<Section> {
    return this.guard(() =>
      this.store.mutate(async (tx, _school, events) => {
        const section = await this.find(tx, id);
        const patch = definedOnly(dto);
        if (patch.code && patch.code !== section.code)
          await this.assertCodeFree(tx, section, patch.code);
        const fields = changedFields(section, patch);
        if (fields.length === 0) return toSection(section);
        const updated = await tx.section.update({ where: { id }, data: patch });
        events.push({
          action: 'SECTION_UPDATED',
          resourceType: 'section',
          resourceId: id,
          changedFields: fields,
        });
        return toSection(updated);
      }),
    );
  }

  setActive(id: string, active: boolean): Promise<Section> {
    return this.store.mutate(async (tx, _school, events) => {
      const section = await this.find(tx, id);
      if (section.isActive === active) return toSection(section);
      const updated = await tx.section.update({ where: { id }, data: { isActive: active } });
      events.push({
        action: active ? 'SECTION_ACTIVATED' : 'SECTION_DEACTIVATED',
        resourceType: 'section',
        resourceId: id,
        changedFields: ['isActive'],
      });
      return toSection(updated);
    });
  }

  reorder(dto: ReorderSectionsDto): Promise<Section[]> {
    return this.store.mutate(async (tx, school, events) => {
      const scope = {
        branchId: dto.branchId,
        academicYearId: dto.academicYearId,
        gradeId: dto.gradeId,
      };
      await this.assertScopeExists(tx, school.id, scope);
      const sections = await tx.section.findMany({
        where: { ...scope, schoolId: school.id },
        select: { id: true },
      });
      assertCompleteOrder(
        sections.map((s) => s.id),
        dto.ids,
      );
      for (const [index, sectionId] of dto.ids.entries()) {
        await tx.section.update({ where: { id: sectionId }, data: { displayOrder: index } });
      }
      events.push({
        action: 'SECTION_REORDERED',
        resourceType: 'section',
        changedFields: ['displayOrder'],
        metadata: { ...scope, count: dto.ids.length },
      });
      const rows = await tx.section.findMany({
        where: { ...scope, schoolId: school.id },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toSection);
    });
  }

  private async find(tx: TenantTransaction, id: string) {
    const school = await this.store.school(tx);
    const section = await tx.section.findFirst({ where: { id, schoolId: school.id } });
    if (!section) throw ACADEMIC_ERRORS.sectionNotFound();
    return section;
  }

  /** Each referenced id must exist in THIS school (other tenants' ids are simply not found). */
  private async assertScopeExists(tx: TenantTransaction, schoolId: string, scope: Scope) {
    const [branch, year, grade] = await Promise.all([
      tx.branch.findFirst({ where: { id: scope.branchId, schoolId } }),
      tx.academicYear.findFirst({ where: { id: scope.academicYearId, schoolId } }),
      tx.grade.findFirst({ where: { id: scope.gradeId, schoolId } }),
    ]);
    if (!branch) throw ACADEMIC_ERRORS.branchNotFound();
    if (!year) throw ACADEMIC_ERRORS.academicYearNotFound();
    if (!grade) throw ACADEMIC_ERRORS.gradeNotFound();
    return { branch, year, grade };
  }

  private async assertScopeWritable(tx: TenantTransaction, schoolId: string, scope: Scope) {
    const { branch, year, grade } = await this.assertScopeExists(tx, schoolId, scope);
    if (!branch.isActive) throw ACADEMIC_ERRORS.branchInactive();
    if (!grade.isActive) throw ACADEMIC_ERRORS.gradeInactive();
    if (year.status === 'CLOSED') throw ACADEMIC_ERRORS.academicYearClosed();
  }

  private async assertCodeFree(tx: TenantTransaction, scope: Scope, code: string): Promise<void> {
    const clash = await tx.section.findFirst({
      where: {
        branchId: scope.branchId,
        academicYearId: scope.academicYearId,
        gradeId: scope.gradeId,
        code,
      },
      select: { id: true },
    });
    if (clash) throw ACADEMIC_ERRORS.duplicateSectionCode();
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error, 'sections_branch_id_academic_year_id_grade_id_code_key'))
        throw ACADEMIC_ERRORS.duplicateSectionCode();
      throw error;
    }
  }
}
