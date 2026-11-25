import QRCode from "npm:qrcode@1.5.4";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const site = "https://canganauto-dot.github.io";
const headers = { "Access-Control-Allow-Origin": site, "Access-Control-Allow-Headers": "authorization,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS", "Cache-Control": "no-store" };
const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply(405, {});
  try {
    const p = await req.json();
    if (!uuid.test(p.id)) return reply(400, {error:"رقم الإصدار غير صالح."});
    if (p.action === "verify") {
      const {data,error} = await db.from("ownership_qr").select("id,buyer,vin").eq("id",p.id).maybeSingle();
      if (error) throw error;
      return data ? reply(200,data) : reply(404,{error:"السجل غير موجود."});
    }
    if (p.action !== "issue") return reply(400,{});
    const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return reply(401,{error:"سجّل الدخول بحساب العقود."});
    const {data:{user},error:authError} = await db.auth.getUser(token);
    if (authError || !user) return reply(401,{error:"انتهت جلسة الدخول."});
    const {data:profile,error:accessError} = await db.rpc("contract_portal",{actor:user.id,action:"session",payload:{}});
    if (accessError) throw accessError;
    if (!profile?.companies?.some((c:{id:string,department:string}) => c.id===p.company && ["contracts","management"].includes(c.department)))
      return reply(403,{error:"لا تملك صلاحية إصدار كتاب لهذه الشركة."});
    if (typeof p.buyer !== "string" || !p.buyer.trim() || p.buyer.length>85 || typeof p.vin!=="string" || !/^[A-Z0-9-]{5,30}$/.test(p.vin))
      return reply(400,{error:"راجع الاسم والشاصي."});
    const row = {id:p.id,buyer:p.buyer.trim(),vin:p.vin,company:p.company,issued_by:user.id};
    const image = await QRCode.toDataURL(site+"/QR/?id="+p.id,{width:640,margin:4,errorCorrectionLevel:"M"});
    const {error} = await db.from("ownership_qr").insert(row);
    if (error?.code==="23505") {
      const {data,error:readError}=await db.from("ownership_qr").select("id").match(row).maybeSingle();
      if (readError) throw readError;
      if (!data) return reply(409,{error:"رقم الإصدار مستخدم."});
    } else if (error) throw error;
    return reply(200,{id:p.id,image});
  } catch {return reply(503,{error:"تعذّر إكمال الطلب. أعد المحاولة."});}
});
