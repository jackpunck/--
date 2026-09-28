import manifest from './assets/anatomy-manifest.json' with { type: 'json' };

export const muscleGroups = Object.freeze({
  chest:{name:'胸肌',description:'高亮胸大肌与胸小肌，点击模型可查看具体结构。',view:'front',anchor:[.20,2.47,.25],bone:'chest'},
  biceps:{name:'肱二头肌',description:'上臂前侧的肱二头肌，包含长头和短头。',view:'front',anchor:[.49,2.14,.08],bone:'upper.l'},
  triceps:{name:'肱三头肌',description:'上臂后侧的肱三头肌，包含长头、外侧头和内侧头。',view:'back',anchor:[-.49,2.16,-.13],bone:'upper.r'},
  deltoids:{name:'三角肌',description:'肩部三角肌，包含锁骨部、肩峰部与肩胛冈部。',view:'angle',anchor:[.40,2.49,.06],bone:'upper.l'},
  lats:{name:'背阔肌',description:'背部两侧的背阔肌；旋转至背面观察完整范围。',view:'back',anchor:[.27,2.15,-.20],bone:'spine'},
  traps:{name:'斜方肌',description:'上背部斜方肌，包含上、中、下部。',view:'back',anchor:[.19,2.56,-.20],bone:'chest'},
  core:{name:'腹部核心',description:'此高亮范围为腹直肌和腹横肌；腹内外斜肌可单独选择。',view:'front',anchor:[.10,1.97,.24],bone:'spine'},
  obliques:{name:'腹内外斜肌',description:'腹壁两侧的腹外斜肌与腹内斜肌。深层结构可能被表层肌肉遮挡。',view:'angle',anchor:[.28,2.0,.13],bone:'spine'},
  quads:{name:'股四头肌',description:'大腿前侧的股直肌、股外侧肌、股内侧肌和股中间肌。',view:'front',anchor:[.20,1.12,.12],bone:'thigh.l'},
  hamstrings:{name:'腘绳肌',description:'大腿后侧的股二头肌、半腱肌与半膜肌。',view:'back',anchor:[.20,1.12,-.15],bone:'thigh.l'},
  glutes:{name:'臀肌',description:'臀大肌、臀中肌与臀小肌；点击可区分具体结构。',view:'back',anchor:[-.19,1.59,-.17],bone:'pelvis'},
  calves:{name:'小腿后侧肌群',description:'高亮腓肠肌、比目鱼肌和跖肌。',view:'back',anchor:[.16,.53,-.12],bone:'shin.l'},
  forearms:{name:'前臂肌群',description:'前臂屈伸腕、屈伸指和旋前旋后相关肌肉，包含肱桡肌。',view:'front',anchor:[.49,1.83,.05],bone:'forearm.l'},
});
export const muscleIds = Object.freeze(Object.keys(muscleGroups));
export const structures = Object.freeze(manifest.filter(item=>item.kind==='muscle').map(item=>item.name));
const structureSet = new Set(structures);
export const isSupportedMuscle = id => typeof id==='string' && Object.hasOwn(muscleGroups,id);
export const isSupportedStructure = name => typeof name==='string' && structureSet.has(name);

export function muscleRole(name){
  const n=name.toLowerCase();
  if(/pectoralis/.test(n))return 'chest';
  if(/biceps brachii/.test(n))return 'biceps';
  if(/triceps brachii/.test(n))return 'triceps';
  if(/deltoid/.test(n))return 'deltoids';
  if(/latissimus dorsi/.test(n))return 'lats';
  if(/trapezius/.test(n))return 'traps';
  if(/abdominal oblique/.test(n))return 'obliques';
  if(/rectus abdominis|transversus abdominis/.test(n))return 'core';
  if(/rectus femoris|vastus /.test(n))return 'quads';
  if(/biceps femoris|semitendinosus|semimembranosus/.test(n))return 'hamstrings';
  if(/gluteus /.test(n))return 'glutes';
  if(/gastrocnemius|soleus|plantaris muscle/.test(n))return 'calves';
  if(/carpi |brachioradialis|pronator |supinator|palmaris longus|flexor digitorum (profundus|superficialis)|extensor digitorum\.|extensor digiti minimi|extensor indicis|(?:flexor|extensor|abductor) pollicis longus|extensor pollicis brevis/.test(n))return 'forearms';
  return null;
}

