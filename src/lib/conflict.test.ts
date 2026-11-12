import { ModelConflict } from '../store/collections';
import { conflictMessage } from './conflict';

test('names the editor and the local time', () => {
  const at = new Date(2026, 10, 11, 9, 5).toISOString();
  expect(conflictMessage(new ModelConflict('Anna', at))).toBe('Anna changed the model at 09:05. Reload to see their changes.');
});
test('falls back to Another admin and drops an unreadable time', () => {
  expect(conflictMessage(new ModelConflict(null, ''))).toBe('Another admin changed the model. Reload to see their changes.');
  expect(conflictMessage(new ModelConflict('Anna', 'junk'))).toBe('Anna changed the model. Reload to see their changes.');
});
