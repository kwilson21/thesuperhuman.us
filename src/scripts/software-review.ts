export function setupSoftwareReviews() {
  document.querySelectorAll<HTMLFormElement>('[data-software-review]').forEach(form=>{
    let busy=false;
    const note=form.querySelector<HTMLTextAreaElement>('[name=note]')!;
    const buttons=Array.from(form.querySelectorAll<HTMLButtonElement>('button'));
    const disabled=buttons.map(button=>button.disabled);
    const marks=Array.from(form.querySelectorAll<HTMLButtonElement>('[data-review-mark]'));
    const storageKey=`software-review:${form.dataset.endpoint}`;
    let saved: Record<string,string>={};
    try {
      const value=JSON.parse(localStorage.getItem(storageKey) ?? '{}');
      if(value && typeof value==='object' && !Array.isArray(value)) {
        for(const button of marks) {
          const index=button.dataset.reviewCheck!;
          if(value[index]==='works' || value[index]==='not-yet') saved[index]=value[index];
        }
      }
    } catch { /* The helper still works when browser storage is unavailable. */ }
    const renderMarks=()=>marks.forEach(button=>button.setAttribute('aria-pressed',String(saved[button.dataset.reviewCheck!]===button.dataset.reviewMark)));
    renderMarks();
    marks.forEach(button=>button.addEventListener('click',()=>{
      if(busy) return;
      const index=button.dataset.reviewCheck!, mark=button.dataset.reviewMark!;
      if(saved[index]===mark) delete saved[index]; else saved[index]=mark;
      renderMarks();
      try { localStorage.setItem(storageKey,JSON.stringify(saved)); } catch { /* Optional browser helper. */ }
    }));
    form.querySelector<HTMLDetailsElement>('[data-request-changes]')?.addEventListener('toggle',event=>{
      if(!(event.currentTarget as HTMLDetailsElement).open) return;
      form.querySelectorAll<HTMLInputElement>('[name=criteria]').forEach(checkbox=>{
        if(saved[checkbox.value]==='not-yet') checkbox.checked=true;
      });
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;
      const submitter=event.submitter as HTMLButtonElement | null;
      if(!submitter || submitter.disabled) return;
      const decision=submitter.value;
      const formData=new FormData(form),criteria=formData.getAll('criteria').map(Number),missing_deliverables=formData.getAll('missing_deliverables').map(Number),inaccessible_deliverables=formData.getAll('inaccessible_deliverables').map(Number),status=form.querySelector<HTMLElement>('[data-review-status]')!;
      if(decision==='changes_requested' && (!note.value.trim() || (form.dataset.direction!=='true' && !criteria.length && !missing_deliverables.length && !inaccessible_deliverables.length))) {
        status.textContent='Choose an unmet check or an unavailable deliverable, then tell me what happened.';note.focus();return;
      }
      if(decision==='milestone_accepted' && !confirm(`Accept ${form.dataset.version} of ${form.dataset.milestone}? This confirms it meets the agreed checks. New features are scoped separately.`)) return;
      busy=true;form.querySelectorAll<HTMLButtonElement>('button').forEach(button=>button.disabled=true);
      try {
        const response=await fetch(form.dataset.endpoint!,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision,confirm:decision==='milestone_accepted',criteria,missing_deliverables,inaccessible_deliverables,note:note.value})});
        const result=await response.json() as {error?:string};
        if(response.ok){location.reload();return;}status.textContent=result.error ?? 'This review changed. Reload before trying again.';
      } catch {status.textContent='Your decision could not be confirmed. Reload to check before trying again.';}
      finally {busy=false;buttons.forEach((button,index)=>button.disabled=disabled[index]);}
    });
  });
}
