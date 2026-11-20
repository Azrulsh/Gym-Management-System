import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../assets/js/money-input.js',import.meta.url),'utf8');
function controls(value, limits = {}) {
  const handlers={};const events=[];
  const input={value,disabled:false,readOnly:false,validity:{badInput:false},...limits,
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

for(const [start,direction,min,max,end] of [
  ['10.50',1,'0.01','9999999999.99','11.50'],
  ['10.50',-1,'0.01','9999999999.99','9.50'],
  ['0.50',-1,'0.01','9999999999.99','0.01'],
  ['0.01',-1,'0.01','9999999999.99','0.01'],
  ['',-1,'0.01','9999999999.99','0.01'],
  ['10.50',1,'0','10.75','10.75'],
  ['0',1,'0','0.50','0.50'],
  ['0',1,'0','0.00','0.00'],
  ['1.50',-1,'0','10.75','0.50'],
]){
  test(`payment arrow ${direction} from ${JSON.stringify(start)} respects ${min}..${max}`,()=>{
    const s=controls(start,{min,max});s.click(direction);assert.equal(s.input.value,end);
    assert.deepEqual(s.events,['input','change']);
  });
}

test('keyboard reads updated allocation limits and preserves cents',()=>{
  const s=controls('9.50',{min:'0',max:'20.00'});s.key('ArrowUp');assert.equal(s.input.value,'10.50');
  s.input.max='10.75';s.key('ArrowUp');assert.equal(s.input.value,'10.75');
  s.key('ArrowDown');assert.equal(s.input.value,'9.75');
});

test('payment forms keep cent validation with non-submit RM1 controls for both amounts',()=>{
  const html=readFileSync(new URL('../payment.php',import.meta.url),'utf8');
  const markup=html.replace(/<\?php[\s\S]*?\?>/g,'dynamic-value');
  for(const id of ['payment-amount','payment-plan-amount']){
    assert.match(markup,new RegExp('class="input-group money-input">\\s*<input[^>]*id="'+id+'"[^>]*step="0.01"'));
  }
  assert.match(html,/id="payment-amount"[^>]*min="0.01"/);
  for(const label of ['Payment amount','Plan allocation']){
    assert.ok(html.includes('type="button" data-direction="1" aria-label="Increase '+label+' by RM1"'));
    assert.ok(html.includes('type="button" data-direction="-1" aria-label="Decrease '+label+' by RM1"'));
  }
});
