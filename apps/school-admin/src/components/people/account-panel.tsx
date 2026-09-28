'use client';

import type { CreatedAccount, ProfileAccount, ProfileKind } from '@acadlyx/types';
import { Alert, Button, Card } from '@acadlyx/web-ui';
import { useState } from 'react';
import { bffApi } from '@/lib/bff-client';
import { NoticeBox, useAction } from '../setup/ui';
import { AccountBadge } from './shared';

const ROLE: Record<ProfileKind, string> = {
  students: 'Student',
  parents: 'Parent',
  teachers: 'Teacher',
};

/**
 * Login account for a profile (Phase 5 decision J). Creates a PENDING account with exactly the
 * matching role — never a password/PIN. Activation: self-service OTP (email/phone) or a one-time
 * code shown ONCE here (students without contact details).
 */
export function AccountPanel({
  kind,
  id,
  account,
}: {
  kind: ProfileKind;
  id: string;
  account: ProfileAccount | null;
}) {
  const { busy, notice, run } = useAction();
  const [issued, setIssued] = useState<CreatedAccount | null>(null);
  const act = (path: string, ok: string) =>
    run(async () => {
      setIssued(await bffApi<CreatedAccount>(`${kind}/${id}/${path}`, { method: 'POST' }));
    }, ok);
  return (
    <section id="login-account" aria-label="Login account" className="scroll-mt-4">
      <Card title="Login account">
        <div className="flex flex-col gap-3">
          <NoticeBox notice={notice} />
          <p className="text-sm">
            <AccountBadge account={account} />{' '}
            <span className="text-xs text-slate-500">
              The login account has its own status, separate from this profile.
            </span>
          </p>
          {issued?.activation.method === 'CODE' ? (
            <Alert tone="info" title="One-time activation code (shown once)">
              <p className="font-mono text-lg tracking-widest" data-testid="activation-code">
                {issued.activation.code}
              </p>
              <p className="text-xs">
                Give it to the person; it expires{' '}
                {new Date(issued.activation.expiresAt).toLocaleString()}. They set their own
                PIN/password at “Activate your account”.
              </p>
            </Alert>
          ) : null}
          {issued?.activation.method === 'OTP' ? (
            <Alert tone="info">
              Account created. The person activates it themselves at “Activate your account” with a
              code sent to their email/phone.
            </Alert>
          ) : null}
          {!account ? (
            <div>
              <Button
                disabled={busy}
                onClick={() => void act('account', `${ROLE[kind]} login account created.`)}
              >
                Create login account
              </Button>
              <p className="mt-1 text-xs text-slate-500">
                Creates a pending account with the {ROLE[kind]} role only. No password is set by the
                school.
              </p>
            </div>
          ) : account.status === 'PENDING_ACTIVATION' && kind === 'students' ? (
            <div>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void act('account/activation-code', 'New activation code issued.')}
              >
                Issue new activation code
              </Button>
            </div>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
