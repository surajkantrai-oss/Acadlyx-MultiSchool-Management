import { describe, expect, it } from 'vitest';
import {
  availableActions,
  canTransition,
  FEATURE_KEYS,
  isConfigurationKey,
  isFeatureKey,
  TENANT_STATUSES,
  validateConfigurationValue,
} from './index.js';

describe('tenant lifecycle', () => {
  const allowed = [
    'DRAFT>ACTIVE',
    'DRAFT>ARCHIVED',
    'ACTIVE>SUSPENDED',
    'ACTIVE>INACTIVE',
    'SUSPENDED>ACTIVE',
    'SUSPENDED>INACTIVE',
    'INACTIVE>ACTIVE',
    'INACTIVE>ARCHIVED',
  ];

  it('allows exactly the approved transitions', () => {
    for (const from of TENANT_STATUSES) {
      for (const to of TENANT_STATUSES) {
        expect(canTransition(from, to), `${from}>${to}`).toBe(allowed.includes(`${from}>${to}`));
      }
    }
  });

  it('treats ARCHIVED as terminal', () => {
    expect(availableActions('ARCHIVED')).toEqual([]);
    expect(availableActions('DRAFT')).toEqual(['activate', 'archive']);
    expect(availableActions('ACTIVE')).toEqual(['suspend', 'deactivate']);
  });
});

describe('feature registry', () => {
  it('has 20 unique UPPER_SNAKE keys', () => {
    expect(FEATURE_KEYS).toHaveLength(20);
    expect(new Set(FEATURE_KEYS).size).toBe(20);
    expect(FEATURE_KEYS.every((k) => /^[A-Z][A-Z_]+$/.test(k))).toBe(true);
    expect(isFeatureKey('ATTENDANCE')).toBe(true);
    expect(isFeatureKey('LIBRARY')).toBe(false);
  });
});

describe('configuration registry', () => {
  it('rejects unknown keys and invalid values', () => {
    expect(isConfigurationKey('general.timezone')).toBe(true);
    expect(isConfigurationKey('toString')).toBe(false);
    expect(validateConfigurationValue('general.timezone', 'Asia/Kolkata').success).toBe(true);
    expect(validateConfigurationValue('general.timezone', 'Mars/Base').success).toBe(false);
    expect(validateConfigurationValue('general.academic_year_start_month', 13).success).toBe(false);
    expect(validateConfigurationValue('general.locale', { evil: true }).success).toBe(false);
  });
});
