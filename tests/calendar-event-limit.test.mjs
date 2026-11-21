import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const library=readFileSync(new URL('../assets/fullcalendar/main.js',import.meta.url),'utf8');
const source=library.slice(library.indexOf('function limitEvents('),library.indexOf('// Given the events within'));
function placement(id,top,bottom,firstCol=0,lastCol=firstCol){
  return {top,bottom,seg:{firstCol,lastCol,eventRange:{instance:{instanceId:id}}}};
}
function limit(columns,maximum,{moreConsumesLevel=true,inBounds}={}){
  const context={};vm.createContext(context);vm.runInContext(source,context);
  const counts=columns.map(()=>0),hidden={};
  const before=JSON.stringify(columns);
  context.limitEvents(counts,hidden,columns,moreConsumesLevel,inBounds||((p)=>p.bottom<=maximum));
  assert.equal(JSON.stringify(columns),before,'Layout must preserve event placements');
  return {counts,hidden};
}

test('first event exceeding row height is hidden without reading an empty placement stack',()=>{
  assert.deepEqual(limit([[placement('first',0,20)]],0),{counts:[1],hidden:{first:true}});
});
test('negative available height and empty days do not crash',()=>{
  assert.deepEqual(limit([[],[placement('first',0,20,1)]],-10),{counts:[0,1],hidden:{first:true}});
  assert.deepEqual(limit([[],[]],0),{counts:[0,0],hidden:{}});
});
test('events fitting the row remain visible',()=>{
  assert.deepEqual(limit([[placement('one',0,20),placement('two',20,40)]],40),{counts:[0],hidden:{}});
});
test('dense days reserve one visible level for the more link',()=>{
  assert.deepEqual(limit([[placement('one',0,20),placement('two',20,40),placement('three',40,60)]],40),{
    counts:[2],hidden:{two:true,three:true},
  });
});
test('overflowing multi-day events are counted once for each covered day',()=>{
  const event=placement('span',0,20,0,2);
  assert.deepEqual(limit([[event],[event],[event]],0),{counts:[1,1,1],hidden:{span:true}});
});
test('numeric event limits preserve their existing behaviour',()=>{
  assert.deepEqual(limit([[placement('one',0,20),placement('two',20,40)]],0,{
    moreConsumesLevel:false,inBounds:(p,level)=>level<1,
  }),{counts:[1],hidden:{two:true}});
});
