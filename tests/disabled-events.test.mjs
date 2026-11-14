import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './helpers/php.mjs';

for(const code of ["include 'events.php';", "$_GET['page']='events';include 'index.php';"]){
  test(`Admin receives controlled 404 before legacy Events runs: ${code}`,()=>{
    const response=run({login_id:2,login_type:1,login_name:'Test'},code);
    assert.equal(response.status,404);
    assert.match(response.body,/not available|Page not found/);
    assert.doesNotMatch(response.body,/Warning|Fatal error|system_settings|List of Events|<table|view-panel/);
  });
}
