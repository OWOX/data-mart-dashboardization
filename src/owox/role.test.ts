import type { OwoxLike } from './sources';
import { fetchMember } from './role';

const owoxWith = (body: unknown) => ({ getJson: vi.fn().mockResolvedValue(body) }) as unknown as OwoxLike;
const failing = () => ({ getJson: vi.fn().mockRejectedValue(new Error('403')) }) as unknown as OwoxLike;

test.each([
  [{ roles: ['admin'] }, true],
  [{ roles: ['editor', 'viewer'] }, false],
  [{}, false],
  [{ member: { roles: ['admin'] } }, true],
  [{ member: { roles: ['viewer'] } }, false],
])('auth context %j: admin %s', async (body, want) => {
  expect((await fetchMember(owoxWith(body))).isAdmin).toBe(want);
});

test('the name is the full name, then the email, then null', async () => {
  expect(await fetchMember(owoxWith({ roles: ['admin'], fullName: ' Ann Lee ', email: 'a@x.io' }))).toEqual({ isAdmin: true, name: 'Ann Lee' });
  expect(await fetchMember(owoxWith({ roles: [], fullName: '  ', email: 'a@x.io' }))).toEqual({ isAdmin: false, name: 'a@x.io' });
  expect(await fetchMember(owoxWith({}))).toEqual({ isAdmin: false, name: null });
  expect(await fetchMember(owoxWith({ member: { roles: ['admin'], fullName: 'Wrapped', email: 'w@x.io' } }))).toEqual({ isAdmin: true, name: 'Wrapped' });
});

test('a failed auth call reads as not admin and no name', async () => {
  expect(await fetchMember(failing())).toEqual({ isAdmin: false, name: null });
});
