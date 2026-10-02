import { expect, it } from 'vitest';
import { nativeAgreementRoute } from '~/lib/agreement-request';
import type { APIContext } from 'astro';
const context = (type: string) => ({request:new Request('https://example.test/api/agreements/session',{method:'POST',headers:{'content-type':type}})}) as APIContext;
it('shows escaped actionable native errors while preserving status and no-store headers', async () => {
  const route = nativeAgreementRoute(async () => Response.json({error:'Invalid <code>'},{status:401,headers:{'cache-control':'private, no-store'}}),()=>'/agreements');
  const response = await route(context('application/x-www-form-urlencoded'));
  expect(response.status).toBe(401);
  expect(response.headers.get('content-type')).toContain('text/html');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const html = await response.text();
  expect(html).toContain('Invalid &lt;code&gt;');
  expect(html).toContain('href="/agreements"');
  expect(html).toContain('role="alert"');
});
it('keeps enhanced JSON and native success redirects unchanged', async () => {
  const json = nativeAgreementRoute(async () => Response.json({ok:false},{status:409}),()=>'/agreements');
  expect(await (await json(context('application/json'))).json()).toEqual({ok:false});
  const redirect = nativeAgreementRoute(async () => new Response(null,{status:303,headers:{location:'/agreements'}}),()=>'/agreements');
  expect((await redirect(context('application/x-www-form-urlencoded'))).headers.get('location')).toBe('/agreements');
});
