const groups={
  get_training_plan:['create_training_plan','update_training_plan','delete_training_plan'],
  read_calendar:['create_calendar_task','update_calendar_task','delete_calendar_task'],
  get_today_meals:['create_meal','update_meal','delete_meal'],
};
const mutations=new Set(Object.values(groups).flat());
export const initialChatTools=tools=>tools.filter(tool=>!mutations.has(tool.function.name));
export function expandChatTools(all,enabled,name){
  const names=new Set([...enabled.map(t=>t.function.name),...(groups[name]||[])]);
  return all.filter(tool=>names.has(tool.function.name));
}
export const toolStatus=name=>({get_training_plan:'正在读取训练计划…',read_calendar:'正在读取训练日程…',get_today_meals:'正在读取今日饮食…',read_chat_context:'正在读取相关资料…',read_conversation_history:'正在查阅之前的对话…',read_chat_attachment:'正在查看之前的附件…'}[name]||(/^delete_/.test(name)?'正在删除记录…':/^create_|^update_/.test(name)?'正在保存记录…':'正在处理…'));
