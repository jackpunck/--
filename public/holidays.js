// 2026: 国办发明电〔2025〕7号. Annual updates use NateScarlet/holiday-cn (MIT).
// https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
const years=new Map();
export function installHolidayYear(input) {
  if(!Number.isInteger(input?.year)||input.year<1900||input.year>2199||!Array.isArray(input.days)||!input.days.length||input.days.length>150)throw new Error('节假日数据格式无效。');
  const seen=new Set();
  const days=input.days.map(day=>{
    if(typeof day.date!=='string'||!day.date.startsWith(input.year+'-')||!/^\d{4}-\d{2}-\d{2}$/.test(day.date)||!Number.isFinite(Date.parse(day.date))||new Date(day.date).toISOString().slice(0,10)!==day.date||seen.has(day.date)||typeof day.isOffDay!=='boolean'||typeof day.name!=='string'||!day.name||day.name.length>30)throw new Error('节假日日期无效。');
    seen.add(day.date);return {date:day.date,name:day.name,isOffDay:day.isOffDay};
  });
  const data={year:input.year,days:days.sort((a,b)=>a.date.localeCompare(b.date))};
  years.set(input.year,{data,dates:new Map(days.map(day=>[day.date,day]))});return structuredClone(data);
}
export function holidayYear(year) {const value=years.get(Number(year));return value?structuredClone(value.data):null;}
export function holidayInfo(date) {return years.get(Number(date.slice(0,4)))?.dates.get(date)||null;}
const days=[];
for(const [name,from,to] of [['元旦','01-01','01-03'],['春节','02-15','02-23'],['清明','04-04','04-06'],['劳动节','05-01','05-05'],['端午','06-19','06-21'],['中秋','09-25','09-27'],['国庆','10-01','10-07']]){
  for(let time=Date.parse('2026-'+from);time<=Date.parse('2026-'+to);time+=86400000)days.push({name,date:new Date(time).toISOString().slice(0,10),isOffDay:true});
}
for(const date of ['01-04','02-14','02-28','05-09','09-20','10-10'])days.push({name:'调休上班',date:'2026-'+date,isOffDay:false});
installHolidayYear({year:2026,days});
