import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';

const fixture=resolve('test/fixtures/synthetic-reports.pdf');
const user={id:'00000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',email:'qa@example.test',app_metadata:{provider:'email'},user_metadata:{}};
function token(exp=Math.floor(Date.now()/1000)+3600){return [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({...user,sub:user.id,exp,iat:Math.floor(Date.now()/1000)})).toString('base64url'),'synthetic-not-a-real-signature'].join('.');}
function session(exp){return {access_token:token(exp),refresh_token:'synthetic-refresh-token',expires_in:3600,expires_at:exp||Math.floor(Date.now()/1000)+3600,token_type:'bearer',user};}
async function sandbox(page,{configured=true,failUpload=false,failSave=false}={}){
  const state={reports:[],images:[],audits:[],objects:new Map(),otp:null,refreshes:0,posts:0,failUpload,failSave,blocked:[]};
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin==='http://127.0.0.1:4173'){
      if(url.pathname==='/api/config')return route.fulfill({json:configured?{supabaseUrl:'https://qa.supabase.test',supabaseAnonKey:'synthetic-public-key',storageBucket:'test-reports',ocrEnabled:false,authRequired:true}:{supabaseUrl:'',supabaseAnonKey:''}});
      return route.continue();
    }
    if(url.origin!=='https://qa.supabase.test'){state.blocked.push(url.origin);return route.abort();}
    if(url.pathname==='/auth/v1/otp'){state.otp={body:request.postDataJSON(),redirect:url.searchParams.get('redirect_to')};return route.fulfill({json:{}});}
    if(url.pathname==='/auth/v1/user')return route.fulfill({json:user});
    if(url.pathname==='/auth/v1/logout')return route.fulfill({json:{}});
    if(url.pathname==='/auth/v1/token'){state.refreshes++;return route.fulfill({json:session()});}
    if(url.pathname.startsWith('/storage/v1/object/sign/'))return route.fulfill({json:{signedURL:'/object/signed-test-image'}});
    if(url.pathname==='/storage/v1/object/signed-test-image'){
      const object=[...state.objects].find(([path])=>path.endsWith('.png'))?.[1];return route.fulfill({contentType:'image/png',body:object||Buffer.from('')});
    }
    if(!request.headers().authorization?.startsWith('Bearer '))return route.fulfill({status:401,json:{message:'login required'}});
    if(url.pathname.startsWith('/storage/v1/object/')){
      if(state.failUpload){state.failUpload=false;return route.fulfill({status:503,json:{message:'synthetic upload failure'}});}
      state.objects.set(url.pathname,request.postDataBuffer());return route.fulfill({json:{Key:url.pathname}});
    }
    if(url.pathname.startsWith('/rest/v1/')){
      const table=url.pathname.split('/').at(-1),store=table==='daily_reports'?state.reports:table==='image_evidence'?state.images:state.audits;
      if(request.method()==='GET')return route.fulfill({json:store});
      state.posts++;if(state.failSave&&table==='image_evidence'){state.failSave=false;return route.fulfill({status:503,json:{message:'synthetic database failure'}});}
      for(const row of [request.postDataJSON()].flat()){const key=table==='daily_reports'?'id':table==='image_evidence'?'image_id':'import_id',existing=store.findIndex(x=>x[key]===row[key]);if(existing<0)store.push(row);else store[existing]=row;}
      return route.fulfill({json:{}});
    }
    return route.fulfill({status:404,json:{message:'unexpected test endpoint'}});
  });
  return state;
}
async function login(page){const s=session();await page.goto(`/#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`);await page.reload();await expect(page.locator('#cloudStatus')).toContainText('已自动登录');}
async function upload(page){await page.locator('#fileInput').setInputFiles(fixture);await expect(page.locator('#importSummary')).toContainText('2 条记录、4 张图片',{timeout:25000});}

