'use client';

import type { AcademicSettings, Weekday } from '@acadlyx/types';
import { academicSettingsSchema, WEEKDAYS } from '@acadlyx/validation';
import { Button, Card } from '@acadlyx/web-ui';
import { type FormEvent, useState } from 'react';
import { bffApi } from '@/lib/bff-client';
import {
  fieldErrors,
  NoticeBox,
  SelectField,
  TextField,
  useAction,
  useUnsavedWarning,
  WEEKDAY_LABELS,
} from './ui';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function AcademicSettingsForm({
  settings,
  canManage,
}: {
  settings: AcademicSettings;
  canManage: boolean;
}) {
  const { busy, notice, setNotice, run } = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  useUnsavedWarning(dirty);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const input = {
      timezone: String(data.get('timezone') ?? '').trim(),
      weekStartDay: String(data.get('weekStartDay') ?? ''),
      workingDays: data.getAll('workingDays').map(String),
      academicYearStartMonth: Number(data.get('academicYearStartMonth')),
    };
    const parsed = academicSettingsSchema.safeParse(input);
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error.issues);
      setErrors(errs);
      setNotice({ tone: 'danger', messages: Object.values(errs) });
      return;
    }
    setErrors({});
    const ok = await run(
      () => bffApi('school/academic-settings', { method: 'PATCH', body: parsed.data }),
      'Academic settings saved.',
    );
    if (ok) setDirty(false);
  }

  const disabled = !canManage || busy;
  return (
    <Card title={canManage ? 'Edit settings' : 'Settings (read-only)'}>
      <form
        onSubmit={(e) => void submit(e)}
        onChange={() => {
          setDirty(true);
        }}
        className="flex flex-col gap-4"
        aria-label="Academic settings"
        noValidate
      >
        <NoticeBox notice={notice} />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            idPrefix="settings"
            name="timezone"
            label="Default time zone"
            hint="IANA name, e.g. Asia/Kolkata. New branches start with this."
            defaultValue={settings.timezone}
            error={errors.timezone}
            disabled={disabled}
          />
          <SelectField
            idPrefix="settings"
            name="weekStartDay"
            label="Week starts on"
            defaultValue={settings.weekStartDay}
            options={WEEKDAYS.map((d) => ({ value: d, label: WEEKDAY_LABELS[d] ?? d }))}
            error={errors.weekStartDay}
            disabled={disabled}
          />
          <SelectField
            idPrefix="settings"
            name="academicYearStartMonth"
            label="Academic year usually starts in"
            hint="Used as a default when creating academic years."
            defaultValue={String(settings.academicYearStartMonth)}
            options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
            error={errors.academicYearStartMonth}
            disabled={disabled}
          />
        </div>
        <fieldset aria-describedby={errors.workingDays ? 'settings-workingDays-error' : undefined}>
          <legend className="mb-2 text-sm font-medium text-slate-800">Working days</legend>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((d: Weekday) => (
              <label key={d} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="workingDays"
                  value={d}
                  defaultChecked={settings.workingDays.includes(d)}
                  disabled={disabled}
                  className="h-4 w-4"
                />
                {WEEKDAY_LABELS[d]}
              </label>
            ))}
          </div>
          {errors.workingDays ? (
            <p id="settings-workingDays-error" className="mt-1 text-xs text-red-700">
              {errors.workingDays}
            </p>
          ) : null}
        </fieldset>
        {canManage ? (
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
