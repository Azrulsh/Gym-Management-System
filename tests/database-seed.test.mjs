import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './helpers/php.mjs';

test('development reset imports twice, integrates migrations and provides complete usable demo records', () => {
  const response = run({ login_id: 1, login_type: 1, csrf_token: 'seed-test' }, `
    require 'tests/helpers/throttle-db.php';
    require 'tests/helpers/membership-read-db.php';
    require 'membership_read.php';
    require 'membership_dates.php';
    require 'payment_read.php';
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
      foreach ($rows as $row) $states[$row['registration_id']] = membership_read_state($row);
      $balances=[];
      foreach ($rows as $row) {
        if (membership_end_date(new DateTimeImmutable($row['start_date']), (int)$row['plan']) !== $row['end_date']) throw new RuntimeException('Inconsistent seed duration');
        $balances[$row['id']]=payment_plan_balance($db,$row['id'],$row['pamount']);
      }
      $counts=[];
      foreach(['members','plans','packages','trainers','registration_info','payments','schedules','users','login_throttle','system_settings','events','event_registrations'] as $table) $counts[$table]=(int)$db->query('SELECT COUNT(*) AS n FROM '.$table)->fetch_assoc()['n'];
      $invalidAllocations=$db->query('SELECT COUNT(*) AS n FROM payments WHERE plan_amount IS NULL OR plan_amount<0 OR plan_amount>amount OR request_key IS NULL')->fetch_assoc()['n'];
      $futurePayments=$db->query('SELECT COUNT(*) AS n FROM payments WHERE date_created>CURRENT_TIMESTAMP')->fetch_assoc()['n'];
      $brokenSchedules=$db->query('SELECT COUNT(*) AS n FROM schedules s LEFT JOIN members m ON m.id=s.member_id WHERE m.id IS NULL')->fetch_assoc()['n'];
      $outsideValidity=$db->query('SELECT COUNT(*) AS n FROM schedules s WHERE NOT EXISTS (SELECT 1 FROM registration_info r WHERE r.member_id=s.member_id AND r.status=1 AND s.date_from>=r.start_date AND s.date_to<=r.end_date)')->fetch_assoc()['n'];
      $overallocated=$db->query('SELECT COUNT(*) AS n FROM (SELECT r.id FROM registration_info r JOIN payments p ON p.registration_id=r.id GROUP BY r.id,r.plan_fee HAVING SUM(p.plan_amount)>r.plan_fee) invalid')->fetch_assoc()['n'];
      $eligible = $db->query('SELECT m.id FROM members m WHERE NOT EXISTS
        (SELECT 1 FROM registration_info r WHERE r.member_id=m.id AND r.status=1) ORDER BY m.id')->fetch_all(MYSQLI_ASSOC);
      $brokenPayments = $db->query('SELECT COUNT(*) AS total FROM payments p LEFT JOIN registration_info r
        ON r.id=p.registration_id WHERE r.id IS NULL')->fetch_assoc()['total'];
      $amounts = $db->query('SELECT amount FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $before = $db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $db->query(file_get_contents('tests/fixtures/legacy-schema/001_login_throttle.sql'));
      $db->query(file_get_contents('tests/fixtures/legacy-schema/002_payment_amount_decimal.sql'));
      $db->query(file_get_contents('tests/fixtures/legacy-schema/003_user_auth_version.sql'));
      $db->query(file_get_contents('tests/fixtures/legacy-schema/004_unique_usernames.sql'));
      $db->query(file_get_contents('tests/fixtures/legacy-schema/005_unique_member_numbers.sql'));
      $db->multi_query(file_get_contents('tests/fixtures/legacy-schema/006_catalog_prices_decimal.sql'));
      do { if ($result = $db->store_result()) $result->free(); }
      while ($db->more_results() && $db->next_result());
      $db->multi_query(file_get_contents('tests/fixtures/legacy-schema/007_membership_price_snapshots.sql'));
      do { if ($result = $db->store_result()) $result->free(); }
      while ($db->more_results() && $db->next_result());
      $db->query(file_get_contents('tests/fixtures/legacy-schema/008_payment_plan_allocation.sql'));
      $db->query(file_get_contents('tests/fixtures/legacy-schema/009_payment_request_keys.sql'));
      $db->query(file_get_contents('tests/fixtures/legacy-schema/010_membership_duration_snapshots.sql'));
      $db->query(file_get_contents('tests/fixtures/legacy-schema/011_plan_versions.sql'));
      $db->multi_query(file_get_contents('tests/fixtures/legacy-schema/012_package_trainer_versions.sql'));
      do { if ($result = $db->store_result()) $result->free(); } while ($db->more_results() && $db->next_result());
      foreach(['013_membership_trainer_id.sql','014_member_versions.sql','015_schedule_versions.sql','016_user_versions.sql'] as $migration) $db->query(file_get_contents('tests/fixtures/legacy-schema/'.$migration));
      $after = $db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $column = $db->query("SHOW COLUMNS FROM payments LIKE 'amount'")->fetch_assoc();
      $users = $db->query('SELECT username,password,type FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $credentials = [];
      foreach ($users as $user) $credentials[$user['username']] = [
        gym_password_verify($user['username'], $user['password']),
        gym_password_needs_rehash($user['password']), (int)$user['type']];
      $add = render_membership_read_page($db, 'manage_membership.php');
      $expired = render_membership_read_page($db, 'view_pdetails.php', ['id'=>2]);
      $GLOBALS['auth_connection']=$db;
      $schedules=$db->query('SELECT * FROM schedules ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      foreach($schedules as $schedule) {
        $post=['id'=>(string)$schedule['id'],'version'=>(string)$schedule['version'],'member_id'=>(string)$schedule['member_id'],
          'date_from'=>substr($schedule['date_from'],0,7),'date_to'=>substr($schedule['date_to'],0,7),
          'time_from'=>$schedule['time_from'],'time_to'=>$schedule['time_to'],'dow'=>explode(',',$schedule['dow']),'csrf_token'=>'seed-test'];
        $result=new_membership_for_test($db,$post,'save_schedule');
        if($result['result']!==1)throw new RuntimeException('Invalid seed schedule: '.json_encode($result));
      }
      $login = throttle_test_login($db, 'admin', 'admin');
      $staffLogin = throttle_test_login($db, 'staff', 'staff');
      echo json_encode(compact('summary','states','eligible','brokenPayments','amounts',
        'before','after','column','credentials','add','expired','login','staffLogin','counts','balances','invalidAllocations','futurePayments','brokenSchedules','outsideValidity','overallocated'));
    });
  `);
  const data = JSON.parse(response.body);
  assert.deepEqual(data.summary, { active_members: 6, total_members: 15, needs_attention: 0 });
  assert.equal(data.states[1].label, 'Active');
  assert.equal(data.states[2].label, 'Expired');
  assert.equal(data.states[2].can_renew, true);
  assert.equal(data.states[3].label, 'Closed');
  assert.equal(data.states[4].label, 'Closed');
  assert.equal(data.states[5].label, 'Active');
  assert.equal(data.states[6].label, 'Scheduled');
  assert.equal(data.states[8].can_renew, true);
  assert.equal(data.states[13].can_renew, true);
  for (const state of Object.values(data.states)) assert.deepEqual(state.issues, []);
  assert.deepEqual(data.eligible.map(row => Number(row.id)), [3, 4, 11, 12, 15]);
  assert.equal(Number(data.brokenPayments), 0);
  assert.deepEqual(data.amounts.map(row => row.amount), ['100.50','110.00','130.00','130.00','130.00','365.25','200.00','100.00','125.50','1085.25','125.25','990.00','100.00','40.00','30.00']);
  assert.deepEqual(data.before, data.after);
  assert.equal(data.column.Type, 'decimal(12,2)');
  assert.deepEqual(data.credentials, { admin: [true, false, 1], staff: [true, false, 2], admin2: [true,false,1], member:[true,false,3], member_disabled:[true,false,3] });
  assert.deepEqual(data.counts,{members:15,plans:5,packages:6,trainers:4,registration_info:13,payments:15,schedules:9,users:5,login_throttle:0,system_settings:1,events:9,event_registrations:10});
  assert.equal(Number(data.invalidAllocations),0);
  assert.equal(Number(data.futurePayments),0);
  assert.equal(Number(data.brokenSchedules),0);
  assert.equal(Number(data.outsideValidity),0);
  assert.equal(Number(data.overallocated),0);
  assert.equal(data.balances[1],16950);
  assert.equal(data.balances[2],0);
  assert.equal(data.balances[5],0);
  assert.equal(data.balances[7],15075);
  assert.equal(data.balances[9],0);
  assert.equal(data.balances[12],0);
  assert.equal(data.balances[13],6000);
  assert.match(data.add, /Kumar/);
  assert.match(data.add, /Mei/);
  assert.match(data.expired, /Renew/);
  assert.equal(data.login.result, 1);
  assert.equal(data.staffLogin.result, 1);
  assert.equal(data.login.authenticated, true);
  assert.equal(data.staffLogin.authenticated, true);
});

