import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportStore, businessKey, validateRecord } from '../src/storage.js';

class MemoryStorage { constructor(){this.data=new Map()} getItem(k){return this.data.get(k)??null} setItem(k,v){this.data.set(k,v)} removeItem(k){this.data.delete(k)} }
const valid = { date:'2026-09-07', workshop:'粉磨车间', process:'设备基础', chineseStaff:12, localStaff:40, dailyConcrete:10, cumulativeConcrete:20 };

test('validates required fields, ranges and cumulative quantity',()=>{assert.deepEqual(Object.keys(validateRecord({})).sort(),['date','process','workshop']);assert.equal(validateRecord({...valid,actualProgress:101}).actualProgress,'进度不能超过 100%');assert.ok(validateRecord({...valid,dailyConcrete:30}).cumulativeConcrete);});
test('creates, updates, queries and deletes local records',()=>{const store=new ReportStore(new MemoryStorage()),created=store.save(valid);assert.equal(created.ok,true);assert.equal(store.all().length,1);assert.equal(store.save({...created.record,localStaff:45}).ok,true);assert.equal(store.all()[0].localStaff,45);store.remove(created.record.id);assert.equal(store.all().length,0);});
test('deduplicates exact activities but preserves different activities on same day',()=>{const store=new ReportStore(new MemoryStorage());store.save({...valid,activityId:'A-01'});const duplicate=store.save({...valid,activityId:'A-01'});assert.equal(duplicate.ok,false);assert.ok(duplicate.duplicate);const second=store.save({...valid,activityId:'A-02'});assert.equal(second.ok,true);const merged=store.merge([{...valid,activityId:'A-01',source:'Excel'},{...valid,date:'2026-09-08',activityId:'A-01'}]);assert.deepEqual([merged.added,merged.skipped],[1,1]);assert.equal(businessKey({...valid,activityId:'A-01'}),'2026-09-07|粉磨车间|设备基础|a-01');});
test('backup and restore validates format and avoids duplicates',()=>{const first=new ReportStore(new MemoryStorage());first.save(valid);const backup=first.backup(),second=new ReportStore(new MemoryStorage()),result=second.restore(backup);assert.equal(result.added,1);assert.equal(second.all()[0].workshop,'粉磨车间');assert.throws(()=>second.restore('{}'),/有效/);});
