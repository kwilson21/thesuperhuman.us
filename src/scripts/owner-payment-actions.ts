export function setupOwnerPaymentActions() {
  const panel = document.querySelector<HTMLElement>('[data-payment-panel]');
  const status = panel?.querySelector<HTMLElement>('[data-payment-status]');
  const requestId = panel?.dataset.requestId;
  if (!panel || !status || !requestId) return;
  async function send(payload: Record<string, unknown>, button: HTMLButtonElement) {
    button.disabled = true; status!.textContent = '';
    try {
      const response = await fetch(`/api/owner/requests/${requestId}/payment`, { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload) });
      if (!response.ok) {
        const result = await response.clone().json().catch(() => ({})) as { recoveryPending?: boolean };
        status!.textContent = payload.action === 'approve' ? 'Those terms were not saved. Check the price and acceptance, then try again.'
          : result.recoveryPending ? 'Stripe may have sent the invoice. Check Stripe and wait for webhook recovery before taking another action.'
            : response.status === 503 ? 'Stripe invoicing is unavailable. Refresh the payment status before trying again.' : 'That invoice was not created. Refresh the payment status before trying again.';
        button.disabled=false; return;
      }
      location.reload();
    } catch { status!.textContent='Connection lost. Refresh before trying again so an invoice is not duplicated.'; button.disabled=false; }
  }
  panel.querySelector<HTMLFormElement>('[data-payment-approval]')?.addEventListener('submit',event=>{
    event.preventDefault(); const form=event.currentTarget as HTMLFormElement; const data=new FormData(form); const amount=String(data.get('totalAmount')??'').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) { status.textContent='Enter the fixed project price with no more than two decimal places.'; return; }
    const [dollars,decimal='']=amount.split('.'); const totalAmountCents=Number(dollars)*100+Number(decimal.padEnd(2,'0'));
    void send({action:'approve',approvedService:String(data.get('approvedService')??''),totalAmountCents,offerAccepted:data.get('offerAccepted')==='on'},form.querySelector<HTMLButtonElement>('button[type="submit"]')!);
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-payment-action]').forEach(button=>button.addEventListener('click',()=>{ void send({action:button.dataset.paymentAction},button); }));
}
