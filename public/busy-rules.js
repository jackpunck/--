import {holidayInfo} from './holidays.js';
function dateValue(date) {
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<'1900-01-01'||date>'2199-12-31')throw new Error('繁忙日期无效。');
 return date;
}
export function normalizeBusySettings(value={}) {
 if(Array.isArray(value))value={dates:value};
 if(!value||typeof value!=='object')throw new Error('繁忙日设置无效。');
 const overrides={};
 if(value.dates!==undefined&&!Array.isArray(value.dates))throw new Error('繁忙日期格式无效。');
 for(const date of value.dates||[])overrides[dateValue(date)]=true;
 if(value.overrides!==undefined&&(!value.overrides||typeof value.overrides!=='object'||Array.isArray(value.overrides)))throw new Error('日期设置无效。');
 for(const [date,busy] of Object.entries(value.overrides||{})){dateValue(date);if(typeof busy!=='boolean')throw new Error('繁忙状态无效。');overrides[date]=busy;}
 if(value.weeklyRules!==undefined&&!Array.isArray(value.weeklyRules))throw new Error('默认繁忙日格式无效。');
 const weeklyRules=(value.weeklyRules||[]).map(rule=>{
  dateValue(rule.from);if(!Array.isArray(rule.weekdays)||rule.weekdays.some(day=>!Number.isInteger(day)||day<1||day>7))throw new Error('请选择周一至周日。');
  return {from:rule.from,weekdays:[...new Set(rule.weekdays)].sort((a,b)=>a-b)};
 }).sort((a,b)=>a.from.localeCompare(b.from));
 if(new Set(weeklyRules.map(rule=>rule.from)).size!==weeklyRules.length)throw new Error('重复的默认繁忙日规则。');
 return {weeklyRules,overrides:Object.fromEntries(Object.entries(overrides).sort(([a],[b])=>a.localeCompare(b)))};
}
export function defaultWeekdays(settings,date) {
 return normalizeBusySettings(settings).weeklyRules.findLast(rule=>rule.from<=date)?.weekdays||[];
}
export function setDefaultWeekdays(settings,weekdays,from) {
 const result=normalizeBusySettings(settings);
 result.weeklyRules=result.weeklyRules.filter(rule=>rule.from<from);
 result.weeklyRules.push({from,weekdays});return normalizeBusySettings(result);
}
export function busyPredicate(input) {
 const {weeklyRules,overrides}=normalizeBusySettings(input);
 return date=>{
  if(Object.hasOwn(overrides,date))return overrides[date];
  if(holidayInfo(date)?.isOffDay)return false;
  const rule=weeklyRules.findLast(rule=>rule.from<=date);
  return !!rule?.weekdays.includes(new Date(date+'T12:00:00Z').getUTCDay()||7);
 };
}
export function isBusyDate(date,settings) {dateValue(date);return busyPredicate(settings)(date);}
export function busyDatesInRange(settings,from,to) {
 dateValue(from);dateValue(to);const busy=busyPredicate(settings),dates=[];
 for(let time=Date.parse(from);time<=Date.parse(to);time+=86400000){const date=new Date(time).toISOString().slice(0,10);if(busy(date))dates.push(date);}
 return dates;
}
