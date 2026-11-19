import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './helpers/php.mjs';

function save(method,setup){
  return JSON.parse(run({login_id:2,login_type:1,csrf_token:'identity'},`
    require 'tests/helpers/membership-db.php';
    with_throttle_database(function($db,$schema){
      $GLOBALS['auth_connection']=$db;
      $post=['version'=>'1','id'=>'${method==='save_account'?2:3}','name'=>'Updated','username'=>'new_username','password'=>'','type'=>'${method==='save_account'?1:2}','csrf_token'=>'identity'];
      ${setup}
      $before=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $result=new_membership_for_test($db,$post,'${method}');
      $after=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      echo json_encode(compact('result','before','after'));
    });`).body);
}

for(const method of ['save_user','save_account']){
  for(const length of [150,200]){
    test(`${method} accepts ${length} Unicode characters without changing credentials or roles`,()=>{
      const data=save(method,`$post['name']=str_repeat(hex2bin('c3a9'),${length});$post['username']=str_repeat(hex2bin('c3a9'),${length});`);
      assert.equal(data.result.result,1);
      const index=method==='save_account'?0:1;
      assert.equal(data.after[index].name,'é'.repeat(length));assert.equal(data.after[index].username,'é'.repeat(length));
      for(const field of ['id','password','type','auth_version'])assert.equal(data.after[index][field],data.before[index][field]);
      assert.deepEqual(data.after[1-index],data.before[1-index]);
    });
  }
  for(const field of ['name','username']){
    for(const [label,value] of [['201 ASCII',"str_repeat('a',201)"],['201 Unicode',"str_repeat(hex2bin('c3a9'),201)"],['invalid UTF-8','chr(255)'],['blank',"'   '"]]){
      test(`${method} rejects ${label} ${field} without changing accounts`,()=>{
        const data=save(method,`$post['${field}']=${value};`);
        assert.notEqual(data.result.result,1);assert.deepEqual(data.after,data.before);
      });
    }
  }
  test(`${method} still enforces the password byte limit`,()=>{
    const data=save(method,`$post['password']=str_repeat(hex2bin('c3a9'),2049);`);
    assert.notEqual(data.result.result,1);assert.deepEqual(data.after,data.before);
  });
}

test('Unicode username accepted by Admin can subsequently be kept during an own-profile name change',()=>{
  const data=JSON.parse(run({login_id:2,login_type:1,csrf_token:'identity'},`
    require 'tests/helpers/membership-db.php';
    with_throttle_database(function($db,$schema){
      $GLOBALS['auth_connection']=$db;$username=str_repeat(hex2bin('c3a9'),150);
      $admin=new_membership_for_test($db,['version'=>'1','id'=>'3','name'=>'Staff','username'=>$username,'password'=>'','type'=>'2','csrf_token'=>'identity'],'save_user');
      $_SESSION['login_id']=3;$_SESSION['login_type']=2;$_SESSION['login_auth_version']=1;
      $own=new_membership_for_test($db,['version'=>'2','id'=>'3','name'=>'Updated Staff','username'=>$username,'password'=>'','csrf_token'=>'identity'],'save_account');
      $row=$db->query('SELECT name,username FROM users WHERE id=3')->fetch_assoc();echo json_encode(compact('admin','own','row'));
    });`).body);
  assert.equal(data.admin.result,1);assert.equal(data.own.result,1);
  assert.equal(data.row.name,'Updated Staff');assert.equal(data.row.username,'é'.repeat(150));
});
