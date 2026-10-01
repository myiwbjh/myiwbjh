import { analyzeRecords, parseCSV, normalizeRows, filterRecords, exportCSV, SAMPLE_RECORDS } from './src/analytics.js';
import { parseXLSX } from './src/xlsx.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let records = [];
let period = 'day';
let demoMode = false;
const adapters = {
  csv: async file => normalizeRows(parseCSV(await file.text()), file.name),
  xlsx: async file => normalizeRows(await parseXLSX(await file.arrayBuffer()), file.name),
  // Extension points for future adapters: pdf(file), googleDrive(fileId).
};

function toast(message, error = false) {
  const node = $('#toast'); node.textContent = message; node.classList.toggle('error', error); node.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
}

function populateFilters() {
  const currentWorkshop = $('#workshopFilter').value, currentProcess = $('#processFilter').value;
  const options = (values, empty) => `<option value="">${empty}</option>` + [...new Set(values.filter(Boolean))].sort().map(v => `<option>${escapeHTML(v)}</option>`).join('');
  $('#workshopFilter').innerHTML = options(records.map(r => r.workshop), '全部车间');
  $('#processFilter').innerHTML = options(records.map(r => r.process), '全部工序');
  $('#workshopFilter').value = currentWorkshop; $('#processFilter').value = currentProcess;
  if (records.length && !$('#dateFilter').value) $('#dateFilter').value = records.map(r => r.date).sort().at(-1);
}

