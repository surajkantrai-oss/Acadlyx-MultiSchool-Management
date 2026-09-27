import type { AcademicYear } from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../../common/errors/domain-errors.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { ACADEMIC_ERRORS } from './academic-errors.js';
import {
  AcademicStore,
  changedFields,
  definedOnly,
  fromIsoDate,
  isoDate,
  toAcademicYear,
} from './academic-store.js';
import type { CreateAcademicYearDto, UpdateAcademicYearDto } from './academic.dto.js';

/**
 * Academic years. Lifecycle PLANNED → ACTIVE → CLOSED (one-way); dates are editable only while
 * PLANNED (later phases attach enrollments, attendance, exams and fees to a year); exactly one
 * current year per school and only an ACTIVE one; date ranges of one school never overlap
 * (service check under the school lock + database exclusion constraint as backstop).
 */
@Injectable()
export class AcademicYearsService {
  constructor(private readonly store: AcademicStore) {}

  list(): Promise<AcademicYear[]> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const rows = await tx.academicYear.findMany({
        where: { schoolId: school.id },
        orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
      });
      return rows.map(toAcademicYear);
    });
  }

  get(id: string): Promise<AcademicYear> {
    return this.store.run(async (tx) => toAcademicYear(await this.find(tx, id)));
  }

  create(dto: CreateAcademicYearDto): Promise<AcademicYear> {
    return this.guard(() =>
      this.store.mutate(async (tx, school, events) => {
        if (dto.startDate >= dto.endDate) throw ACADEMIC_ERRORS.invalidDates();
        await this.assertNameFree(tx, school.id, dto.name);
        await this.assertNoOverlap(tx, school.id, dto.startDate, dto.endDate);
        const created = await tx.academicYear.create({
          data: {
            tenantId: school.tenantId,
            schoolId: school.id,
            name: dto.name,
            startDate: fromIsoDate(dto.startDate),
            endDate: fromIsoDate(dto.endDate),
            status: 'PLANNED',
            isCurrent: false,
          },
        });
        events.push({
          action: 'ACADEMIC_YEAR_CREATED',
          resourceType: 'academic_year',
          resourceId: created.id,
          changedFields: ['name', 'startDate', 'endDate'],
          metadata: { startDate: dto.startDate, endDate: dto.endDate },
        });
        return toAcademicYear(created);
      }),
    );
  }

  update(id: string, dto: UpdateAcademicYearDto): Promise<AcademicYear> {
    return this.guard(() =>
      this.store.mutate(async (tx, school, events) => {
        const year = await this.find(tx, id);
        const start = dto.startDate ?? isoDate(year.startDate);
        const end = dto.endDate ?? isoDate(year.endDate);
        const datesChange = start !== isoDate(year.startDate) || end !== isoDate(year.endDate);
        if (datesChange && year.status !== 'PLANNED')
          throw ACADEMIC_ERRORS.academicYearDatesLocked();
        if (start >= end) throw ACADEMIC_ERRORS.invalidDates();
        if (dto.name !== undefined && dto.name !== year.name)
          await this.assertNameFree(tx, school.id, dto.name);
        if (datesChange) await this.assertNoOverlap(tx, school.id, start, end, id);
        const patch = definedOnly({
          name: dto.name,
          startDate: dto.startDate ? fromIsoDate(start) : undefined,
          endDate: dto.endDate ? fromIsoDate(end) : undefined,
        });
        const fields = changedFields(year, patch);
        if (fields.length === 0) return toAcademicYear(year);
        const updated = await tx.academicYear.update({ where: { id }, data: patch });
        events.push({
          action: 'ACADEMIC_YEAR_UPDATED',
          resourceType: 'academic_year',
          resourceId: id,
          changedFields: fields,
        });
        return toAcademicYear(updated);
      }),
    );
  }

  activate(id: string): Promise<AcademicYear> {
    return this.store.mutate(async (tx, _school, events) => {
      const year = await this.find(tx, id);
      if (year.status === 'ACTIVE') return toAcademicYear(year);
      if (year.status !== 'PLANNED')
        throw ACADEMIC_ERRORS.academicYearTransition(year.status, 'ACTIVE');
      const updated = await tx.academicYear.update({ where: { id }, data: { status: 'ACTIVE' } });
      events.push({
        action: 'ACADEMIC_YEAR_ACTIVATED',
        resourceType: 'academic_year',
        resourceId: id,
        changedFields: ['status'],
        metadata: { from: 'PLANNED', to: 'ACTIVE' },
      });
      return toAcademicYear(updated);
    });
  }

  close(id: string): Promise<AcademicYear> {
    return this.store.mutate(async (tx, _school, events) => {
      const year = await this.find(tx, id);
      if (year.status === 'CLOSED') return toAcademicYear(year);
      if (year.status !== 'ACTIVE')
        throw ACADEMIC_ERRORS.academicYearTransition(year.status, 'CLOSED');
      if (year.isCurrent) throw ACADEMIC_ERRORS.currentYearCannotClose();
      const updated = await tx.academicYear.update({ where: { id }, data: { status: 'CLOSED' } });
      events.push({
        action: 'ACADEMIC_YEAR_CLOSED',
        resourceType: 'academic_year',
        resourceId: id,
        changedFields: ['status'],
        metadata: { from: 'ACTIVE', to: 'CLOSED' },
      });
      return toAcademicYear(updated);
    });
  }

  /** Atomic switch under the school lock: never two current years, not even transiently. */
  setCurrent(id: string): Promise<AcademicYear> {
    return this.store.mutate(async (tx, school, events) => {
      const year = await this.find(tx, id);
      if (year.isCurrent) return toAcademicYear(year);
      if (year.status !== 'ACTIVE') throw ACADEMIC_ERRORS.academicYearNotActive();
      const previous = await tx.academicYear.findFirst({
        where: { schoolId: school.id, isCurrent: true },
      });
      await tx.academicYear.updateMany({
        where: { schoolId: school.id, isCurrent: true },
        data: { isCurrent: false },
      });
      const updated = await tx.academicYear.update({ where: { id }, data: { isCurrent: true } });
      events.push({
        action: 'ACADEMIC_YEAR_SET_CURRENT',
        resourceType: 'academic_year',
        resourceId: id,
        changedFields: ['isCurrent'],
        metadata: { previousCurrentYearId: previous?.id ?? null },
      });
      return toAcademicYear(updated);
    });
  }

  private async find(tx: TenantTransaction, id: string) {
    const school = await this.store.school(tx);
    const year = await tx.academicYear.findFirst({ where: { id, schoolId: school.id } });
    if (!year) throw ACADEMIC_ERRORS.academicYearNotFound();
    return year;
  }

  private async assertNameFree(
    tx: TenantTransaction,
    schoolId: string,
    name: string,
  ): Promise<void> {
    const clash = await tx.academicYear.findFirst({
      where: { schoolId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash) throw ACADEMIC_ERRORS.duplicateAcademicYearName();
  }

  /** Inclusive ranges [start, end] must not intersect any other year of the school. */
  private async assertNoOverlap(
    tx: TenantTransaction,
    schoolId: string,
    start: string,
    end: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await tx.academicYear.findFirst({
      where: {
        schoolId,
        startDate: { lte: fromIsoDate(end) },
        endDate: { gte: fromIsoDate(start) },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw ACADEMIC_ERRORS.academicYearOverlap();
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error, 'academic_years_school_id_name_key'))
        throw ACADEMIC_ERRORS.duplicateAcademicYearName();
      // Exclusion-constraint backstop (the service check normally answers first).
      if (String((error as Error | undefined)?.message).includes('academic_years_no_overlap'))
        throw ACADEMIC_ERRORS.academicYearOverlap();
      throw error;
    }
  }
}
