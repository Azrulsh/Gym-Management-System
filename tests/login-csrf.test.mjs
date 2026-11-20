import assert from 'node:assert/strict';
import test from 'node:test';
import {run,literal} from './helpers/php.mjs';

for(const entry of ['dispatch','method']){
 for(const session of [{},{login_id:2,login_type:1,login_auth_version:1,csrf_token:'expected'}]){
  for(const token of [null,'','wrong',['expected'],true]){
   test(`${entry} rejects ${JSON.stringify(token)} before database access or session changes (${session.login_id?'signed in':'anonymous'})`,()=>{
    const d=run(session,`
      $before=$_SESSION;
      register_shutdown_function(function() use ($before){if($_SESSION!==$before)throw new RuntimeException('Login CSRF rejection changed session');});
      $_SERVER['REQUEST_METHOD']='POST';$_SERVER['HTTP_ORIGIN']='https://external.example';
      $_POST=['username'=>'staff','password'=>'staff','csrf_token'=>json_decode(${literal(JSON.stringify(token))},true)];
      ${entry==='dispatch'?"$_GET=['action'=>'login'];include 'ajax.php';":`
       require 'admin_class.php';ob_start();
       $action=(new ReflectionClass('Action'))->newInstanceWithoutConstructor();
       $property=new ReflectionProperty('Action','db');$property->setAccessible(true);
       $property->setValue($action,new class {public function close(){} public function prepare($sql){throw new RuntimeException('Unexpected query');}});
       $action->login();`}
      echo 'UNEXPECTED';`);
    assert.equal(d.status,419);assert.equal(JSON.parse(d.body).error,'Login form has expired. Refresh the page and try again.');
   });
  }
 }
}

test('missing token is rejected even when there is an existing authenticated session',()=>{
 const d=run({login_id:2,login_type:1,csrf_token:'expected'},`
  $_SERVER['REQUEST_METHOD']='POST';$_POST=['username'=>'staff','password'=>'staff'];require_login_request();`);
 assert.equal(d.status,419);
});
test('matching token passes request validation without requiring authentication',()=>{
 const d=run({csrf_token:'expected'},`$_SERVER['REQUEST_METHOD']='POST';$_POST=['csrf_token'=>'expected'];require_login_request();echo 'allowed';`);
 assert.equal(d.status,200);assert.equal(d.body,'allowed');
});
test('GET retains 405 even with a matching token',()=>{
 const d=run({csrf_token:'expected'},`$_SERVER['REQUEST_METHOD']='GET';$_POST=['csrf_token'=>'expected'];require_login_request();`);
 assert.equal(d.status,405);
});
test('login form renders an escaped token matching its pre-login session',()=>{
 const d=run({},`
  $page=str_replace("include('./db_connect.php');",'',file_get_contents('login.php'));
  $page=str_replace('__DIR__',var_export(getcwd(),true),$page);
  ob_start();eval('?>'.$page);$html=ob_get_clean();
  echo json_encode(['html'=>$html,'token'=>$_SESSION['csrf_token']]);`);
 const data=JSON.parse(d.body);assert.match(data.token,/^[a-f0-9]{64}$/);
 assert.ok(data.html.includes('name="csrf_token" value="'+data.token+'"'));
});
