import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../users.php',import.meta.url),'utf8').split('<script>')[1].split('</script>')[0];
function ui(){
 const rows=Array.from({length:12},(_,i)=>({id:String(i+1)}));
 let visible=rows,direct=[],newUser;
 const delegated=[],calls=[],document={};
 function $(target){
  if(target===document)return {on(event,selector,handler){assert.equal(event,'click');delegated.push({selector,handler});}};
  if(target==='table')return {dataTable(){visible=rows.slice(0,10);}};
  if(target==='#new_user')return {click(handler){newUser=handler;}};
  if(target==='.edit_user')return {click(handler){direct=visible.map(row=>({row,handler}));}};
  return {attr(name){assert.equal(name,'data-id');return target.id;}};
 }
 vm.runInNewContext(source,{$,document,uni_modal(...args){calls.push(args);}});
 return {
  calls,
  page2(){visible=rows.slice(10);},
  search(){visible=[rows[11]];},
  redraw(){visible=[{id:'99'}];},
  edit(index=0){const row=visible[index];for(const entry of direct)if(entry.row===row)entry.handler.call(row);
   for(const entry of delegated)if(entry.selector==='.edit_user')entry.handler.call(row);},
  add(){newUser();},
 };
}

test('Edit works on the first page without duplicate modal calls',()=>{
 const s=ui();s.edit();assert.deepEqual(s.calls,[['Edit User','manage_user.php?id=1']]);
});
test('Edit works for users initially outside the first DataTables page',()=>{
 const s=ui();s.page2();s.edit();assert.deepEqual(s.calls,[['Edit User','manage_user.php?id=11']]);
});
test('Edit works when search reveals a user originally on another page',()=>{
 const s=ui();s.search();s.edit();assert.deepEqual(s.calls,[['Edit User','manage_user.php?id=12']]);
});
test('replaced row controls work after redraw without rebinding',()=>{
 const s=ui();s.redraw();s.edit();assert.deepEqual(s.calls,[['Edit User','manage_user.php?id=99']]);
});
test('New User still opens the blank form',()=>{
 const s=ui();s.add();assert.deepEqual(s.calls,[['New User','manage_user.php']]);
});
