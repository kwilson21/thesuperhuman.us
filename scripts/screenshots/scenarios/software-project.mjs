import { createHash } from 'node:crypto';
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
    const terms={outcome:'A clear next step for every client.',summary:'Client onboarding tool',milestones:[{name:'Client onboarding tracker',deliverables:['A shared status view','Next actions with a named owner'],acceptance:['Add a client and identify the next action.'],feeCents:240000}],clientInputs:'A redacted sample export.',exclusions:'Live rollout and integrations.',timing:'Agreed before start.',paymentMode:'standard'};
    // Intake, sent offer and session need outside Turnstile/email, so only these are seeded.
    sql(`INSERT INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,created_at,updated_at) VALUES (${quote(id)},'software','workflow','Alex Example',${quote(email)},'Client onboarding tool','{"path":"workflow","company":"Example Studio"}','reviewed',${quote(at)},${quote(at)});
      INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at,sent_at,sent_by) VALUES ('screenshot-project-offer',${quote(id)},1,'sent',${quote(JSON.stringify(terms))},${quote(at)},${quote(at)},${quote(at)},'owner@example.com');
      INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES (${quote(createHash('sha256').update(token).digest('hex'))},${quote(email)},${quote(at)},'2099-01-01',${quote(at)})`);
    const steps=[];
    const shot=async(title,path,name,options={})=>{const images=[];for(const viewport of ['desktop','phone']) images.push({file:await capture({file:`software-project-${name}-${viewport}.png`,path,viewport,...options}),caption:`Fictional data: ${title}`});steps.push({title,images});};
    await shot('Start the project',`/owner/requests/${id}`,'start',{owner:true});
    await ownerFetch(`/api/owner/requests/${id}/project`,{action:'start',signatures:true,payment:true,next_update_on:'2026-10-08'});
    await shot('Project rail after start',`/owner/requests/${id}`,'rail',{owner:true});
    await shot('Before the first shared update',`/studio/software/${id}`,'first',{cookie});
    const update={kind:'progress',milestone_index:0,title:'From scattered updates to one shared view.',artifact_version:'v1',evidence_type:'concept',visual_alt:'Illustrative table layout for client status and next actions.',preview_url:'',what_changed:'A proposed shared view of client status and the next action.',checks_limitations:'Concept only. Not implemented.',next_step:'Build the shared view after your feedback.',client_request:'Send a redacted sample export.',next_update_on:'2026-10-08',email_client:false};
    const draft=await ownerFetch(`/api/owner/requests/${id}/updates`,{action:'draft',update,expectedUpdatedAt:null});
    const visual=await ownerFetch(`/api/owner/requests/${id}/updates/${draft.id}/visual`,conceptPng(),'PUT',{'content-type':'image/png','if-unmodified-since':draft.updatedAt});
    await shot('Composer with concept and live client preview',`/owner/requests/${id}/update`,'composer',{owner:true,prepare:async page=>{
      await page.locator('[name=title]').fill('One shared client view.');
      await page.waitForFunction(() => document.querySelector('[data-preview-title]')?.textContent === 'One shared client view.');
    }});
    await ownerFetch(`/api/owner/requests/${id}/updates`,{action:'share',confirmed:true,update,expectedUpdatedAt:visual.updatedAt});
    await shot('Shared concept and Waiting on you',`/studio/software/${id}`,'shared',{cookie});
    await shot('Software-only project list','/studio','software-index',{cookie});
    sql(`INSERT INTO owner_requests(id,kind,service_id,name,email,summary,status,created_at,updated_at) VALUES ('screenshot-project-song','service','vocal-mix','Alex Example',${quote(email)},'Fictional song (mix)','new',${quote(at)},${quote(at)})`);
    await shot('Software and songs project list','/studio','mixed-index',{cookie});
    await shot('Software sign-in','/studio/sign-in?for=software','signin');
    await shot('Unknown project unavailable','/studio/software/unavailable','unavailable',{cookie,status:404});
    return steps;
  },
};
