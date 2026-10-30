// Multi-tenant Edge Function "cbs-biz". Secrets needed: ADMIN_KEY. JWT verification: OFF.
import {createClient} from 'npm:@supabase/supabase-js@2'
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const ADMIN=Deno.env.get('ADMIN_KEY')||''
const H={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-staff-key,x-admin-key,apikey,authorization','Content-Type':'application/json'}
const J=(o:any,s=200)=>new Response(JSON.stringify(o),{status:s,headers:H})
const uid=()=>crypto.randomUUID().slice(0,7)
const today=()=>new Date().toISOString().slice(0,10)
const code=()=>String(1000+crypto.getRandomValues(new Uint32Array(1))[0]%9000)
const rnd=(n:number)=>[...crypto.getRandomValues(new Uint8Array(n))].map(x=>'abcdefghjkmnpqrstuvwxyz23456789'[x%31]).join('')
const sha=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('')
const okId=(s:string)=>/^[a-z0-9][a-z0-9-]{1,38}$/.test(s)
const okDate=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>=today()
const getBiz=async(id:string)=>(await db.from('cbs_biz').select('id,name,active,key_hash,data,ts').eq('id',id).maybeSingle()).data
const hrs=(D:any)=>{const a=+(D.set.open??9),b=+(D.set.close??17),o:string[]=[];for(let h=a;h<b;h++)o.push(String(h).padStart(2,'0')+':00');return o}
const slots=(D:any,date:string,sid:string,skip?:string):[string,boolean,number][]=>{const sv=D.svc.find((x:any)=>x.id===sid),cap=Math.max(1,+(sv&&sv.cap)||1);return hrs(D).map(t=>{const n=D.appt.filter((a:any)=>a.id!==skip&&a.sid===sid&&a.date===date&&a.time===t&&a.st!=='cancelled').length;return [t,n<cap,cap-n] as [string,boolean,number]})}
const view=(D:any,c:any)=>({name:c.name,pet:c.pet,species:c.species,breed:c.breed,vacc:c.vacc,
 appts:D.appt.filter((a:any)=>a.cid===c.id).map((a:any)=>({id:a.id,sid:a.sid,date:a.date,time:a.time,st:a.st,svc:(D.svc.find((s:any)=>s.id===a.sid)||{}).name})),
 inv:D.inv.filter((i:any)=>i.cid===c.id).map((i:any)=>({d:i.d,desc:i.desc,amt:i.amt,st:i.st}))})
function auth(D:any,email:string,pin:string){email=(email||'').trim().toLowerCase();D._f=D._f||{};const f=D._f[email]||{n:0,t:0}
 if(f.n>=5&&Date.now()-f.t<9e5)return {err:'Too many attempts. Try again in 15 minutes.'}
 const c=D.cust.find((x:any)=>x.email&&x.email.toLowerCase()===email&&x.code===String(pin))
 if(!c){D._f[email]={n:f.n+1,t:Date.now()};return {err:'Email or code not recognised'}}
 delete D._f[email];return {c}}
const starter=(name:string,op:string,cp:string)=>({set:{name,tag:'Care for every paw.',ac:'#2dd4a0',cur:'£',hooks:{sms:'',email:'',pay:''},cloud:{url:'',key:''},open:9,close:17},
 staff:[{id:'u1',name:'Owner',role:'owner',pin:op},{id:'u2',name:'Care team',role:'care',pin:cp}],att:[],
 svc:[{id:uid(),name:'Dog Walking',price:15,mins:30,promo:0,cap:2},{id:uid(),name:'Grooming',price:35,mins:60,promo:0,cap:1}],
 cust:[],appt:[],inv:[],task:[],msg:[],rev:[],stock:[],faq:['Thanks for your enquiry! We will get back to you shortly.']})
async function mutate(id:string,fn:(D:any)=>any){for(let i=0;i<4;i++){const row=await getBiz(id);if(!row||!row.active)return {error:'This booking page is unavailable'}
 const out=fn(row.data);if(out.nochange)return out
 const {data}=await db.from('cbs_biz').update({data:row.data,ts:Date.now()}).eq('id',id).eq('ts',row.ts).select('ts');if(data?.length)return out}
 return {error:'Busy, please retry'}}
function handle(A:string,b:any,D:any):any{
 if(A==='book'){const s=D.svc.find((x:any)=>x.id===b.sid),date=String(b.date),time=String(b.time)
  const name=String(b.name||'').trim().slice(0,80),email=String(b.email||'').trim().slice(0,120),phone=String(b.phone||'').trim().slice(0,30)
  if(!s||!name||!(email||phone)||!okDate(date))return {error:'Please complete all fields',nochange:true}
  if(!slots(D,date,s.id).find(x=>x[0]===time&&x[1]))return {error:'That slot was just taken',nochange:true}
  let c=email&&D.cust.find((x:any)=>x.email&&x.email.toLowerCase()===email.toLowerCase());const isNew=!c
  if(!c){c={id:uid(),name,phone,email,pet:String(b.pet||'').slice(0,60),species:String(b.species||'Dog').slice(0,20),breed:'',vacc:'',notes:'Online booking',code:code()};D.cust.push(c)}
  const care=D.staff.filter((u:any)=>u.role==='care'),free=care.find((u:any)=>!D.appt.some((a:any)=>a.uid===u.id&&a.date===date&&a.time===time&&a.st!=='cancelled'))||care[0]
  D.appt.push({id:uid(),cid:c.id,sid:s.id,uid:free?.id,date,time,st:'booked'})
  const text=`Booking confirmed: ${s.name} on ${date} at ${time}.`+(isNew?` Your My Pets portal code: ${c.code}`:'')
  D.msg.push({id:uid(),cid:c.id,dir:'out',text,d:today(),ch:'SMS/Email'})
  return {ok:true,code:isNew?c.code:null,_n:{phone:c.phone,email:c.email,text,h:D.set.hooks||{},biz:D.set.name}}}
 const a=auth(D,b.email,b.code);if(a.err)return {error:a.err};const c=a.c
 if(A==='login')return {...view(D,c),nochange:true}
 const ap=D.appt.find((x:any)=>x.id===b.id&&x.cid===c.id)
 if(A==='cancel'){if(!ap||ap.st!=='booked')return {error:'Not found',nochange:true};ap.st='cancelled';return {ok:true}}
 if(A==='move'){const date=String(b.date),time=String(b.time);if(!ap||ap.st!=='booked'||!okDate(date)||!slots(D,date,ap.sid,ap.id).find(x=>x[0]===time&&x[1]))return {error:'Slot unavailable',nochange:true};ap.date=date;ap.time=time;return {ok:true}}
 if(A==='review'){D.rev.push({id:uid(),cid:c.id,r:Math.min(5,Math.max(1,+b.r||5)),t:String(b.t||'').slice(0,500),d:today()});return {ok:true}}
 if(A==='message'){D.msg.push({id:uid(),cid:c.id,dir:'in',text:String(b.text||'').slice(0,500),d:today(),ch:'Portal'});return {ok:true}}
 return {error:'Unknown action',nochange:true}}
async function notify(n:any){const post=(u:string,p:any)=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({business:n.biz,text:n.text,...p})})
 await Promise.allSettled([n.h.sms&&n.phone&&post(n.h.sms,{type:'sms',to:n.phone}),n.h.email&&n.email&&post(n.h.email,{type:'email',to:n.email,subject:n.biz})].filter(Boolean) as Promise<any>[])}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:H})
 try{const b=await req.json(),A=String(b.action||''),id=String(b.b||'')
  if(A.startsWith('admin_')){ // you only
   if(!ADMIN||req.headers.get('x-admin-key')!==ADMIN)return J({error:'forbidden'},403)
   if(A==='admin_list'){const {data}=await db.from('cbs_biz').select('id,name,active,created').order('created',{ascending:false});return J({list:data||[]})}
   if(A==='admin_create'){const name=String(b.name||'').trim().slice(0,80)
    if(!okId(id)||!name)return J({error:'Use a short id (lowercase letters, numbers, dashes) and a name'},400)
    if(await getBiz(id))return J({error:'That id is already used'},400)
    const key=rnd(24),op=code(),cp=code()
    const {error}=await db.from('cbs_biz').insert({id,name,active:true,key_hash:await sha(key),data:starter(name,op,cp),ts:Date.now()})
    return error?J({error:'Could not create'},400):J({id,key,ownerPin:op,carePin:cp})}
   const row=await getBiz(id);if(!row)return J({error:'Not found'},404)
   if(A==='admin_suspend'||A==='admin_resume'){await db.from('cbs_biz').update({active:A==='admin_resume'}).eq('id',id);return J({ok:true})}
   if(A==='admin_resetkey'){const key=rnd(24);await db.from('cbs_biz').update({key_hash:await sha(key)}).eq('id',id);return J({key})}
   if(A==='admin_export')return J({data:row.data})
   if(A==='admin_delete'){await db.from('cbs_biz').delete().eq('id',id);return J({ok:true})}
   return J({error:'Unknown action'},400)}
  if(A==='pull'||A==='push'){ // business staff app
   const k=req.headers.get('x-staff-key'),row=await getBiz(id)
   if(!row||!k||await sha(k)!==row.key_hash)return J({error:'forbidden'},403)
   if(!row.active)return J({error:'suspended'},403)
   if(A==='pull')return J({data:row.data,ts:row.ts,name:row.name})
   const ts=Date.now(),{data}=await db.from('cbs_biz').update({data:b.data,ts}).eq('id',id).eq('ts',b.baseTs).select('ts')
   return data?.length?J({ts}):J({data:row.data,ts:row.ts},409)}
  const row=await getBiz(id);if(!row||!row.active)return J({error:'This booking page is unavailable'},404);const D=row.data // customers
  if(A==='info')return J({name:D.set.name,tag:D.set.tag,ac:D.set.ac,cur:D.set.cur,svc:D.svc.map((s:any)=>({id:s.id,name:s.name,mins:s.mins,price:s.price*(1-(s.promo||0)/100)}))})
  if(A==='slots')return J({slots:slots(D,String(b.date),String(b.sid))})
  const r=await mutate(id,d=>handle(A,b,d));if(r._n){const n=r._n;delete r._n;await notify(n)}
  delete r.nochange;return J(r,r.error?400:200)
 }catch(e){return J({error:'Bad request'},400)}})
