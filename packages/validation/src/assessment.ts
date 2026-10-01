/**
 * Phase 9 validation shared by the backend (authoritative) and web/mobile forms (UX only).
 * Official values are exact decimals with up to 2 places (decision T), sent as strings.
 */
import { z } from 'zod';

export const EXAM_NAME_MAX = 100;
export const EXAM_DESCRIPTION_MAX = 1000;
export const COMPONENT_NAME_MAX = 60;
export const REMARK_MAX = 500;
export const FEEDBACK_MAX = 2000;
export const REASON_MIN = 3;
export const REASON_MAX = 500;
export const GRADE_LABEL_MAX = 10;
/** NUMERIC(7,2): up to 99999.99. */
export const MARKS_PATTERN = /^\d{1,5}(\.\d{1,2})?$/;
/** Percent bounds for grade bands: 0–100 with up to 2 decimals. */
export const PERCENT_PATTERN = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;

export const isMarks = (v: string) => MARKS_PATTERN.test(v);

export const marksString = z
  .string()
  .trim()
  .regex(MARKS_PATTERN, 'Enter a number with at most 2 decimal places');

export const reasonSchema = z
  .string()
  .trim()
  .min(REASON_MIN, `At least ${String(REASON_MIN)} characters`)
  .max(REASON_MAX, `At most ${String(REASON_MAX)} characters`);

export const examFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(EXAM_NAME_MAX),
    description: z.string().trim().max(EXAM_DESCRIPTION_MAX).optional().nullable(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a start date'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose an end date'),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'The end date must be on or after the start date',
    path: ['endDate'],
  });

export const gradeFeedbackSchema = z.object({
  marksAwarded: marksString.optional().nullable(),
  feedback: z.string().trim().max(FEEDBACK_MAX).optional().nullable(),
});
