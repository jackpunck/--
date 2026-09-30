import {mkdir,writeFile,rename} from 'node:fs/promises';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {holidayYear,installHolidayYear} from '../public/holidays.js';

export function createHolidayService(dataDir,{fetcher=fetch}={}) {
  const directory=join(dataDir,'holidays'),pending=new Map(),retryAfter=new Map();
  try {for(const file of readdirSync(directory).filter(name=>/^\d{4}\.json$/.test(name)))try{installHolidayYear(JSON.parse(readFileSync(join(directory,file),'utf8')));}catch{}}catch{}
  return async function loadYear(year) {
    if(!Number.isInteger(year)||year<1900||year>2199)throw new Error('节假日年份无效。');
    const cached=holidayYear(year);if(cached)return {available:true,...cached};
    if(year<2007||year>new Date().getFullYear()+1||Date.now()<(retryAfter.get(year)||0))return {available:false,year,days:[]};
    if(pending.has(year))return pending.get(year);
    const task=(async()=>{
      try {
        const response=await fetcher(`https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,{signal:AbortSignal.timeout(4000),redirect:'error'});
        if(!response.ok)throw new Error('节假日数据暂不可用。');
        const text=await response.text();if(text.length>100000)throw new Error('节假日数据过大。');
        const input=JSON.parse(text);if(input.year!==year)throw new Error('节假日年份不匹配。');
        const data=installHolidayYear(input);
        try{await mkdir(directory,{recursive:true});const temporary=join(directory,`${year}.tmp`);await writeFile(temporary,JSON.stringify(data));await rename(temporary,join(directory,`${year}.json`));}catch{}
        return {available:true,...data};
      }catch{retryAfter.set(year,Date.now()+6*60*60*1000);return {available:false,year,days:[]};}
      finally{pending.delete(year);}
    })();pending.set(year,task);return task;
  };
}
