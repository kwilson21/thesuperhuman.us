export function setupSoftwareProject() {
  document.querySelectorAll<HTMLElement>('[data-software-project]').forEach(root => {
    const status = root.querySelector<HTMLElement>('[data-software-status]')!;
    async function send(body: unknown) {
      const buttons = root.querySelectorAll<HTMLButtonElement>('button');
      buttons.forEach(button => button.disabled = true);
      try {
        const response = await fetch(root.dataset.endpoint!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const result = await response.json() as { error?: string };
        if (response.ok) { location.reload(); return; }
        status.textContent = result.error ?? 'Could not save. Please try again.';
      } catch { status.textContent = 'Could not save. Please try again.'; }
      finally { buttons.forEach(button => button.disabled = false); syncStart(); }
    }
    const start = root.querySelector<HTMLFormElement>('[data-software-start]');
    function syncStart() {
      if (!start) return;
      start.querySelector<HTMLButtonElement>('button')!.disabled = !start.querySelector<HTMLInputElement>('[name=signatures]')!.checked || !start.querySelector<HTMLInputElement>('[name=payment]')!.checked;
    }
    start?.addEventListener('change', syncStart);
    start?.addEventListener('submit', event => {
      event.preventDefault(); const data = new FormData(start);
      void send({ action: 'start', offer_id: data.get('offer_id'), offer_version: Number(data.get('offer_version')), signatures: data.has('signatures'), payment: data.has('payment'), next_update_on: data.get('next_update_on') });
    });
    const state = root.querySelector<HTMLFormElement>('[data-software-state]');
    const syncWaiting = () => { if (state) state.querySelector<HTMLInputElement>('[name=waiting_for]')!.required = state.querySelector<HTMLInputElement>('[name=state]')!.value === 'waiting_for_input'; };
    state?.addEventListener('change', syncWaiting);
    state?.addEventListener('submit', event => {
      event.preventDefault(); const data = new FormData(state);
      void send({ action: 'state', ...Object.fromEntries(data), milestone_index: Number(data.get('milestone_index')), expectedUpdatedAt: state.dataset.updatedAt });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-software-notice]').forEach(button => button.addEventListener('click', () => {
      const uncertain = button.dataset.uncertain === 'true';
      if (uncertain && !confirm('Confirm that you checked Resend and it did not accept this email.')) return;
      void send({ action: 'notice', updateId: button.dataset.softwareNotice || undefined, confirmedNotSent: uncertain });
    }));
    root.querySelector('[data-software-revoke]')?.addEventListener('click', () => {
      if (confirm('Close client access and sign the client out?')) void send({ action: 'revoke', confirmed: true });
    });
    root.querySelectorAll<HTMLFormElement>('[data-software-payment]').forEach(form=>form.addEventListener('submit',event=>{
      event.preventDefault();void send({action:'payment',milestone_index:Number(form.dataset.milestone),confirmed:new FormData(form).has('confirmed')});
    }));
    root.querySelector('[data-software-complete]')?.addEventListener('click',()=>{
      if(confirm('Mark this project complete after the final milestone handoff?')) void send({action:'complete',confirmed:true});
    });
  });
}
