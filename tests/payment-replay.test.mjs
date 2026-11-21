import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './helpers/php.mjs';

function isolated(code, options={}) {
  return JSON.parse(run({login_id:2,login_type:1,csrf_token:'replay'},`
    require 'tests/helpers/membership-read-db.php';require 'payment_read.php';
    with_membership_read_database(function($db,$schema){
      $GLOBALS['auth_connection']=$db;
      $post=['registration_id'=>'9','amount'=>'100.00','plan_amount'=>'100.00','remarks'=>"Member's payment",'csrf_token'=>'replay','request_key'=>str_repeat('a',64)];
      ${code}
    });`,options).body);
}

test('lost-response retry returns original success even after Plan balance is fully allocated',()=>{
  const data=isolated(`$first=new_membership_for_test($db,$post,'save_payment');$before=membership_snapshot($db);
    $post['amount']='100';$post['plan_amount']='100.0';
    $retry=new_membership_for_test($db,$post,'save_payment');$after=membership_snapshot($db);
    $balance=payment_plan_balance($db,9,'100.00');echo json_encode(compact('first','retry','before','after','balance'));`);
  assert.equal(data.first.result,1);assert.equal(data.retry.result,1);
  assert.deepEqual(data.after,data.before);assert.equal(data.balance,0);
});

for(const [field,value] of [['amount','101.00'],['plan_amount','0.00'],['remarks','changed'],['registration_id','8']]){
  test(`reused key with changed ${field} returns conflict and preserves records`,()=>{
    const data=isolated(`new_membership_for_test($db,$post,'save_payment');$before=membership_snapshot($db);
      $post['${field}']='${value}';$result=new_membership_for_test($db,$post,'save_payment');$after=membership_snapshot($db);
      echo json_encode(compact('result','before','after'));`);
    assert.equal(data.result.status,409);assert.deepEqual(data.after,data.before);
  });
}

test('identical legitimate monthly payments with different keys both save',()=>{
  const data=isolated(`$post['plan_amount']='0.00';$first=new_membership_for_test($db,$post,'save_payment');
    $post['request_key']=str_repeat('b',64);$second=new_membership_for_test($db,$post,'save_payment');
    $rows=$db->query('SELECT amount,plan_amount,request_key FROM payments WHERE request_key IS NOT NULL ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    echo json_encode(compact('first','second','rows'));`);
  assert.equal(data.first.result,1);assert.equal(data.second.result,1);assert.equal(data.rows.length,2);
  assert.equal(data.rows[0].amount,data.rows[1].amount);assert.notEqual(data.rows[0].request_key,data.rows[1].request_key);
});

for(const key of [null,'','abc','a'.repeat(63),'A'.repeat(64),['a'.repeat(64)],true]){
  test(`invalid request key ${JSON.stringify(key)} cannot write`,()=>{
    const data=isolated(`$post['request_key']=json_decode('${JSON.stringify(key)}',true);$before=membership_snapshot($db);
      $result=new_membership_for_test($db,$post,'save_payment');$after=membership_snapshot($db);echo json_encode(compact('result','before','after'));`);
    assert.equal(data.result.status,400);assert.deepEqual(data.after,data.before);
  });
}

test('migration preserves legacy rows and keys when imported again; newly opened forms have different keys',()=>{
  const data=isolated(`$db->query('ALTER TABLE payments DROP INDEX payments_request_key_unique,DROP COLUMN request_key');
    $before=$db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $db->query(file_get_contents('tests/fixtures/legacy-schema/009_payment_request_keys.sql'));
    $legacy=$db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    new_membership_for_test($db,$post,'save_payment');$first=membership_snapshot($db);
    $db->query(file_get_contents('tests/fixtures/legacy-schema/009_payment_request_keys.sql'));$after=membership_snapshot($db);
    $one=render_membership_read_page($db,'payment.php',['rid'=>9]);$two=render_membership_read_page($db,'payment.php',['rid'=>9]);
    preg_match('/name="request_key" value="([a-f0-9]{64})"/',$one,$key1);
    preg_match('/name="request_key" value="([a-f0-9]{64})"/',$two,$key2);
    echo json_encode(compact('before','legacy','first','after','key1','key2'));`);
  assert.deepEqual(data.legacy.map(({request_key,...old})=>old),data.before);
  assert.ok(data.legacy.every(row=>row.request_key===null));assert.deepEqual(data.after,data.first);
  assert.equal(data.key1[1].length,64);assert.notEqual(data.key1[1],data.key2[1]);
});

for(const mode of ['same request','separate payments','key reused for different membership']){
  test(`parallel ${mode} preserves exactly the intended payments`,()=>{
    const data=isolated(`
      $post['plan_amount']='0.00';$posts=[$post,$post,$post];
      ${mode==='separate payments' ? "$posts[1]['request_key']=str_repeat('b',64);$posts[2]['request_key']=str_repeat('c',64);" : ''}
      ${mode==='key reused for different membership' ? "$posts[1]['registration_id']='8';$posts[2]['registration_id']='8';" : ''}
      $db->query('CREATE TRIGGER slow_payment BEFORE INSERT ON payments FOR EACH ROW DO SLEEP(0.2)');
      $workers=[];
      foreach($posts as $workerPost){
        $source='session_set_save_handler(function(){return true;},function(){return true;},function(){return "";},function(){return true;},function(){return true;},function(){return 0;});session_start();'
          .'require "tests/helpers/membership-db.php";require "admin_class.php";'
          .'$_SESSION='.var_export($_SESSION,true).';'
          .'$db=throttle_test_connection('.var_export($schema,true).');$GLOBALS["auth_connection"]=$db;'
          .'echo json_encode(new_membership_for_test($db,'.var_export($workerPost,true).',"save_payment"));$db->close();';
        $process=proc_open([PHP_BINARY,'-r',$source],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
        if(!is_resource($process))throw new RuntimeException('Worker failed');
        fclose($pipes[0]);$workers[]=[$process,$pipes];
      }
      $results=[];
      foreach($workers as [$process,$pipes]){
        $out=stream_get_contents($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
        if(proc_close($process)!==0||$error!=='')throw new RuntimeException($error);
        $results[]=json_decode($out,true);
      }
      $rows=$db->query('SELECT * FROM payments WHERE request_key IS NOT NULL')->fetch_all(MYSQLI_ASSOC);
      echo json_encode(compact('results','rows'));`);
    assert.equal(data.rows.length,mode==='separate payments'?3:1);
    if(mode==='key reused for different membership'){
      assert.ok(data.results.some(r=>r.result===1));assert.ok(data.results.some(r=>r.status===409));
      assert.ok(data.results.every(r=>r.result===1||r.status===409));
    }else assert.ok(data.results.every(r=>r.result===1));
  });
}

test('rolled back payment can be retried with the same key after storage recovers',()=>{
  const data=isolated(`$before=membership_snapshot($db);
    $db->query("CREATE TRIGGER fail_payment BEFORE INSERT ON payments FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test failure'");
    $failed=new_membership_for_test($db,$post,'save_payment');$afterFailure=membership_snapshot($db);
    $db->query('DROP TRIGGER fail_payment');$retry=new_membership_for_test($db,$post,'save_payment');$after=membership_snapshot($db);
    echo json_encode(compact('before','failed','afterFailure','retry','after'));`,
    {expectedStderr:/^Unable to save payment \(database code 1644\)\.\r?\n$/});
  assert.equal(data.failed.status,500);assert.deepEqual(data.afterFailure,data.before);
  assert.equal(data.retry.result,1);assert.equal(data.after.payments.length,data.before.payments.length+1);
});
