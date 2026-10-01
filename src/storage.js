export const STORAGE_KEY = 'khayrat.dailyReports.v1';
export const EVIDENCE_KEY = 'khayrat.imageEvidence.v1';

export function businessKey(record) {
  return [record.date, record.workshop, record.process].map(value => String(value || '').trim().toLowerCase()).join('|');
}

export function validateRecord(record) {
  const errors = {};
  if (!record.date) errors.date = '请选择日报日期';
  if (!record.workshop?.trim()) errors.workshop = '请输入车间';
  if (!record.process?.trim()) errors.process = '请输入施工工序';
  for (const field of ['chineseStaff', 'localStaff', 'dailyConcrete', 'cumulativeConcrete', 'plannedProgress', 'actualProgress']) {
    const value = record[field];
    if (value != null && value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) errors[field] = '必须为非负数';
  }
  for (const field of ['plannedProgress', 'actualProgress']) if (Number(record[field]) > 100) errors[field] = '进度不能超过 100%';
  if (Number(record.dailyConcrete) > Number(record.cumulativeConcrete) && record.cumulativeConcrete !== '' && record.cumulativeConcrete != null) errors.cumulativeConcrete = '累计完成量不能小于当日完成量';
  return errors;
}

export class ReportStore {
  constructor(storage = globalThis.localStorage) { this.storage = storage; }
  all() { try { const value = JSON.parse(this.storage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
  write(records) { this.storage.setItem(STORAGE_KEY, JSON.stringify(records)); return records; }
  duplicate(record, excludeId = '') { return this.all().find(item => item.id !== excludeId && businessKey(item) === businessKey(record)); }
  save(record) {
    const errors = validateRecord(record); if (Object.keys(errors).length) return { ok: false, errors };
    const rows = this.all(), duplicate = rows.find(item => item.id !== record.id && businessKey(item) === businessKey(record));
    if (duplicate) return { ok: false, duplicate };
    const now = new Date().toISOString(), normalized = { ...record, id: record.id || crypto.randomUUID(), reportName: record.reportName || `手工日报-${record.date}`, source: record.source || '浏览器手工录入', updatedAt: now, createdAt: record.createdAt || now };
    const index = rows.findIndex(item => item.id === normalized.id); if (index >= 0) rows[index] = normalized; else rows.push(normalized); this.write(rows); return { ok: true, record: normalized };
  }
  remove(id) { this.write(this.all().filter(item => item.id !== id)); }
  merge(incoming) { const rows = this.all(), keys = new Set(rows.map(businessKey)); let added = 0, skipped = 0; for (const item of incoming) { if (keys.has(businessKey(item))) { skipped++; continue; } const now = new Date().toISOString(); rows.push({ ...item, id: item.id || crypto.randomUUID(), createdAt: item.createdAt || now, updatedAt: now }); keys.add(businessKey(item)); added++; } this.write(rows); return { added, skipped, records: rows }; }
  backup() { return JSON.stringify({ format: 'khayrat-daily-reports', version: 1, exportedAt: new Date().toISOString(), records: this.all() }, null, 2); }
  restore(text) { const data = JSON.parse(text); if (data?.format !== 'khayrat-daily-reports' || data.version !== 1 || !Array.isArray(data.records)) throw new Error('不是有效的 Khayrat 备份文件'); const valid = data.records.filter(item => !Object.keys(validateRecord(item)).length); const result = this.merge(valid); return { ...result, invalid: data.records.length - valid.length }; }
  clear() { this.storage.removeItem(STORAGE_KEY); }
}

export class EvidenceStore {
  constructor(storage = globalThis.localStorage) { this.storage = storage; }
  all() { try { const value = JSON.parse(this.storage.getItem(EVIDENCE_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
  write(items) { this.storage.setItem(EVIDENCE_KEY, JSON.stringify(items)); return items; }
  merge(incoming) { const items = this.all(), ids = new Set(items.map(x => x.imageId)); let added = 0; for (const image of incoming) { if (ids.has(image.imageId)) continue; items.push(image); ids.add(image.imageId); added++; } this.write(items); return { added, items }; }
  update(imageId, changes) { const items = this.all(), index = items.findIndex(x => x.imageId === imageId); if (index < 0) return null; items[index] = { ...items[index], ...changes, updatedAt: new Date().toISOString() }; this.write(items); return items[index]; }
  removeBySource(sourceFile) { this.write(this.all().filter(x => x.sourceFile !== sourceFile)); }
}
