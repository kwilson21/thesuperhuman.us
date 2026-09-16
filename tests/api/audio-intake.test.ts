import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '~/pages/api/audio-intake';
const base = { service:'vocal-mix', title:'My song', direction:'judgment', preferences:{}, name:'Artist', email:'artist@example.com', permission:true, turnstileToken:'test', fileLink:'https://drive.google.com/example' };
function context(body: unknown = base, origin = 'https://thesuperhuman.us') {
  return { request: new Request('https://thesuperhuman.us/api/audio-intake', { method:'POST', headers:{origin,'content-type':'application/json'}, body:JSON.stringify(body) }), locals:{runtime:{env:{RESEND_API_KEY:'test',CONTACT_FROM_EMAIL:'test@example.com',CONTACT_TO_EMAIL:'owner@example.com',TURNSTILE_SECRET_KEY:'test',RATE_LIMIT:{get:vi.fn(async()=>null),put:vi.fn(async()=>{})}}}} } as any;
}
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async (url:string)=> url.includes('siteverify') ? {ok:true,json:async()=>({success:true})} : {ok:true})));
describe('intake endpoint',()=>{
 it('sends reviewed details only to the owner without fetching file links',async()=>{const res=await POST(context());expect(res.status).toBe(200);expect(fetch).toHaveBeenCalledTimes(2);const payload=JSON.parse((fetch as any).mock.calls[1][1].body);expect(payload.to).toEqual(['owner@example.com']);expect(payload.text).toContain('FILE REVIEW ONLY');expect(payload.text).toContain(base.fileLink);});
 it('rejects cross-origin and oversized requests before external calls',async()=>{expect((await POST(context(base,'https://evil.example'))).status).toBe(403);expect((await POST(context({padding:'x'.repeat(33000)}))).status).toBe(413);expect(fetch).not.toHaveBeenCalled();});
 it('requires files and permission before sending',async()=>{expect((await POST(context({...base,fileLink:'',permission:false}))).status).toBe(400);expect(fetch).not.toHaveBeenCalled();});
 it('does not accept obsolete upload session instead of files',async()=>{expect((await POST(context({...base,fileLink:'',uploadSession:'00000000-0000-0000-0000-000000000001'}))).status).toBe(400);});
 it('does not claim success when delivery is unavailable or fails',async()=>{const ctx=context();ctx.locals.runtime.env.RESEND_API_KEY='';expect((await POST(ctx)).status).toBe(503);(fetch as any).mockImplementation(async(url:string)=>url.includes('siteverify')?{ok:true,json:async()=>({success:true})}:{ok:false});expect((await POST(context())).status).toBe(502);});
 it('blocks failed captcha and rate limit',async()=>{const ctx=context();ctx.locals.runtime.env.RATE_LIMIT.get.mockResolvedValue('1');expect((await POST(ctx)).status).toBe(429);(fetch as any).mockResolvedValue({ok:true,json:async()=>({success:false})});expect((await POST(context())).status).toBe(403);});
});
