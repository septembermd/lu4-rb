import {readFile} from "node:fs/promises";
import {Pool} from "pg";
const url=process.env.MIGRATION_DATABASE_URL;
if(!url)throw Error("MIGRATION_DATABASE_URL required");
const data=JSON.parse(await readFile(process.argv[2]??"public/data/raid-bosses.json","utf8"));
if(!Array.isArray(data.bosses)||!data.bosses.length)throw Error("Catalog empty/invalid");
const pool=new Pool({connectionString:url,max:1}),db=await pool.connect();
try{
 await db.query("BEGIN");
 for(const b of data.bosses){
  if(!Number.isSafeInteger(b.id)||b.id<=0||!Number.isInteger(b.level)||b.level<1||b.level>100||typeof b.name!=="string"||!Array.isArray(b.points))throw Error("Invalid boss");
  await db.query(`INSERT INTO bosses(id,name,level,location,source_url,verified_at,metadata) VALUES($1,$2,$3,$4,$5,now(),$6::jsonb)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,level=excluded.level,location=excluded.location,source_url=excluded.source_url,metadata=bosses.metadata||excluded.metadata`,
    [b.id,b.name,b.level,b.group,b.sourceUrl,JSON.stringify({category:b.category,stats:b.stats})]);
  await db.query(`INSERT INTO boss_rules(server_id,boss_id,min_minutes,max_minutes,source_url,verified_at)
    VALUES('gamma',$1,NULL,NULL,$2,now()) ON CONFLICT(server_id,boss_id) DO NOTHING`,[b.id,b.sourceUrl]);
  await db.query("DELETE FROM boss_map_points WHERE boss_id=$1",[b.id]);
  for(const [i,p] of b.points.entries()){
   if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>100||p.y<0||p.y>100)throw Error("Invalid map point");
   await db.query("INSERT INTO boss_map_points(boss_id,point_index,map_x_percent,map_y_percent,source_url) VALUES($1,$2,$3,$4,$5)",[b.id,i,p.x,p.y,b.sourceUrl]);
  }
 }
 await db.query("COMMIT");
 console.log("Imported "+data.bosses.length+" bosses and map points");
}catch(e){await db.query("ROLLBACK");throw e}finally{db.release();await pool.end()}
