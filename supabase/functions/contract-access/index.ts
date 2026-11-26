import webpush from "npm:web-push@3.6.7";
import {projection} from "./finance.ts";
import {PDFDocument} from "npm:pdf-lib@1.17.1";
// All privileged operations derive the actor from Supabase Auth on this server.
const root = Deno.env.get("SUPABASE_URL")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const origin = "https://canganauto-dot.github.io";
const headers = {"Access-Control-Allow-Origin":origin,"Vary":"Origin","Cache-Control":"no-store",
 "Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json"};
const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data ?? null),{status,headers});
class Failure extends Error {constructor(public status:number,message:string){super(message)}}
async function upstream(path:string,method:string,key:string,body?:unknown,bearer=key){
 const response=await fetch(root+path,{method,headers:{apikey:key,Authorization:"Bearer "+bearer,"Content-Type":"application/json"},
 body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json().catch(()=>null);
 if(!response.ok){
  const code=data?.code; console.error("Upstream error",path.split("?")[0],response.status,code);
  if(code==="P3001")throw new Failure(409,"انتهت مهلة إعادة النشر. بقيت تعديلاتك محفوظة في المسودة.");
  const status=code==="42501"?403:code==="40001"||code==="23505"?409:typeof code==="string" && /^(22|23)/.test(code)?400:response.status;
  throw new Failure(status,status===403?"لا تملك صلاحية هذه العملية.":status===409?"تغيّرت البيانات أو الاسم مستخدم. حدّث القائمة.":status===429?"محاولات كثيرة. حاول لاحقاً.":"تعذّر إكمال الطلب.");
 }
 return data;
}
const rpc=(name:string,body:unknown)=>upstream("/rest/v1/rpc/"+name,"POST",service,body);
const portal=async(actor:string|null,action:string,payload:unknown={})=>{
 const result=await rpc("contract_portal",{actor,action,payload});
 if(action==="session" && result)result.formsWorkspace=result.companies?.some((c:{department?:string})=>typeof c.department==="string")===true;
 return result;
};
const username=(value:unknown)=>{const name=String(value||"").trim().toLowerCase();if(!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(name))throw new Failure(400,"اسم المستخدم من ٣ إلى ٤٠ حرفاً إنكليزياً أو رقماً.");return name};
const password=(value:unknown)=>{if(typeof value!=="string" || value.length<12 || value.length>128)throw new Failure(400,"استخدم كلمة مرور من ١٢ إلى ١٢٨ حرفاً.");return value;};
// Forms move into the contract editor as business inputs only. Identity, numbering,
// print state, templates and attachment paths are assigned separately by the server.
function formFields(source:Record<string,unknown>){
 const keys=("contractType contractDate buyer buyerPhone buyerId buyerIdDate buyerIdFrom buyerAddress district street house "+
 "guarantor guarantorId guarantorIdDate guarantorIdFrom guarantorAddress guarantorPhone guarantorDistrict guarantorStreet guarantorHouse "+
 "externalSeller externalSellerAddress externalSellerPhone externalSellerId externalBuyer externalBuyerAddress externalBuyerPhone externalBuyerId externalKeys externalPurchaseDate externalWaiverDate "+
 "oldCar oldVin oldModel oldColor oldMileage oldPlate cashSplit car brand color model plate mileage vin total deposit depositDate firstDate payment count intervalMonths phaseEnabled phaseCount phasePayment phaseSecondCount "+
 "firstAuto depositAuto exchangeOldDebt formSellerId formFees formInstallmentNote cashReceived cashDueDate cashTransferNote exchangeManual exchangePayer exchangePaymentNote warrantyYears noWarranty notes").split(" ");
 const data:Record<string,unknown>={};
 for(const key of keys){const v=source[key];if(typeof v==="string"||typeof v==="boolean"||typeof v==="number")data[key]=v;}
 if(source.bookValues && typeof source.bookValues==="object" && !Array.isArray(source.bookValues)){
  data.bookValues=Object.fromEntries(Object.entries(source.bookValues).filter(([k,v])=>/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k)&&!Object.hasOwn(Object.prototype,k)&&["string","number","boolean"].includes(typeof v)));
 }
 for(const key of ["extras","cashPayments"]){
  const rows=source[key];if(!Array.isArray(rows))continue;
  data[key]=rows.slice(0,4).map(r=>({amount:String(r?.amount??""),date:String(r?.date??""),label:String(r?.label??"دفعة"),enabled:!!r?.amount}));
 }
 return data;
}
function cleanLayout(p:Record<string,any>){
 const allowed=new Set("approvedLayout pages cashTemplate exchangeTemplate externalPages transferLetter scheduleTemplate companySheets printLayouts contractTemplates variableLabels".split(" "));
 if(!p.layout || typeof p.layout!=="object" || Array.isArray(p.layout) || Object.keys(p.layout).some(k=>!allowed.has(k)))throw new Failure(400,"تصميم غير صالح.");
 const groups=[p.layout.pages,...["externalPages","companySheets"].filter(k=>p.layout[k]).map(k=>p.layout[k]),
 ...["cashTemplate","exchangeTemplate","scheduleTemplate","transferLetter"].filter(k=>p.layout[k]).map(k=>[p.layout[k]])];
 for(const pages of groups)if(!Array.isArray(pages)||new Set(pages.map(x=>x?.id)).size!==pages.length||pages.some(x=>!Number.isInteger(x?.id)||!Array.isArray(x.nodes)||x.nodes.some(n=>!n||typeof n!=="object")))throw new Failure(400,"صفحات التصميم غير صالحة.");
}
async function createAccount(actor:string|null,action:string,p:Record<string,any>){
 const pass=password(p.password),handle=action==="bootstrap"?"admin":username(p.username);
 const alias=crypto.randomUUID()+"@staff.invalid";
 if(action==="bootstrap")await portal(null,"bootstrap_check",{secret:p.secret});
 else await portal(actor,"can_create",{company:p.company});
 const created=await upstream("/auth/v1/admin/users","POST",service,{email:alias,password:pass,email_confirm:true});
 const id=created.id||created.user?.id; if(!id)throw new Failure(503,"تعذّر تأكيد إنشاء حساب الدخول.");
 try{
  const {password:_unused,...safe}=p;
  if(action==="create")await rpc("contract_staff_assignment",{actor,action,p:{...safe,username:handle,target:id}});
  else await portal(actor,action,{...safe,username:handle,target:id});
 }catch(error){
  // A confirmed DB rejection rolls back membership creation. Leave a disabled-by-default
  // unbound identity alone on ambiguous network failures to avoid deleting a committed user.
  if(error instanceof Failure && [400,403,409].includes(error.status))await upstream("/auth/v1/admin/users/"+id,"DELETE",service).catch(()=>{});
  throw error;
 }
 return {id};
}
async function actor(req:Request){
 const token=req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
 if(!token)throw new Failure(401,"سجّل الدخول.");
 const user=await upstream("/auth/v1/user","GET",anon,undefined,token);
 if(!user?.id)throw new Failure(401,"سجّل الدخول.");
 return user;
}
const archive=(actor:string,action:string,p:Record<string,any>)=>rpc("contract_archive",{actor,action,p});
const fileHeaders={apikey:service,Authorization:"Bearer "+service};
const storage=(path:string)=>root+"/storage/v1/object/contract-archive/"+path;
async function digest(data:ArrayBuffer){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data)),b=>b.toString(16).padStart(2,"0")).join("");}
async function upload(req:Request){
 const user=await actor(req), p=Object.fromEntries(new URL(req.url).searchParams);
 if(!["generated_pdf","signed_pdf"].includes(p.purpose)||Number(req.headers.get("content-length"))>15000000)throw new Failure(400,"راجع نوع الملف وحجمه.");
 // Check branch and revision before decoding the PDF. The upload RPC checks write permission again.
 await archive(user.id,"read",p);
 const bytes=await req.arrayBuffer();
 if(bytes.byteLength>15000000||new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-")throw new Failure(400,"اختر PDF بحجم لا يتجاوز ١٥ ميغابايت.");
 try{if(!(await PDFDocument.load(bytes)).getPageCount())throw Error();}catch{throw new Failure(400,"تعذّرت قراءة صفحات PDF.");}
 const meta={...p,hash:await digest(bytes),size:bytes.byteLength};
 const job=await archive(user.id,"reserve_file",meta);
 if(!job.done){
  const result=await fetch(storage(job.path),{method:"POST",headers:{...fileHeaders,"Content-Type":"application/pdf","x-upsert":"false"},body:bytes});
  if(!result.ok){
   const old=await fetch(storage(job.path),{headers:fileHeaders});
   if(!old.ok || await digest(await old.arrayBuffer())!==meta.hash)throw new Failure(503,"تعذّر حفظ الملف. أعد المحاولة.");
  }
  await archive(user.id,"publish_file",meta);
 }
 return reply(200,true);
}
// Device notifications carry an event kind and an inbox id. Customer and contract data stay inside the signed-in app.
function pushDestination(raw:string){
 const url=new URL(raw);
 if(url.protocol!=="https:"||url.port||url.username||url.password||url.hash||!(
  ["fcm.googleapis.com","updates.push.services.mozilla.com","web.push.apple.com"].includes(url.hostname)||
  url.hostname.endsWith(".push.apple.com")||url.hostname.endsWith(".notify.windows.com")))throw new Failure(400,"خدمة إشعارات غير مدعومة.");
 return url;
}
const encode64=(bytes:Uint8Array)=>btoa(Array.from(bytes,c=>String.fromCharCode(c)).join("")).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
let pushKeyPromise:Promise<JsonWebKey>|undefined;
async function signingKey(){
 const configured=Deno.env.get("FORM_VAPID_JWK");
 if(configured)return JSON.parse(configured) as JsonWebKey;
 if(!pushKeyPromise)pushKeyPromise=(async()=>{
  const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  const candidate=await crypto.subtle.exportKey("jwk",pair.privateKey);
  return await rpc("contract_push_identity",{candidate}) as JsonWebKey;
 })().catch(error=>{pushKeyPromise=undefined;throw error;});
 return pushKeyPromise;
}
function publicPushKey(key:JsonWebKey){
 const decode=(v:string)=>Uint8Array.from(atob(v.replaceAll("-","+").replaceAll("_","/")),s=>s.charCodeAt(0));
 return encode64(new Uint8Array([4,...decode(key.x!),...decode(key.y!)]));
}
async function drainPush(){
 const key=await signingKey();
 const vapidDetails={subject:Deno.env.get("FORM_VAPID_SUBJECT")||origin+"/car-contract-web/",publicKey:publicPushKey(key),privateKey:key.d!};
 const jobs=await rpc("form_devices",{actor:null,action:"claim",p:{}});
 await Promise.all(jobs.map(async(job:{endpoint:string,lease:string,id:number,kind:string,details?:Record<string,string>,auth:string,p256dh:string})=>{
  let outcome="retry";
  try{
   const url=pushDestination(job.endpoint);
   const request=webpush.generateRequestDetails({endpoint:url.href,keys:{auth:job.auth,p256dh:job.p256dh}},
    JSON.stringify({kind:job.kind,id:job.id,details:job.details}),{TTL:86400,vapidDetails});
   const response=await fetch(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(8000),headers:request.headers,body:new Uint8Array(request.body)});
   outcome=response.ok?"sent":[404,410].includes(response.status)?"gone":"retry";await response.body?.cancel();
  }catch{}
  await rpc("form_devices",{actor:null,action:"finish",p:{endpoint:job.endpoint,id:job.id,lease:job.lease,outcome}});
 }));
}
function queuePush(){
 const runtime=(globalThis as typeof globalThis & {EdgeRuntime?:{waitUntil:(promise:Promise<void>)=>void}}).EdgeRuntime;
 const job=drainPush().catch(()=>console.warn("Push delivery pending"));if(runtime)runtime.waitUntil(job);
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return reply(405,{error:"طريقة غير صالحة."});
 if(req.headers.has("Origin") && req.headers.get("Origin")!==origin)return reply(403,{error:"عنوان الموقع غير مسموح."});
 try{
  if(req.headers.get("content-type")?.startsWith("application/pdf"))return await upload(req);
  if(!req.headers.get("content-type")?.startsWith("application/json"))return reply(415,{error:"نوع طلب غير مدعوم."});
  if(Number(req.headers.get("content-length"))>18000000)return reply(413,{error:"الملف كبير."});
  const input=await req.text();if(input.length>18000000)return reply(413,{error:"الملف كبير."});
  const p=JSON.parse(input);const action=p.action;
  if(action==="push_retry"){
   if(!Deno.env.get("FORM_PUSH_JOB_TOKEN")||req.headers.get("authorization")!=="Bearer "+Deno.env.get("FORM_PUSH_JOB_TOKEN"))throw new Failure(403,"غير مخوّل.");
   await drainPush();return reply(200,true);
  }
  if(action==="push_key")return reply(200,{key:publicPushKey(await signingKey())});
  if(action==="qr_verify"){const v=await rpc("document_qr",{actor:null,action:"verify",p:{id:p.id}});return v?reply(200,v):reply(404,{error:"الرمز غير موجود."});}
  if(action==="request_access")return reply(200,await rpc("contract_review",{actor:null,action,p:{company:p.company,name:p.name,username:username(p.username)}}));
  if(action==="login"){
   const name=username(p.username);if(typeof p.password!=="string"||p.password.length>128)throw new Failure(401,"راجع اسم المستخدم وكلمة المرور.");
   const email=await portal(null,"identity",{username:name}) || "unused@staff.invalid";
   let session;try{session=await upstream("/auth/v1/token?grant_type=password","POST",anon,{email,password:p.password});}
   catch(e){if(e instanceof Failure && e.status===429)throw e;throw new Failure(401,"راجع اسم المستخدم وكلمة المرور.");}
   const account=await portal(session.user.id,"session");
   if(!account?.companies?.length)throw new Failure(403,"الحساب موقوف أو بانتظار تفعيل المدير.");
   return reply(200,{access_token:session.access_token,refresh_token:session.refresh_token,expires_at:session.expires_at,account});
  }
  if(action==="refresh"){
   const s=await upstream("/auth/v1/token?grant_type=refresh_token","POST",anon,{refresh_token:p.refresh_token});
   const account=await portal(s.user.id,"session");
   if(!account?.companies?.length)throw new Failure(403,"الحساب موقوف.");
   return reply(200,{access_token:s.access_token,refresh_token:s.refresh_token,expires_at:s.expires_at,account});
  }
  if(action==="bootstrap")return reply(200,await createAccount(null,"bootstrap",p));
  const bearer=req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if(!bearer)throw new Failure(401,"سجّل الدخول.");
  const user=await upstream("/auth/v1/user","GET",anon,undefined,bearer);
  if(!user?.id)throw new Failure(401,"سجّل الدخول.");
  if(["qr_issue","qr_review","qr_change","qr_visibility"].includes(action))return reply(200,await rpc("document_qr",{actor:user.id,action:action.slice(3),p}));
  if(action==="logout"){await fetch(root+"/auth/v1/logout?scope=local",{method:"POST",headers:{apikey:anon,Authorization:"Bearer "+bearer}});return reply(200,true);}
  if(action==="create")return reply(200,await createAccount(user.id,"create",p));
  if(action==="reset"||action==="password"){
   if(action==="reset")await portal(user.id,"reset_check",p);
   else {const current=await upstream("/auth/v1/token?grant_type=password","POST",anon,{email:user.email,password:p.current});if(current.user?.id!==user.id)throw new Failure(403,"راجع كلمة المرور الحالية.");}
   const target=action==="password"?user.id:p.target;
   await upstream("/auth/v1/admin/users/"+encodeURIComponent(target),"PUT",service,{password:password(p.password)});
   return reply(200,true);
  }
  if(["list","read","draft","remove","issue"].includes(action)){
   let body=p;
   if(action==="issue"){
    if(!p.config || typeof p.config!=="object"||!p.data)throw new Failure(400,"بيانات الإصدار ناقصة.");
    try{body={...p,finance:null,...projection(p.data)};}catch(e){throw new Failure(400,e instanceof Error?e.message:"راجع بيانات المستند.");}
   }
   return reply(200,await archive(user.id,action,body));
  }
  if(action==="file"){
   if(!["generated_pdf","signed_pdf"].includes(p.purpose))throw new Failure(400,"نوع ملف غير صالح.");
   const path=await archive(user.id,"download",p);
   if(!path)return reply(404,{error:"النسخة غير مرفوعة."});
   const file=await fetch(storage(path),{headers:fileHeaders});
   if(!file.ok)throw new Failure(503,"تعذّر استرجاع الملف.");
   return new Response(file.body,{headers:{...headers,"Content-Type":"application/pdf"}});
  }
  if(action==="update")return reply(200,await rpc("contract_staff_assignment",{actor:user.id,action,p}));

  if(action==="push_subscribe"||action==="push_unsubscribe"){
   const endpoint=pushDestination(p.endpoint).href;
   return reply(200,await rpc("form_devices",{actor:user.id,action:action==="push_subscribe"?"subscribe":"unsubscribe",p:{endpoint,auth:p.auth,p256dh:p.p256dh}}));
  }
  if(action==="form_sellers")return reply(200,await rpc("form_sellers",{actor:user.id,p}));
  if(["forms_list","form_read","form_save","form_publish","form_delete","form_withdraw","form_correct","form_reject","form_remove_published","form_history","alerts","alerts_seen","form_approve","form_convert","move_contract"].includes(action)){
   if(["form_save","form_publish","form_correct"].includes(action) && (!p.data || Array.isArray(p.data) || typeof p.data!=="object" || JSON.stringify(p.data).length>500000 || !["cash","installment","external","exchange"].includes(p.data.contractType)))throw new Failure(400,"راجع محتوى الفورمة.");
   if(["form_save","form_publish","form_correct"].includes(action))p.data=formFields(p.data);
   const result=await rpc("sales_forms",{actor:user.id,action,p});
   if(["form_publish","form_correct","form_approve","form_reject"].includes(action))queuePush();
   return reply(200,result);
  }
  if(action==="number")return reply(200,await rpc("contract_number",{actor:user.id,p}));
  if(["layouts","propose"].includes(action)){
   const profile=await portal(user.id,"session");
   const membership=profile?.companies?.find((c:{id:string})=>c.id===p.company);
   if(!membership || (membership.role==="employee" && ["sales","finance"].includes(membership.department)))throw new Failure(403,"هذه العملية تخص قسم العقود.");
  }
  if(["publish","propose"].includes(action))cleanLayout(p);
  if(["pending","propose","approve_design","reject","inspect"].includes(action))return reply(200,await rpc("contract_review",{actor:user.id,action,p}));
  if(!["session","members","update","layouts","publish","brand_save"].includes(action))throw new Failure(404,"عملية غير معروفة.");
  return reply(200,await portal(user.id,action,p));
 }catch(e){
  const status=e instanceof Failure?e.status:e instanceof SyntaxError?400:500;
  return reply(status,{error:e instanceof Failure?e.message:"تعذّر تنفيذ العملية."});
 }
});