function escapeHTML(value = '') { const div = document.createElement('div'); div.textContent = String(value); return div.innerHTML; }
function pct(value) { return value == null ? '—' : `${value.toFixed(1)}%`; }
function delta(value) { return value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`; }
function statusClass(value = '') { return /停工|滞后|受阻|未到货|待清关|延误/.test(value) ? 'danger' : /进行|准备|运输|已发运/.test(value) ? 'warning' : 'good'; }

function renderChart(points) {
  if (!points.length) return '<div class="mini-empty">无可用时间序列</div>';
  const width = 700, height = 210, pad = 24, max = Math.max(100, ...points.flatMap(p => [p.planned || 0, p.actual || 0]));
  const x = i => pad + i * (width - pad * 2) / Math.max(1, points.length - 1), y = v => height - pad - (v || 0) / max * (height - pad * 2);
  const path = key => points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[key])}`).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="计划和实际进度趋势"><g class="grid-lines">${[0,25,50,75,100].map(v => `<line x1="${pad}" y1="${y(v)}" x2="${width-pad}" y2="${y(v)}"/><text x="0" y="${y(v)+3}">${v}%</text>`).join('')}</g><path class="plan-line" d="${path('planned')}"/><path class="actual-line" d="${path('actual')}"/>${points.map((p,i)=>`<circle class="actual-dot" cx="${x(i)}" cy="${y(p.actual)}" r="3"><title>${p.date}: 实际 ${pct(p.actual)}</title></circle>`).join('')}</svg><div class="x-labels">${points.map((p,i)=> i===0||i===points.length-1||i===Math.floor(points.length/2)?`<span style="left:${x(i)/width*100}%">${p.date.slice(5)}</span>`:'').join('')}</div>`;
}

function render() {
  const filtered = filterRecords(records, { date: $('#dateFilter').value, workshop: $('#workshopFilter').value, process: $('#processFilter').value });
  $('#recordCount').textContent = `${filtered.length} 条原始记录`;
  $('#emptyState').hidden = records.length > 0; $('#dashboard').hidden = records.length === 0; $('#demoBanner').hidden = !demoMode;
  $('#dataStatus').textContent = demoMode ? '示例数据 · 非项目实绩' : records.length ? `${records.length} 条记录已载入` : '尚未导入数据';
  if (!records.length) return;
  const a = analyzeRecords(filtered, period);
  $('#plannedKpi').textContent = pct(a.kpis.planned); $('#actualKpi').textContent = pct(a.kpis.actual);
  $('#plannedNote').textContent = a.latestDate ? `截至 ${a.latestDate}` : '等待数据';
  $('#varianceNote').textContent = a.kpis.variance == null ? '缺少计划或实际值' : `计划偏差 ${delta(a.kpis.variance)}`;
  $('#concreteKpi').textContent = a.kpis.dailyConcrete == null ? '—' : `${a.kpis.dailyConcrete.toFixed(0)} / ${a.kpis.cumulativeConcrete?.toFixed(0) ?? '—'}`;
  $('#peopleKpi').textContent = a.kpis.totalStaff ?? '—'; $('#peopleNote').textContent = `中方 ${a.kpis.chineseStaff ?? '—'} · 属地 ${a.kpis.localStaff ?? '—'} · 较上期 ${a.kpis.staffDelta == null ? '—' : (a.kpis.staffDelta >= 0 ? '+' : '') + a.kpis.staffDelta}`;
  $('#stoppageKpi').textContent = a.stoppages.length;
  $('#trendChart').innerHTML = renderChart(a.timeline); $('#chartCaption').textContent = `${period === 'day' ? '每日' : period === 'week' ? '每周' : '每月'}聚合 · ${a.timeline.length} 个数据点`;
  $('#workforceChart').innerHTML = a.workforce.length ? a.workforce.slice(-8).map(p => `<div class="staff-row"><span>${p.date.slice(5)}</span><div><i class="cn" style="width:${Math.min(100,p.chinese/Math.max(1,a.maxStaff)*100)}%"></i><i class="local" style="width:${Math.min(100,p.local/Math.max(1,a.maxStaff)*100)}%"></i></div><b>${p.chinese + p.local}</b></div>`).join('') + '<div class="staff-legend"><i></i>中方人员 <i></i>属地人员</div>' : '<div class="mini-empty">暂无人员数据</div>';
  $('#workshopRows').innerHTML = a.workshops.length ? a.workshops.map(w => `<tr><td><b>${escapeHTML(w.workshop)}</b><small>${escapeHTML(w.process || '未填写工序')}</small></td><td>${pct(w.planned)}</td><td><span class="bar"><i style="width:${w.actual || 0}%"></i></span>${pct(w.actual)}</td><td class="${(w.variance||0)<0?'negative':'positive'}">${delta(w.variance)}</td><td>${delta(w.change)}</td><td><span class="tag ${statusClass(w.status)}">${escapeHTML(w.status || '未标注')}</span></td></tr>`).join('') : '<tr><td colspan="6" class="mini-empty">筛选范围内无车间数据</td></tr>';
  $('#equipmentList').innerHTML = a.equipment.length ? a.equipment.map(e => `<div><span class="equipment-icon">◇</span><span><b>${escapeHTML(e.name)}</b><small>${escapeHTML(e.workshop)} · ${escapeHTML(e.note || '无补充记录')}</small></span><em class="tag ${statusClass(e.status)}">${escapeHTML(e.status)}</em></div>`).join('') : '<div class="mini-empty">暂无设备状态记录</div>';
  $('#riskCount').textContent = a.risks.length; $('#riskList').innerHTML = a.risks.length ? a.risks.map(r => `<div><span>!</span><p><b>${escapeHTML(r.title)}</b><small>${escapeHTML(r.detail)}</small><em>${escapeHTML(r.date)} · ${escapeHTML(r.reportName)}</em></p></div>`).join('') : '<div class="mini-empty success">当前筛选范围内未识别到风险</div>';
  $('#evidenceList').innerHTML = a.stoppages.length ? a.stoppages.map(s => `<details><summary><span><b>${escapeHTML(s.workshop)} · ${escapeHTML(s.process)}</b><small>${s.startDate} 至 ${s.endDate} · 连续 ${s.days} 个有效日报日</small></span><strong>查看 ${s.evidence.length} 条证据</strong></summary>${s.evidence.map(e => `<blockquote><b>${escapeHTML(e.reportName)} · ${e.date}</b><p>${escapeHTML(e.rawRecord || '状态：' + e.status)}</p></blockquote>`).join('')}</details>`).join('') : '<div class="mini-empty success">未发现满足规则的连续停工</div>';
}

async function importFiles(files) {
  const messages = [];
  for (const file of files) {
    try { const ext = file.name.split('.').pop().toLowerCase(); if (!adapters[ext]) throw new Error('暂不支持此文件类型'); const rows = await adapters[ext](file); records.push(...rows); messages.push(`${file.name}: ${rows.length} 条`); }
    catch (error) { messages.push(`${file.name}: 导入失败（${error.message}）`); }
  }
  records = [...new Map(records.map(r => [`${r.source}|${r.reportName}|${r.date}|${r.workshop}|${r.process}|${r.rawRecord}`, r])).values()]; demoMode = false;
  $('#importLog').textContent = messages.join('；'); populateFilters(); render(); toast(`导入完成：当前 ${records.length} 条记录`);
}

$$('.import-trigger').forEach(b => b.onclick = () => $('#fileInput').click()); $('#importTop').onclick = () => { location.hash = 'import'; $('#fileInput').click(); };
$('#fileInput').onchange = event => importFiles([...event.target.files]);
$$('.period-switch button').forEach(b => b.onclick = () => { $$('.period-switch button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); period=b.dataset.period; render(); });
['dateFilter','workshopFilter','processFilter'].forEach(id => $(`#${id}`).onchange = render);
$('#clearFilters').onclick = () => { $('#dateFilter').value = records.map(r=>r.date).sort().at(-1)||''; $('#workshopFilter').value=''; $('#processFilter').value=''; render(); };
$('#demoButton').onclick = () => { records = SAMPLE_RECORDS.map(x=>({...x})); demoMode=true; populateFilters(); render(); toast('已载入明确标注的示例数据'); };
$('#clearData').onclick = () => { records=[]; demoMode=false; populateFilters(); render(); };
$('#exportButton').onclick = () => { if(!records.length) return toast('没有可导出的数据',true); const filtered=filterRecords(records,{date:$('#dateFilter').value,workshop:$('#workshopFilter').value,process:$('#processFilter').value}); const blob=new Blob(['\ufeff'+exportCSV(filtered)],{type:'text/csv;charset=utf-8'}), a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`khayrat-analysis-${$('#dateFilter').value||'all'}.csv`; a.click(); URL.revokeObjectURL(a.href); };
$('#templateButton').onclick = () => { const header='日报名称,日期,车间,工序,计划进度,实际进度,当日混凝土,累计混凝土,中方人员,属地人员,设备名称,设备状态,风险制约,工作状态,原始记录\n'; const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['\ufeff'+header],{type:'text/csv'})); a.download='khayrat-daily-report-template.csv'; a.click(); };
const menu=()=>{$('#sidebar').classList.toggle('open');$('#overlay').classList.toggle('show')}; $('#menuButton').onclick=menu; $('#overlay').onclick=menu;
populateFilters(); render();
