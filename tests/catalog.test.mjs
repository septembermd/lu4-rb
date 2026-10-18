import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCatalog} from '../scripts/validate-catalog.mjs';
const boss = {id:1,name:'Fixture',level:65,location:'Fixture zone',sourceUrl:'https://example.org/boss/1',verifiedAt:'2026-10-18T12:00:00Z',respawnMinMinutes:null,respawnMaxMinutes:null,spawns:[{x:-100,y:200,z:null}],drops:[]};
test('catalog accepts negative world coordinates and unknown respawn',()=>assert.equal(validateCatalog({schemaVersion:1,bosses:[boss]}),1));
test('catalog rejects duplicates, reversed ranges, missing source and invalid drop probabilities',()=>{
  assert.throws(()=>validateCatalog({schemaVersion:1,bosses:[boss,boss]}));
  for(const patch of [{respawnMinMinutes:100,respawnMaxMinutes:50},{sourceUrl:''},{verifiedAt:null},{drops:[{itemId:1,name:'x',min:1,max:1,chancePercent:101}]}]) {
    assert.throws(()=>validateCatalog({schemaVersion:1,bosses:[{...boss,...patch}]}));
  }
});
