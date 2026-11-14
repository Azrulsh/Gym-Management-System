import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from './helpers/php.mjs';

const php=process.env.GYM_TEST_PHP||(process.platform==='win32'?'C:/xampp/php/php.exe':'php');
for(const file of ['auth.php','membership_read.php','membership_dates.php']){
  test(`${file} uses Malaysian time even when PHP defaults to Europe/Berlin`,()=>{
    const result=spawnSync(php,['-d','date.timezone=Europe/Berlin','-r',`
      session_set_save_handler(function(){return true;},function(){return true;},function(){return '';},function(){return true;},function(){return true;},function(){return 0;});
      require '${file}';echo date_default_timezone_get();`],
      {cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');assert.equal(result.stdout,'Asia/Kuala_Lumpur');
  });
}

test('database timezone matches PHP without changing stored dates or payment history',()=>{
  const data=JSON.parse(run({login_id:2,login_type:1},`
    require 'tests/helpers/membership-read-db.php';
    with_membership_read_database(function($db,$schema){
      $before=membership_snapshot($db);
      $db->query("SET SESSION time_zone = '-05:00'");configure_database_timezone($db);
      $clock=$db->query("SELECT @@session.time_zone AS zone,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),NOW()) AS offset_seconds,UNIX_TIMESTAMP() AS epoch")->fetch_assoc();
      $phpEpoch=time();$after=membership_snapshot($db);echo json_encode(compact('before','after','clock','phpEpoch'));
    });`).body);
  assert.equal(data.clock.zone,'+08:00');assert.equal(Number(data.clock.offset_seconds),28800);
  assert.ok(Math.abs(Number(data.clock.epoch)-data.phpEpoch)<=2);assert.deepEqual(data.after,data.before);
});

for(const [utc,localDate,label,renew] of [
  ['2026-11-14 15:59:59','2026-11-14','Active',false],
  ['2026-11-14 16:00:00','2026-11-15','Expired',true],
  ['2026-12-31 16:00:00','2027-01-01','Expired',true],
]){
  test(`PHP and SQL agree across Malaysian midnight at ${utc} UTC`,()=>{
    const data=JSON.parse(run({login_id:2,login_type:1},`
      require 'tests/helpers/membership-read-db.php';require 'membership_read.php';
      with_membership_read_database(function($db,$schema){
        $instant=new DateTimeImmutable('${utc}',new DateTimeZone('UTC'));
        $local=$instant->setTimezone(new DateTimeZone(date_default_timezone_get()))->format('Y-m-d');
        $db->query('SET timestamp='.$instant->getTimestamp());
        $sql=$db->query('SELECT CURDATE() AS today,NOW() AS local_time')->fetch_assoc();
        $db->query("UPDATE registration_info SET start_date='2026-10-14',end_date='2026-11-14' WHERE id=9");
        $row=membership_read_records($db,null,9)[0];$state=membership_read_state($row,$local);
        $db->query('SET timestamp=DEFAULT');echo json_encode(compact('local','sql','state'));
      });`).body);
    assert.equal(data.local,localDate);assert.equal(data.sql.today,localDate);
    assert.equal(data.state.label,label);assert.equal(data.state.can_renew,renew);
  });
}
