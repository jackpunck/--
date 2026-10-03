// Configuration view helpers contain no credentials or persistent state.
export function enabledModels(provider) {
  return Array.isArray(provider.models) ? provider.models : provider.model ? [{id:provider.model,name:provider.model,vision:null}] : [];
}

export function taskSelection(task, providers, tasks, taskModels) {
  const provider = providers.find(item => item.id === tasks[task]);
  if (!provider) return '';
  const modelId = taskModels[task] ?? provider.model;
  return enabledModels(provider).some(model => model.id === modelId) ? JSON.stringify({providerId:provider.id,modelId}) : '';
}

export function reconcileTasks(providers, tasks, taskModels, editedId) {
  const nextTasks = {...tasks}, nextModels = {...taskModels};
  const edited = providers.find(provider => provider.id === editedId);
  for (const task of ['chat','meal','planning','motion']) {
    const provider = providers.find(item => item.id === nextTasks[task]);
    if (provider) {
      const models = enabledModels(provider);
      if (!models.some(model => model.id === (nextModels[task] ?? provider.model))) {
        nextModels[task] = '';
        nextTasks[task] = '';
      } else nextModels[task] ||= provider.model;
    } else {
      nextTasks[task] = ''; nextModels[task] = '';
    }
    if (!nextTasks[task] && edited) {
      const models = enabledModels(edited);
      const preferred=models.find(model => model.id === edited.model) || models[0];
      const candidate = task === 'meal' ? models.find(model => model.vision === true) : task === 'motion' ? models.find(model => model.vision === true) || preferred : preferred;
      if (candidate) {nextTasks[task] = edited.id;nextModels[task] = candidate.id;}
    }
  }
  return {tasks:nextTasks,taskModels:nextModels};
}
