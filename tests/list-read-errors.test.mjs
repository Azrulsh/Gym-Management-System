import assert from 'node:assert/strict';
import test from 'node:test';
import {run} from './helpers/php.mjs';

const pages=[['members.php','members'],['users.php','users'],['plans.php','plans'],['packages.php','packages'],['trainer.php','trainers']];
function render(page,setup='',options={}){
 return run({login_id:2,login_type:1},`
  require 'tests/helpers/membership-read-db.php';
  with_membership_read_database(function($db){
   $db->query("ALTER TABLE packages ADD description TEXT NOT NULL DEFAULT ''");
   $db->query("ALTER TABLE trainers ADD email VARCHAR(100) DEFAULT 'trainer@example.test', ADD contact VARCHAR(100) DEFAULT '0123456789'");
   ${setup}
   $before=membership_snapshot($db);
   $html=render_membership_read_page($db,'${page}');
   $after=membership_snapshot($db);
   if($before!==$after)throw new RuntimeException('List changed history');
   echo $html;
  });`,options);
}

for(const [page,table] of pages){
 test(`${page} returns a generic 503 before rendering a partial table on query failure`,()=>{
  const d=render(page,`$db->query('DROP TABLE ${table}');`,{expectedStderr:new RegExp('^Unable to load '+table+' \\(error code 1146\\)\\.\\r?\\n$')});
  assert.equal(d.status,503);assert.equal(d.body,`<div class="alert alert-danger" role="alert">Unable to load ${table}. Please try again.</div>`);
  assert.doesNotMatch(d.body,/<table|<form|mysqli|SELECT|Stack trace|Fatal error|1146/);
 });
 test(`${page} still renders records and action controls successfully`,()=>{
  const d=render(page);assert.equal(d.status,200);assert.match(d.body,/<table/);
  assert.match(d.body,/data-id=/);assert.doesNotMatch(d.body,/Warning|Fatal error|Unable to load/);
 });
 test(`${page} distinguishes an empty list from a failed query`,()=>{
  const d=render(page,`$db->query('DELETE FROM ${table}');`);
  assert.equal(d.status,200);assert.match(d.body,/<table/);assert.doesNotMatch(d.body,/data-id=|Unable to load|Warning|Fatal error/);
 });
}

test('index buffers shell output so an included list failure can still set HTTP 503',()=>{
 const d=run({login_id:2,login_type:1},`
  $_GET=['page'=>'members'];
  $source=file_get_contents('index.php');
  $source=str_replace("include __DIR__ . '/' . \\$page . '.php';",
    "if(headers_sent())throw new RuntimeException('Headers sent before list');http_response_code(503);echo 'List unavailable';",$source);
  $source=str_replace('__DIR__',var_export(getcwd(),true),$source);
  eval('?>'.$source);`);
 assert.equal(d.status,503);assert.match(d.body,/List unavailable/);assert.doesNotMatch(d.body,/Warning|Fatal error/);
});
