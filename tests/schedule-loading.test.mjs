import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { run } from './helpers/php.mjs';

const page=readFileSync(new URL('../schedule.php',import.meta.url),'utf8');
const source=page.split('<script>')[1].split('</script>')[0].replace("<?php echo date('Y-m-d') ?>",'2026-11-14');
const row={id:1,name:'Test Member',dow:'1',date_from:'2026-11-01',date_to:'2026-11-30',time_from:'09:00',time_to:'10:00'};
function ui() {
  const state={requests:[],started:0,stopped:0,created:0,rendered:0,destroyed:0,hidden:{},disabled:false};
  let retry;
  const document={getElementById:()=>({}),addEventListener(name,callback){callback();}};
  function $(selector) { return {
    click(callback){if(selector==='#retry-schedules')retry=callback;},
    prop(name,value){state.disabled=value;},
    addClass(){for(const key of selector.split(', '))state.hidden[key]=true;},
    removeClass(){state.hidden[selector]=false;},empty(){},val(){},
  }; }
  $.ajax=request=>state.requests.push(request);
  const FullCalendar={Calendar:function(element,config){
    state.created++;state.config=config;
    this.render=()=>{if(state.failRender)throw new Error('Render failure');state.rendered++;};
    this.destroy=()=>{state.destroyed++;};
  }};
  vm.runInNewContext(source,{document,$,FullCalendar,start_load(){state.started++;},end_load(){state.stopped++;},
    uni_modal(title,url){state.modal=url;}});
  state.retry=()=>retry();
  return state;
}
for(const reason of ['blocked','network','timeout','parsererror','server']) {
  test(`${reason} failure ends loading and Retry recovers without duplicate requests`,()=>{
    const state=ui();const request=state.requests[0];
    assert.equal(request.dataType,'json');assert.equal(request.timeout,15000);
    request.error({status:reason==='server'?503:0},reason);request.complete();
    assert.equal(state.stopped,1);assert.equal(state.disabled,false);
    assert.equal(state.hidden['#schedule-load-error'],false);
    assert.equal(state.hidden['#schedule-empty'],true);assert.equal(state.created,0);
    state.retry();state.retry();assert.equal(state.requests.length,2);
    state.requests[1].success([row]);state.requests[1].complete();
    assert.equal(state.created,1);assert.equal(state.rendered,1);assert.equal(state.stopped,2);
    assert.equal(state.hidden['#schedule-load-error'],true);
    state.config.eventClick({event:{extendedProps:{data_id:1}}});
    assert.equal(state.modal,'manage_schedule.php?id=1');
  });
}
for(const response of [null,{},'<b>SQL failure</b>',[null],[{...row,date_to:'invalid'}]]) {
  test(`malformed response ${JSON.stringify(response)} shows safe error and permits retry`,()=>{
    const state=ui();state.requests[0].success(response);state.requests[0].complete();
    assert.equal(state.hidden['#schedule-load-error'],false);
    assert.equal(state.stopped,1);assert.equal(state.disabled,false);
    state.retry();assert.equal(state.requests.length,2);
  });
}
test('empty successful response renders a calendar with an empty-state message',()=>{
  const state=ui();state.requests[0].success([]);state.requests[0].complete();
  assert.equal(state.rendered,1);assert.equal(state.hidden['#schedule-empty'],false);
  assert.equal(state.hidden['#schedule-load-error'],true);assert.equal(state.stopped,1);
});
test('render exception cleans up partial calendar and Retry creates one replacement',()=>{
  const state=ui();state.failRender=true;
  state.requests[0].success([row]);state.requests[0].complete();
  assert.equal(state.destroyed,1);assert.equal(state.hidden['#schedule-load-error'],false);
  assert.equal(state.stopped,1);state.failRender=false;state.retry();
  state.requests[1].success([row]);state.requests[1].complete();
  assert.equal(state.created,2);assert.equal(state.rendered,1);assert.equal(state.stopped,2);
});

const session={login_id:2,login_type:1};
test('schedule feed returns JSON rows, then [] when empty without changing memberships',()=>{
  const response=run(session,`require 'tests/helpers/membership-read-db.php';
    with_membership_read_database(function($db,$schema){
      $db->query('CREATE TABLE schedules (id INT PRIMARY KEY, member_id INT, dow TEXT, date_from DATE, date_to DATE, time_from TIME, time_to TIME) ENGINE=InnoDB');
      $db->query("INSERT INTO schedules VALUES (1,11,'1','2026-11-01','2026-11-30','09:00','10:00')");
      $before=membership_snapshot($db);
      $result=new_membership_for_test($db,[],'get_schecdule');
      $db->query('DELETE FROM schedules');$empty=new_membership_for_test($db,[],'get_schecdule');
      $after=membership_snapshot($db);echo json_encode(compact('result','empty','before','after'));
    });`);
  const data=JSON.parse(response.body);
  assert.equal(data.result.status,200);assert.equal(JSON.parse(data.result.result).length,1);
  assert.equal(data.empty.result,'[]');assert.deepEqual(data.before,data.after);
});
test('schedule feed database failure returns generic 503 JSON',()=>{
  const response=run(session,`require 'tests/helpers/membership-read-db.php';
    with_membership_read_database(function($db,$schema){
      ini_set('error_log','');echo json_encode(new_membership_for_test($db,[],'get_schecdule'));
    });`,{expectedStderr:/^Unable to load schedules\.\r?\n$/});
  const data=JSON.parse(response.body);assert.equal(data.status,503);
  assert.equal(JSON.parse(data.result).error,'Unable to load schedules. Please try again.');
  assert.doesNotMatch(data.result,/SELECT|Stack trace|SQLSTATE/);
});
