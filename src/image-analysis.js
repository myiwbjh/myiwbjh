export const SCENES = ['施工中','停工或无明显施工','材料堆放','设备到货','安装准备','已完成区域','无法判断'];
const RULES = [
  { scene:'停工或无明显施工', words:['停工','无人','无施工','suspended','stopped'], tags:['无明显人员活动'], confidence:.62 },
  { scene:'设备到货', words:['到货','卸车','到场','delivery','arrived','包装箱'], tags:['设备 / 车辆','包装设备'], confidence:.66 },
  { scene:'安装准备', words:['安装准备','吊装准备','基础验收','installation'], tags:['机械安装迹象'], confidence:.61 },
  { scene:'材料堆放', words:['材料','堆放','钢筋','模板','管道','电缆'], tags:['材料堆放'], confidence:.58 },
  { scene:'已完成区域', words:['完成','验收','completed'], tags:['已完成区域'], confidence:.6 },
  { scene:'施工中', words:['施工','浇筑','绑扎','支模','作业','construction'], tags:['人员活动'], confidence:.6 }
];
const OBJECT_RULES = [{word:/人员|工人|作业/,tag:'人员活动'},{word:/车辆|吊车|挖机|设备/,tag:'设备 / 车辆'},{word:/钢筋/,tag:'钢筋'},{word:/模板|支模/,tag:'模板'},{word:/混凝土|浇筑/,tag:'混凝土施工迹象'},{word:/管道|电缆|结构件/,tag:'管道 / 电缆 / 结构件'},{word:/包装|安装|吊装/,tag:'包装设备或机械安装迹象'}];

export function analyzeImageMetadata(image) {
  const text = `${image.sourceFile || ''} ${image.caption || ''} ${image.nearbyText || ''}`.toLowerCase();
  const match = RULES.find(rule => rule.words.some(word => text.includes(word.toLowerCase())));
  const tags = new Set(match?.tags || []); OBJECT_RULES.forEach(rule => { if (rule.word.test(text)) tags.add(rule.tag); });
  const scene = match?.scene || '无法判断', confidence = match?.confidence || .2;
  return { tags:[...tags], aiSummary:scene === '无法判断' ? '现有图片元数据不足，无法进行可靠判断。' : `根据图片邻近文字，可能为“${scene}”场景。`, evidenceType:'AI推断', scene, confidence, manualReviewed:false, reviewRecommended:confidence < .7 };
}

export class ImageAnalysisProvider {
  constructor({ endpoint = '', consent = false, fetchImpl = fetch } = {}) { this.endpoint=endpoint; this.consent=consent; this.fetch=fetchImpl; }
  get enabled() { return Boolean(this.endpoint && this.consent); }
  async analyze(image) {
    if (!this.enabled) return { ...analyzeImageMetadata(image), provider:'metadata-rules', visionEnabled:false, notice:'尚未启用真实视觉识别；当前结果不是对图片像素的识别。' };
    const response = await this.fetch(this.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageDataUrl:image.dataUrl,context:{sourceFile:image.sourceFile,pageNumber:image.pageNumber,nearbyText:image.nearbyText}})});
    if(!response.ok)throw new Error(`视觉分析服务返回 ${response.status}`);const result=await response.json();
    return {scene:SCENES.includes(result.scene)?result.scene:'无法判断',tags:Array.isArray(result.tags)?result.tags:[],visibleFacts:Array.isArray(result.visibleFacts)?result.visibleFacts:[],inferences:Array.isArray(result.inferences)?result.inferences:[],aiSummary:String(result.summary||''),confidence:Math.max(0,Math.min(1,Number(result.confidence)||0)),evidenceType:'AI推断',manualReviewed:false,reviewRecommended:true,provider:result.model||'external-vision',visionEnabled:true};
  }
}

export function findEvidenceConflicts(record, images) {
  const conflicts=[]; for(const image of images){const scene=image.scene||'';if(/施工中/.test(record.status||'')&&/停工/.test(scene))conflicts.push({imageId:image.imageId,reason:'日报记录为施工中，但图片推断为停工或无明显施工'});if(/停工/.test(record.status||'')&&/施工中/.test(scene))conflicts.push({imageId:image.imageId,reason:'日报记录为停工，但图片推断为施工中'});if(/未到货/.test(record.equipmentStatus||'')&&/设备到货/.test(scene))conflicts.push({imageId:image.imageId,reason:'日报记录为未到货，但图片推断为设备到货'});}return conflicts;
}
