import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../assets/js/money-input.js',import.meta.url),'utf8');
function controls(value) {
  const handlers={};const events=[];
  const input={value,disabled:false,readOnly:false,validity:{badInput:false},
    matches:()=>true,reportValidity(){events.push('invalid');},dispatchEvent(event){events.push(event.type);}};
  const group={querySelector:()=>input};
  vm.runInNewContext(source,{document:{addEventListener(name,fn){handlers[name]=fn;}},Event:class{constructor(type){this.type=type;}}});
  return {input,events,
    click(direction){const button={disabled:false,dataset:{direction:String(direction)},closest:()=>group};
      handlers.click({target:{closest:()=>button},preventDefault(){}});},
    key(key){handlers.keydown({target:input,key,preventDefault(){}});}};
}

for(const [start,direction,end] of [['10.50',1,'11.50'],['10.50',-1,'9.50'],['0',-1,'0.00'],['0.50',-1,'0.00'],['',1,'1.00'],['',-1,'0.00'],['9999999999.99',1,'9999999999.99'],['9999999999.50',1,'9999999999.99'],['0.01',1,'1.01']]){
  test(`arrow ${direction} changes ${JSON.stringify(start)} to ${end}`,()=>{
    const state=controls(start);state.click(direction);assert.equal(state.input.value,end);
    assert.deepEqual(state.events,['input','change']);
  });
}
test('keyboard arrows preserve cents and repeated steps do not accumulate rounding errors',()=>{
  const state=controls('10.10');
  for(let n=0;n<100;n++)state.key('ArrowUp');
  assert.equal(state.input.value,'110.10');
  state.key('ArrowDown');assert.equal(state.input.value,'109.10');
});
test('arrows do not silently round invalid prices or edit disabled fields',()=>{
  const state=controls('10.501');state.click(1);assert.equal(state.input.value,'10.501');
  assert.deepEqual(state.events,['invalid']);
  state.input.value='10.50';state.input.disabled=true;state.click(1);assert.equal(state.input.value,'10.50');
  state.input.disabled=false;state.input.readOnly=true;state.key('ArrowUp');assert.equal(state.input.value,'10.50');
});
test('all three catalog forms accept cents and provide non-submit RM1 arrow controls',()=>{
  for(const [page,id] of [['plans.php','plan-amount'],['packages.php','package-amount'],['trainer.php','trainer-rate']]){
    const html=readFileSync(new URL('../'+page,import.meta.url),'utf8');
    assert.match(html,new RegExp('id="'+id+'"[^>]+step="0.01"'));
    assert.match(html,/type="button" data-direction="1" aria-label="Increase .* by RM1"/);
    assert.match(html,/type="button" data-direction="-1" aria-label="Decrease .* by RM1"/);
  }
});
