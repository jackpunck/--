import {resolveVisualSelection} from '../public/visuals.js';

export const chatVisualTool={type:'function',function:{
  name:'set_chat_visuals',
  description:'由你结合整个对话判断是否需要本地3D辅助理解，并选择当前回答的模型卡片。不要仅因为文字提到动作或肌肉就展示；考虑用户意图、前文所指对象和当前说明是否受益。不需要时无需调用。需要目录时先 read_chat_context sections=["visuals"]。每次替换当前回答的全部卡片，最多2个，传空数组可清除。此工具只展示，不修改训练或饮食。',
  parameters:{type:'object',additionalProperties:false,required:['visuals'],properties:{visuals:{type:'array',maxItems:2,items:{type:'object',additionalProperties:false,required:['type','id'],properties:{type:{type:'string',enum:['exercise','muscle']},id:{type:'string',maxLength:80,description:'本地目录中的精确ID；不得编造URL或目标。'}}}}}}
}};
export function setChatVisuals(args){
  try{
    if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>key!=='visuals'))throw new Error('展示参数无效。');
    const visuals=resolveVisualSelection(args.visuals);
    return {ok:true,readOnly:true,presentation:true,visuals,message:visuals.length?'已展示'+visuals.map(item=>item.title).join('、')+'。':'已清除本轮模型展示。'};
  }catch(error){return {ok:false,readOnly:true,presentation:true,code:'INVALID_VISUALS',message:error.message};}
}
