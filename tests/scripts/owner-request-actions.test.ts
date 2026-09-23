import { afterEach, expect, it, vi } from 'vitest';
import { setupOwnerRequestActions } from '../../src/scripts/owner-request-actions';

afterEach(() => { vi.unstubAllGlobals(); });

it('binds only request status buttons, not project update forms that share data-action', () => {
  const bound: string[] = [];
  const element = (name: string, data: Record<string, string> = {}) => ({ dataset: data, addEventListener: () => { bound.push(name); } });
  const statusButton = element('resolve button', { action: 'resolve' });
  const revisionForm = element('begin_revision form', { action: 'begin_revision' });
  vi.stubGlobal('document', {
    querySelector: (selector: string) => selector === '[data-request-id]' ? { dataset: { requestId: 'song-1' } }
      : selector === '[data-action-status]' ? { textContent: '' } : null,
    querySelectorAll: (selector: string) => selector === '[data-request-actions] button[data-action]' ? [statusButton]
      : selector === '[data-action]' ? [statusButton, revisionForm] : [],
  });
  setupOwnerRequestActions();
  expect(bound).toEqual(['resolve button']);
});