test('first email login uses correct redirect, remembered session restores and logout is explicit',async({page})=>{
  const state=await sandbox(page);await page.goto('/');await expect(page.locator('#cloudStatus')).toContainText('点击登录');await page.locator('#cloudStatus').click();await page.locator('#loginEmail').fill(user.email);await page.locator('#sendLogin').click();await expect(page.locator('#loginError')).toContainText('登录链接已发送');expect(state.otp.body.create_user).toBe(false);expect(state.otp.redirect).toBe('http://127.0.0.1:4173/');
  await login(page);await page.reload();await expect(page.locator('#cloudStatus')).toContainText('已自动登录');await page.locator('#signOutButton').click();await expect(page.locator('#cloudStatus')).toContainText('点击登录');await page.reload();await expect(page.locator('#cloudStatus')).toContainText('点击登录');expect(state.blocked).toEqual([]);
});
test('expired remembered session refreshes through SDK rather than using stale access token',async({page})=>{
  const state=await sandbox(page),old=session(Math.floor(Date.now()/1000)-300);await page.addInitScript(({old})=>localStorage.setItem('sb-qa-auth-token',JSON.stringify(old)),{old});await page.goto('/');await expect(page.locator('#cloudStatus')).toContainText('已自动登录');expect(state.refreshes).toBeGreaterThan(0);
});
test('real multilingual PDF extracts text and JPEG/Flate images, saves private data and restores after reload',async({page})=>{
  const state=await sandbox(page);await login(page);await upload(page);await expect(page.locator('#importPreviewRows')).toContainText('粉磨车间');await expect(page.locator('#importPreviewRows')).toContainText('第 2 页');expect(state.posts).toBe(0);
  await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();expect(state.reports).toHaveLength(2);expect(state.images).toHaveLength(4);expect(state.audits).toHaveLength(1);expect(state.objects.size).toBe(5);
  expect(state.reports.every(r=>r.id&&r.payload.provenance&&r.payload.originalObjectPath)).toBe(true);expect(state.images.every(i=>i.report_id&&i.payload.objectPath&&!i.payload.dataUrl&&!i.payload.signedUrl)).toBe(true);
  await page.getByRole('link',{name:'日报对比'}).click();await expect(page.locator('#comparisonRows')).toContainText('改善');await expect(page.locator('#comparisonRows')).toContainText('中方 +1');await expect(page.locator('#comparisonRows')).toContainText('当日工程量变化 +8');
  await page.reload();await page.getByRole('link',{name:'图片证据'}).click();await expect(page.locator('#imageGallery img')).toHaveCount(4);await expect.poll(()=>page.locator('#imageGallery img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);expect(state.posts).toBe(3);expect(state.blocked).toEqual([]);
});
test('upload failure retains pending batch, retry saves once and duplicate import does not overwrite reports',async({page})=>{
  const state=await sandbox(page,{failUpload:true});await login(page);await upload(page);await page.locator('#confirmImport').click();await expect(page.locator('#confirmImport')).toContainText('重试');expect(state.reports).toHaveLength(0);await expect(page.locator('#dataStatus')).toContainText('尚未导入');
  await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();expect(state.reports).toHaveLength(2);const ids=state.reports.map(r=>r.id);await upload(page);await expect(page.locator('#importSummary')).toContainText('2 条重复');await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();expect(state.reports.map(r=>r.id)).toEqual(ids);expect(state.images).toHaveLength(4);expect(state.images.every(i=>ids.includes(i.report_id))).toBe(true);
});
test('database partial failure can retry stable report/image/audit IDs without local commit',async({page})=>{
  const state=await sandbox(page,{failSave:true});await login(page);await upload(page);await page.locator('#confirmImport').click();await expect(page.locator('#confirmImport')).toContainText('重试');await expect(page.locator('#dataStatus')).toContainText('尚未导入');const ids=state.reports.map(r=>r.id);await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();expect(state.reports.map(r=>r.id)).toEqual(ids);expect(state.audits).toHaveLength(1);
});
test('failed PDF batch is visible and cannot be confirmed; cancelling keeps prior data',async({page})=>{
  await sandbox(page,{configured:false});await page.goto('/');await page.locator('#fileInput').setInputFiles({name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a PDF')});await expect(page.locator('#importMessages')).toContainText('导入失败');await expect(page.locator('#confirmImport')).toBeDisabled();await page.locator('#cancelImport').click();await expect(page.locator('#dataStatus')).toContainText('尚未导入');
});
test('offline PDF mode preserves original and decoded images in IndexedDB through reload',async({page})=>{
  await sandbox(page,{configured:false});await page.goto('/');await upload(page);await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();await page.reload();await page.getByRole('link',{name:'图片证据'}).click();await expect(page.locator('#imageGallery img')).toHaveCount(4);await expect.poll(()=>page.locator('#imageGallery img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
  await page.getByRole('link',{name:'日报录入'}).click();await page.locator('[data-source]').first().click();await expect(page.locator('#sourceDetails')).toContainText('synthetic-reports.pdf');await expect(page.locator('#downloadOriginal')).toBeVisible();
});
test('manual report saves to authenticated cloud and retains construction content after reload',async({page})=>{
  const state=await sandbox(page);await login(page);await page.getByRole('link',{name:'日报录入'}).click();
  await page.locator('[name="date"]').fill('2026-10-03');await page.locator('[name="workshop"]').fill('QA Workshop');await page.locator('[name="process"]').fill('QA Activity');await page.locator('[name="constructionContent"]').fill('SYNTHETIC WORK ONLY');await page.getByRole('button',{name:'保存日报'}).click();
  await expect(page.getByText('日报已保存到本机和云端')).toBeVisible();expect(state.reports).toHaveLength(1);expect(state.reports[0].payload.constructionContent).toBe('SYNTHETIC WORK ONLY');await page.reload();await page.getByRole('link',{name:'日报录入'}).click();await expect(page.locator('#historyRows')).toContainText('QA Workshop');
});
