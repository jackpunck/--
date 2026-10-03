/** Lossless JSON packets for complete local pose observations and analysis.
 * Paths are literal property/index segments, never executable expressions.
 * Images and the image metadata are sent separately by the caller. */
export const MOTION_COACH_BATCH_LIMITS = Object.freeze({ maxChars: 64000, minChars: 1024, maxPackets: 4096 });

const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const POSE_COLUMNS = Object.freeze(['x', 'y', 'z', 'visibility', 'presence', 'missingMask']);
export const MOTION_COACH_POSE_ENCODING = 'pose-tables-f32-v1';

/** Decimal numbers remain directly readable by the model. For columns whose
 * original values are all exactly binary32, the declared float32 type restores
 * their original JS values, rather than rounding measurements to a precision. */
function shortestFloat32(value) {
  if (value === null) return value;
  for (let digits = 1; digits <= 9; digits++) {
    const candidate = Number(value.toPrecision(digits));
    if (Object.is(Math.fround(candidate), value)) return candidate;
  }
  return value;
}

function encodePointTable(points, source, sourceName) {
  if (!Array.isArray(points) || !points.length) return points;
  const present = points.filter(point => point !== null);
  const tupleLength = present[0]?.length;
  if (!present.length || ![5, 6].includes(tupleLength)
      || !present.every(point => Array.isArray(point) && point.length === tupleLength)) return points;

  const columns = [], constants = {}, shared = {}, float32 = [];
  const negativeZero = { constants: [], cells: [] };
  for (let field = 0; field < tupleLength; field++) {
    const name = POSE_COLUMNS[field], first = present[0][field];
    if (present.every(point => Object.is(point[field], first))) {
      constants[name] = first;
      if (Object.is(first, -0)) negativeZero.constants.push(name);
    } else if (Array.isArray(source) && source.length === points.length
        && points.every((point, index) => point === null || (Array.isArray(source[index]) && Object.is(point[field], source[index][field])))) {
      shared[name] = sourceName;
    } else {
      columns.push(name);
      if (present.every(point => point[field] === null || (typeof point[field] === 'number' && Object.is(Math.fround(point[field]), point[field])))) float32.push(name);
    }
  }
  const rows = points.map((point, row) => point === null ? null : columns.map(name => {
    const value = point[POSE_COLUMNS.indexOf(name)];
    if (Object.is(value, -0)) negativeZero.cells.push([row, name]);
    return float32.includes(name) ? shortestFloat32(value) : value;
  }));
  const table = { tupleLength, columns, rows };
  if (Object.keys(constants).length) table.constants = constants;
  if (Object.keys(shared).length) table.shared = shared;
  if (float32.length) table.float32 = float32;
  if (negativeZero.constants.length || negativeZero.cells.length) table.negativeZero = negativeZero;
  return table;
}

function encodePoseBlock(block) {
  if (block.path.length !== 3 || block.path[0] !== 'poseData' || block.path[1] !== 'frames' || !plainObject(block.value)) return block;
  const value = { ...block.value };
  let changed = false;
  for (const [key, sourceKey] of [['landmarks', null], ['worldLandmarks', 'landmarks']]) {
    if (!Object.hasOwn(value, key)) continue;
    const table = encodePointTable(block.value[key], sourceKey && block.value[sourceKey], sourceKey);
    if (table !== block.value[key]) { value[key] = table; changed = true; }
  }
  if (!changed) return block;
  const encoded = { path: block.path, encoding: MOTION_COACH_POSE_ENCODING, value };
  return JSON.stringify(encoded).length < JSON.stringify(block).length ? encoded : block;
}

/** Decode a self-contained block; no preceding packet or external dictionary is
 * needed. This is also the executable specification of the readable wire format.
 * Each table row has the original landmark index, including explicit null rows.
 * Constants apply to every non-null point; shared fields copy the same field
 * and landmark index from the named table in this frame. */
export function decodeMotionCoachBlock(block) {
  if (!block.encoding) return block;
  if (block.encoding !== MOTION_COACH_POSE_ENCODING) throw new Error('不支持的骨架数据编码。');
  const value = { ...block.value };
  for (const key of ['landmarks', 'worldLandmarks']) {
    const table = value[key];
    if (!plainObject(table) || !Array.isArray(table.rows)) continue;
    value[key] = table.rows.map(row => row === null ? null : Array.from({length: table.tupleLength}, (_, field) => {
      const name = POSE_COLUMNS[field];
      if (Object.hasOwn(table.constants || {}, name)) return table.negativeZero?.constants.includes(name) ? -0 : table.constants[name];
      if (Object.hasOwn(table.shared || {}, name)) return null; // Fill after all rows exist.
      const item = row[table.columns.indexOf(name)];
      return table.float32?.includes(name) && item !== null ? Math.fround(item) : item;
    }));
    for (let row = 0; row < value[key].length; row++) {
      if (value[key][row] === null) continue;
      for (const [name, source] of Object.entries(table.shared || {})) {
        const field = POSE_COLUMNS.indexOf(name);
        value[key][row][field] = value[source][row][field];
      }
    }
    for (const [row, name] of table.negativeZero?.cells || []) value[key][row][POSE_COLUMNS.indexOf(name)] = -0;
  }
  return {path: block.path, value};
}

