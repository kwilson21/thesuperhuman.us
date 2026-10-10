import { createHash } from 'node:crypto';
import { prepareAgreedTerms } from '../agreed-terms.mjs';
import { deflateSync } from 'node:zlib';

// Fictional table-shaped concept, generated here without outside imagery or services.
function conceptPng() {
  const width=480,height=180,raw=Buffer.alloc(height*(width*3+1));
  const paper=[251,248,242],rule=[232,227,218],accent=[174,85,52];
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const color=y===24||y===64||y===104||y===144||x===0||x===479?rule:(x>20&&x<32&&y>35&&y<48?accent:paper);
    color.forEach((value,index)=>raw[y*(width*3+1)+1+x*3+index]=value);
  }
  const crc = bytes => { let value=0xffffffff; for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0; };
  const chunk = (type,data) => { const body=Buffer.concat([Buffer.from(type),data]),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(body));return Buffer.concat([length,body,checksum]); };
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
export default {
  title:'Software project start, private updates and studio access',
  async run({capture,sql,ownerFetch}) {
    const id='screenshot-software-project',at=new Date().toISOString(),email='software-example@example.com';
    const token='00000000-0000-4000-8000-000000000005'.repeat(2),cookie={name:'studio_session',value:token};
    const quote=value=>`'${String(value).replaceAll("'","''")}'`;
    const terms={outcome:'Client onboarding tracker',summary:'Client onboarding tool',milestones:[{name:'Client onboarding tracker',deliverables:['A shared status view','Next actions with a named owner'],acceptance:['Add a client.','Update their status.','Identify the next action.','Import the agreed sample CSV.','Read the handoff notes.'],feeCents:240000},{name:'Client follow-up',deliverables:['Follow-up view'],acceptance:['Identify the next follow-up.'],feeCents:120000}],clientInputs:'A redacted sample export.',exclusions:'Live rollout and integrations.',timing:'Agreed before start.',paymentMode:'standard'};
    const sentOffer={id:'screenshot-project-offer',version:1};
    // Intake, sent offer and session need outside Turnstile/email, so only these are seeded.
    sql(`INSERT INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,created_at,updated_at) VALUES (${quote(id)},'software','workflow','Alex Example',${quote(email)},'Client onboarding tool','{"path":"workflow","company":"Example Studio"}','reviewed',${quote(at)},${quote(at)});
      INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at,sent_at,sent_by) VALUES (${quote(sentOffer.id)},${quote(id)},${sentOffer.version},'sent',${quote(JSON.stringify(terms))},${quote(at)},${quote(at)},${quote(at)},'owner@example.com');
      INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES (${quote(createHash('sha256').update(token).digest('hex'))},${quote(email)},${quote(at)},'2099-01-01',${quote(at)})`);
    const steps=[];
    const projectAt=()=>JSON.parse(sql(`SELECT updated_at FROM software_projects WHERE request_id=${quote(id)}`))[0]?.results?.[0]?.updated_at ?? "";
    const shot=async(title,path,name,options={})=>{const images=[];for(const viewport of ['desktop','phone']) images.push({file:await capture({file:`software-project-${name}-${viewport}.png`,path,viewport,...options}),caption:`Fictional data: ${title}`});steps.push({title,images});};
    sql(`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,stripe_invoice_id,hosted_invoice_url,status,due_at,created_by,created_at,updated_at)
      VALUES ('screenshot-deposit',${quote(id)},${quote(sentOffer.id)},0,'deposit',120000,7,'in_fictional_deposit','https://example.com/invoice/deposit','open','2026-10-07','owner@example.com',${quote(at)},${quote(at)})`);
    await shot('Open deposit before start',`/owner/requests/${id}`,'deposit-open',{owner:true});
    sql(`UPDATE software_invoices SET status='paid',status_updated_at=${quote(at)} WHERE id='screenshot-deposit'`);
    await shot('Paid deposit checks first installment before start',`/owner/requests/${id}`,'deposit-paid',{owner:true});
    await shot('Start the project',`/owner/requests/${id}`,'start',{owner:true});
    await shot('Manual signed copy details',`/owner/requests/${id}`,'external-signing',{owner:true,prepare:async page=>{
      await page.locator('[data-software-start] details > summary').click();
      await page.locator('[name=external_signed_on]').waitFor({state:'visible'});
    }});
    await ownerFetch(`/api/owner/requests/${id}/project`,{action:'start',signature_source:'external',external_signed_on:'2026-09-30',external_parties:'Sample Client / Sample Contractor',external_kept_copy:true,external_copy_reference:'Fictional signed copy',inputs_ready:true,offer_id:sentOffer.id,offer_version:sentOffer.version,expectedRequestUpdatedAt:at,signatures:true,payment:true,deposit_invoice_id:'screenshot-deposit',next_update_on:'2026-10-08'});
    sql(`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,stripe_invoice_id,hosted_invoice_url,status,due_at,created_by,created_at,updated_at)
      VALUES ('screenshot-next-deposit',${quote(id)},${quote(sentOffer.id)},1,'deposit',60000,7,'in_fictional_next_deposit','https://example.com/invoice/next-deposit','open','2026-10-07','owner@example.com',${quote(at)},${quote(at)})`);
    await shot('Owner milestone line with open later deposit',`/owner/requests/${id}`,'milestone-deposit-open',{owner:true});
    sql(`UPDATE software_invoices SET status='void' WHERE id='screenshot-next-deposit'`);
    await shot('Manual later deposit confirmation after void',`/owner/requests/${id}`,'milestone-deposit-manual',{owner:true});
    await ownerFetch(`/api/owner/requests/${id}/project`,{action:'deposit',milestone_index:1,confirmed:true});
    await shot('Later deposit recorded before milestone move',`/owner/requests/${id}`,'milestone-deposit-recorded',{owner:true});
    await shot('Project rail after start',`/owner/requests/${id}`,'rail',{owner:true});
    await shot('Before the first shared update',`/studio/software/${id}`,'first',{cookie});
    const update={kind:'progress',milestone_index:0,title:'First look at the tracker layout',artifact_version:'v1',evidence_type:'concept',visual_alt:'Illustrative table layout for client status and next actions.',preview_url:'',what_changed:'A proposed shared view of client status and the next action.',checks_limitations:'Concept only. Not implemented.',next_step:'Build the shared view after your feedback.',client_request:'Send a redacted sample export.',next_update_on:'2026-10-08',email_client:false,links:[{label:'Prior progress reference',url:'https://example.com/progress-reference'}]};
    const draft=await ownerFetch(`/api/owner/requests/${id}/updates`,{action:'draft',expectedProjectUpdatedAt:projectAt(),update,expectedUpdatedAt:null});
    const visual=await ownerFetch(`/api/owner/requests/${id}/updates/${draft.id}/visual`,conceptPng(),'PUT',{'content-type':'image/png','if-unmodified-since':draft.updatedAt});
    await shot('Composer with concept and live client preview',`/owner/requests/${id}/update`,'composer',{owner:true,prepare:async page=>{
      await page.locator('[name=title]').fill('One shared client view.');
      await page.waitForFunction(() => document.querySelector('[data-preview-title]')?.textContent === 'One shared client view.');
    }});
    await ownerFetch(`/api/owner/requests/${id}/updates`,{action:'share',expectedProjectUpdatedAt:draft.projectUpdatedAt,confirmed:true,update,expectedUpdatedAt:visual.updatedAt});
    sql(`UPDATE software_projects SET state='waiting_for_input',waiting_for='A redacted sample export.' WHERE request_id=${quote(id)}`);
    await shot('Latest work with a request for input',`/studio/software/${id}`,'shared',{cookie});
    await shot('Agreed project terms',`/studio/software/${id}`,'agreed',{cookie,prepare:page=>prepareAgreedTerms(page)});
    for (const [stage,name,title] of [[1,'agreed-milestones','Agreed milestones and timing'],[2,'agreed-cost','Agreed cost and responsibilities'],[3,'agreed-review','Complete externally signed agreement reference']]) {
      await shot(title,`/studio/software/${id}`,name,{cookie,selector:'[data-terms-reader]',prepare:page=>prepareAgreedTerms(page,stage)});
    }
    await shot('All agreed terms together',`/studio/software/${id}`,'agreed-full',{cookie,selector:'[data-terms-reader]',prepare:page=>prepareAgreedTerms(page,3,true)});
    sql(`INSERT INTO software_project_messages(request_id,actor,actor_id,body,created_at) VALUES (${quote(id)},'client',${quote(email)},'Thanks. I will send the sample.',${quote(at)})`);
    await shot('Today with a software project','/owner','today',{owner:true});
    await shot('Software-only project list','/studio','software-index',{cookie});
    sql(`INSERT INTO owner_requests(id,kind,service_id,name,email,summary,status,created_at,updated_at) VALUES ('screenshot-project-song','service','vocal-mix','Alex Example',${quote(email)},'Fictional song (mix)','new',${quote(at)},${quote(at)})`);
    await shot('Software and songs project list','/studio','mixed-index',{cookie});
    await shot('Software sign-in','/studio/sign-in?for=software','signin');
    await shot('Unknown project unavailable','/studio/software/unavailable','unavailable',{cookie,status:404});
    const share=async value=>ownerFetch(`/api/owner/requests/${id}/updates`,{action:'share',expectedProjectUpdatedAt:projectAt(),confirmed:true,update:{...update,...value,email_client:false},expectedUpdatedAt:null});
    const decide=async(review,decision)=>ownerFetch(`/api/studio/software/${id}/reviews/${review.id}`,decision,'POST',{cookie:`studio_session=${token}`});
    const direction=await share({kind:'direction_review',artifact_version:'Direction v1',client_request:''});
    await shot('Direction review awaiting a decision',`/studio/software/${id}`,'direction-review',{cookie});
    await decide(direction,{decision:'direction_confirmed'});
    await shot('Direction confirmed',`/studio/software/${id}`,'direction-confirmed',{cookie,prepare:async page=>{if(!await page.locator('.project-current').getByRole('heading',{name:'Your decision',exact:true}).isVisible()) throw new Error('The confirmed direction must keep its decision beside the work.');}});
    const delivery={...update,kind:'delivery_review',artifact_version:'Delivery v1',evidence_type:'working_preview',checks_limitations:'Checked with the fictional sample. Live rollout is outside this milestone.',title:'Client onboarding',client_request:'',review_window_days:5,delivered_deliverables:['A shared status view'],criteria:terms.milestones[0].acceptance.map(check=>`${check} Checked with the fictional sample in the preview.`),links:[{label:'Fictional release notes',url:'https://example.com/releases/delivery-v1'}],preview_url:'https://example.com/preview',email_client:false};
    const deliveryDraft=await ownerFetch(`/api/owner/requests/${id}/updates`,{action:'draft',expectedProjectUpdatedAt:projectAt(),update:{...delivery,links:[{label:'',url:'https://draft.example.com/unlabeled'}]},expectedUpdatedAt:null});
    await shot('Owner composer with every delivery check',`/owner/requests/${id}/update`,'delivery-composer',{owner:true,prepare:async page=>{
      const checkHeadings=page.locator('.client-preview').getByRole('heading',{name:'Agreed checks',exact:true});
      if(await checkHeadings.count()!==1) throw new Error('Owner preview should show one active copy of the agreed checks.');
      const included=await page.locator('[data-preview-delivered-items]').innerText();
      if(!included.includes('A shared status view') || included.includes('Next actions with a named owner')) throw new Error('Owner preview must distinguish selected deliverables from the full milestone scope.');
      const acceptanceBoundary=await page.locator('[data-preview-acceptance-boundary]').innerText();
      if(!acceptanceBoundary.includes('subset') || !acceptanceBoundary.includes('cannot accept the full milestone')) throw new Error('Owner preview must reflect the selected subset and full-milestone acceptance boundary.');
      const evidence=page.locator('[data-criteria-group="0"] textarea');
      if(await evidence.count()!==5 || !(await evidence.evaluateAll(fields=>fields.every(field=>field.required)))) throw new Error('Every agreed check needs required evidence.');
      const referenceFields=page.locator('[data-delivery-reference] input');
      await page.locator('[name="link_url"]').first().fill('https://draft.example.com/unlabeled');
      const savedReference=page.locator('[data-reuse-reference]');
      if(await savedReference.count()!==1) throw new Error('A previously shared project reference should be reusable.');
      await savedReference.click();
      if(await referenceFields.nth(1).inputValue()!=='https://draft.example.com/unlabeled') throw new Error('Reusing a saved link must not overwrite a URL with a missing label.');
      if(await referenceFields.nth(2).inputValue()!=='Prior progress reference' || await referenceFields.nth(3).inputValue()!=='https://example.com/progress-reference') throw new Error('The saved link should fill the next empty row.');
      await page.locator('[name=title]').focus();await page.keyboard.press('Tab');
      if(!(await page.locator('[name=artifact_version]').evaluate(field=>document.activeElement===field))) throw new Error('Keyboard Tab should move from title to version.');
      await page.locator('[name=artifact_version]').evaluate(field=>field.blur());
    }});
    const deliveryVisual=await ownerFetch(`/api/owner/requests/${id}/updates/${deliveryDraft.id}/visual`,conceptPng(),'PUT',{'content-type':'image/png','if-unmodified-since':deliveryDraft.updatedAt});
    const review=await ownerFetch(`/api/owner/requests/${id}/updates`,{action:'share',expectedProjectUpdatedAt:deliveryDraft.projectUpdatedAt,confirmed:true,update:delivery,expectedUpdatedAt:deliveryVisual.updatedAt});
    sql(`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,stripe_invoice_id,hosted_invoice_url,status,due_at,created_by,created_at,updated_at)
      VALUES ('screenshot-balance',${quote(id)},${quote(sentOffer.id)},0,'balance',120000,15,'in_fictional_balance','https://example.com/invoice/balance','open','2026-10-15','owner@example.com',${quote(at)},${quote(at)})`);
    await shot('Open balance after delivery',`/owner/requests/${id}`,'balance-open',{owner:true});
    await shot('Client invoices and payment strip',`/studio/software/${id}`,'invoices',{cookie,prepare:async page=>{await page.getByText('Invoices',{exact:true}).click();}});
    await shot('Delivery review awaiting a decision with selected items and full milestone scope',`/studio/software/${id}`,'delivery-review',{cookie,prepare:async page=>{
      await page.locator('summary').filter({hasText:"See what's included"}).click();
      if(await page.getByRole('heading',{name:'Agreed checks',exact:true}).count()) throw new Error('Pending checks should appear only in Try these.');
      if(!await page.locator('.try-check .hint').first().isVisible()) throw new Error('Each check should show its evidence beside the helper.');
      if(!await page.getByRole('heading',{name:'Included in this delivery'}).isVisible()) throw new Error('Client review should name what is included in this delivery.');
      if(!await page.getByRole('heading',{name:'Full agreed scope · Milestone 1'}).isVisible()) throw new Error('Client review should keep the complete acceptance scope visible.');
      if(!await page.locator('[data-preview-delivery-scope]').getByText('Next actions with a named owner',{exact:true}).isVisible()) throw new Error('Client should still see planned scope beyond this delivery.');
    }});
    await share({kind:'progress',title:'The next update',client_request:''});
    await shot('Progress update with an undecided delivery review',`/studio/software/${id}`,'progress-pending-review',{cookie,prepare:async page=>{if(!await page.locator('.project-current').getByRole('heading',{name:'The next update',exact:true}).isVisible()) throw new Error('Newer progress must lead while review actions remain available.');if(!await page.locator('aside[aria-label="Next steps"] button[value=milestone_accepted]').isVisible()) throw new Error('Pending delivery must remain actionable.');}});
    await shot('Delivery change request form open',`/studio/software/${id}`,'changes-open',{cookie,prepare:async page=>{const mark=page.locator('[data-review-mark="not-yet"]').first();if(await mark.getAttribute('aria-pressed')!=='true') await mark.click();await page.locator('[data-request-changes] summary').click();await page.waitForFunction(()=>document.querySelector('[data-request-changes] input[name=criteria]')?.checked);const check=page.locator('[name=criteria]').first();if(!await check.isChecked()) throw new Error('Not yet must pre-tick the matching agreed check.');await page.locator('[data-review-mark="works"]').first().click();if(await check.isChecked()) throw new Error('Works must clear a helper-ticked check.');await mark.click();if(!await check.isChecked()) throw new Error('Not yet must re-tick an untouched check.');await check.uncheck();await page.locator('[data-request-changes] summary').click();await page.locator('[data-request-changes] summary').click();if(await check.isChecked()) throw new Error('Reopening changes must preserve a manual untick.');await check.check();await page.locator('[name=note]').fill('Adding the fictional sample client does not save.');}});
    await decide(review,{decision:'changes_requested',criteria:[0],note:'Adding the fictional sample client does not save.'});
    const corrected=await share({...delivery,artifact_version:'Delivery v2',delivered_deliverables:terms.milestones[0].deliverables});
    await shot('Redelivery invoice replacement prompt',`/owner/requests/${id}`,'redelivery-invoice',{owner:true});
    await shot('Complete version ready to try',`/studio/software/${id}`,'delivery-complete',{cookie,prepare:async page=>{await page.locator('[data-review-mark="works"]').first().click();if(!await page.getByText('Accepting version 2 accepts milestone 1 in full, including every check above.',{exact:true}).isVisible()) throw new Error('Complete delivery must explain full milestone acceptance.');const payment=page.locator('[data-software-review] button[value=milestone_accepted] + p');if(!await payment.isVisible() || !/^(The \$[\d,.]+ balance|This milestone) is invoiced on delivery/.test(await payment.textContent())) throw new Error('Payment terms must follow the acceptance button.');}});
    sql(`UPDATE software_projects SET payment_mode='invoice' WHERE request_id=${quote(id)}`);
    await shot('Invoice Terms review',`/studio/software/${id}`,'delivery-invoice-terms',{cookie});
    sql(`UPDATE software_projects SET payment_mode='standard' WHERE request_id=${quote(id)}`);
    await decide(corrected,{decision:'milestone_accepted',confirm:true});
    sql(`UPDATE software_projects SET milestone_index=1 WHERE request_id=${quote(id)}`);
    await shot('Earlier accepted milestone awaiting payment',`/studio/software/${id}`,'earlier-accepted',{cookie});
    sql(`UPDATE software_projects SET milestone_index=0 WHERE request_id=${quote(id)}`);
    await shot('Accepted delivery before full-payment handoff',`/studio/software/${id}`,'accepted',{cookie});
    sql(`UPDATE software_invoices SET status='paid',status_updated_at=${quote(at)} WHERE id='screenshot-balance'`);
    sql(`INSERT INTO software_milestone_payments(request_id,milestone_index,paid_recorded_at,recorded_by) VALUES (${quote(id)},0,${quote(at)},'owner@example.com')`);
    sql(`UPDATE software_projects SET milestone_index=1 WHERE request_id=${quote(id)}`);
    await shot('Earlier accepted milestone awaiting handoff',`/studio/software/${id}`,'earlier-paid-handoff-pending',{cookie});
    sql(`UPDATE software_projects SET milestone_index=0 WHERE request_id=${quote(id)}`);
    await shot('Paid delivery awaiting handoff',`/studio/software/${id}`,'paid-handoff-pending',{cookie});
    await share({kind:'handoff',artifact_version:'Delivery v2',title:'Your handoff is ready.',what_changed:'Delivered files and operating notes.',checks_limitations:'Fictional sample only. Live rollout is outside scope.',next_step:'Corrections within the correction period. Anything new is a separate milestone.',paid_confirmed:true,links:[{label:'Download handoff notes',url:'https://example.com/notes'},{label:'View delivered files',url:'https://example.com/files'}],client_request:''});
    await shot('Accepted milestone with handoff ready',`/studio/software/${id}`,'handoff',{cookie,prepare:async page=>{
      const current=page.locator('.project-current');
      const headings=await current.locator('h2').allTextContents();
      if(headings[0]!=='Your files · Milestone 1' || headings.includes('Your handoff is ready.')) throw new Error('Handoff files should lead without a duplicate heading.');
      if(await page.locator('header').getByText(/^Next update:/).count()) throw new Error('A finished handoff should not promise a next update.');
    }});
    await shot('Earlier versions with their own decisions',`/studio/software/${id}`,'earlier-versions',{cookie,prepare:async page=>{await page.getByText('Earlier versions',{exact:true}).click();}});
    await share({kind:'progress',title:'Guide updated after handoff',what_changed:'I updated the operating guide.',client_request:''});
    await shot('Progress after handoff keeps files and notes',`/studio/software/${id}`,'progress-after-handoff',{cookie});
    sql(`UPDATE software_projects SET milestone_index=1,next_update_on='2026-10-16' WHERE request_id=${quote(id)}`);
    await shot('New milestone before its first update',`/studio/software/${id}`,'next-milestone-starting',{cookie});
    await shot('Owner milestone statuses and full-payment record',`/owner/requests/${id}`,'milestone-statuses',{owner:true});
    await share({kind:'direction_review',milestone_index:1,artifact_version:'Direction v1',title:'Client follow-up direction',client_request:''});
    await shot('Milestone 2 direction review with milestone 1 handoff',`/studio/software/${id}`,'next-milestone-handoff',{cookie});
    return steps;
  },
};
