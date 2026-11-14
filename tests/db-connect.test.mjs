import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './helpers/php.mjs';

for(const mode of ['page','ajax','xhr']){
  test(`connection failure returns safe 503 for ${mode} without stopping MySQL`,()=>{
    const response=run({},`
      $_SERVER['SCRIPT_NAME']='${mode==='ajax'?'ajax.php':'members.php'}';
      ${mode==='xhr'?"$_SERVER['HTTP_X_REQUESTED_WITH']='XMLHttpRequest';":''}
      $source=file_get_contents('db_connect.php');
      $source=str_replace("new mysqli('localhost', 'root', '', 'gym')", "new mysqli('127.0.0.1', 'root', '', 'gym', 1)",$source);
      $source=str_replace('__DIR__',var_export(getcwd(),true),$source);
      eval('?>'.$source);echo 'UNREACHABLE';`,
      {expectedStderr:/^Database connection unavailable \(error code \d+\)\.\r?\n$/});
    assert.equal(response.status,503);
    assert.doesNotMatch(response.body,/UNREACHABLE|Fatal error|Warning|127\.0\.0\.1|root|mysqli|Stack trace/);
    if(mode==='page')assert.match(response.body,/role="alert"/);
    else assert.equal(JSON.parse(response.body).error,'Unable to connect to the database. Please try again later.');
  });
}

test('timezone configuration failure is also handled without exposing details',()=>{
  const response=run({},`
    $_SERVER['SCRIPT_NAME']='ajax.php';
    $source=file_get_contents('db_connect.php');
    $source=str_replace("new mysqli('localhost', 'root', '', 'gym')", "new class { function close() {} }",$source);
    $source=str_replace('configure_database_timezone($conn);',"throw new RuntimeException('private test details');",$source);
    $source=str_replace('__DIR__',var_export(getcwd(),true),$source);
    eval('?>'.$source);echo 'UNREACHABLE';`,
    {expectedStderr:/^Database connection unavailable \(error code 0\)\.\r?\n$/});
  assert.equal(response.status,503);assert.doesNotMatch(response.body,/private test details|UNREACHABLE/);
  assert.equal(JSON.parse(response.body).error,'Unable to connect to the database. Please try again later.');
});
