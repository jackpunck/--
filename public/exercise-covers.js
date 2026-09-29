/**
 * 动作卡片封面（真人图片）清单。
 * 由 `npm run covers`（scripts/build-exercise-covers.mjs）扫描 public/assets/exercises/ 生成，
 * 请不要手工编辑。命名规则：<动作 id>.webp，也接受 .avif/.jpg/.jpeg/.png。
 * 已收录 25/25。
 * 25 个动作封面已齐全。
 *
 * 图片规格、拍摄要求与来源授权记录见 public/assets/exercises/README.md 与 docs/封面素材.md。
 * 没有收录封面的动作会在卡片上回退到原来的矢量图示，因此清单缺项不会造成 404。
 */
export const exerciseCovers = Object.freeze({
  'squat': 'squat.jpg',
  'pushup': 'pushup.jpg',
  'curl': 'curl.jpg',
  'bench': 'bench.jpg',
  'incline-bench': 'incline-bench.jpg',
  'chest-press': 'chest-press.jpg',
  'lat-pulldown': 'lat-pulldown.jpg',
  'row': 'row.jpg',
  'dumbbell-row': 'dumbbell-row.jpg',
  'pullup': 'pullup.jpg',
  'shoulder-press': 'shoulder-press.jpg',
  'lateral-raise': 'lateral-raise.jpg',
  'reverse-fly': 'reverse-fly.jpg',
  'triceps': 'triceps.jpg',
  'overhead-triceps': 'overhead-triceps.jpg',
  'hammer-curl': 'hammer-curl.jpg',
  'goblet-squat': 'goblet-squat.jpg',
  'rdl': 'rdl.jpg',
  'lunge': 'lunge.jpg',
  'leg-curl': 'leg-curl.jpg',
  'leg-extension': 'leg-extension.jpg',
  'glute-bridge': 'glute-bridge.jpg',
  'plank': 'plank.jpg',
  'crunch': 'crunch.jpg',
  'calf-raise': 'calf-raise.jpg',
});

/** 封面地址；该动作没有收录真人封面时返回空串，调用方回退到矢量图示。 */
export function coverUrl(id) {
  const file = exerciseCovers[id];
  return file ? `/assets/exercises/${file}` : '';
}
