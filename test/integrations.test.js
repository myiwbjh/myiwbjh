import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateXLSX, TEMPLATE_HEADERS } from '../src/xlsx-writer.js';
import { parseXLSX } from '../src/xlsx.js';
import { GoogleDriveReadOnlyAdapter } from '../src/google-drive.js';

test('generated blank Excel template is readable by the application importer',async()=>{const blob=createTemplateXLSX(),rows=await parseXLSX(await blob.arrayBuffer());assert.deepEqual(rows,[]);assert.equal(TEMPLATE_HEADERS.length,20);assert.ok(TEMPLATE_HEADERS.includes('实际完成工作量'));assert.ok(TEMPLATE_HEADERS.includes('WBS权重'));});
test('Google Drive adapter requires runtime configuration',()=>{assert.throws(()=>new GoogleDriveReadOnlyAdapter({}),/运行时/);});
test('Google Drive adapter uses readonly scope and bearer token',async()=>{let tokenArgs,request;const adapter=new GoogleDriveReadOnlyAdapter({clientId:'runtime-client',folderId:'folder',tokenProvider:async args=>(tokenArgs=args,'token'),fetchImpl:async(...args)=>(request=args,{ok:true,json:async()=>({files:[{id:'1'}]})})});const files=await adapter.listDailyReports();assert.match(tokenArgs.scope,/drive\.readonly/);assert.match(request[0],/folder/);assert.equal(request[1].headers.Authorization,'Bearer token');assert.equal(files[0].id,'1');});
