import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createServer } from '../server.mjs';

const PASSWORD = 'followers-isolated-test-password';

async function fixture(t) {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'fitness-community-followers-'));
  const server = createServer({ dataDir: directory });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
    assert.equal(dirname(resolve(directory)), temporaryRoot);
    assert.ok(basename(directory).startsWith('fitness-community-followers-'));
    await rm(directory, { recursive: true, force: true });
  });
  async function api(path, client, method = 'GET', body, headers = {}) {
    const response = await fetch(base + (path.startsWith('/api/') ? path : '/api/community' + path), {
      method,
      headers: { ...(client ? { Cookie: client.cookie, 'X-Fitness-User': client.id } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  }
  async function register(name) {
    const response = await fetch(base + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email: `${name.toLowerCase()}-followers@example.test`, password: PASSWORD })
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    return { id: body.user.id, cookie: response.headers.get('set-cookie').split(';')[0] };
  }
  const [alice, bob, charlie, dana] = await Promise.all(['Alice', 'Bob', 'Charlie', 'Dana'].map(register));
  async function follow(fan, target, active = true) {
    const result = await api(`/users/${target.id}/follow`, fan, 'PUT', { active });
    assert.equal(result.status, 200, JSON.stringify(result));
  }
  return { api, follow, register, alice, bob, charlie, dana };
}

function assertPublic(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(/email|password|session|apiKey|records|health|weight|height/i.test(key), false, `Private field: ${key}`);
    assertPublic(child);
  }
}

test('my followers use authenticated relationship direction and public profiles regardless of supplied user IDs', async t => {
  const { api, follow, alice, bob, charlie, dana } = await fixture(t);
  const empty = await api('/me/followers', alice);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { items: [], nextCursor: null, hasMore: false });
  await follow(bob, alice);
  await follow(alice, charlie);
  await follow(charlie, dana);
  await follow(alice, bob);
  assert.equal((await api('/me/profile', bob, 'PATCH', { nickname: '粉丝的社区昵称', bio: '公开简介' })).status, 200);
  const result = await api(`/me/followers?userId=${dana.id}`, alice);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.items.map(row => row.id), [bob.id]);
  assert.equal(result.body.items[0].nickname, '粉丝的社区昵称');
  assert.equal(result.body.items[0].bio, '公开简介');
  assert.equal(result.body.items[0].avatarUrl, null);
  assert.equal(result.body.items[0].followed, true);
  assert.equal(result.body.items[0].followedBy, true);
  assert.match(result.body.items[0].accountNumber, /^\d{10}$/);
  assertPublic(result.body);
  assert.deepEqual((await api('/me/followers', dana)).body.items.map(row => row.id), [charlie.id]);
  assert.equal((await api('/me/followers')).status, 401);
  assert.equal((await api('/me/followers', alice, 'GET', undefined, { 'X-Fitness-User': dana.id })).status, 409);
  const publicFans = await api(`/users/${alice.id}/followers`, dana);
  assert.equal(publicFans.status, 200);
  assert.deepEqual(publicFans.body.items.map(row => row.id), [bob.id]);
  assert.equal(publicFans.body.items[0].followed, false);
  assert.equal(publicFans.body.items[0].followedBy, false);
  assertPublic(publicFans.body);
});

