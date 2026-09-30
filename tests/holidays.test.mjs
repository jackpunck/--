import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {holidayInfo,installHolidayYear} from '../public/holidays.js';
import {createHolidayService} from '../server/holidays.mjs';
test('bundled official holiday periods distinguish days off and make-up workdays',()=>{
 assert.equal(holidayInfo('2026-10-05').isOffDay,true);assert.equal(holidayInfo('2026-10-10').isOffDay,false);
 assert.equal(holidayInfo('2026-02-23').isOffDay,true);assert.equal(holidayInfo('2026-02-28').isOffDay,false);
 assert.throws(()=>installHolidayYear({year:2020,days:[{name:'假日',date:'2020-02-30',isOffDay:true}]}));
});
test('annual fetching shares requests, validates data, persists cache and falls back offline',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'fitness-holidays-'));let calls=0;
 const load=createHolidayService(directory,{fetcher:async()=>{calls++;return new Response(JSON.stringify({year:2020,days:[{name:'元旦',date:'2020-01-01',isOffDay:true}]}));}});
 const [a,b]=await Promise.all([load(2020),load(2020)]);assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a.available,true);assert.equal(JSON.parse(await readFile(join(directory,'holidays/2020.json'),'utf8')).year,2020);
 const offline=createHolidayService(directory,{fetcher:async()=>{throw new Error('offline');}});assert.equal((await offline(2020)).available,true);assert.equal((await offline(2021)).available,false);assert.equal((await offline(2026)).available,true);
 const invalid=createHolidayService(directory,{fetcher:async()=>new Response(JSON.stringify({year:2022,days:[{name:'x',date:'2022-02-30',isOffDay:true}]}))});assert.equal((await invalid(2022)).available,false);
});
