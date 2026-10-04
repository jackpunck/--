export function formatMealNotes(value) {
  return String(value || '').replace(/\r\n?/g, '\n')
    .replace(/(^|[\s：:。；;])((?:\d{1,2}[)）]|[一二三四五六七八九十]+、))\s*/g, '$1\n\n$2 ')
    .replace(/(假设与依据|估算依据|注意事项|温馨提示)[：:]\s*/g, '\n\n$1：\n\n')
    .replace(/([。；;])\s*(综上|总体而言|总的来说)/g, '$1\n\n$2')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
