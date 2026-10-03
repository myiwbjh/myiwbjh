export const MODEL_VERSION=2;
export const REQUIRED_FIELDS=['date','workshop','process'];
export const NUMERIC_FIELDS=['wbsWeight','plannedProgress','actualProgress','dailyConcrete','cumulativeConcrete','chineseStaff','localStaff'];

export function parseReportDate(value){
  if(value instanceof Date)return Number.isNaN(value.getTime())?'':value.toISOString().slice(0,10);
  if(typeof value==='number'&&value>20000&&value<100000)return new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);
  const text=String(value??'').trim().replace(/[./年]/g,'-').replace(/月/g,'-').replace(/日/g,'');
  const match=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);if(!match)return '';
  const canonical=`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
  const date=new Date(`${canonical}T00:00:00Z`);
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===canonical?canonical:'';
}

export function withProvenance(record,meta={}){
  const sourceFile=meta.sourceFile||record.sourceFile||record.source||'';
  const reviewFields=new Set(record.reviewFields||[]);
  for(const field of REQUIRED_FIELDS)if(!record[field])reviewFields.add(field);
  if((record.dailyConcrete!=null||record.cumulativeConcrete!=null)&&!record.workUnit)reviewFields.add('workUnit');
  if((record.chineseStaff!=null||record.localStaff!=null)&&!record.staffScope)reviewFields.add('staffScope');
  const rawValues=record.rawValues||{};
  for(const field of NUMERIC_FIELDS){const n=record[field];if(rawValues[field]&&n==null)reviewFields.add(field);if(n!=null&&(n<0||((field==='chineseStaff'||field==='localStaff')&&!Number.isInteger(n))||(/Progress$/.test(field)&&n>100)))reviewFields.add(field);}
  const fieldStatus=Object.fromEntries(['date','workshop','process','constructionContent','dailyConcrete','cumulativeConcrete','workUnit','chineseStaff','localStaff','staffScope','equipmentStatus','risk','status'].map(field=>[field,reviewFields.has(field)?'uncertain':record[field]==null||record[field]===''?'not-reported':'reported']));
  return {...record,schemaVersion:MODEL_VERSION,constructionContent:record.constructionContent||'',sourceFile,fieldStatus,
    provenance:{...record.provenance,sourceFile,pageNumber:meta.pageNumber??record.pageNumber??null,sourceRow:record.sourceRow??null,extractionMethod:meta.extractionMethod||record.extractionMethod||'structured-input',excerpt:meta.sourceExcerpt??record.sourceExcerpt??record.rawRecord??''},
    reviewFields:[...reviewFields],needsReview:reviewFields.size>0};
}

export function evidenceOf(record){return {reportName:record.reportName||'',date:record.date||'',sourceFile:record.sourceFile||record.source||'',pageNumber:record.pageNumber??record.provenance?.pageNumber??null,sourceRow:record.sourceRow??null,objectPath:record.originalObjectPath||'',excerpt:record.sourceExcerpt||record.rawRecord||record.provenance?.excerpt||''};}
