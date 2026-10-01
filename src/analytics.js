export const FIELDS = ['reportName','date','workshop','process','plannedProgress','actualProgress','dailyConcrete','cumulativeConcrete','chineseStaff','localStaff','equipmentName','equipmentStatus','risk','status','rawRecord'];
const ALIASES = {
  reportName:['日报名称','report_name','report name','report'], date:['日期','date'], workshop:['车间','workshop','area'], process:['工序','process','activity'],
  plannedProgress:['计划进度','planned_progress','planned progress','plan'], actualProgress:['实际进度','actual_progress','actual progress','actual'], dailyConcrete:['当日混凝土','daily_concrete','daily concrete'], cumulativeConcrete:['累计混凝土','cumulative_concrete','cumulative concrete'],
  chineseStaff:['中方人员','chinese_staff','chinese staff'], localStaff:['属地人员','local_staff','local staff'], equipmentName:['设备名称','equipment_name','equipment'], equipmentStatus:['设备状态','equipment_status'], risk:['风险制约','风险','risk','constraint'], status:['工作状态','状态','status'], rawRecord:['原始记录','raw_record','record','description']
};
const numericFields = new Set(['plannedProgress','actualProgress','dailyConcrete','cumulativeConcrete','chineseStaff','localStaff']);

export function parseCSV(text) {
  const rows=[]; let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1]; if(c==='"'&&quoted&&n==='"'){field+='"';i++;}else if(c==='"'){quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';}else field+=c;}
  row.push(field);if(row.some(v=>v.trim()))rows.push(row); if(!rows.length)return [];
  const headers=rows.shift().map(h=>h.trim().replace(/^\ufeff/,'')); return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
}
function number(value){if(value===''||value==null)return null;const n=Number(String(value).replace(/[% ,]/g,''));return Number.isFinite(n)?n:null;}
function validDate(value){if(value instanceof Date&&!isNaN(value))return value.toISOString().slice(0,10);if(Number(value)>20000&&Number(value)<100000){const d=new Date(Date.UTC(1899,11,30)+Number(value)*86400000);return d.toISOString().slice(0,10);}const text=String(value??'').trim().replace(/[./]/g,'-');const d=new Date(text);return !text||isNaN(d)?'':d.toISOString().slice(0,10);}

