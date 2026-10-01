export function setupSoftwareReviews() {
  document.querySelectorAll<HTMLFormElement>('[data-software-review]').forEach(form=>{
    let busy=false;
    const note=form.querySelector<HTMLTextAreaElement>('[name=note]')!;
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;
      const decision=(event.submitter as HTMLButtonElement).value;
      const formData=new FormData(form),criteria=formData.getAll('criteria').map(Number),missing_deliverables=formData.getAll('missing_deliverables').map(Number),status=form.querySelector<HTMLElement>('[data-review-status]')!;
      if(decision==='changes_requested' && (!note.value.trim() || (form.dataset.direction!=='true' && !criteria.length && !missing_deliverables.length))) {
        status.textContent='Choose an unmet check or a missing deliverable, then tell me what happened.';note.focus();return;
      }
      if(decision==='milestone_accepted' && !confirm(`Accept ${form.dataset.version} of ${form.dataset.milestone}? This confirms it meets the agreed checks. New features are scoped separately.`)) return;
      busy=true;form.querySelectorAll<HTMLButtonElement>('button').forEach(button=>button.disabled=true);
      try {
        const response=await fetch(form.dataset.endpoint!,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision,confirm:decision==='milestone_accepted',criteria,missing_deliverables,note:note.value})});
        const result=await response.json() as {error?:string};
        if(response.ok){location.reload();return;}status.textContent=result.error ?? 'This review changed. Reload before trying again.';
      } catch {status.textContent='Your decision could not be confirmed. Reload to check before trying again.';}
      finally {busy=false;form.querySelectorAll<HTMLButtonElement>('button').forEach(button=>button.disabled=false);}
    });
  });
}
