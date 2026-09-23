type UploadPart = { partNumber: number; etag: string };

export function setupOwnerProjectFiles() {
  document.querySelectorAll<HTMLElement>('[data-owner-project-files]').forEach(root => {
    const form = root.querySelector<HTMLFormElement>('[data-project-upload-form]');
    const endpoint = root.dataset.endpoint;
    if (!endpoint) return;
    const publishEndpoint = root.dataset.publishEndpoint;
    if (publishEndpoint) root.querySelectorAll<HTMLFormElement>('[data-project-revoke-form]').forEach(revokeForm => {
      revokeForm.addEventListener('submit', async event => {
        event.preventDefault();
        const button = revokeForm.querySelector<HTMLButtonElement>('button[type="submit"]');
        const status = revokeForm.querySelector<HTMLElement>('[data-revoke-status]');
        const note = revokeForm.querySelector<HTMLTextAreaElement>('textarea[name="note"]')?.value ?? '';
        const fileId = revokeForm.dataset.fileId;
        if (!button || !status || !fileId || !confirm('Remove access to this file?')) return;
        button.disabled = true;
        try {
          const response = await fetch(`${publishEndpoint}/${encodeURIComponent(fileId)}`, { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'revoke', note }) });
          const result = await response.json() as { error?: string };
          if (!response.ok) throw new Error(result.error ?? 'Could not revoke this file.');
          location.reload();
        } catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not revoke this file.'; }
        finally { button.disabled = false; }
      });
    });
    if (publishEndpoint) root.querySelectorAll<HTMLFormElement>('[data-project-publish-form]').forEach(publishForm => {
      publishForm.addEventListener('submit', async event => {
        event.preventDefault();
        const button = publishForm.querySelector<HTMLButtonElement>('button[type="submit"]');
        const status = publishForm.querySelector<HTMLElement>('[data-publish-status]');
        const note = publishForm.querySelector<HTMLTextAreaElement>('textarea[name="note"]')?.value;
        const fileId = publishForm.dataset.fileId;
        if (!button || !status || !note || !fileId) return;
        button.disabled = true;
        try {
          const response = await fetch(`${publishEndpoint}/${encodeURIComponent(fileId)}`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'publish', note, downloadable: Boolean(publishForm.querySelector<HTMLInputElement>('input[name="downloadable"]')?.checked) }),
          });
          const result = await response.json() as { error?: string };
          if (!response.ok) throw new Error(result.error ?? 'Could not publish this file.');
          location.reload();
        } catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not publish this file.'; }
        finally { button.disabled = false; }
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-upload-action]').forEach(button => {
      button.addEventListener('click', async () => {
        const status = root.querySelector<HTMLElement>('[data-pending-status]');
        button.disabled = true;
        try {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: button.dataset.uploadAction, uploadId: button.dataset.uploadId }) });
          const result = await response.json() as { error?: string };
          if (!response.ok) throw new Error(result.error ?? 'Could not update this upload.');
          location.reload();
        } catch (error) {
          if (status) status.textContent = error instanceof Error ? error.message : 'Could not update this upload.';
          button.disabled = false;
        }
      });
    });
    if (!form) return;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const file = form.querySelector<HTMLInputElement>('input[name="file"]')?.files?.[0];
      const version = (form.elements.namedItem('version') as HTMLSelectElement | null)?.value;
      const status = form.querySelector<HTMLElement>('[data-upload-status]');
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!status || !button || !file || !version) return;
      const extension = file.name.toLowerCase().split('.').pop();
      const mediaType = extension === 'mp3' ? 'audio/mpeg' : extension === 'wav' ? 'audio/wav' : null;
      if (!mediaType) { status.textContent = 'Choose an MP3 or WAV file.'; return; }
      button.disabled = true;
      let uploadId: string | null = null;
      let completed = false;
      try {
        const begin = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'start', version, displayName: file.name, mediaType, byteSize: file.size }) });
        const start = await begin.json() as { uploadId?: string; partSize?: number; error?: string };
        if (!begin.ok || !start.uploadId || !start.partSize) throw new Error(start.error ?? 'Upload could not start.');
        uploadId = start.uploadId;
        const parts: UploadPart[] = [];
        const count = Math.ceil(file.size / start.partSize);
        for (let number = 1; number <= count; number++) {
          status.textContent = `Uploading part ${number} of ${count}…`;
          const url = new URL(endpoint, location.href);
          url.searchParams.set('uploadId', uploadId);
          url.searchParams.set('part', String(number));
          const chunk = file.slice((number - 1) * start.partSize, Math.min(number * start.partSize, file.size));
          let part: UploadPart | null = null;
          for (let attempt = 0; attempt < 2 && !part; attempt++) {
            try {
              const response = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: chunk });
              if (response.ok) part = (await response.json() as { part: UploadPart }).part;
            } catch { /* A part can be retried without restarting the whole file. */ }
          }
          if (!part) throw new Error('A file part could not be uploaded.');
          parts.push(part);
        }
        status.textContent = 'Finishing the upload…';
        const finish = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'complete', uploadId, parts }) });
        const result = await finish.json() as { error?: string };
        if (!finish.ok) throw new Error(result.error ?? 'The upload could not be finished.');
        completed = true;
        location.reload();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'Upload failed. Please try again.';
        if (uploadId && !completed) status.textContent += ' The file was not published. Reload to recover or discard the unfinished upload.';
      } finally { button.disabled = false; }
    });
  });
  document.querySelectorAll<HTMLElement>('[data-project-access]').forEach(root => {
    const button = root.querySelector<HTMLButtonElement>('[data-revoke-project]');
    const status = root.querySelector<HTMLElement>('[data-access-status]');
    const endpoint = root.dataset.endpoint;
    if (!button || !status || !endpoint) return;
    button.addEventListener('click', async () => {
      if (!confirm('Close client access to this project? The client will be signed out immediately.')) return;
      button.disabled = true;
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'revoke' }) });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error ?? 'Could not close client access.');
        location.reload();
      } catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not close client access.'; }
      finally { button.disabled = false; }
    });
  });
}