for(const day of ['2027-01-31','2028-02-29','2027-12-31']) {
  test(`mock dates and balances remain consistent on import day ${day}`,()=>{
    const response=run({},`
      require 'tests/helpers/throttle-db.php';require 'membership_read.php';require 'membership_dates.php';
      with_throttle_database(function($db){
        $db->query("SET timestamp=UNIX_TIMESTAMP('${day} 12:00:00')");
        $db->multi_query(file_get_contents('database/gym.sql'));
        do {if($r=$db->store_result())$r->free();}while($db->more_results()&&$db->next_result());
        $today=$db->query('SELECT CURDATE() AS day')->fetch_assoc()['day'];
        $labels=[];
        foreach(membership_read_records($db) as $row){
          $state=membership_read_state($row,$today);
          if($state['issues'])throw new RuntimeException('Incomplete demo membership');
          if(membership_end_date(new DateTimeImmutable($row['start_date']),(int)$row['plan'])!==$row['end_date'])throw new RuntimeException('Invalid demo duration');
          $labels[$state['label']]=($labels[$state['label']]??0)+1;
        }
        $future=$db->query('SELECT COUNT(*) AS n FROM payments WHERE date_created>CURRENT_TIMESTAMP')->fetch_assoc()['n'];
        echo json_encode(compact('today','labels','future'));
      });`);
    const data=JSON.parse(response.body);
    assert.equal(data.today,day);
    assert.deepEqual(data.labels,{Expired:3,Active:6,Closed:3,Scheduled:1});
    assert.equal(Number(data.future),0);
  });
}
