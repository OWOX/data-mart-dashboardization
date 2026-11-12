import type { OwoxLike } from './sources';
import { fetchMember } from './role';

const owoxWith = (body: unknown) => ({ getJson: vi.fn().mockResolvedValue(body) }) as unknown as OwoxLike;
const failing = () => ({ getJson: vi.fn().mockRejectedValue(new Error('403')) }) as unknown as OwoxLike;

test.each([
  [{ member: { roles: ['admin'] } }, true],
  [{ member: { roles: ['editor', 'viewer'] } }, false],
  [{ member: {} }, false],
])('roles %j: admin %s', async (body, want) => {
  expect((await fetchMember(owoxWith(body))).isAdmin).toBe(want);
});

test('the name is the full name, then the email, then null', async () => {
  expect(await fetchMember(owoxWith({ member: { roles: ['admin'], fullName: ' Ann Lee ', email: 'a@x.io' } }))).toEqual({ isAdmin: true, name: 'Ann Lee' });
  expect(await fetchMember(owoxWith({ member: { roles: [], fullName: '  ', email: 'a@x.io' } }))).toEqual({ isAdmin: false, name: 'a@x.io' });
  expect(await fetchMember(owoxWith({ member: {} }))).toEqual({ isAdmin: false, name: null });
});

test('a failed auth call reads as not admin and no name', async () => {
  expect(await fetchMember(failing())).toEqual({ isAdmin: false, name: null });
});