function assertJson(value, ancestors = new Set(), depth = 0) {
  if (depth > 128) throw new Error('完整动作数据嵌套过深，无法分段发送。');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!Array.isArray(value) && !plainObject(value)) throw new Error('完整动作数据必须是有效的 JSON 数据。');
  if (ancestors.has(value)) throw new Error('完整动作数据包含循环引用。');
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) assertJson(value[index], ancestors, depth + 1);
  } else {
    for (const item of Object.values(value)) assertJson(item, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

function indices(blocks, root, collection) {
  return [...new Set(blocks.filter(({ path }) => path[0] === root && path[1] === collection && Number.isInteger(path[2]))
    .map(({ path }) => path[2]))];
}

function packet(blocks, index, total) {
  return { index, total, blocks, frameIndices: indices(blocks, 'poseData', 'frames'), measurementIndices: indices(blocks, 'fullAnalysis', 'measurements') };
}

/** Every value is emitted exactly once. Large containers split recursively;
 * scalars are never sliced or rounded. A split frame can span multiple packets,
 * with its index listed on each packet containing part of that frame. */
export function planMotionCoachBatches(input, { maxChars = MOTION_COACH_BATCH_LIMITS.maxChars, compactPose = false } = {}) {
  if (!Number.isSafeInteger(maxChars) || maxChars < MOTION_COACH_BATCH_LIMITS.minChars) {
    throw new Error(`动作数据分段上限至少为 ${MOTION_COACH_BATCH_LIMITS.minChars} 个字符。`);
  }
  if (!plainObject(input)) throw new Error('请提供完整动作分析数据。');
  const poseData = input.poseData ?? {};
  const fullAnalysis = input.fullAnalysis ?? input.analysis ?? {};
  if (!plainObject(poseData) || !plainObject(fullAnalysis)) throw new Error('骨架数据与完整分析必须为对象。');
  if (poseData.frames !== undefined && !Array.isArray(poseData.frames)) throw new Error('骨架帧数据必须为数组。');
  if (fullAnalysis.measurements !== undefined && !Array.isArray(fullAnalysis.measurements)) throw new Error('客观测量数据必须为数组。');
  assertJson(poseData);
  assertJson(fullAnalysis);

  const packets = [];
  let current = [];
  // Reserve the longest possible packet counters while greedily filling packets.
  // Replacing these counters with the final values can only shorten the JSON.
  const fits = blocks => JSON.stringify(packet(blocks, MOTION_COACH_BATCH_LIMITS.maxPackets - 1, MOTION_COACH_BATCH_LIMITS.maxPackets)).length <= maxChars;
  const flush = () => {
    if (!current.length) return;
    if (packets.length >= MOTION_COACH_BATCH_LIMITS.maxPackets) throw new Error('完整动作数据需要超过 4096 段，请缩短视频后重试；数据不会截断。');
    packets.push(current);
    current = [];
  };
  const append = (path, value) => {
    const block = { path, value };
    const encoded = compactPose ? encodePoseBlock(block) : block;
    if (fits([...current, encoded])) {
      current.push(encoded);
      return;
    }
    if (fits([encoded])) {
      flush();
      current.push(encoded);
      return;
    }
    // If a complete encoded frame cannot fit, recurse over its original values.
    // Each smaller block remains independently readable and losslessly decodable.
    if (Array.isArray(value) && value.length) {
      for (let index = 0; index < value.length; index++) append([...path, index], value[index]);
    } else if (plainObject(value) && Object.keys(value).length) {
      for (const [key, item] of Object.entries(value)) append([...path, key], item);
    } else {
      throw new Error('单个动作数据字段超过分段上限，无法完整发送；数据不会截断。');
    }
  };
  // Keep natural frame and measurement boundaries wherever they fit. Other
  // fields retain their exact original values, including nested metric arrays.
  for (const [root, value, collection] of [['poseData', poseData, 'frames'], ['fullAnalysis', fullAnalysis, 'measurements']]) {
    if (!Object.keys(value).length) append([root], value);
    for (const [key, item] of Object.entries(value)) {
      if (key === collection && item.length) {
        for (let index = 0; index < item.length; index++) append([root, key, index], item[index]);
      } else append([root, key], item);
    }
  }
  flush();
  return packets.map((blocks, index) => packet(blocks, index, packets.length));
}
