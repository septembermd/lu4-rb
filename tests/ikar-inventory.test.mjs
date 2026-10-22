import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../ikar/tools/register-inventory.mjs', import.meta.url));

function execute(inventory) {
  const dir=mkdtempSync(join(tmpdir(),'rb-inventory-'));
  try {
    const cfg=join(dir,'config.json'), inv=join(dir,'inventory.json');
    writeFileSync(cfg,JSON.stringify({apiUrl:'https://example.invalid',agentToken:'test-token'}));
    writeFileSync(inv,JSON.stringify(inventory));
    try {
      const out=execFileSync(process.execPath,[script,cfg,inv,'--check'],{encoding:'utf8',stdio:'pipe'});
      return {ok:true,out};
    } catch(e) {return {ok:false,out:String(e.stderr??e.message)};}
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test('preflight accepts valid full inventory without network calls',()=>{
  const r=execute({accounts:[{key:'account-1',label:'First',characters:[{slot:0,name:'ScoutA'},{slot:1,name:'ScoutB'}]}]});
  assert.equal(r.ok,true,r.out);assert.match(r.out,/1 accounts \/ 2 characters/);
});
test('preflight rejects duplicate character slots',()=>{
  const r=execute({accounts:[{key:'account-1',label:'First',characters:[{slot:0,name:'ScoutA'},{slot:0,name:'ScoutB'}]}]});
  assert.equal(r.ok,false);assert.match(r.out,/Invalid or duplicate character slot/);
});
test('preflight rejects secret fields',()=>{
  const r=execute({accounts:[{key:'account-1',label:'First',password:'should-not-be-sent',characters:[]}]});
  assert.equal(r.ok,false);assert.match(r.out,/only key, label and characters/);
});
