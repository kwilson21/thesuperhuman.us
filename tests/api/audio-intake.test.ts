import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '~/pages/api/audio-intake';
import { saveOwnerRequest } from '~/lib/owner-requests';
import { sendUrgentOwnerAlert } from '~/lib/owner-alerts';
import { deliverProjectInvitation } from '~/lib/audio-project-invitations';

vi.mock('~/lib/owner-requests', () => ({ saveOwnerRequest: vi.fn(async (_db, input) => ({ id: 'request-123', ...input })) }));
vi.mock('~/lib/owner-alerts', () => ({ sendUrgentOwnerAlert: vi.fn(async () => true) }));
vi.mock('~/lib/audio-project-invitations', () => ({ deliverProjectInvitation: vi.fn(async () => {}) }));
const base = { service:'vocal-mix', title:'My song', direction:'judgment', preferences:{}, name:'Artist', email:'artist@example.com', permission:true, turnstileToken:'test', fileLink:'https://drive.google.com/example' };
function context(body: unknown = base, origin = 'https://thesuperhuman.us') {
  return { request: new Request('https://thesuperhuman.us/api/audio-intake', { method:'POST', headers:{origin,'content-type':'application/json'}, body:JSON.stringify(body) }), locals:{runtime:{env:{MUSIC_DB:{},RESEND_API_KEY:'test',CONTACT_FROM_EMAIL:'test@example.com',CONTACT_TO_EMAIL:'owner@example.com',TURNSTILE_SECRET_KEY:'test',RATE_LIMIT:{get:vi.fn(async()=>null),put:vi.fn(async()=>{}),delete:vi.fn(async()=>{})}}}} } as any;
}
beforeEach(()=>{ vi.clearAllMocks(); vi.stubGlobal('fetch',vi.fn(async (url:string)=> url.includes('siteverify') ? {ok:true,json:async()=>({success:true})} : {ok:true})); });
describe('intake endpoint',()=>{
 it('stores reviewed details without fetching the shared file',async()=>{const res=await POST(context());expect(res.status).toBe(200);expect(saveOwnerRequest).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({kind:'service',serviceId:'vocal-mix',email:'artist@example.com'}));});
 it('sends the owner an immediate notice with the service, title, client, files, direction and a dashboard link, regardless of the client portal flag', async () => {
   const res = await POST(context());
   expect(res.status).toBe(200);
   expect(deliverProjectInvitation).not.toHaveBeenCalled();
   const resendCalls = (fetch as any).mock.calls.filter(([url]: [string]) => String(url).includes('api.resend.com'));
   expect(resendCalls).toHaveLength(1);
   const body = JSON.parse(resendCalls[0][1].body);
   expect(body.to).toEqual(['owner@example.com']);
   expect(body.reply_to).toBe('artist@example.com');
   expect(body.subject).not.toContain('—');
   expect(body.text).not.toContain('—');
   expect(body.text).toContain('Service: Two-track vocal mixing');
   expect(body.text).toContain('Title: My song');
   expect(body.text).toContain('Name: Artist');
   expect(body.text).toContain('Email: artist@example.com');
   expect(body.text).toContain('Files: https://drive.google.com/example');
   expect(body.text).toContain('Direction: Use your judgment');
   expect(body.text).toContain('https://thesuperhuman.us/owner/requests/request-123');
 });
 it('queues a sign-in invitation in addition to the owner notice when the private portal is enabled', async () => {
   const ctx = context();
   const waitUntil = vi.fn();
   ctx.locals.runtime.ctx = { waitUntil };
   ctx.locals.runtime.env.AUDIO_CLIENT_PORTAL_ENABLED = 'true';
   expect((await POST(ctx)).status).toBe(200);
   expect(deliverProjectInvitation).toHaveBeenCalledWith(ctx.locals.runtime.env.MUSIC_DB, 'request-123', ctx.locals.runtime.env);
   expect(waitUntil).toHaveBeenCalledTimes(1);
 });
 it('still returns success when the owner notice fails to send, since the request is already stored', async () => {
   (fetch as any).mockImplementation(async (url: string) => url.includes('siteverify') ? { ok: true, json: async () => ({ success: true }) } : { ok: false, json: async () => ({}) });
   const res = await POST(context());
   expect(res.status).toBe(200);
   expect(await res.json()).toEqual({ ok: true });
 });
 it('rejects cross-origin and oversized requests before external calls',async()=>{expect((await POST(context(base,'https://evil.example'))).status).toBe(403);expect((await POST(context({padding:'x'.repeat(33000)}))).status).toBe(413);expect(fetch).not.toHaveBeenCalled();});
 it('requires files and permission before sending',async()=>{expect((await POST(context({...base,fileLink:'',permission:false}))).status).toBe(400);expect(fetch).not.toHaveBeenCalled();});
 it('does not accept obsolete upload session instead of files',async()=>{expect((await POST(context({...base,fileLink:'',uploadSession:'00000000-0000-0000-0000-000000000001'}))).status).toBe(400);});
 it('does not claim success when storage is unavailable or fails',async()=>{const ctx=context();ctx.locals.runtime.env.MUSIC_DB=undefined;expect((await POST(ctx)).status).toBe(503);vi.mocked(saveOwnerRequest).mockRejectedValueOnce(new Error('database unavailable'));expect((await POST(context())).status).toBe(503);expect(sendUrgentOwnerAlert).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({category:'request-storage',route:'/api/audio-intake'}));});
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
   // Exactly one submission succeeded, so exactly one owner notice went out.
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
