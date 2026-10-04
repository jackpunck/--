import {api,getApiUser} from './store.js?v=11';

/** Business calculations go through the authenticated application server. */
export async function calculate(operation,...args) {
  const userId=getApiUser();
  try {const value=await api('/compute',{method:'POST',body:{operation,args}});if(getApiUser()!==userId){const error=new Error('账号已切换，请重新操作。');error.status=409;throw error;}return value.result;}
  catch(error){if(!error.status)throw new Error('无法连接计算服务器，请恢复连接后重试。');throw error;}
}

export function createComputedState(getInput,request=calculate) {
  let cachedKey, cachedValue, pending=new Map();
  return {
    async refresh() {
      const input=getInput(),key=JSON.stringify(input);
      if(key===cachedKey)return cachedValue;
      let promise=pending.get(key);
      if(!promise){promise=request('snapshot',input);pending.set(key,promise);}
      try {
        const value=await promise;
        // A late response from another date/account must never replace current data.
        if(JSON.stringify(getInput())!==key)return this.refresh();
        cachedKey=key;cachedValue=value;return value;
      } finally {if(pending.get(key)===promise)pending.delete(key);}
    },
  };
}
