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
 it('rejects empty specific direction before external calls', async () => {
   const response = await POST(context({ ...base, direction: 'specific', referenceNote: '  ' }));
   expect(response.status).toBe(400);
   expect(await response.json()).toEqual({ ok: false, errors: { referenceNote: 'Describe the specific direction you have in mind.' } });
   expect(fetch).not.toHaveBeenCalled();
 });
 it('allows a corrected captcha immediately while limiting successful submissions', async () => {
   const stored = new Map<string, string>();
   const kv = { get: vi.fn(async (key: string) => stored.get(key) ?? null), put: vi.fn(async (key: string, value: string) => { stored.set(key, value); }) };
   const submit = () => { const ctx = context(); ctx.locals.runtime.env.RATE_LIMIT = kv; return POST(ctx); };
   vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) } as Response);
   expect((await submit()).status).toBe(403);
   expect(stored.has('rl:audio:0.0.0.0')).toBe(false);
   expect((await submit()).status).toBe(200);
   expect((await submit()).status).toBe(429);
   expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('api.resend.com'))).toHaveLength(1);
 });
 it('bounds repeated failed captcha attempts before external verification', async () => {
   const ctx = context();
   ctx.locals.runtime.env.RATE_LIMIT.get.mockImplementation(async (key: string) => key.startsWith('rl:audio-attempt:') ? '10' : null);
   expect((await POST(ctx)).status).toBe(429);
   expect(fetch).not.toHaveBeenCalled();
 });
 it('blocks failed captcha and rate limit',async()=>{const ctx=context();ctx.locals.runtime.env.RATE_LIMIT.get.mockResolvedValue('1');expect((await POST(ctx)).status).toBe(429);(fetch as any).mockResolvedValue({ok:true,json:async()=>({success:false})});expect((await POST(context())).status).toBe(403);});
});
