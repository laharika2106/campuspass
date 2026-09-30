import { getChatGPTUser } from '../../chatgpt-auth';
import { database } from '../../../db';
import { RESERVE_SQL } from '../../../lib/booking-sql';
import { sampleEvents } from '../../../lib/sample-events';
import type { User } from '../../../lib/types';
export const dynamic = 'force-dynamic';
class AppError extends Error { constructor(message:string,public status=400){super(message);} }
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function currentUser() {
  const auth=await getChatGPTUser();
  if(!auth) throw new AppError('Sign in with ChatGPT to continue.',401);
  const db=database(), now=new Date().toISOString();
  // The first setup runs behind owner-private platform access. Later accounts are students.
  await db.prepare("INSERT INTO users(id,name,email,role,created_at) VALUES(?,?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM users) THEN 'organizer' ELSE 'student' END,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email").bind(auth.userId,auth.fullName||auth.email.split('@')[0],auth.email,now).run();
  const user=await db.prepare('SELECT * FROM users WHERE id=?').bind(auth.userId).first<User>();
  if(!user) throw new AppError('Your account could not be loaded.',503);
  if(user.role==='organizer') {
    const seeded=await db.prepare("SELECT id FROM events WHERE id='sample-build-night'").first();
    if(!seeded) await db.batch(sampleEvents(user.id).map(e=>db.prepare('INSERT OR IGNORE INTO events(id,title,description,category,club,venue,starts_at,ends_at,capacity,owner_id,sample,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?)').bind(e.id,e.title,e.description,e.category,e.club,e.venue,e.startsAt,e.endsAt,e.capacity,user.id,now)));
  }
  return user;
}
function errorResponse(error:unknown) {
  if(error instanceof AppError) return json({error:error.message},error.status);
  console.error('CampusPass request failed',error);
  return json({error:'We could not reach event storage. Please try again. Your input has been kept.'},503);
}
export async function GET(request:Request) {
 try {
  const user=await currentUser(), db=database(), eventId=new URL(request.url).searchParams.get('attendees');
  if(eventId) {
    const owned=await db.prepare('SELECT id FROM events WHERE id=? AND owner_id=?').bind(eventId,user.id).first();
    if(user.role!=='organizer'||!owned) throw new AppError('Only this event’s organizer can view attendees.',403);
    const r=await db.prepare("SELECT b.*,u.name,u.email FROM bookings b JOIN users u ON u.id=b.user_id WHERE b.event_id=? AND b.status!='cancelled' ORDER BY b.created_at").bind(eventId).all();
    return json({attendees:r.results});
  }
  const result=await db.batch([
    db.prepare("SELECT e.*,COUNT(CASE WHEN b.status!='cancelled' THEN 1 END) AS reserved,COUNT(CASE WHEN b.status='checked_in' THEN 1 END) AS checked_in FROM events e LEFT JOIN bookings b ON b.event_id=e.id GROUP BY e.id ORDER BY e.starts_at"),
    db.prepare('SELECT * FROM bookings WHERE user_id=? ORDER BY created_at DESC').bind(user.id)
  ]);
  return json({user,events:result[0].results,bookings:result[1].results});
 } catch(e){return errorResponse(e);}
}
export async function POST(request:Request) {
 try {
  const origin=request.headers.get('origin');
  if(!origin||new URL(origin).host!==new URL(request.url).host) throw new AppError('This request must come from CampusPass.',403);
  if(!request.headers.get('content-type')?.includes('application/json')) throw new AppError('Please send a valid request.');
  const bodyText=await request.text();
  if(bodyText.length>16000) throw new AppError('This request is too large.');
  let body; try {body=JSON.parse(bodyText);} catch {throw new AppError('Invalid request.');}
  if(!body||typeof body!=='object') throw new AppError('Invalid request.');
  const user=await currentUser(),db=database(),now=new Date().toISOString();
  if(body.action==='reserve') {
    const eventId=String(body.eventId||'');
    const existing=await db.prepare("SELECT * FROM bookings WHERE event_id=? AND user_id=? AND status!='cancelled'").bind(eventId,user.id).first();
    if(existing) return json({booking:existing,message:'Your ticket is already reserved.'});
    await db.prepare(RESERVE_SQL).bind(crypto.randomUUID(),user.id,crypto.randomUUID(),now,eventId,now).run();
    const booking=await db.prepare("SELECT * FROM bookings WHERE event_id=? AND user_id=? AND status!='cancelled'").bind(eventId,user.id).first();
    if(!booking) throw new AppError('This event is full or booking has closed.',409);
    return json({booking,message:'You’re in! Your ticket is ready.'});
  }
  if(body.action==='cancel') {
    const r=await db.prepare("UPDATE bookings SET status='cancelled' WHERE id=? AND user_id=? AND status='confirmed' AND EXISTS(SELECT 1 FROM events WHERE events.id=bookings.event_id AND starts_at>?)").bind(String(body.bookingId||''),user.id,now).run();
    if(!r.meta.changes) throw new AppError('This ticket cannot be cancelled. It may already be checked in, cancelled, or past its start time.',409);
    return json({message:'Reservation cancelled. Your seat is available to others.'});
  }
  if(user.role!=='organizer') throw new AppError('Organizer access is required.',403);
  if(body.action==='create') {
    const field=(key:string,min:number,max:number)=>{const v=typeof body[key]==='string'?body[key].trim():'';if(v.length<min||v.length>max)throw new AppError('Please check the '+key+' field.');return v;};
    const title=field('title',4,100),description=field('description',20,3000),club=field('club',2,80),venue=field('venue',2,120),category=field('category',2,30);
    if(!['Technology','Workshop','Culture','Sports','Career'].includes(category)) throw new AppError('Choose a valid category.');
    const starts=new Date(body.startsAt),ends=new Date(body.endsAt),capacity=Number(body.capacity);
    if(!Number.isFinite(starts.getTime())||!Number.isFinite(ends.getTime())||starts.getTime()<=Date.now()||ends<=starts) throw new AppError('Choose a future start and an end after the start.');
    if(!Number.isInteger(capacity)||capacity<1||capacity>10000) throw new AppError('Capacity must be between 1 and 10,000.');
    const id=crypto.randomUUID();
    await db.prepare('INSERT INTO events(id,title,description,category,club,venue,starts_at,ends_at,capacity,owner_id,sample,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?)').bind(id,title,description,category,club,venue,starts.toISOString(),ends.toISOString(),capacity,user.id,now).run();
    return json({id,message:'Your event is live on CampusPass.'},201);
  }
  if(body.action==='checkin') {
    const code=String(body.code||'').trim();
    const booking=await db.prepare('SELECT b.*,e.owner_id,e.title FROM bookings b JOIN events e ON e.id=b.event_id WHERE b.code=? AND e.owner_id=?').bind(code,user.id).first<{id:string;status:string;title:string}>();
    if(!booking) throw new AppError('Ticket not found for an event you organize.',404);
    if(booking.status==='cancelled') throw new AppError('This ticket has been cancelled.',409);
    if(booking.status==='checked_in') throw new AppError('This ticket has already been checked in.',409);
    const r=await db.prepare("UPDATE bookings SET status='checked_in',checked_in_at=? WHERE id=? AND status='confirmed'").bind(now,booking.id).run();
    if(!r.meta.changes) throw new AppError('This ticket has already been processed.',409);
    return json({message:'Checked in successfully for '+booking.title+'.'});
  }
  throw new AppError('Unknown action.');
 }catch(e){return errorResponse(e);}
}
