// QA-only adapter. It is deliberately not imported by any production module.
// Wrap the existing trace/budget fetch so they record and budget the actual
// augmented request and preserve the original, unnormalised provider response.
import {readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {readMotionCoachResponse} from '../server/motion-coach-full.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const referenceIds = ['REFERENCE_HINGE', 'REFERENCE_ROUND'];
const hashPattern = /^[a-f0-9]{64}$/;
const fail = message => { const error = new Error(`QA visual reference: ${message}`); error.code = 'QA_REFERENCE_EVIDENCE'; throw error; };

export const MOTION_REFERENCE_INSTRUCTION = `本轮是仅用于QA的固定视觉参考实验。待评视频与教学参考严格分离：
VIDEO_0、VIDEO_1等才属于本次待评视频，其真实时间和裁切在元数据中。最后两张REFERENCE_HINGE、REFERENCE_ROUND来自其他开发视频，仅说明髋铰链与明显圆背的视觉区别，不属于待评视频，不包含本次待评标签。参考图上的TARGET也是参考训练者，不能与待评者合并。
参考不是普遍姿势模板：两图阶段、视角、体型和裁切可不同。不要按衣服、人物、背景或与示例的相似程度分类；不要把参考中的圆背、器械或动作名称复制到待评视频。先独立确认待评动作，只有硬拉且待评画面自身显示相关背部轮廓时才使用该视觉区别；其他动作按原有可见维度评价。看不清时保留uncertain。
本实验替换输出证据字段为videoImageIds，值必须是提供的VIDEO_数字字符串；不输出imageIndices、imageIndex、evidenceTimes、frameIndices、analysisPaths或referenceIds。action与每条feedback必须含videoImageIds数组。所有身份、优点、问题及动态变化都只能由待评VIDEO图片支持；不得引用、描述或比较REFERENCE图作为最终报告证据。任何REFERENCE/未知ID/数字索引引用会使整条结果无效。
保留原有action、verdict、feedback、limitations结构，只将图片引用字段替换为videoImageIds；feedback.source只能visual。反馈仍不超过3项，不输出参考学习过程。`;

export async function loadMotionReferencePack(path) {
  const absolute = resolve(path), bytes = await readFile(absolute), manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.version !== 1 || manifest.id !== 'mydeadlift-development-hinge-v1'
      || manifest.selectedFrom !== 'development-subject-01-only' || manifest.references?.length !== 2) fail('unsupported reference pack');
  const references = [];
  for (const [index, reference] of manifest.references.entries()) {
    const source = reference.source;
    if (reference.id !== referenceIds[index] || reference.mimeType !== 'image/jpeg' || !hashPattern.test(reference.sha256)
        || !reference.path || !reference.caption || source?.subject !== '01' || source?.split !== 'train'
        || source?.license !== 'CC BY 4.0' || source?.datasetPage !== 'https://data.mendeley.com/datasets/w5prmmxyt9/1'
        || !hashPattern.test(source?.videoSha256 || '')) fail('invalid development source metadata');
    const image = await readFile(resolve(dirname(absolute), reference.path));
    if (image.length < 4 || image.length > 1900000 || image[0] !== 0xff || image[1] !== 0xd8 || sha256(image) !== reference.sha256) fail('reference bytes do not match the frozen JPEG hash');
    references.push({...reference, data: image.toString('base64')});
  }
  return {audit: {...manifest, manifestSha256: sha256(bytes), referenceInstruction: MOTION_REFERENCE_INSTRUCTION,
    guard: 'Disjoint VIDEO/REFERENCE IDs; reject entire response on foreign, mixed or legacy citations. Semantic copying with forged valid VIDEO IDs still requires blinded review.'}, references};
}

function validatePack(pack) {
  if (pack?.references?.length !== 2 || !hashPattern.test(pack?.audit?.manifestSha256 || '')) fail('load the frozen reference pack first');
  for (const [index, reference] of pack.references.entries()) {
    if (reference.id !== referenceIds[index] || reference.mimeType !== 'image/jpeg' || !reference.data
        || sha256(Buffer.from(reference.data, 'base64')) !== reference.sha256) fail('reference changed after pack loading');
  }
}

