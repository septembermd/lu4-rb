import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const catalog=JSON.parse(await readFile(new URL("../public/data/raid-bosses.json",import.meta.url),"utf8"));
test("LU4 raid catalog has 158 distinct NPCs with valid map points",()=>{
 assert.equal(catalog.bosses.length,158);
 assert.equal(new Set(catalog.bosses.map(b=>b.id)).size,158);
 for(const b of catalog.bosses){
  assert.ok(Number.isInteger(b.id)&&b.id>0);
  assert.ok(b.name.trim()&&b.level>=1);
  assert.ok(b.points.length>0,b.name);
  for(const p of b.points){assert.ok(Number.isFinite(p.x)&&p.x>=0&&p.x<=100,b.name);assert.ok(Number.isFinite(p.y)&&p.y>=0&&p.y<=100,b.name)}
 }
});
test("catalog references the local LU4 map",()=>{assert.equal(catalog.map.image,"/maps/lu4-world.jpg");assert.equal(catalog.map.width,3004);assert.equal(catalog.map.height,3004)});