export function normalizeRows(rows, source='unknown') {
  return rows.map((row,index)=>{const lower=Object.fromEntries(Object.entries(row).map(([k,v])=>[k.trim().toLowerCase(),v]));const out={source,sourceRow:index+2};
    for(const field of FIELDS){const alias=ALIASES[field].find(a=>Object.hasOwn(lower,a.toLowerCase()));let value=alias?lower[alias.toLowerCase()]:'';out[field]=numericFields.has(field)?number(value):String(value??'').trim();}
    out.date=validDate(out.date);if(!out.reportName)out.reportName=source;return out;
  }).filter(r=>r.date && (r.workshop||r.equipmentName||r.rawRecord));
}
export function filterRecords(records,{date='',workshop='',process=''}={}){return records.filter(r=>(!date||r.date<=date)&&(!workshop||r.workshop===workshop)&&(!process||r.process===process));}
const lastBy=(records,key)=>{const map=new Map();[...records].sort((a,b)=>a.date.localeCompare(b.date)).forEach(r=>map.set(key(r),r));return [...map.values()];};
const avg=values=>{values=values.filter(v=>v!=null);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;};
const sum=values=>{values=values.filter(v=>v!=null);return values.length?values.reduce((a,b)=>a+b,0):null;};
function bucket(date,period){if(period==='day')return date;if(period==='month')return date.slice(0,7);const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
function peopleByDate(records){return [...new Set(records.map(r=>r.date))].sort().map(date=>{const rows=records.filter(r=>r.date===date), reports=lastBy(rows,r=>r.reportName);return {date,chinese:Math.max(0,...reports.map(r=>r.chineseStaff??0)),local:Math.max(0,...reports.map(r=>r.localStaff??0))};});}

export function detectStoppages(records,minDays=3){const groups=new Map();records.forEach(r=>{const key=`${r.workshop}|${r.process}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);});const results=[];
  for(const rows of groups.values()){const daily=lastBy(rows,r=>r.date).sort((a,b)=>a.date.localeCompare(b.date));let run=[];const flush=()=>{if(run.length>=minDays)results.push({workshop:run[0].workshop,process:run[0].process,startDate:run[0].date,endDate:run.at(-1).date,days:run.length,evidence:run});run=[];};
    daily.forEach((r,i)=>{const previous=daily[i-1];const explicit=/停工|stopped|suspended/i.test(r.status);const noOutput=r.dailyConcrete===0 && r.actualProgress!=null && previous?.actualProgress===r.actualProgress; if(explicit||noOutput)run.push(r);else flush();});flush();}
  return results;
}
export function analyzeRecords(records,period='day'){
  if(!records.length)return {kpis:{},timeline:[],workforce:[],maxStaff:0,workshops:[],equipment:[],risks:[],stoppages:[],latestDate:''};const sorted=[...records].sort((a,b)=>a.date.localeCompare(b.date)),latestDate=sorted.at(-1).date,latest=lastBy(sorted,r=>`${r.workshop}|${r.process}`),people=peopleByDate(sorted),currentPeople=people.at(-1)||{},previousPeople=people.at(-2);
  const dates=new Map();sorted.forEach(r=>{const b=bucket(r.date,period);if(!dates.has(b))dates.set(b,[]);dates.get(b).push(r);});const timeline=[...dates].map(([date,rows])=>{const last=lastBy(rows,r=>`${r.workshop}|${r.process}`);return {date,planned:avg(last.map(r=>r.plannedProgress)),actual:avg(last.map(r=>r.actualProgress))};});
  const workshops=latest.map(r=>{const history=sorted.filter(x=>x.workshop===r.workshop&&x.process===r.process&&x.date<r.date);const previous=history.at(-1);return {workshop:r.workshop,process:r.process,planned:r.plannedProgress,actual:r.actualProgress,variance:r.actualProgress!=null&&r.plannedProgress!=null?r.actualProgress-r.plannedProgress:null,change:r.actualProgress!=null&&previous?.actualProgress!=null?r.actualProgress-previous.actualProgress:null,status:r.status};}).filter(w=>w.workshop);
  const equipment=lastBy(sorted.filter(r=>r.equipmentName),r=>r.equipmentName).map(r=>({name:r.equipmentName,status:r.equipmentStatus||'未标注',workshop:r.workshop,note:r.rawRecord}));
  const risks=sorted.filter(r=>r.risk).map(r=>({title:r.risk,detail:`${r.workshop||'全项目'} · ${r.process||'未指定工序'}`,date:r.date,reportName:r.reportName}));workshops.filter(w=>w.variance!=null&&w.variance<=-5).forEach(w=>risks.push({title:'关键节点滞后',detail:`${w.workshop} · ${w.process} 落后计划 ${Math.abs(w.variance).toFixed(1)} 个百分点`,date:latestDate,reportName:'系统计算'}));
  const latestDay=sorted.filter(r=>r.date===latestDate), dailyConcrete=sum(lastBy(latestDay,r=>`${r.reportName}|${r.workshop}|${r.process}`).map(r=>r.dailyConcrete)), cumulativeConcrete=Math.max(...sorted.map(r=>r.cumulativeConcrete??-Infinity));const planned=avg(latest.map(r=>r.plannedProgress)),actual=avg(latest.map(r=>r.actualProgress));
  return {latestDate,kpis:{planned,actual,variance:planned!=null&&actual!=null?actual-planned:null,dailyConcrete,cumulativeConcrete:Number.isFinite(cumulativeConcrete)?cumulativeConcrete:null,chineseStaff:currentPeople.chinese,localStaff:currentPeople.local,totalStaff:(currentPeople.chinese??0)+(currentPeople.local??0),staffDelta:previousPeople?(currentPeople.chinese+currentPeople.local)-(previousPeople.chinese+previousPeople.local):null},timeline,workforce:people,maxStaff:Math.max(1,...people.flatMap(p=>[p.chinese,p.local])),workshops,equipment,risks,stoppages:detectStoppages(sorted)};
}
function quote(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}
export function exportCSV(records){return [FIELDS.join(','),...records.map(r=>FIELDS.map(f=>quote(r[f])).join(','))].join('\n');}
export const SAMPLE_RECORDS=normalizeRows([
 {'日报名称':'示例日报-01','日期':'2026-09-08','车间':'水泥粉磨车间','工序':'设备基础','计划进度':'20','实际进度':'18','当日混凝土':'120','累计混凝土':'820','中方人员':'28','属地人员':'96','设备名称':'水泥磨','设备状态':'运输中','风险制约':'清关资料待确认','工作状态':'施工中','原始记录':'示例：完成磨机基础一区浇筑'},
 {'日报名称':'示例日报-02','日期':'2026-09-09','车间':'水泥粉磨车间','工序':'设备基础','计划进度':'22','实际进度':'18','当日混凝土':'0','累计混凝土':'820','中方人员':'28','属地人员':'92','设备名称':'水泥磨','设备状态':'运输中','工作状态':'停工','原始记录':'示例：钢筋材料未到，设备基础停工'},
 {'日报名称':'示例日报-03','日期':'2026-09-10','车间':'水泥粉磨车间','工序':'设备基础','计划进度':'24','实际进度':'18','当日混凝土':'0','累计混凝土':'820','中方人员':'27','属地人员':'88','设备名称':'水泥磨','设备状态':'到港待清关','风险制约':'基础施工影响安装准备','工作状态':'停工','原始记录':'示例：材料仍未到场，无施工'},
 {'日报名称':'示例日报-04','日期':'2026-09-11','车间':'水泥粉磨车间','工序':'设备基础','计划进度':'26','实际进度':'18','当日混凝土':'0','累计混凝土':'820','中方人员':'27','属地人员':'86','设备名称':'水泥磨','设备状态':'到港待清关','工作状态':'停工','原始记录':'示例：连续第三个日报日停工'},
 {'日报名称':'示例日报-04','日期':'2026-09-11','车间':'熟料储存及输送','工序':'主体结构','计划进度':'34','实际进度':'33','当日混凝土':'75','累计混凝土':'1240','设备名称':'斗式提升机','设备状态':'已发运','工作状态':'施工中','原始记录':'示例：筒仓结构施工'}
],'内置示例（非项目实绩）');
