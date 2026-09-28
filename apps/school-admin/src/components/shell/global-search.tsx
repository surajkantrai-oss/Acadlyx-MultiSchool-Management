'use client';

import type { SearchResults } from '@acadlyx/types';
import { SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from '@acadlyx/validation';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { bffApi } from '@/lib/bff-client';

interface Option {
  id: string;
  group: string;
  label: string;
  detail: string;
  href: string;
}

function flatten(r: SearchResults): Option[] {
  return [
    ...(r.students ?? []).map((s) => ({
      id: `s-${s.id}`,
      group: 'Students',
      label: s.label,
      detail: s.admissionNumber,
      href: `/people/students/${s.id}`,
    })),
    ...(r.parents ?? []).map((p) => ({
      id: `p-${p.id}`,
      group: 'Parents / guardians',
      label: p.label,
      detail: p.parentCode ?? '',
      href: `/people/parents/${p.id}`,
    })),
    ...(r.teachers ?? []).map((t) => ({
      id: `t-${t.id}`,
      group: 'Teachers',
      label: t.label,
      detail: t.employeeId,
      href: `/people/teachers/${t.id}`,
    })),
    ...(r.classes ?? []).map((c) => ({
      id: `c-${c.id}`,
      group: 'Classes',
      label: c.label,
      detail: '',
      href: `/classes/${c.id}`,
    })),
  ];
}

/**
 * Header search (ARIA 1.2 combobox + grouped listbox). Debounced; the server enforces length
 * bounds, permissions, the people data scope and per-type result caps. Shows only minimal
 * identifying information (name + admission number / parent code / employee ID).
 */
export function GlobalSearch() {
  const router = useRouter();
  const uid = useId();
  const listId = `${uid}-list`;
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const options = useMemo(
    () => (results && q.trim().length >= SEARCH_MIN_LENGTH ? flatten(results) : []),
    [results, q],
  );

  useEffect(() => {
    const term = q.trim();
    const n = ++seq.current;
    if (term.length < SEARCH_MIN_LENGTH) return;
    const timer = setTimeout(() => {
      setStatus('Searching…');
      bffApi<SearchResults>(`workspace/search?q=${encodeURIComponent(term)}`)
        .then((r) => {
          if (n !== seq.current) return;
          const count = flatten(r).length;
          setResults(r);
          setActive(-1);
          setOpen(true);
          setStatus(count ? `${String(count)} result${count === 1 ? '' : 's'}` : 'No matches');
        })
        .catch(() => {
          if (n === seq.current) setStatus('Search is unavailable right now');
        });
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [q]);

  const go = (o: Option | undefined) => {
    if (!o) return;
    setOpen(false);
    setQ('');
    router.push(o.href);
  };

  const groups = [...new Set(options.map((o) => o.group))];
  const short = q.trim().length < SEARCH_MIN_LENGTH;
  const expanded = open && !short && results !== null;
  return (
    <div className="relative w-full sm:w-72" data-testid="global-search">
      <label htmlFor={`${uid}-input`} className="sr-only">
        Search students, guardians, teachers and classes
      </label>
      <input
        id={`${uid}-input`}
        type="search"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${uid}-${options[active]?.id ?? ''}` : undefined}
        aria-describedby={`${uid}-status`}
        placeholder="Search people and classes"
        maxLength={SEARCH_MAX_LENGTH}
        value={q}
        autoComplete="off"
        className="w-full rounded-md border-0 bg-white/95 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-2 focus:outline-offset-2 focus:outline-white"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setTimeout(() => {
            setOpen(false);
          }, 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(options.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            go(options[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setActive(-1);
          }
        }}
      />
      <p id={`${uid}-status`} role="status" aria-live="polite" className="sr-only">
        {short ? (q.trim() ? `Type at least ${String(SEARCH_MIN_LENGTH)} characters` : '') : status}
      </p>
      <div
        id={listId}
        role="listbox"
        aria-label="Search results"
        hidden={!expanded}
        className="absolute right-0 z-20 mt-1 max-h-96 w-full min-w-72 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 text-sm text-slate-900 shadow-lg"
      >
        {options.length === 0 ? (
          <p className="px-3 py-2 text-slate-500">No matches</p>
        ) : (
          groups.map((g) => (
            <div key={g} role="group" aria-label={g}>
              <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {g}
              </p>
              {options.map((o, i) =>
                o.group === g ? (
                  <div
                    key={o.id}
                    id={`${uid}-${o.id}`}
                    role="option"
                    aria-label={o.detail ? `${o.label}, ${o.detail}` : o.label}
                    aria-selected={i === active}
                    tabIndex={-1}
                    className={`flex cursor-pointer justify-between gap-3 rounded px-3 py-1.5 ${i === active ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      go(o);
                    }}
                  >
                    <span>{o.label}</span>
                    {o.detail ? (
                      <span className="font-mono text-xs text-slate-500">{o.detail}</span>
                    ) : null}
                  </div>
                ) : null,
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
