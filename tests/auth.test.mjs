// Run against local XAMPP: node --test tests/auth.test.mjs
// Set GYM_TEST_USERNAME and GYM_TEST_PASSWORD to also test authenticated access.
// These checks read application data; they do not save or delete records.
import assert from 'node:assert/strict';
import test from 'node:test';

const baseUrl = (process.env.GYM_TEST_URL || 'http://localhost/Gym-Management-System').replace(/\/$/, '');
const protectedPages = [
  'index.php', 'home.php', 'members.php', 'registered_members.php',
  'plans.php', 'packages.php', 'trainer.php', 'schedule.php', 'events.php',
  'users.php', 'manage_member.php', 'manage_membership.php',
  'manage_schedule.php', 'manage_user.php', 'payment.php', 'view_member.php',
  'view_pdetails.php', 'view_schedule.php', 'navbar.php', 'topbar.php',
];

async function request(path, options = {}, cookies) {
  const headers = new Headers(options.headers);
  if (cookies?.size) {
    headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
  }
  const response = await fetch(`${baseUrl}/${path}`, { ...options, headers, redirect: 'manual' });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0];
    const equals = pair.indexOf('=');
    cookies?.set(pair.slice(0, equals), pair.slice(equals + 1));
  }
  return response;
}

for (const page of protectedPages) {
  test(`anonymous ${page} redirects before rendering`, async () => {
    const response = await request(page);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'login.php');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), '');
  });
}

test('anonymous modal request returns 401 instead of rendering a login form inside the modal', async () => {
  const response = await request('manage_user.php?id=2', {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required.' });
});

for (const path of ['ajax.php?action=get_schecdule', 'ajax.php?action=unknown', 'ajax.php']) {
  test(`anonymous ${path} is rejected before dispatch`, async () => {
    const response = await request(path);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Authentication required.' });
  });
}

test('login and stylesheet remain public; session cookie has browser protections', async () => {
  const response = await request('login.php');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /id="login-form"/);
  const sessionCookie = response.headers.getSetCookie().find(cookie => cookie.startsWith('PHPSESSID='));
  assert.ok(sessionCookie);
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /SameSite=Lax/i);
  const css = await request('assets/vendor/bootstrap/css/bootstrap.min.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /css/);
});

test('incorrect credentials do not grant access', async () => {
  const cookies = new Map();
  const response = await request('ajax.php?action=login', {
    method: 'POST',
    body: new URLSearchParams({ username: '__auth_smoke_missing_user__', password: 'incorrect' }),
  }, cookies);
  assert.equal(response.status, 200);
  assert.equal((await response.text()).trim(), '3');
  const protectedResponse = await request('members.php', {}, cookies);
  assert.equal(protectedResponse.status, 302);
});

test('valid login rotates session, preserves pages and modals, and logout revokes access', {
  skip: !process.env.GYM_TEST_USERNAME || !process.env.GYM_TEST_PASSWORD,
}, async () => {
  const cookies = new Map();
  await (await request('login.php', {}, cookies)).text();
  const oldSession = cookies.get('PHPSESSID');
  const response = await request('ajax.php?action=login', {
    method: 'POST',
    body: new URLSearchParams({
      username: process.env.GYM_TEST_USERNAME,
      password: process.env.GYM_TEST_PASSWORD,
    }),
  }, cookies);
  assert.equal(response.status, 200);
  assert.equal((await response.text()).trim(), '1');
  assert.notEqual(cookies.get('PHPSESSID'), oldSession);

  for (const page of ['home', 'members', 'registered_members', 'plans', 'packages', 'trainer', 'schedule', 'users']) {
    const dashboard = await request(`index.php?page=${page}`, {}, cookies);
    assert.equal(dashboard.status, 200, page);
    const html = await dashboard.text();
    assert.match(html, /assets\/vendor\/bootstrap\/css\/bootstrap.min.css/, page);
    assert.match(html, /id="sidebar"/, page);
    assert.doesNotMatch(html, /Fatal error|headers already sent|session_start\(\).*already active/i, page);
  }

  for (const path of ['manage_member.php', 'manage_membership.php', 'manage_schedule.php', 'manage_user.php']) {
    const modal = await request(path, { headers: { 'X-Requested-With': 'XMLHttpRequest' } }, cookies);
    assert.equal(modal.status, 200, path);
    assert.match(await modal.text(), /<form\b/, path);
  }
  const schedules = await request('ajax.php?action=get_schecdule', {}, cookies);
  assert.equal(schedules.status, 200);
  assert.ok(Array.isArray(await schedules.json()));

  const login = await request('login.php', {}, cookies);
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), 'index.php?page=home');
  assert.equal(await login.text(), '');

  const loggedOut = await request('ajax.php?action=logout', {}, cookies);
  assert.equal(loggedOut.status, 302);
  await loggedOut.text();
  const members = await request('members.php', {}, cookies);
  assert.equal(members.status, 302);
  const expiredModal = await request('manage_member.php', {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  }, cookies);
  assert.equal(expiredModal.status, 401);
});