test('public following and follower lists preserve edge direction and report relationships relative to the viewer', async t => {
  const { api, follow, alice, bob, charlie, dana } = await fixture(t);
  for (const target of [bob, charlie, dana]) await follow(alice, target);
  await follow(bob, alice);
  await follow(bob, dana);
  await follow(charlie, alice);
  await follow(charlie, dana);
  await follow(dana, bob);
  const following = await api(`/users/${alice.id}/following`, dana);
  const followers = await api(`/users/${alice.id}/followers`, dana);
  assert.equal(following.status, 200);
  assert.equal(followers.status, 200);
  assert.deepEqual(new Set(following.body.items.map(row => row.id)), new Set([bob.id, charlie.id, dana.id]));
  assert.deepEqual(new Set(followers.body.items.map(row => row.id)), new Set([bob.id, charlie.id]));
  const states = new Map(following.body.items.map(row => [row.id, [row.followed, row.followedBy, row.isSelf]]));
  assert.deepEqual(states.get(bob.id), [true, true, false]);
  assert.deepEqual(states.get(charlie.id), [false, true, false]);
  assert.deepEqual(states.get(dana.id), [false, false, true]);
  for (const row of followers.body.items) {
    assert.equal(row.followed, row.id === bob.id);
    assert.equal(row.followedBy, true);
    assert.equal(typeof row.noteCount, 'number');
    assert.equal(typeof row.followingCount, 'number');
    assert.equal(typeof row.followerCount, 'number');
  }
  const own = await api(`/users/${alice.id}/followers`, alice);
  const alias = await api('/me/followers', alice);
  assert.deepEqual(alias.body.items, own.body.items);
  assert.ok(own.body.items.every(row => row.followed && row.followedBy && !row.isSelf));
  const bobView = await api(`/users/${alice.id}/following`, bob);
  assert.deepEqual(bobView.body.items.filter(row => row.id === charlie.id).map(row => [row.followed, row.followedBy]), [[false, false]]);
  const charlieView = await api(`/users/${alice.id}/following`, charlie);
  assert.deepEqual(charlieView.body.items.filter(row => row.id === dana.id).map(row => [row.followed, row.followedBy]), [[true, false]]);
  const toggle = await api(`/users/${charlie.id}/follow`, dana, 'PUT', { active: true });
  assert.equal(toggle.status, 200);
  assert.equal(toggle.body.followed, true);
  assert.equal(toggle.body.followedBy, true);
  assert.equal(toggle.body.viewerFollowingCount, 2);
  assert.equal((await api(`/users/${charlie.id}/follow`, dana, 'PUT', { active: true })).body.viewerFollowingCount, 2);
  const unfollow = await api(`/users/${charlie.id}/follow`, dana, 'PUT', { active: false });
  assert.equal(unfollow.body.followed, false);
  assert.equal(unfollow.body.followedBy, true);
  assert.equal(unfollow.body.viewerFollowingCount, 1);
  assert.equal((await api(`/users/${charlie.id}/follow`, dana, 'PUT', { active: false })).body.viewerFollowingCount, 1);
  for (const result of [following, followers, own, alias, bobView, charlieView, toggle, unfollow]) assertPublic(result.body);
});

test('relationship search normalizes nicknames, finds public account numbers and paginates within its scope', async t => {
  const { api, follow, alice, bob, charlie, dana } = await fixture(t);
  for (const [client, nickname] of [[bob, 'Ｃｏａｃｈ One'], [charlie, 'coach Two'], [dana, 'Other Coach']]) {
    assert.equal((await api('/me/profile', client, 'PATCH', { nickname })).status, 200);
    await follow(alice, client);
    await follow(client, alice);
  }
  const path = `/users/${alice.id}/following`;
  const query = encodeURIComponent('  COACH  ');
  const first = await api(`${path}?q=${query}&limit=1`, dana);
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 1);
  assert.equal(first.body.hasMore, true);
  const cursor = encodeURIComponent(first.body.nextCursor);
  for (const [url, viewer] of [
    [`${path}?q=two&cursor=${cursor}`, dana],
    [`/users/${alice.id}/followers?q=coach&cursor=${cursor}`, dana],
    [`/users/${bob.id}/following?q=coach&cursor=${cursor}`, dana],
    [`${path}?q=coach&cursor=${cursor}`, bob]
  ]) assert.equal((await api(url, viewer)).status, 400);
  const seen = first.body.items.map(row => row.id);
  let next = first.body.nextCursor;
  while (next) {
    const result = await api(`${path}?q=${encodeURIComponent('ｃｏａｃｈ')}&limit=1&cursor=${encodeURIComponent(next)}`, dana);
    assert.equal(result.status, 200);
    seen.push(...result.body.items.map(row => row.id));
    next = result.body.nextCursor;
  }
  assert.equal(seen.length, 3);
  assert.deepEqual(new Set(seen), new Set([bob.id, charlie.id, dana.id]));
  const bobProfile = (await api(`/users/${bob.id}`, alice)).body.profile;
  const numbered = await api(`${path}?q=${bobProfile.accountNumber}`, dana);
  assert.equal(numbered.status, 200);
  assert.deepEqual(numbered.body.items.map(row => row.id), [bob.id]);
  const fans = await api(`/users/${alice.id}/followers?q=ONE`, dana);
  const myFans = await api('/me/followers?q=ONE', alice);
  assert.deepEqual(fans.body.items.map(row => row.id), [bob.id]);
  assert.deepEqual(myFans.body.items.map(row => row.id), [bob.id]);
  for (const q of ['bob-followers@example.test', '%', '_', 'not-present']) {
    assert.deepEqual((await api(`${path}?q=${encodeURIComponent(q)}`, dana)).body, { items: [], nextCursor: null, hasMore: false });
  }
  for (const result of [first, numbered, fans, myFans]) assertPublic(result.body);
});

