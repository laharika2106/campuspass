// Runs the actual route handlers against an in-memory SQLite adapter.
// The platform identity provider is stubbed; no hosted identities are created.
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
for (const filename of fs.readdirSync('drizzle').filter(n => n.endsWith('.sql')).sort()) db.exec(fs.readFileSync('drizzle/'+filename,'utf8'));
db.exec('PRAGMA foreign_keys=ON');
let identity=null;
function statement(sql,values=[]) {
 return {
  bind(...args){return statement(sql,args)},
  async first(){return db.prepare(sql).get(...values)||null},
  async all(){return {results:db.prepare(sql).all(...values)}},
  async run(){return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}}}
 };
}
const d1={prepare:statement,async batch(statements){db.exec('BEGIN');try{const rows=[];for(const s of statements) {try{rows.push(await s.all())}catch{rows.push(await s.run())}}db.exec('COMMIT');return rows}catch(e){db.exec('ROLLBACK');throw e}}};
function load(file,mocks={}){
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',source)(name=>{if(name in mocks)return mocks[name];throw Error('Unexpected dependency '+name)},module,module.exports);
 return module.exports;
}
const sql=load('lib/booking-sql.ts'),samples=load('lib/sample-events.ts');
const api=load('app/api/campus/route.ts',{'../../chatgpt-auth':{getChatGPTUser:async()=>identity},'../../../db':{database:()=>d1},'../../../lib/booking-sql':sql,'../../../lib/sample-events':samples});
let assertions=0;
function equal(a,b){assert.equal(a,b);assertions++}
function truthy(a){assert.ok(a);assertions++}
async function request({user='test-organizer',body,path='/api/campus',origin='https://campus.test'}={}){
 identity=user?{userId:user,email:user+'@example.test',fullName:user}:null;
 const req=new Request('https://campus.test'+path,body?{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}:{});
 const response=await (body?api.POST(req):api.GET(req));
 return {status:response.status,body:await response.json()};
}
(async()=>{
 equal((await request({user:null})).status,401);
 let result=await request();equal(result.status,200);equal(result.body.user.role,'organizer');equal(result.body.events.length,6);
 equal((await request({user:'student'})).body.user.role,'student');
 equal((await request({user:'student',body:{action:'create'}})).status,403);
 equal((await request({body:{action:'create'}})).status,400);
 equal((await request({body:{action:'reserve',eventId:'missing'},origin:'https://evil.test'})).status,403);
 const starts=new Date(Date.now()+5*86400000),ends=new Date(starts.getTime()+7200000);
 const eventBody={action:'create',title:'Integration test event',description:'A local test of registration and check-in.',club:'Test Club',category:'Technology',venue:'Test room',capacity:1,startsAt:starts.toISOString(),endsAt:ends.toISOString()};
 result=await request({body:eventBody});equal(result.status,201);const event=result.body.id;
 result=await request({user:'student',body:{action:'reserve',eventId:event}});equal(result.status,200);let booking=result.body.booking;const old=booking.code;
 equal((await request({user:'student',body:{action:'reserve',eventId:event}})).body.booking.id,booking.id);
 equal((await request({user:'other',body:{action:'reserve',eventId:event}})).status,409);
 equal((await request({user:'other',body:{action:'cancel',bookingId:booking.id}})).status,409);
 equal((await request({user:'student',path:'/api/campus?attendees='+event})).status,403);
 equal((await request({user:'other'})).body.bookings.length,0);
 equal((await request({user:'student',body:{action:'cancel',bookingId:booking.id}})).status,200);
 equal((await request({body:{action:'checkin',code:old}})).status,409);
 result=await request({user:'student',body:{action:'reserve',eventId:event}});equal(result.status,200);booking=result.body.booking;truthy(booking.code!==old);
 equal((await request({body:{action:'checkin',code:old}})).status,404);
 equal((await request({user:'student',body:{action:'checkin',code:booking.code}})).status,403);
 equal((await request({path:'/api/campus?attendees='+event})).body.attendees.length,1);
 equal((await request({body:{action:'checkin',code:booking.code}})).status,200);
 equal((await request({body:{action:'checkin',code:booking.code}})).status,409);
 equal((await request({user:'student',body:{action:'cancel',bookingId:booking.id}})).status,409);
 equal((await request({user:'other',body:{action:'reserve',eventId:event}})).status,409);
 equal((await request({user:'student'})).body.bookings[0].status,'checked_in');
 // Simulate an already provisioned second organizer; cross-owner access must still fail.
 db.prepare("UPDATE users SET role='organizer' WHERE id='other'").run();
 equal((await request({user:'other',path:'/api/campus?attendees='+event})).status,403);
 equal((await request({user:'other',body:{action:'checkin',code:booking.code}})).status,404);
 console.log('PASS: '+assertions+' API assertions covering auth, CSRF, role and ownership boundaries, event creation, capacity, duplicate requests, cancellation, code rotation, and single-use check-in.');
 db.close();
})().catch(error=>{console.error(error);process.exitCode=1});
