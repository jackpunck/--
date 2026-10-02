import {newAchievementState,applyTrainingEvent,settleAchievementWeeks,achievementRecords} from './achievement-rules.mjs';
import {trainingRecord} from '../public/achievements.js';
import {weekDates,addDays,validateDate} from '../public/schedule.js';

export function initializeAchievements(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS achievement_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS achievement_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL, kind TEXT NOT NULL, before_data TEXT, after_data TEXT,
  before_at TEXT, before_deleted INTEGER, after_deleted INTEGER NOT NULL, occurred_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS achievement_events_user ON achievement_events(user_id,seq);`);
 if(!db.prepare('PRAGMA table_info(achievement_events)').all().some(column=>column.name==='before_at')){
  db.exec('ALTER TABLE achievement_events ADD COLUMN before_at TEXT; DROP TRIGGER IF EXISTS achievement_training_insert; DROP TRIGGER IF EXISTS achievement_training_update;');
 }
 db.exec(`CREATE TRIGGER IF NOT EXISTS achievement_training_insert AFTER INSERT ON records
 WHEN new.kind IN ('calendar-task','schedule') BEGIN
  INSERT INTO achievement_events(user_id,record_id,kind,before_data,after_data,before_at,before_deleted,after_deleted,occurred_at)
  VALUES(new.user_id,new.id,new.kind,NULL,new.data,NULL,1,new.deleted,new.updated_at);
 END;
 CREATE TRIGGER IF NOT EXISTS achievement_training_update AFTER UPDATE ON records
 WHEN new.kind IN ('calendar-task','schedule') BEGIN
  INSERT INTO achievement_events(user_id,record_id,kind,before_data,after_data,before_at,before_deleted,after_deleted,occurred_at)
  VALUES(new.user_id,new.id,new.kind,old.data,new.data,old.updated_at,old.deleted,new.deleted,new.updated_at);
 END;`);
}
const fromRow=row=>({id:row.id,kind:row.kind,data:JSON.parse(row.data),deleted:!!row.deleted,updatedAt:row.updated_at});
const safeTime=(value,now)=>Number.isFinite(Date.parse(value))&&Date.parse(value)<=Date.parse(now)?new Date(value).toISOString():now;

/** Called inside a savepoint so history and awards always share the caller's transaction. */
export function reconcileAchievements(db,userId,now=new Date().toISOString()) {
 db.exec('SAVEPOINT achievement_refresh');
 try {
  const events=db.prepare('SELECT * FROM achievement_events WHERE user_id=? ORDER BY seq').all(userId);
  const stored=db.prepare('SELECT data FROM achievement_state WHERE user_id=?').get(userId);
  const rows=db.prepare("SELECT * FROM records WHERE user_id=? AND kind IN ('calendar-task','schedule','achievement','achievement-summary')").all(userId);
  const records=rows.map(fromRow),state=stored?JSON.parse(stored.data):newAchievementState();
  if(!stored){
   const firstEvents=new Map();for(const event of events)if(!firstEvents.has(event.record_id))firstEvents.set(event.record_id,event);
   for(const record of records.filter(r=>['calendar-task','schedule'].includes(r.kind))){
    const event=firstEvents.get(record.id);
    const initial=event?{...record,data:JSON.parse(event.before_data||'null'),deleted:!!event.before_deleted}:record;
    if(!trainingRecord(initial))continue;
    const temp=newAchievementState();
    applyTrainingEvent(temp,initial,safeTime(event?.before_at||record.updatedAt,now));
    for(const [id,session] of Object.entries(temp.sessions))Object.defineProperty(state.sessions,id,{value:session,enumerable:true,writable:true,configurable:true});
   }
   for(const record of records.filter(r=>r.kind==='achievement'&&!r.deleted&&r.data?.type==='weekly-training')){
    const data=record.data;
    try{
     validateDate(data.weekStart);validateDate(data.weekEnd);validateDate(data.earnedDate);
     if(weekDates(data.weekStart)[0]!==data.weekStart||addDays(data.weekStart,6)!==data.weekEnd||data.earnedDate<data.weekStart||data.earnedDate>data.weekEnd)continue;
     state.legacy[data.weekStart]={trainingCount:Number.isInteger(data.trainingCount)&&data.trainingCount>0?data.trainingCount:1};
    }catch{}
   }
  }
  for(const event of events)applyTrainingEvent(state,{id:event.record_id,kind:event.kind,data:JSON.parse(event.after_data||'null'),deleted:!!event.after_deleted},safeTime(event.occurred_at,now));
  settleAchievementWeeks(state,now);
  const desired=achievementRecords(state),ids=new Set(desired.map(record=>record.id)),existing=new Map(records.map(record=>[record.id,record]));
  const write=db.prepare(`INSERT INTO records(user_id,id,kind,data,version,deleted,updated_at) VALUES(?,?,?,?,1,?,?)
   ON CONFLICT(user_id,id) DO UPDATE SET data=excluded.data,version=records.version+1,deleted=excluded.deleted,updated_at=excluded.updated_at`);
  for(const record of desired){
   const prior=existing.get(record.id);
   if(!prior?.deleted&&JSON.stringify(prior?.data)===JSON.stringify(record.data))continue;
   write.run(userId,record.id,record.kind,JSON.stringify(record.data),0,now);
  }
  for(const record of records.filter(r=>r.kind==='achievement'&&!r.deleted&&!ids.has(r.id)))write.run(userId,record.id,record.kind,'null',1,now);
  const serialized=JSON.stringify(state);
  if(stored?.data!==serialized)db.prepare('INSERT INTO achievement_state(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data').run(userId,serialized);
  db.prepare('DELETE FROM achievement_events WHERE user_id=?').run(userId);
  db.exec('RELEASE achievement_refresh');
 } catch(error){db.exec('ROLLBACK TO achievement_refresh');db.exec('RELEASE achievement_refresh');throw error;}
}
