'use client';

import type { School } from '@acadlyx/types';
import { SCHOOL_BOARDS, schoolProfileSchema } from '@acadlyx/validation';
import { Button, Card } from '@acadlyx/web-ui';
import { type FormEvent, useState } from 'react';
import { bffApi } from '@/lib/bff-client';
import {
  BOARD_LABELS,
  fieldErrors,
  formValues,
  NoticeBox,
  SelectField,
  TextField,
  useAction,
  useUnsavedWarning,
} from './ui';

const P = 'school';

export function SchoolProfileForm({ school, canManage }: { school: School; canManage: boolean }) {
  const { busy, notice, setNotice, run } = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [board, setBoard] = useState(school.board ?? '');
  useUnsavedWarning(dirty);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = formValues(e.currentTarget);
    const input = { ...values, board: values.board ? values.board : null };
    const parsed = schoolProfileSchema.safeParse(input);
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error.issues);
      setErrors(errs);
      setNotice({ tone: 'danger', messages: Object.values(errs) });
      return;
    }
    setErrors({});
    const ok = await run(
      () => bffApi('school', { method: 'PATCH', body: parsed.data }),
      'School profile saved.',
    );
    if (ok) setDirty(false);
  }

  const v = (x: string | null) => x ?? '';
  const common = { idPrefix: P, disabled: !canManage || busy };
  return (
    <Card title={canManage ? 'Edit profile' : 'Profile (read-only)'}>
      <form
        onSubmit={(e) => void submit(e)}
        onChange={() => {
          setDirty(true);
        }}
        className="flex flex-col gap-4"
        aria-label="School profile"
        noValidate
      >
        <NoticeBox notice={notice} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="name"
            label="School name"
            defaultValue={school.name}
            required
            maxLength={160}
            error={errors.name}
            {...common}
          />
          <TextField
            name="shortName"
            label="Short name"
            defaultValue={v(school.shortName)}
            maxLength={40}
            error={errors.shortName}
            {...common}
          />
          <TextField
            name="code"
            label="School code"
            hint="Stable internal code, e.g. SPS or DPS-BPL (letters, digits, - or _)."
            defaultValue={v(school.code)}
            maxLength={20}
            error={errors.code}
            {...common}
          />
          <SelectField
            name="board"
            label="Board"
            value={board}
            onChange={(e) => {
              setBoard(e.target.value);
            }}
            options={[
              { value: '', label: 'Not set' },
              ...SCHOOL_BOARDS.map((b) => ({ value: b, label: BOARD_LABELS[b] ?? b })),
            ]}
            error={errors.board}
            {...common}
          />
          {board === 'OTHER' ? (
            <TextField
              name="boardName"
              label="Board name"
              hint="Name of the board or curriculum."
              defaultValue={v(school.boardName)}
              maxLength={100}
              error={errors.boardName}
              {...common}
            />
          ) : null}
          <TextField
            name="email"
            type="email"
            label="Email"
            defaultValue={v(school.email)}
            error={errors.email}
            {...common}
          />
          <TextField
            name="phone"
            type="tel"
            label="Phone"
            defaultValue={v(school.phone)}
            error={errors.phone}
            {...common}
          />
          <TextField
            name="website"
            type="url"
            label="Website"
            hint="Including https://"
            defaultValue={v(school.website)}
            error={errors.website}
            {...common}
          />
        </div>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-slate-800">School address</legend>
          <TextField
            name="addressLine1"
            label="Address line 1"
            defaultValue={v(school.addressLine1)}
            error={errors.addressLine1}
            {...common}
          />
          <TextField
            name="addressLine2"
            label="Address line 2"
            defaultValue={v(school.addressLine2)}
            error={errors.addressLine2}
            {...common}
          />
          <TextField
            name="city"
            label="City"
            defaultValue={v(school.city)}
            error={errors.city}
            {...common}
          />
          <TextField
            name="state"
            label="State / region"
            defaultValue={v(school.state)}
            error={errors.state}
            {...common}
          />
          <TextField
            name="postalCode"
            label="Postal code"
            defaultValue={v(school.postalCode)}
            error={errors.postalCode}
            {...common}
          />
          <TextField
            name="country"
            label="Country"
            hint="2-letter ISO code, e.g. IN"
            defaultValue={v(school.country)}
            maxLength={2}
            error={errors.country}
            {...common}
          />
        </fieldset>
        {canManage ? (
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
