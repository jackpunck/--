import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeCards, findKnowledge } from '../public/knowledge.js';

test('reference cards carry checkable primary sources and disclose their real review status', () => {
  assert.equal(new Set(knowledgeCards.map(card => card.id)).size, knowledgeCards.length);
  assert.ok(knowledgeCards.length >= 4);
  const hosts = new Set(['acsm.org', 'www.niddk.nih.gov', 'pubmed.ncbi.nlm.nih.gov', 'www.ars.usda.gov', 'fdc.nal.usda.gov']);
  for (const card of knowledgeCards) {
    const source = new URL(card.sourceUrl);
    assert.equal(source.protocol, 'https:');
    assert.ok(hosts.has(source.hostname));
    assert.equal(card.review.status, 'source-checked');
    assert.equal(card.review.note, '来源已核对，尚未专业审核');
    assert.ok(card.title && card.summary && card.sourceName && card.keywords.length);
  }
});

test('reference retrieval is bounded, deterministic, case-tolerant, and avoids unmatched citations', () => {
  assert.deepEqual(findKnowledge('天气怎么样'), []);
  assert.deepEqual(findKnowledge(null), []);
  assert.deepEqual(findKnowledge(' '), []);
  assert.equal(findKnowledge('bmr和tdee是实测的吗')[0].id, 'energy-estimate-is-prediction');
  assert.equal(findKnowledge('生重熟重如何换算')[0].id, 'raw-and-cooked-weight');
  assert.equal(findKnowledge('每１００克的标签如何按份量计算')[0].id, 'per-100g-and-edible-portion');
  const query = '新手力量训练，体重趋势复盘，代谢热量，每100克标签，生熟重量换算';
  const result = findKnowledge(query);
  assert.equal(result.length, 3);
  assert.deepEqual(result, findKnowledge(query));
  assert.equal(new Set(result.map(c => c.id)).size, result.length);
  assert.throws(() => { result[0].review.status = 'reviewed'; });
});