test('following snapshots skip cancelled edges and deleted accounts without adding later follows', async t => {
  const { api, follow, register, alice, bob, charlie, dana } = await fixture(t);
  const targets = [bob, charlie, dana];
  for (const target of targets) await follow(alice, target);
  const first = await api(`/users/${alice.id}/following?limit=1`, alice);
  assert.equal(first.status, 200);
  assert.equal(first.body.hasMore, true);
  const remaining = targets.filter(target => target.id !== first.body.items[0].id);
  await follow(alice, remaining[0], false);
  assert.equal((await api('/api/account', remaining[1], 'DELETE', { password: PASSWORD })).status, 200);
  const later = await register('Later');
  await follow(alice, later);
  const next = await api(`/users/${alice.id}/following?cursor=${encodeURIComponent(first.body.nextCursor)}`, alice);
  assert.equal(next.status, 200);
  assert.deepEqual(next.body, { items: [], nextCursor: null, hasMore: false });
  assert.deepEqual(new Set((await api(`/users/${alice.id}/following`, alice)).body.items.map(row => row.id)), new Set([first.body.items[0].id, later.id]));
});

test('relationship snapshots recheck nickname search and allow self-follower aliases to continue each other', async t => {
  const { api, follow, alice, bob, charlie, dana } = await fixture(t);
  for (const client of [bob, charlie, dana]) {
    await api('/me/profile', client, 'PATCH', { nickname: 'Search Match' });
    await follow(client, alice);
  }
  const first = await api(`/users/${alice.id}/followers?q=match&limit=1`, alice);
  const remaining = [bob, charlie, dana].filter(client => client.id !== first.body.items[0].id);
  await api('/me/profile', remaining[0], 'PATCH', { nickname: 'Renamed' });
  await follow(remaining[1], alice, false);
  const next = await api(`/users/${alice.id}/followers?q=match&cursor=${encodeURIComponent(first.body.nextCursor)}`, alice);
  assert.equal(next.status, 200);
  assert.deepEqual(next.body, { items: [], nextCursor: null, hasMore: false });
  await follow(remaining[1], alice);
  const aliasFirst = await api('/me/followers?limit=1', alice);
  const aliasNext = await api(`/users/${alice.id}/followers?cursor=${encodeURIComponent(aliasFirst.body.nextCursor)}`, alice);
  assert.equal(aliasNext.status, 200);
  assert.equal(aliasNext.body.items.length, 2);
  const userFirst = await api(`/users/${alice.id}/followers?limit=1`, alice);
  const userNext = await api(`/me/followers?cursor=${encodeURIComponent(userFirst.body.nextCursor)}`, alice);
  assert.equal(userNext.status, 200);
  assert.equal(userNext.body.items.length, 2);
});

test('relationship lists require authentication, validate queries and reject deleted or unknown profile owners', async t => {
  const { api, follow, alice, bob, charlie } = await fixture(t);
  await follow(alice, bob);
  for (const direction of ['following', 'followers']) {
    const path = `/users/${alice.id}/${direction}`;
    assert.equal((await api(path)).status, 401);
    assert.equal((await api(path, bob, 'GET', undefined, { 'X-Fitness-User': charlie.id })).status, 409);
    assert.equal((await api(`/users/missing-profile/${direction}`, bob)).status, 404);
    for (const limit of ['0', '-1', '51', '1.5', 'invalid', '']) assert.equal((await api(`${path}?limit=${limit}`, bob)).status, 400);
    assert.equal((await api(`${path}?q=${'x'.repeat(101)}`, bob)).status, 400);
    assert.equal((await api(`${path}?q=%00`, bob)).status, 400);
    assert.equal((await api(`${path}?q=%20%20`, bob)).status, 200);
    assert.equal((await api(`${path}?cursor=invalid`, bob)).status, 400);
  }
  assert.equal((await api('/api/account', alice, 'DELETE', { password: PASSWORD })).status, 200);
  for (const direction of ['following', 'followers']) assert.equal((await api(`/users/${alice.id}/${direction}`, bob)).status, 404);
  assert.deepEqual((await api(`/users/${bob.id}/following`, bob)).body, { items: [], nextCursor: null, hasMore: false });
  assert.deepEqual((await api(`/users/${bob.id}/followers`, bob)).body, { items: [], nextCursor: null, hasMore: false });
});

