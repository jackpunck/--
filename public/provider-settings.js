const tasks = [['chat','日常对话'],['meal','餐食识别'],['planning','规划建议'],['motion','动作点评']];

export function verifyTaskModels(settings, {tasks:expectedTasks = {}, taskModels:expectedModels = {}} = {}) {
  for (const [task,label] of tasks) {
    if (expectedTasks[task] !== undefined && (settings?.tasks?.[task] ?? '') !== expectedTasks[task]
        || expectedModels[task] !== undefined && (settings?.taskModels?.[task] ?? '') !== expectedModels[task]) {
      throw new Error(`${label}模型未保存：服务器返回的配置与所选模型不一致。`);
    }
  }
  if (!Array.isArray(settings?.providers) || !settings.tasks || !settings.taskModels) throw new Error('任务模型未保存：服务器返回的配置不完整。');
  return settings;
}

export function createProviderSettings({request, onUpdate, getUserId = () => null}) {
  let version = 0;
  let writes = Promise.resolve();
  const assertUser = userId => {
    if (userId !== getUserId()) throw new Error('账号已切换，请重新保存模型配置。');
  };
  return {
    async load() {
      const current = ++version, userId = getUserId();
      const settings = await request('/providers');
      if (current === version && userId === getUserId()) onUpdate(settings);
      return settings;
    },
    save(body) {
      ++version;
      const userId = getUserId();
      // Each write includes confirmation so older writes cannot arrive after newer ones.
      const saving = writes.then(async () => {
        assertUser(userId);
        ++version;
        const saved = verifyTaskModels(await request('/providers', {method:'PUT',body}), body);
        assertUser(userId);
        // The write invalidates reads that began before it finished.
        const current = ++version;
        onUpdate(saved);
        const confirmed = verifyTaskModels(await request('/providers'), body);
        assertUser(userId);
        if (current === version) onUpdate(confirmed);
        return confirmed;
      });
      writes = saving.catch(() => {});
      return saving;
    },
  };
}