export function buildMotionReferenceRequest(body, pack) {
  validatePack(pack);
  if (body.model !== 'deepseek-flash' || body.thinking?.type !== 'disabled' || body.stream !== false
      || body.temperature !== 0 || body.max_tokens !== 2400 || body.reasoning_effort !== undefined) fail('requires the frozen non-thinking Flash configuration, temperature 0 and 2400 output tokens');
  if (body.messages?.length !== 2 || body.messages[0].role !== 'system' || typeof body.messages[0].content !== 'string'
      || body.messages[1].role !== 'user' || !Array.isArray(body.messages[1].content)) fail('unsupported production request structure');
  const parts = body.messages[1].content;
  let context; try { context = JSON.parse(parts[0]?.text); } catch { fail('missing visual context'); }
  const images = parts.filter(part => part.type === 'image_url');
  if (context.stage !== 'visual-keyframes' || !Array.isArray(context.frames) || !images.length || images.length !== context.frames.length
      || !context.frames.every((frame, index) => frame.imageIndex === index && Number.isFinite(frame.time))) fail('only a single visual-keyframes review is supported');
  const videoIds = images.map((_, index) => `VIDEO_${index}`);
  const videoContext = {...context, frames: context.frames.map(({imageIndex, ...frame}, index) => ({...frame, videoImageId: videoIds[index]}))};
  const content = [{type: 'text', text: JSON.stringify(videoContext)}];
  images.forEach((image, index) => content.push({type: 'text', text: `待评视频 ${videoIds[index]}，实际画面时间 ${context.frames[index].time} 秒。只有VIDEO图片可作为报告证据。`}, structuredClone(image)));
  for (const reference of pack.references) {
    content.push({type: 'text', text: `独立教学参考 ${reference.id}（不属于待评视频，不可引用为证据）。${reference.caption}\n来源：${reference.source.author}，${reference.source.dataset}，${reference.source.datasetPage}；${reference.source.license}，${reference.source.licenseUrl}。`},
      {type: 'image_url', image_url: {url: `data:${reference.mimeType};base64,${reference.data}`}});
  }
  const system = body.messages[0].content.replaceAll('imageIndices', 'videoImageIds').replaceAll('imageIndex', 'videoImageId')
    + '\n' + MOTION_REFERENCE_INSTRUCTION + '\n本次唯一允许的证据ID：' + JSON.stringify(videoIds);
  return {body: {...body, messages: [{role: 'system', content: system}, {role: 'user', content}]}, videoIds};
}

function onlyKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`unexpected ${label} fields`);
}

// Validate before production sanitizers can discard invalid references. A
// mixed [VIDEO_0, REFERENCE_ROUND] citation invalidates the entire report.
export function normalizeMotionReferenceResponse(parsed, videoIds) {
  onlyKeys(parsed, ['action', 'verdict', 'feedback', 'limitations'], 'report');
  onlyKeys(parsed.action, ['name', 'family', 'status', 'confidence', 'videoImageIds', 'evidence'], 'action');
  onlyKeys(parsed.verdict, ['status', 'summary'], 'verdict');
  if (!Array.isArray(parsed.feedback)) fail('feedback must be an array');
  const literal = JSON.stringify(parsed);
  if (/REFERENCE[_\s-]*(?:HINGE|ROUND)|参考(?:图片|图像|图)|示例(?:图片|图像|图)/i.test(literal)) fail('reference material was cited in the target report');
  const map = item => {
    if (!Array.isArray(item.videoImageIds) || item.videoImageIds.some(id => typeof id !== 'string' || !videoIds.includes(id))) fail('foreign or missing video evidence IDs');
    const {videoImageIds: ids, ...rest} = item;
    return {...rest, imageIndices: [...new Set(ids.map(id => videoIds.indexOf(id)))]};
  };
  const feedback = parsed.feedback.map(item => {
    onlyKeys(item, ['title', 'status', 'source', 'videoImageIds', 'evidence', 'correction', 'priority'], 'feedback');
    if (item.source !== 'visual') fail('reference reviews accept only target visual evidence');
    return map(item);
  });
  return {...parsed, action: map(parsed.action), feedback};
}

export function createMotionReferenceFetch({pack, fetchImpl, onRejected = () => {}}) {
  validatePack(pack);
  if (typeof fetchImpl !== 'function') fail('an explicit traced and budgeted fetch is required');
  if (typeof onRejected !== 'function') fail('onRejected must be a function');
  let calls = 0;
  return async (endpoint, options) => {
    try {
      const url = new URL(endpoint);
      if (url.origin !== 'https://api.deepseek.com' || !['/chat/completions', '/v1/chat/completions'].includes(url.pathname)
          || url.username || url.password || url.search || url.hash) fail('only the authorized official DeepSeek endpoint is supported');
      if (calls++) fail('one provider attempt per target is allowed; no selection by retry');
      const {body, videoIds} = buildMotionReferenceRequest(JSON.parse(options.body), pack);
      const response = await fetchImpl(endpoint, {...options, body: JSON.stringify(body)});
      if (!response.ok) return response;
      const payload = await response.clone().json(), choice = payload.choices?.[0];
      const parsed = readMotionCoachResponse({content: choice?.message?.content, finishReason: choice?.finish_reason});
      const normalized = normalizeMotionReferenceResponse(parsed, videoIds);
      const result = structuredClone(payload);
      result.choices[0].message.content = JSON.stringify(normalized);
      const headers = new Headers(response.headers); headers.delete('content-length'); headers.delete('content-encoding');
      return new Response(JSON.stringify(result), {status: response.status, statusText: response.statusText, headers});
    } catch (error) {
      if (error.code === 'QA_REFERENCE_EVIDENCE') {
        // The provider adapter intentionally hides transport details. Preserve
        // our bounded protocol reason separately without changing the failure.
        try { await onRejected({code: error.code, message: error.message}); } catch {}
      }
      throw error;
    }
  };
}
