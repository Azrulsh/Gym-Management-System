import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './helpers/php.mjs';

const session={login_id:2,login_type:1,csrf_token:'catalog-decimal'};
function isolated(code){return JSON.parse(run(session,`require 'tests/helpers/membership-read-db.php';
  function apply_catalog_decimal($db){
    $db->multi_query(file_get_contents('database/migrations/006_catalog_prices_decimal.sql'));
    do{if($result=$db->store_result())$result->free();}while($db->more_results()&&$db->next_result());
  }
  function catalog_prices($db){$rows=[];foreach(['plans'=>'amount','packages'=>'amount','trainers'=>'rate'] as $table=>$column){
    $rows[$table]=$db->query('SELECT id,CAST('.$column.' AS DECIMAL(12,2)) price FROM '.$table.' ORDER BY id')->fetch_all(MYSQLI_ASSOC);
  }return $rows;}
  with_membership_read_database(function($db,$schema){
    $GLOBALS['auth_connection']=$db;
    $db->query('ALTER TABLE plans MODIFY id INT NOT NULL AUTO_INCREMENT,MODIFY amount FLOAT NOT NULL');
    $db->query("ALTER TABLE packages MODIFY id INT NOT NULL AUTO_INCREMENT,MODIFY amount FLOAT NOT NULL,ADD description TEXT NOT NULL DEFAULT ''");
    $db->query("ALTER TABLE trainers MODIFY id INT NOT NULL AUTO_INCREMENT,MODIFY rate FLOAT NOT NULL,ADD email VARCHAR(100) DEFAULT '',ADD contact VARCHAR(100) DEFAULT ''");
    ${code}
  });`).body);}
test('catalog migration preserves stored prices rounded to cents, IDs and membership history and can run twice',()=>{
  const data=isolated(`$db->query('UPDATE plans SET amount=16777217 WHERE id=1');
    $db->query('UPDATE plans SET amount=-11 WHERE id=3');$db->query('UPDATE packages SET amount=0.10');
    $before=catalog_prices($db);$historyBefore=membership_snapshot($db);
    apply_catalog_decimal($db);apply_catalog_decimal($db);
    $after=catalog_prices($db);$historyAfter=membership_snapshot($db);$types=[];
    foreach(['plans'=>'amount','packages'=>'amount','trainers'=>'rate'] as $table=>$column)$types[$table]=$db->query("SHOW COLUMNS FROM $table LIKE '$column'")->fetch_assoc()['Type'];
    echo json_encode(compact('before','after','historyBefore','historyAfter','types'));`);
  assert.deepEqual(data.before,data.after);assert.deepEqual(data.historyBefore,data.historyAfter);
  assert.equal(data.after.plans[0].price,'16777216.00');
  assert.equal(data.after.plans[2].price,'-11.00');
  assert.ok(Object.values(data.types).every(type=>type==='decimal(12,2)'));
});
test('strict conversion rejects an out-of-range legacy price rather than clipping it',()=>{
  const data=isolated(`$db->query("SET SESSION sql_mode=''");$db->query('UPDATE plans SET amount=1000000000000 WHERE id=1');
    $before=$db->query('SELECT amount FROM plans WHERE id=1')->fetch_assoc();$code=0;
    try{apply_catalog_decimal($db);}catch(mysqli_sql_exception $e){$code=$e->getCode();}
    $after=$db->query('SELECT amount FROM plans WHERE id=1')->fetch_assoc();echo json_encode(compact('before','after','code'));`);
  assert.equal(data.code,1264);assert.deepEqual(data.before,data.after);
});
for(const [kind,table,column,existingId] of [['plan','plans','amount',1],['package','packages','amount',1],['trainer','trainers','rate',2]]){
  test(`${kind} Add/Edit store exact decimals and reject values outside supported precision/range`,()=>{
    const data=isolated(`apply_catalog_decimal($db);$results=[];$historyBefore=membership_snapshot($db);
      foreach(['','${existingId}'] as $id){foreach(['0','0.01','120.50','16777217','9999999999.99','10000000000','9999999999.999','-1','1e3'] as $value){
        $post=['id'=>$id,'csrf_token'=>'catalog-decimal','${column}'=>$value];
        ${kind==='plan'?"$post['plan']='1';":kind==='package'?"$post['package']='Test';$post['description']='Demo';":"$post['name']='Test';$post['email']='trainer@example.test';$post['contact']='0123456789';"}
        $before=catalog_prices($db);
        $result=new_membership_for_test($db,$post,'save_${kind}');
        $target=$id===''?$db->insert_id:(int)$id;
        $after=catalog_prices($db);$stored=null;
        if($result['result']===1){$stored=$db->query('SELECT ${column} price FROM ${table} WHERE id='.(int)$target)->fetch_assoc()['price'];}
        $results[]=compact('id','value','result','before','after','stored');
      }}$historyAfter=membership_snapshot($db);echo json_encode(compact('results','historyBefore','historyAfter'));`);
    for(const result of data.results){
      const valid=['0','0.01','120.50','16777217','9999999999.99'].includes(result.value);
      assert.equal(result.result.status,valid?200:400,`${kind} ${result.value}`);
      if(valid)assert.equal(result.stored,({0:'0.00','0.01':'0.01','120.50':'120.50',16777217:'16777217.00','9999999999.99':'9999999999.99'})[result.value]);
      else assert.deepEqual(result.before,result.after);
    }
    assert.deepEqual(data.historyBefore,data.historyAfter);
  });
}
