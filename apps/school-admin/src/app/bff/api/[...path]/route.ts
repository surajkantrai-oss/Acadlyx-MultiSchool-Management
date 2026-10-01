import { type NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { hostForwardingFetch } from '@/lib/server-fetch';
import { COOKIE, trustedMutation } from '@/lib/server/session';

/**
 * School-scoped API proxy for client components. Forwards the browser's Host (tenant resolution)
 * and the session bearer token. Only self-service auth, public OTP-start and the Phase 4 school
 * setup endpoints are reachable; token-producing steps use dedicated cookie-managing routes.
 */
const ALLOWED: RegExp[] = [
  /^auth\/(me|sessions(\/[\w-]+)?|devices(\/[\w-]+)?|credentials\/change|identifiers\/change\/(start|verify)|mfa\/totp\/remove|mfa\/recovery-codes\/regenerate)$/,
  /^auth\/(activation|recovery)\/start$/,
  /^tenant\/(workspace|settings)$/,
  // Phase 4 — school & academic configuration (permissions enforced by the API).
  /^school(\/(setup-status|academic-settings))?$/,
  /^(branches|academic-years|grades|sections|subjects)(\/[\w-]+){0,3}$/,
  // Phase 5 — people, enrollment and bulk onboarding (permissions enforced by the API).
  /^(students|parents|teachers)(\/[\w-]+){0,4}$/,
  /^people\/summary$/,
  // Phase 6 workspace read models (GET only on the API side).
  /^workspace\/(dashboard|search|access)$/,
  /^classes(\/[\w-]+)?$/,
  // Phase 7 — academic operations (permissions + teacher scope enforced by the API).
  /^attendance(\/(classes|students\/[\w-]+|sections\/[\w-]+(\/(history|changes))?))?$/,
  /^(homework|assignments)(\/(targets|[\w-]+(\/(publish|close|archive))?))?$/,
  /^timetable\/(periods(\/(order|[\w-]+))?|entries(\/[\w-]+)?|sections\/[\w-]+|teachers\/[\w-]+)$/,
  // Phase 9 — exams, marks, results, report cards and assignment grading.
  /^grade-scales(\/[\w-]+)?$/,
  /^exams(\/[\w-]+(\/(transitions\/[\w-]+|subjects(\/[\w-]+(\/components)?)?|components\/[\w-]+(\/schedules\/[\w-]+)?|sheets(\/[\w-]+\/[\w-]+(\/(submit|finalize|reopen))?)?|results(\/(publish|students\/[\w-]+))?|remarks\/[\w-]+|publications))?)?$/,
  /^result-publications\/[\w-]+\/students\/[\w-]+$/,
  /^assignments\/[\w-]+\/(grading|submissions\/[\w-]+\/versions\/\d+\/grade(\/publish)?)$/,
  /^imports(\/(templates\/(STUDENTS|PARENTS|TEACHERS)(\/file)?|[\w-]+(\/(rows|errors\.csv|confirm|cancel))?))?$/,
];

/** Multipart uploads are forwarded byte-for-byte (the API parses and validates them). */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 + 64 * 1024;

async function forward(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  if (!trustedMutation(req))
    return NextResponse.json(
      { code: 'CSRF_REJECTED', message: 'Request origin not allowed' },
      { status: 403 },
    );
  const joined = (await ctx.params).path.join('/');
  if (!ALLOWED.some((re) => re.test(joined)))
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  const token = req.cookies.get(COOKIE.access)?.value;
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const incomingType = req.headers.get('content-type') ?? '';
  const multipart = hasBody && incomingType.startsWith('multipart/form-data');
  let body: string | Uint8Array<ArrayBuffer> | undefined;
  if (multipart) {
    const declared = Number(req.headers.get('content-length') ?? '0');
    if (declared > MAX_UPLOAD_BYTES)
      return NextResponse.json(
        { code: 'IMPORT_FILE_TOO_LARGE', message: 'The file is larger than 5 MB' },
        { status: 413 },
      );
    body = new Uint8Array(await req.arrayBuffer());
    if (body.length > MAX_UPLOAD_BYTES)
      return NextResponse.json(
        { code: 'IMPORT_FILE_TOO_LARGE', message: 'The file is larger than 5 MB' },
        { status: 413 },
      );
  } else if (hasBody) {
    body = await req.text();
  }
  const upstream = await hostForwardingFetch(
    `${appConfig.apiBaseUrl.replace(/\/+$/, '')}/${joined}${req.nextUrl.search}`,
    {
      method: req.method,
      headers: {
        host: req.headers.get('host') ?? '',
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(hasBody ? { 'content-type': multipart ? incomingType : 'application/json' } : {}),
        'user-agent': req.headers.get('user-agent') ?? '',
      },
      ...(body === undefined ? {} : { body }),
    },
  ).catch(() => null);
  if (!upstream) return NextResponse.json({ message: 'Service unavailable' }, { status: 502 });
  // Bytes, not text: templates (.xlsx) and reports are binary-safe; filenames pass through.
  const bytes = Buffer.from(await upstream.arrayBuffer());
  const disposition = upstream.headers.get('content-disposition');
  return new NextResponse(bytes.length > 0 ? bytes : null, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      ...(disposition ? { 'content-disposition': disposition } : {}),
    },
  });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