test('my followers paginate without duplicates and reject invalid limits or another account cursor', async t => {
  const { api, follow, alice, bob, charlie, dana } = await fixture(t);
  for (const fan of [bob, charlie, dana]) await follow(fan, alice);
  const first = await api('/me/followers?limit=1', alice);
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 1);
  assert.equal(first.body.hasMore, true);
  const cursor = encodeURIComponent(first.body.nextCursor);
  assert.equal((await api(`/me/followers?cursor=${cursor}`, bob)).status, 400);
  assert.equal((await api(`/me/collections?cursor=${cursor}`, alice)).status, 400);
  assert.equal((await api('/me/followers?cursor=not-a-cursor', alice)).status, 400);
  for (const limit of ['0', '-1', '51', '1.5', 'invalid', '']) {
    assert.equal((await api(`/me/followers?limit=${limit}`, alice)).status, 400);
  }
  assert.equal((await api('/me/followers?limit=50', alice)).status, 200);
  const seen = first.body.items.map(row => row.id);
  let next = first.body.nextCursor;
  while (next) {
    const result = await api(`/me/followers?limit=1&cursor=${encodeURIComponent(next)}`, alice);
    assert.equal(result.status, 200);
    seen.push(...result.body.items.map(row => row.id));
    next = result.body.nextCursor;
  }
  assert.equal(new Set(seen).size, 3);
  assert.deepEqual(new Set(seen), new Set([bob.id, charlie.id, dana.id]));
});

test('follower snapshots recheck cancelled relationships and deleted accounts before returning later pages', async t => {
  const { api, follow, alice, bob, charlie, dana } = await fixture(t);
  const fans = [bob, charlie, dana];
  for (const fan of fans) await follow(fan, alice);
  const first = await api('/me/followers?limit=1', alice);
  assert.equal(first.status, 200);
  const remaining = fans.filter(fan => fan.id !== first.body.items[0].id);
  await follow(remaining[0], alice, false);
  assert.equal((await api('/api/account', remaining[1], 'DELETE', { password: PASSWORD })).status, 200);
  const next = await api(`/me/followers?cursor=${encodeURIComponent(first.body.nextCursor)}`, alice);
  assert.equal(next.status, 200);
  assert.deepEqual(next.body, { items: [], nextCursor: null, hasMore: false });
  assert.deepEqual((await api('/me/followers', alice)).body.items.map(row => row.id), [first.body.items[0].id]);
});

test('public follower IDs can invite a fan who must accept before receiving group access', async t => {
  const { api, follow, alice, bob, charlie } = await fixture(t);
  await follow(bob, alice);
  const followers = await api('/me/followers', alice);
  const created = await api('/groups', alice, 'POST', { name: '粉丝邀请测试群', clientMutationId: 'followers-group-create' });
  assert.equal(created.status, 201, JSON.stringify(created));
  const groupId = created.body.group.id;
  const invited = await api(`/groups/${groupId}/invitations`, alice, 'POST', { userIds: followers.body.items.map(row => row.id) });
  assert.equal(invited.status, 200, JSON.stringify(invited));
  assert.equal(invited.body.items.length, 1);
  assert.equal((await api(`/groups/${groupId}`, bob)).status, 404);
  const pending = await api('/groups/invitations', bob);
  assert.equal(pending.status, 200);
  assert.equal(pending.body.items[0].group.id, groupId);
  const invitationId = pending.body.items[0].id;
  assert.equal((await api(`/groups/invitations/${invitationId}`, charlie, 'PATCH', { action: 'accept' })).status, 404);
  assert.equal((await api(`/groups/invitations/${invitationId}`, bob, 'PATCH', { action: 'accept' })).status, 200);
  const members = await api(`/groups/${groupId}/members`, alice);
  assert.equal(members.status, 200);
  assert.deepEqual(new Set(members.body.items.map(row => row.id)), new Set([alice.id, bob.id]));
  assert.equal(members.body.items.find(row => row.id === bob.id).nickname, followers.body.items[0].nickname);
  assertPublic(followers.body);
  assertPublic(invited.body);
});
