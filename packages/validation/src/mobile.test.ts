import { describe, expect, it } from 'vitest';
import {
  isHttpsUrl,
  resolveActiveRole,
  resolveSelectedChild,
  SUBMISSION_TEXT_MAX,
  SUBMISSION_URL_MAX,
  submissionSchema,
} from './mobile.js';

describe('Phase 8 mobile validation', () => {
  it('accepts only absolute https links', () => {
    expect(isHttpsUrl('https://docs.example.com/essay?id=1#top')).toBe(true);
    expect(isHttpsUrl('HTTPS://EXAMPLE.COM/A')).toBe(true);
    for (const bad of [
      'http://example.com',
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'ftp://example.com/x',
      'https://',
      'https://exa mple.com',
      'https://user:pw@example.com',
      '//example.com',
      'example.com',
      `https://e.com/${'a'.repeat(SUBMISSION_URL_MAX)}`,
    ])
      expect(isHttpsUrl(bad), bad).toBe(false);
  });

  it('submission needs text or a link; keeps text as typed; trims only the link', () => {
    expect(submissionSchema.safeParse({}).success).toBe(false);
    expect(submissionSchema.safeParse({ text: '   ', url: '' }).success).toBe(false);
    expect(submissionSchema.safeParse({ url: 'http://x.com' }).success).toBe(false);
    expect(submissionSchema.safeParse({ text: 'x'.repeat(SUBMISSION_TEXT_MAX + 1) }).success).toBe(
      false,
    );
    expect(submissionSchema.parse({ text: '  Line one\n  line two ' })).toEqual({
      text: '  Line one\n  line two ',
      url: null,
    });
    expect(submissionSchema.parse({ url: '  https://a.example/x  ' })).toEqual({
      text: null,
      url: 'https://a.example/x',
    });
    expect(submissionSchema.parse({ text: 'Answer', url: 'https://a.example/x' })).toEqual({
      text: 'Answer',
      url: 'https://a.example/x',
    });
  });

  it('active role: remembered if still granted, else a sensible default; none → null', () => {
    expect(resolveActiveRole(['TEACHER', 'PARENT'], 'PARENT')).toBe('PARENT');
    expect(resolveActiveRole(['TEACHER', 'PARENT'], 'STUDENT')).toBe('TEACHER');
    expect(resolveActiveRole(['PARENT'], 'TEACHER')).toBe('PARENT');
    expect(resolveActiveRole(['STUDENT'], null)).toBe('STUDENT');
    expect(resolveActiveRole([], 'TEACHER')).toBeNull();
  });

  it('selected child: kept only while still linked (decision B)', () => {
    const kids = [{ studentId: 'a' }, { studentId: 'b' }];
    expect(resolveSelectedChild(kids, 'b')).toEqual({ studentId: 'b' });
    expect(resolveSelectedChild(kids, 'removed')).toEqual({ studentId: 'a' });
    expect(resolveSelectedChild([], 'a')).toBeNull();
  });
});
