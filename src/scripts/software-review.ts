export function setupSoftwareReviews() {
  document.querySelectorAll<HTMLFormElement>('[data-software-review]').forEach(form=>{
    let busy=false;
    const note=form.querySelector<HTMLTextAreaElement>('[name=note]')!;
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;
      const decision=(event.submitter as HTMLButtonElement).value;
      const criteria=new FormData(form).getAll('criteria').map(Number),status=form.querySelector<HTMLElement>('[data-review-status]')!;
      if(decision==='changes_requested' && (!note.value.trim() || (form.dataset.direction!=='true' && !criteria.length))) {
        status.textContent='Name the unmet checks and tell me what happened and how to see it.';note.focus();return;
      }
      if(decision==='milestone_accepted' && !confirm(`Accept ${form.dataset.version} of ${form.dataset.milestone}? This confirms it meets the agreed checks. New features are scoped separately.`)) return;
      busy=true;form.querySelectorAll<HTMLButtonElement>('button').forEach(button=>button.disabled=true);
      try {
        const response=await fetch(form.dataset.endpoint!,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision,confirm:decision==='milestone_accepted',criteria,note:note.value})});
        const result=await response.json() as {error?:string};
        if(response.ok){location.reload();return;}status.textContent=result.error ?? 'This review changed. Reload before trying again.';
      } catch {status.textContent='Your decision could not be confirmed. Reload to check before trying again.';}
      finally {busy=false;form.querySelectorAll<HTMLButtonElement>('button').forEach(button=>button.disabled=false);}
    });
  });
}
