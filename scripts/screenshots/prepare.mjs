import { writeFile } from 'node:fs/promises';

export async function prepareWithDiagnostics(page, prepare, out, scenario, file) {
  try {
    await prepare(page);
  } catch (error) {
    const shot = file.replace(/\.png$/, '').replace(new RegExp(`^${scenario}-`), '');
    const path = `${out}/_failure-${scenario}-${shot}`;
    // Diagnostics must not replace the original prepare error if the page closed.
    const results = await Promise.allSettled([
      page.screenshot({ path: `${path}.png`, fullPage: true, animations: 'disabled' }),
      (async () => {
        const statuses = await page.locator('[role=status]').allTextContents();
        await writeFile(`${path}.txt`, `URL: ${page.url()}\nError: ${error instanceof Error ? error.message : String(error)}\nStatuses:\n${statuses.map((text, index) => `${index + 1}: ${text}`).join('\n')}\n`);
      })(),
    ]);
    for (const result of results) if (result.status === 'rejected') console.error('Could not save prepare diagnostics:', result.reason);
    throw error;
  }
}
