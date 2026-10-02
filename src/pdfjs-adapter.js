import { mapPDFText } from './pdf.js';

const DEFAULT_PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const DEFAULT_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

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
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false }).promise;
  const records = [], pages = [], warnings = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber), content = await page.getTextContent(), rows = groupTextItems(content.items || []);
    let text = rows.map(row=>row.text).join('\n'), extractionMethod = 'pdf-text';
    if (!text.trim() && allowOCR && ocrProvider) { const result = await ocrProvider.recognize(page, { sourceFile, pageNumber }); text = result?.text || ''; extractionMethod = 'ocr'; }
    if (!text.trim()) warnings.push(`第 ${pageNumber} 页没有可提取文字${allowOCR ? '，OCR 也未返回内容' : '，未授权 OCR'}`);
    const mapped = mapPDFText(text, { sourceFile, pageNumber }).map(record=>({ ...record, extractionMethod, sourceLocation:{ pageNumber, lines:rows.map(row=>({ y:row.y, text:row.text })).slice(0,50) }, reviewFields:['date','workshop','process'].filter(field=>!record[field]) }));
    records.push(...mapped); pages.push({ pageNumber, text, extractionMethod, rows });
  }
  return { records, pages, diagnostics:{ pageCount:document.numPages, warnings, engine:'PDF.js' } };
}

export class OCRProvider {
  constructor({ endpoint, consent, accessToken='', fetchImpl = fetch }) { this.endpoint=endpoint;this.consent=consent;this.accessToken=accessToken;this.fetch=fetchImpl; }
  async recognize(page, context) { if (!this.consent) throw new Error('OCR 需要用户明确授权'); if (!this.endpoint) throw new Error('尚未配置 OCR 服务');if(typeof document==='undefined')throw new Error('OCR 页面渲染仅能在浏览器执行');const viewport=page.getViewport({scale:1.8}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const response=await this.fetch(this.endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(this.accessToken?{Authorization:`Bearer ${this.accessToken}`}:{})},body:JSON.stringify({imageDataUrl:canvas.toDataURL('image/jpeg',.88),context})});if(!response.ok)throw new Error(`OCR 服务返回 ${response.status}`);return response.json(); }
}
