import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './helpers/php.mjs';

test('development reset imports twice, integrates migrations and provides complete usable demo records', () => {
  const response = run({ login_id: 1, login_type: 1, csrf_token: 'seed-test' }, `
    require 'tests/helpers/throttle-db.php';
    require 'tests/helpers/membership-read-db.php';
    require 'membership_read.php';
    with_throttle_database(function($db, $schema) {
      $import = function() use ($db) {
        $db->multi_query(file_get_contents('database/gym.sql'));
        do { if ($result = $db->store_result()) $result->free(); }
        while ($db->more_results() && $db->next_result());
      };
      $import();
      $db->query("INSERT INTO members (member_id,firstname,middlename,lastname,gender,contact,address,email)
        VALUES (999999,'Temporary','','Test','Male','','','')");
      $import();
      $rows = membership_read_records($db);
      $summary = membership_read_summary($db, $rows);
      $states = [];
      foreach ($rows as $row) $states[$row['member_id']] = membership_read_state($row);
      $eligible = $db->query('SELECT m.id FROM members m WHERE NOT EXISTS
        (SELECT 1 FROM registration_info r WHERE r.member_id=m.id AND r.status=1) ORDER BY m.id')->fetch_all(MYSQLI_ASSOC);
      $brokenPayments = $db->query('SELECT COUNT(*) AS total FROM payments p LEFT JOIN registration_info r
        ON r.id=p.registration_id WHERE r.id IS NULL')->fetch_assoc()['total'];
      $amounts = $db->query('SELECT amount FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $before = $db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $db->query(file_get_contents('database/migrations/001_login_throttle.sql'));
      $db->query(file_get_contents('database/migrations/002_payment_amount_decimal.sql'));
      $db->query(file_get_contents('database/migrations/003_user_auth_version.sql'));
      $db->query(file_get_contents('database/migrations/004_unique_usernames.sql'));
      $after = $db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $column = $db->query("SHOW COLUMNS FROM payments LIKE 'amount'")->fetch_assoc();
      $users = $db->query('SELECT username,password,type FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $credentials = [];
      foreach ($users as $user) $credentials[$user['username']] = [
        gym_password_verify($user['username'], $user['password']),
        gym_password_needs_rehash($user['password']), (int)$user['type']];
      $add = render_membership_read_page($db, 'manage_membership.php');
      $expired = render_membership_read_page($db, 'view_pdetails.php', ['id'=>2]);
      $login = throttle_test_login($db, 'admin', 'admin');
      $staffLogin = throttle_test_login($db, 'staff', 'staff');
      echo json_encode(compact('summary','states','eligible','brokenPayments','amounts',
        'before','after','column','credentials','add','expired','login','staffLogin'));
    });
  `);
  const data = JSON.parse(response.body);
  assert.deepEqual(data.summary, { active_members: 1, total_members: 4, needs_attention: 0 });
  assert.equal(data.states[1].label, 'Active');
  assert.equal(data.states[2].label, 'Expired');
  assert.equal(data.states[2].can_renew, true);
  assert.equal(data.states[3].label, 'Closed');
  for (const state of Object.values(data.states)) assert.deepEqual(state.issues, []);
  assert.deepEqual(data.eligible.map(row => Number(row.id)), [3, 4]);
  assert.equal(Number(data.brokenPayments), 0);
  assert.deepEqual(data.amounts.map(row => row.amount), ['100.50', '130.00']);
  assert.deepEqual(data.before, data.after);
  assert.equal(data.column.Type, 'decimal(12,2)');
  assert.deepEqual(data.credentials, { admin: [true, false, 1], staff: [true, false, 2] });
  assert.match(data.add, /Kumar/);
  assert.match(data.add, /Mei/);
  assert.match(data.expired, /Renew/);
  assert.equal(data.login.result, 1);
  assert.equal(data.staffLogin.result, 1);
  assert.equal(data.login.authenticated, true);
  assert.equal(data.staffLogin.authenticated, true);
});
