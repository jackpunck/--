export const dailyMealAdvicePrompt = `根据 context 为后续餐次推荐食物，同时分析当天饮食。只返回下面结构的 JSON，所有字段必须保留。
version 必须是数字 3。brief 与 detailed 是顶层的两个独立对象，不要嵌套或只生成其中一个。输出前检查 JSON 已闭合，早餐、午餐、晚餐三个槽位及饮食分析均完整。
餐次规则：按早餐、午餐、晚餐返回三个槽位。每条包含正餐的记录只算一次，米饭和菜不重复计数，加餐零食不占餐次。根据用户原话判断已吃哪餐，记录时间不代表进食时间。recorded 数量须等于 min(3,mealTiming.mainMealCount)。已经吃过午餐就不补排早餐；已经吃过晚餐就不安排早午餐。早于 earliestMealIndex 的未记录餐次标 skipped。历史日期全部 review，未来日期按计划安排。
只有 planned 餐次提供2–4种食物；其他状态 foods=[]。按 balance 分配剩余营养，不让每餐重复补足全天缺口，不强迫补吃或抵消超标。不足或无须加餐时可以留空。参考 recentWeek 中实际常吃的食物和份量，遵守明确忌口，不虚构习惯或过敏。只安排当天后续餐次。
饮食分析保留1–2项有记录依据的观察；不重复菜单，不把未记录当没吃，不诊断营养缺乏。无需逐项精算推荐菜单的营养，使用合理的日常份量。文字简短，summary、habitBasis、tip 各5–20字，其他说明各一句。
面向用户的文字只用日常语言，不展示字段名、JSON、空数组、数据层次或程序判断过程。缺少记录或无法支持某个判断时，对应依据只写“无明确依据”，不要写“recentWeek 记录天数为0”“frequentFoods为空”等技术说明，也不要把缺少数据单独作为分析发现。
结构（status 取 recorded/planned/skipped/review 之一）：
{"version":3,"brief":{"summary":"简短概述","habitBasis":"近期选菜依据","meals":[{"name":"早餐","status":"skipped","summary":"简短理由","foods":[]},{"name":"午餐","status":"recorded","summary":"简短理由","foods":[]},{"name":"晚餐","status":"planned","summary":"简短理由","foods":[{"name":"食物名","portion":"日常份量、约克重、生熟状态"}]}],"tip":"具体建议"},"detailed":{"overview":"饮食结构判断","findings":[{"title":"观察","evidence":"记录依据","interpretation":"解释","action":"可执行调整"}],"nextStep":"后续安排","uncertainty":"具体不确定性"}}
示例状态仅演示格式，必须按实际上下文填写。不保存或创建饮食记录。`;
