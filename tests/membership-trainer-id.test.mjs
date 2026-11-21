import assert from 'node:assert/strict';
import test from 'node:test';
import {run} from './helpers/php.mjs';

function isolated(code) {
  return JSON.parse(run({login_id:2,login_type:1,csrf_token:'trainer-range'}, `
    require 'tests/helpers/membership-db.php';
    with_membership_database(function($db) { ${code} });
  `).body);
}

for (const id of [128, 200, 2147483647]) {
  test(`create and renew preserve trainer ID ${id} and capture current fees`, () => {
    const data = isolated(`
      $db->query('INSERT IGNORE INTO trainers (id,rate) VALUES (${id},10)');
      $before=membership_snapshot($db);
      $post=['member_id'=>'9','plan_id'=>'1','package_id'=>'1','trainer_id'=>'${id}','csrf_token'=>'trainer-range'];
      $created=new_membership_for_test($db,$post);
      $row=$db->query('SELECT * FROM registration_info ORDER BY id DESC LIMIT 1')->fetch_assoc();
      $db->query("UPDATE registration_info SET start_date=DATE_SUB(CURDATE(),INTERVAL 4 MONTH), end_date=DATE_SUB(CURDATE(),INTERVAL 1 DAY) WHERE id=".(int)$row['id']);
      $expired=membership_snapshot($db);
      $db->query('UPDATE trainers SET rate=25 WHERE id=${id}');
      $renewed=new_membership_for_test($db,['rid'=>$row['id'],'csrf_token'=>'trainer-range'],'renew_membership');
      $after=membership_snapshot($db);
      echo json_encode(compact('before','created','row','expired','renewed','after'));
    `);
    assert.equal(data.created.result,1);
    assert.equal(Number(data.row.trainer_id),id);
    assert.equal(data.row.trainer_fee_snapshot,'10.00');
    assert.equal(data.renewed.status,200);
    assert.ok(Number(data.renewed.result)>Number(data.row.id));
    assert.deepEqual(data.after.memberships.slice(0,2),data.before.memberships);
    assert.deepEqual(data.after.memberships[2],{...data.expired.memberships[2],status:'0'});
    assert.equal(Number(data.after.memberships[3].trainer_id),id);
    assert.equal(data.after.memberships[3].trainer_fee_snapshot,'25.00');
    assert.equal(data.after.memberships[3].plan_fee,'100.00');
    assert.equal(data.after.memberships[3].package_fee,'20.00');
    assert.deepEqual(data.after.payments,data.before.payments);
  });
}

test('migration can be repeated without changing references or history', () => {
  const data=isolated(`
    $db->query('ALTER TABLE registration_info MODIFY trainer_id TINYINT NOT NULL DEFAULT 0');
    $before=membership_snapshot($db);
    $sql=file_get_contents('tests/fixtures/legacy-schema/013_membership_trainer_id.sql');
    $db->query($sql);$db->query($sql);
    $after=membership_snapshot($db);
    $column=$db->query("SHOW COLUMNS FROM registration_info LIKE 'trainer_id'")->fetch_assoc();
    echo json_encode(compact('before','after','column'));
  `);
  assert.deepEqual(data.after,data.before);
  assert.match(data.column.Type,/^int(?:\(11\))?$/);
  assert.equal(data.column.Default,'0');
  assert.equal(data.column.Null,'NO');
});
