import { mapPDFText } from './pdf.js';
import {analyzeImageMetadata} from './image-analysis.js';
import {businessKey} from './storage.js';

const DEFAULT_PDFJS_URL = '/vendor/pdf.mjs';
const DEFAULT_WORKER_URL = '/vendor/pdf.worker.mjs';

export async function loadPDFJS(url = DEFAULT_PDFJS_URL) {
  const pdfjs = await import(url);
  pdfjs.GlobalWorkerOptions.workerSrc = DEFAULT_WORKER_URL;
  return pdfjs;
}

function groupTextItems(items) {
  const rows = new Map();
  for (const item of items) { const y = Math.round(item.transform?.[5] || 0); if (!rows.has(y)) rows.set(y, []); rows.get(y).push(item); }
  return [...rows.entries()].sort((a,b)=>b[0]-a[0]).map(([y,row])=>({ y, items:row.sort((a,b)=>(a.transform?.[4]||0)-(b.transform?.[4]||0)), text:row.sort((a,b)=>(a.transform?.[4]||0)-(b.transform?.[4]||0)).map(x=>x.str).join(' ').trim() })).filter(row=>row.text);
}

export async function parseWithPDFJS(buffer, sourceFile, { pdfjs, ocrProvider, allowOCR = false } = {}) {
  pdfjs ||= await loadPDFJS();
  const bytes=new Uint8Array(buffer),fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const pdfDocument = await pdfjs.getDocument({ data: new Uint8Array(buffer).slice(), useWorkerFetch: false, cMapUrl:'/vendor/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/standard_fonts/',wasmUrl:'/vendor/wasm/' }).promise;
  const records = [], pages = [], images=[], warnings = [];
  try{for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
    const page = await pdfDocument.getPage(pageNumber), content = await page.getTextContent(), rows = groupTextItems(content.items || []);
    let text = rows.map(row=>row.text).join('\n'), extractionMethod = 'pdf-text';
    if (!text.trim() && allowOCR && ocrProvider) { const result = await ocrProvider.recognize(page, { sourceFile, pageNumber }); text = result?.text || ''; extractionMethod = 'ocr'; }
    if (!text.trim()) warnings.push(`第 ${pageNumber} 页没有可提取文字${allowOCR ? '，OCR 也未返回内容' : '，未授权 OCR'}`);
    const mapped = mapPDFText(text, { sourceFile, pageNumber }).map(record=>({ ...record, extractionMethod, sourceLocation:{ pageNumber, lines:rows.map(row=>({ y:row.y, text:row.text })).slice(0,50) }, reviewFields:['date','workshop','process'].filter(field=>!record[field]) }));
    records.push(...mapped); pages.push({ pageNumber, text, extractionMethod, rows });
    if(page.getOperatorList){try{images.push(...await extractPageImages(page,pdfjs,{sourceFile,pageNumber,text,fingerprint,related:mapped.length===1?mapped[0]:null}));}catch(error){warnings.push(`第 ${pageNumber} 页图片提取失败，需人工核对：${error.message}`);}}
    page.cleanup?.();
  }
  return { records, pages, images, diagnostics:{ pageCount:pdfDocument.numPages,textPages:pages.filter(p=>p.text.trim()).length,imageCount:images.length,warnings, engine:'PDF.js' } };
  }finally{await pdfDocument.destroy?.();}
}

async function extractPageImages(page,pdfjs,{sourceFile,pageNumber,text,fingerprint,related}){
  const ops=await page.getOperatorList(),images=[];
  for(let index=0;index<ops.fnArray.length;index++){
    const op=ops.fnArray[index],args=ops.argsArray[index];let image;
    if(op===pdfjs.OPS.paintImageXObject||op===pdfjs.OPS.paintImageXObjectRepeat){
      const id=args[0],objects=id.startsWith('g_')?page.commonObjs:page.objs;
      image=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('图片解码超时')),10000);objects.get(id,value=>{clearTimeout(timer);resolve(value);});});
    }else if(op===pdfjs.OPS.paintInlineImageXObject)image=args[0];else continue;
    const dataUrl=decodedImageURL(image,pdfjs.ImageKind),imageIndex=images.length+1;
    const base={imageId:`pdfjs-${fingerprint}-${pageNumber}-${index}`,sourceFile,pageNumber,imageIndex,mimeType:'image/png',dataUrl,nearbyText:text.slice(0,2000),relatedDate:related?.date||'',relatedWorkshop:related?.workshop||'',relatedProcess:related?.process||'',relatedRecordKey:related?businessKey(related):'',reviewRecommended:true,manualReviewed:false,directEvidence:'PDF 页面嵌入图片',evidenceType:'直接证据'};
    images.push({...base,...analyzeImageMetadata(base)});
  }
  return images;
}

export function decodedImageURL(image,kinds){
  if(typeof document==='undefined')throw new Error('图片提取需要浏览器 Canvas');
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  if(!canvas.width||!canvas.height||canvas.width*canvas.height>40_000_000)throw new Error('图片尺寸无效或过大');
  const context=canvas.getContext('2d');
  if(image.bitmap)context.drawImage(image.bitmap,0,0);else{
    const pixels=context.createImageData(canvas.width,canvas.height),data=image.data;
    if(image.kind===kinds.RGBA_32BPP)pixels.data.set(data);
    else if(image.kind===kinds.RGB_24BPP){for(let p=0,q=0;p<data.length;p+=3,q+=4){pixels.data[q]=data[p];pixels.data[q+1]=data[p+1];pixels.data[q+2]=data[p+2];pixels.data[q+3]=255;}}
    else if(image.kind===kinds.GRAYSCALE_1BPP){const stride=Math.ceil(canvas.width/8);for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const v=data[y*stride+(x>>3)]&(128>>(x&7))?255:0,q=(y*canvas.width+x)*4;pixels.data[q]=pixels.data[q+1]=pixels.data[q+2]=v;pixels.data[q+3]=255;}}
    else throw new Error('不支持的解码像素格式');
    context.putImageData(pixels,0,0);
  }
  return canvas.toDataURL('image/png');
}

export class OCRProvider {
  constructor({ endpoint, consent, accessToken='', fetchImpl = fetch }) { this.endpoint=endpoint;this.consent=consent;this.accessToken=accessToken;this.fetch=fetchImpl; }
  async recognize(page, context) { if (!this.consent) throw new Error('OCR 需要用户明确授权'); if (!this.endpoint) throw new Error('尚未配置 OCR 服务');if(typeof document==='undefined')throw new Error('OCR 页面渲染仅能在浏览器执行');const viewport=page.getViewport({scale:1.8}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const response=await this.fetch(this.endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(this.accessToken?{Authorization:`Bearer ${this.accessToken}`}:{})},body:JSON.stringify({imageDataUrl:canvas.toDataURL('image/jpeg',.88),context})});if(!response.ok)throw new Error(`OCR 服务返回 ${response.status}`);return response.json(); }
}