// Chinese terminology: docs/肌肉图谱核对.md. Preserve source subdivisions and tissue names.
const translations=[
 ['coracobrachialis','喙肱肌'],
 ['iliocostalis colli','颈髂肋肌'],['iliocostalis thoracis','胸髂肋肌'],['iliocostalis lumborum','腰髂肋肌'],
 ['longissimus capitis','头最长肌'],['longissimus colli','颈最长肌'],['longissimus thoracis','胸最长肌'],
 ['spinalis capitis','头棘肌'],['spinalis colli','颈棘肌'],['spinalis thoracis','胸棘肌'],
 ['semispinalis colli','颈半棘肌'],['semispinalis thoracis','胸半棘肌'],
 ['multifidus colli','多裂肌（颈部）'],['multifidus thoracis','多裂肌（胸部）'],['multifidus lumborum','多裂肌（腰部）'],
 ['pectoralis major','胸大肌'],['pectoralis minor','胸小肌'],['biceps brachii','肱二头肌'],['triceps brachii','肱三头肌'],['deltoid','三角肌'],['latissimus dorsi','背阔肌'],['trapezius','斜方肌'],
 ['external abdominal oblique','腹外斜肌'],['internal abdominal oblique','腹内斜肌'],['rectus abdominis','腹直肌'],['transversus abdominis','腹横肌'],['rectus femoris','股直肌'],['vastus lateralis','股外侧肌'],['vastus medialis','股内侧肌'],['vastus intermedius','股中间肌'],
 ['biceps femoris','股二头肌'],['semitendinosus','半腱肌'],['semimembranosus','半膜肌'],['gluteus maximus','臀大肌'],['gluteus medius','臀中肌'],['gluteus minimus','臀小肌'],['gastrocnemius','腓肠肌'],['soleus','比目鱼肌'],['plantaris muscle','跖肌'],
 ['serratus anterior','前锯肌'],['rhomboid major','大菱形肌'],['rhomboid minor','小菱形肌'],['tibialis anterior','胫骨前肌'],['tibialis posterior','胫骨后肌'],['adductor magnus','大收肌'],['adductor longus','长收肌'],['adductor brevis','短收肌'],['adductor minimus','小收肌'],
 ['iliocostalis','髂肋肌'],['longissimus','最长肌'],['semispinalis','半棘肌'],['spinalis','棘肌'],['multifidus','多裂肌'],['quadratus lumborum','腰方肌'],['iliacus','髂肌'],['psoas major','腰大肌'],['sartorius','缝匠肌'],['gracilis','股薄肌'],['tensor fasciae latae','阔筋膜张肌'],['linea alba','腹白线（筋膜）'],
 ['brachialis','肱肌'],['brachioradialis','肱桡肌'],['flexor carpi radialis','桡侧腕屈肌'],['flexor carpi ulnaris','尺侧腕屈肌'],['extensor carpi radialis longus','桡侧腕长伸肌'],['extensor carpi radialis brevis','桡侧腕短伸肌'],['extensor carpi ulnaris','尺侧腕伸肌'],['pronator teres','旋前圆肌'],['pronator quadratus','旋前方肌'],['supinator','旋后肌'],['palmaris longus','掌长肌'],
 ['infraspinatus','冈下肌'],['supraspinatus','冈上肌'],['subscapularis','肩胛下肌'],['teres major','大圆肌'],['teres minor','小圆肌'],['levator scapulae','肩胛提肌'],['sternocleidomastoid','胸锁乳突肌'],['masseter','咬肌'],['temporalis','颞肌'],['frontalis','额肌'],['orbicularis oculi','眼轮匝肌'],['orbicularis oris','口轮匝肌'],['platysma','颈阔肌'],['calcaneal tendon','跟腱'],
 ['abductor digiti minimi of foot','小趾展肌'],['abductor digiti minimi of hand','小指展肌'],
 ['flexor digiti minimi of foot','小趾短屈肌'],['flexor digiti minimi of hand','小指短屈肌'],
 ['opponens digiti minimi muscle of foot','小趾对跖肌'],['opponens digiti minimi muscle of hand','小指对掌肌'],
 ['dorsal interossei muscles of foot','足骨间背侧肌'],['dorsal interossei muscles of hand','手骨间背侧肌'],
 ['lumbrical muscles of foot','足蚓状肌'],['lumbrical muscles of hand','手蚓状肌'],
 ['palmar interossei','骨间掌侧肌'],['plantar interossei','骨间足底肌'],
 ['abductor hallucis','拇展肌（足）'],['abductor pollicis brevis','拇短展肌（手）'],['abductor pollicis longus','拇长展肌（前臂）'],
 ['adductor hallucis','拇收肌（足）'],['adductor pollicis','拇收肌（手）'],['opponens pollicis','拇对掌肌'],
 ['extensor digiti minimi','小指伸肌'],['extensor digitorum brevis','趾短伸肌'],['extensor digitorum longus','趾长伸肌'],['extensor digitorum','指伸肌'],
 ['extensor hallucis brevis','拇短伸肌（足）'],['extensor hallucis longus','拇长伸肌（小腿）'],['extensor indicis','示指伸肌'],
 ['extensor pollicis brevis','拇短伸肌（前臂）'],['extensor pollicis longus','拇长伸肌（前臂）'],
 ['flexor digitorum brevis','趾短屈肌'],['flexor digitorum longus','趾长屈肌'],['flexor digitorum profundus','指深屈肌'],['flexor digitorum superficialis','指浅屈肌'],
 ['flexor hallucis brevis','拇短屈肌（足）'],['flexor hallucis longus','拇长屈肌（小腿）'],['flexor pollicis brevis','拇短屈肌（手）'],['flexor pollicis longus','拇长屈肌（前臂）'],
 ['fibularis brevis','腓骨短肌'],['fibularis longus','腓骨长肌'],['fibularis tertius','第三腓骨肌'],
 ['anconeus','肘肌'],['pectineus','耻骨肌'],['piriformis','梨状肌'],['popliteus','腘肌'],['pyramidalis','锥状肌'],
 ['quadratus femoris','股方肌'],['quadratus plantae','足底方肌'],['obturator externus','闭孔外肌'],['obturator internus','闭孔内肌'],
 ['inferior gemellus','下孖肌'],['superior gemellus','上孖肌'],['subclavius','锁骨下肌'],
 ['digastric muscle','二腹肌'],['bucinator','颊肌'],['corrugator supercilii','皱眉肌'],['depressor anguli oris','降口角肌'],
 ['depressor labii inferioris','降下唇肌'],['depressor septi nasi','降鼻中隔肌'],['levator anguli oris','提口角肌'],
 ['levator labii superioris','提上唇肌'],['levator nasolabialis','提上唇鼻翼肌'],['mentalis','颏肌'],['nasalis','鼻肌'],
 ['occipitalis','枕肌'],['procerus','降眉间肌'],['risorius','笑肌'],['zygomaticus major','颧大肌'],['zygomaticus minor','颧小肌'],
 ['temporoparietalis','颞顶肌'],['lateral pterygoid','翼外肌'],['medial pterygoid','翼内肌'],
 ['geniohyoid','颏舌骨肌'],['mylohyoid','下颌舌骨肌'],['omohyoid','肩胛舌骨肌'],['sternohyoid','胸骨舌骨肌'],['stylohyoid','茎突舌骨肌'],
 ['longus capitis','头长肌'],['longus colli','颈长肌'],['splenius capitis','头夹肌'],['splenius colli','颈夹肌'],
 ['obliquus inferior capitis','头下斜肌'],['obliquus superior capitis','头上斜肌'],
 ['rectus posterior major capitis','头后大直肌'],['rectus posterior minor capitis','头后小直肌'],['rectus anterior capitis','头前直肌'],['rectus lateralis capitis','头外侧直肌'],
 ['scalenus anterior','前斜角肌'],['scalenus medius','中斜角肌'],['scalenus posterior','后斜角肌'],
 ['serratus posterior inferior','下后锯肌'],['serratus posterior superior','上后锯肌'],['levatores breves costarum','肋短提肌'],['levatores longi costarum','肋长提肌'],
 ['interspinales colli','颈棘间肌'],['interspinales thoracis','胸棘间肌'],['interspinales lumborum','腰棘间肌'],
 ['lateral intertransversarii lumborum','腰横突间外侧肌'],['rotatores','回旋肌'],
 ['epicranial aponeurosis','帽状腱膜'],['iliotibial tract','髂胫束'],['inguinal ligament','腹股沟韧带'],['plantar aponeurosis','足底腱膜'],
 ['intermediate tendon of digastric muscle','二腹肌中间腱'],['tendon of extensor digitorum longus','趾长伸肌腱'],
 ['extensor retinaculum of wrist','伸肌支持带（腕）'],['flexor retinaculum of wrist','屈肌支持带（腕）'],['flexor retinaculum of ankle','屈肌支持带（踝）'],
 ['inferior extensor retinaculum of ankle','伸肌下支持带（踝）'],['superior extensor retinaculum of ankle','伸肌上支持带（踝）'],
 ['inferior fibular retinaculum','腓骨肌下支持带'],['superior fibular retinaculum','腓骨肌上支持带'],
 ['lateral patellar retinaculum','髌外侧支持带'],['medial patellar retinaculum','髌内侧支持带'],
 ['superficial transverse metacarpal ligament','掌浅横韧带'],['superficial transverse metatarsal ligament','跖浅横韧带'],
];
// Match complete anatomical terms, longest first: coracobrachialis must never
// match brachialis, and semispinalis must never match spinalis.
const labelMatchers=translations.sort((a,b)=>b[0].length-a[0].length).map(([term,label])=>({pattern:new RegExp(`\\b${term}\\b`),label}));
const parts=[
 ['abdominal part','腹部'],['long head','长头'],['short head','短头'],['lateral head','外侧头'],['medial head','内侧头'],
 ['humero-ulnar head','肱尺头'],['humeral head','肱骨头'],['ulnar head','尺骨头'],['radial head','桡骨头'],
 ['deep head','深头'],['superficial head','浅头'],['superior head','上头'],['inferior head','下头'],['oblique head','斜头'],['transverse head','横头'],
 ['anterior belly','前腹'],['posterior belly','后腹'],['deep part','深部'],['superficial part','浅部'],['orbital part','眶部'],['palpebral part','睑部'],
 ['dorsal parts','背侧部'],['ventral parts','腹侧部'],['clavicular','锁骨部'],['acromial','肩峰部'],['scapular spinal','肩胛冈部'],
 ['sternocostal','胸肋部'],['descending','上部'],['ascending','下部'],['transverse part','中部'],
];
export function structureLabel(name){
  const lower=name.toLowerCase(),match=labelMatchers.find(({pattern})=>pattern.test(lower));
  const side=name.endsWith('.l')?'左侧':name.endsWith('.r')?'右侧':'';
  const detail=parts.find(([key])=>lower.includes(key))?.[1];
  return match?[side,match.label,detail].filter(Boolean).join(' · '):[side,name.replace(/\.[lr]$/,'')].filter(Boolean).join(' · ');
}

export function structureView(name){
  // Use the surface where the structure belongs even for transparent highlights.
  if(/scapular spinal part of deltoid|supraspinatus|infraspinatus|teres (major|minor)|rhomboid|spinalis|longissimus|iliocostalis/i.test(name))return 'back';
  if(/clavicular part of deltoid|subscapularis|tibialis anterior|rectus abdominis/i.test(name))return 'front';
  const role=muscleRole(name);
  return role?muscleGroups[role].view:'angle';
}
