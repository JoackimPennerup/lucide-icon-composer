import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function point(page: Page, x: number, y: number) {
  const svg = page.locator('.editor-svg');
  await svg.scrollIntoViewIfNeeded();
  const matrix = await svg.evaluate(element => {
    const m = (element as SVGSVGElement).getScreenCTM()!;
    return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
  });
  return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
}

async function dragModifier(page: Page, dx: number, dy: number, alt = false) {
  const x = Number(await page.getByLabel('X position').inputValue());
  const y = Number(await page.getByLabel('Y position').inputValue());
  const start = await point(page, x + 0.4, y + 0.3);
  const end = await point(page, x + 0.4 + dx, y + 0.3 + dy);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(end.x, end.y, { steps: 6 });
  if (alt) await page.keyboard.up('Alt');
  await page.mouse.up();
}

async function selectIcon(page: Page, layer: 'subject' | 'modifier', query: string, name: string) {
  await page.getByRole('button', { name: new RegExp(`Choose ${layer} icon`) }).click();
  const dialog = page.getByRole('dialog', { name: `Choose ${layer} icon` });
  await dialog.getByRole('searchbox', { name: `Search ${layer} icons` }).fill(query);
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('button', { name: new RegExp(`Choose ${layer} icon`) })).toContainText(name);
}

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('dragging preserves the grab offset, snaps, and makes one undoable change', async ({ page }) => {
  await dragModifier(page, 1.2, -0.3);
  await expect(page.getByLabel('X position')).toHaveValue('19');
  await expect(page.getByLabel('Y position')).toHaveValue('18');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('X position')).toHaveValue('18');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByLabel('X position')).toHaveValue('19');
});

test('quarter and half unit grids work; Alt temporarily disables snapping', async ({ page }) => {
  await page.getByLabel('Grid increment').selectOption('0.5');
  await dragModifier(page, 0.62, 0);
  await expect(page.getByLabel('X position')).toHaveValue('18.5');
  await page.getByLabel('Grid increment').selectOption('0.25');
  await dragModifier(page, 0.35, 0);
  await expect(page.getByLabel('X position')).toHaveValue('18.75');
  await dragModifier(page, 0.17, 0.13, true);
  await expect(page.getByLabel('X position')).toHaveValue('18.92');
  await expect(page.getByLabel('Y position')).toHaveValue('18.13');
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Snap', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('zoom and pan do not change pointer placement; Escape cancels a drag', async ({ page }) => {
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Pan', exact: true }).click();
  const start = await point(page, 18, 18);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 54, start.y - 25, { steps: 4 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Pan', exact: true }).click();
  await dragModifier(page, 1.1, 0.9);
  await expect(page.getByLabel('X position')).toHaveValue('19');
  await expect(page.getByLabel('Y position')).toHaveValue('19');
  const next = await point(page, 19.4, 19.3);
  await page.mouse.move(next.x, next.y); await page.mouse.down();
  await page.mouse.move(next.x + 44, next.y + 18, { steps: 3 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.getByLabel('X position')).toHaveValue('19');
  await expect(page.getByLabel('Y position')).toHaveValue('19');
});

test('keyboard and numeric editing share state; Delete and undo restore the modifier', async ({ page }) => {
  await page.getByLabel('X position').fill('17.3');
  await expect(page.locator('.canvas-footer')).toContainText('17.30');
  await page.locator('.editor-svg').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('X position')).toHaveValue('18.3');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByLabel('Y position')).toHaveValue('20');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByLabel('X position')).toHaveValue('18.2');
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-drag-modifier]')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-drag-modifier]')).toHaveCount(1);
});

test('editable JSON reopens and clean SVG downloads', async ({ page }) => {
  await selectIcon(page, 'subject', 'folder', 'Folder');
  await selectIcon(page, 'modifier', 'check', 'Check');
  await page.getByLabel('Grid increment').selectOption('0.25');
  await dragModifier(page, -1, 0.5);
  const download = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download SVG' }).click()]);
  const exported = await readFile(await download[0].path(), 'utf8');
  expect(exported).toContain('viewBox="0 0 24 24"');
  expect(exported).not.toMatch(/<mask|<clipPath|<image|<filter/i);
  const jsonDownload = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save editable JSON' }).click()]);
  const json = await readFile(await jsonDownload[0].path(), 'utf8');
  const installed = JSON.parse(await readFile('node_modules/lucide-static/package.json', 'utf8'));
  expect(JSON.parse(json)).toMatchObject({ version: 4, lucideVersion: installed.version, subject: { name: 'folder' }, modifier: { name: 'check' } });
  await page.getByRole('button', { name: 'Remove modifier' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'restored.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.locator('[data-drag-modifier]')).toHaveCount(1);
  await expect(page.getByLabel('X position')).toHaveValue('17');
});

test('full library is lazy, searchable by aliases, and selection preserves the other layer', async ({ page }) => {
  const initialResources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  expect(initialResources.some(url => /lucide-catalog|lucide-icons\//.test(url))).toBe(false);
  await page.getByRole('button', { name: /Choose subject icon/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose subject icon' });
  const generated = JSON.parse(await readFile('public/lucide-catalog.json', 'utf8'));
  await expect(dialog).toContainText(`${generated.icons.length.toLocaleString('en-US')} matching icons`);
  await dialog.getByRole('searchbox', { name: 'Search subject icons' }).fill('home');
  await expect(dialog.getByRole('button', { name: 'House', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'House', exact: true }).click();
  await expect(page.getByRole('button', { name: /Choose subject icon/ })).toContainText('House');
  await expect(page.getByRole('button', { name: /Choose modifier icon/ })).toContainText('Plus');
  await selectIcon(page, 'modifier', 'alarm check', 'Alarm Clock Check');
  await expect(page.getByRole('button', { name: /Choose subject icon/ })).toContainText('House');
  const loaded = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  expect(loaded.some(url => url.endsWith('/lucide-catalog.json'))).toBe(true);
  expect(loaded.filter(url => url.includes('/lucide-icons/')).length).toBeLessThan(generated.icons.length / 4);
});

test('picker keyboard navigation, empty state, and Escape return focus to the trigger', async ({ page }) => {
  const trigger = page.getByRole('button', { name: /Choose subject icon/ });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Choose subject icon' });
  const search = dialog.getByRole('searchbox', { name: 'Search subject icons' });
  await search.fill('no-icon-has-this-string');
  await expect(dialog).toContainText('No matching icons');
  await search.fill('user-round');
  await search.press('ArrowDown');
  const focused = dialog.locator('.library-icon:focus');
  await expect(focused).toHaveCount(1);
  const focusedName = await focused.getAttribute('aria-label');
  expect(focusedName).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('searchbox', { name: 'Search subject icons' }).fill('user-round');
  await dialog.getByRole('searchbox', { name: 'Search subject icons' }).press('ArrowDown');
  await expect(dialog.locator('.library-icon:focus')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(trigger).toContainText(focusedName!);
});

test('virtualized picker can navigate to and select the last installed icon', async ({ page }) => {
  const generated = JSON.parse(await readFile('public/lucide-catalog.json', 'utf8'));
  const lastName = generated.icons.at(-1).name as string;
  const trigger = page.getByRole('button', { name: /Choose modifier icon/ });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Choose modifier icon' });
  await dialog.getByRole('searchbox', { name: 'Search modifier icons' }).press('ArrowDown');
  await expect(dialog.locator('.library-icon:focus')).toHaveCount(1);
  await page.keyboard.press('End');
  await expect(dialog.locator(`.library-icon[title="${lastName}"]`)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toContainText(lastName.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' '));
});

test('searching the library does not recompose the canvas', async ({ page }) => {
  await page.evaluate(() => {
    const canvas = document.querySelector('.editor-svg')!;
    (window as typeof window & { canvasChanges: number }).canvasChanges = 0;
    new MutationObserver(records => { (window as typeof window & { canvasChanges: number }).canvasChanges += records.length; })
      .observe(canvas, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await page.getByRole('button', { name: /Choose modifier icon/ }).click();
  const search = page.getByRole('dialog', { name: 'Choose modifier icon' }).getByRole('searchbox', { name: 'Search modifier icons' });
  await search.fill('arrow');
  await search.fill('check');
  await search.fill('file');
  const mutations = await page.evaluate(() => (window as typeof window & { canvasChanges: number }).canvasChanges);
  expect(mutations).toBe(0);
});

test('touch drag commits once and pointer cancellation restores the starting position', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  const start = await point(page, 18.4, 18.3);
  const moved = await point(page, 19.5, 18.3);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', x: number, y: number) =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }],
    });
  await touch('touchStart', start.x, start.y);
  await touch('touchMove', moved.x, moved.y);
  await touch('touchCancel', moved.x, moved.y);
  await expect(page.getByLabel('X position')).toHaveValue('18');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  await touch('touchStart', start.x, start.y);
  await touch('touchMove', moved.x, moved.y);
  await touch('touchEnd', moved.x, moved.y);
  await expect(page.getByLabel('X position')).toHaveValue('19');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('X position')).toHaveValue('18');
});

test('canvas visual states remain stable with zoom and grid changes', async ({ page }) => {
  await expect(page.locator('.editor-svg')).toHaveScreenshot('editor-grid-default.png');
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('.editor-svg')).toHaveScreenshot('editor-grid-hidden-zoomed.png');
});

test('actual-size previews reflect manual placement, scale, and light or dark background', async ({ page }) => {
  await page.getByLabel('X position').fill('16.5');
  await page.getByLabel('Modifier scale').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('PageUp');
  await page.keyboard.press('PageUp');
  await page.keyboard.press('PageUp');
  await expect(page.getByLabel('Modifier scale')).not.toHaveValue('0.45');
  await expect(page.locator('.actual-row')).toHaveScreenshot('preview-light-adjusted.png');
  await page.getByRole('button', { name: 'Light background' }).click();
  await expect(page.locator('.actual-row')).toHaveScreenshot('preview-dark-adjusted.png');
});

test('subject drag snaps, numeric position stays synchronized, and undo and redo restore it', async ({ page }) => {
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Pan', exact: true }).click();
  const panStart = await point(page, 8, 8);
  await page.mouse.move(panStart.x, panStart.y); await page.mouse.down();
  await page.mouse.move(panStart.x + 35, panStart.y - 20, { steps: 3 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Pan', exact: true }).click();
  const start = await point(page, 8, 8);
  const end = await point(page, 9.2, 7.7);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Subject', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('X position')).toHaveValue('13');
  await expect(page.getByLabel('Y position')).toHaveValue('12');
  await page.getByLabel('X position').fill('13.5');
  await expect(page.locator('.canvas-footer')).toContainText('13.50');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('X position')).toHaveValue('13');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('X position')).toHaveValue('12');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByLabel('X position')).toHaveValue('13');
  await page.locator('.editor-svg').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('X position')).toHaveValue('14');
});

test('subject and modifier transforms persist and export as constant-width geometry', async ({ page }) => {
  await page.getByRole('button', { name: 'Subject', exact: true }).click();
  await page.getByLabel('Subject scale').fill('0.7');
  await page.getByLabel('X position').fill('11.5');
  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  await page.getByLabel('X position').fill('19');
  const [svgDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download SVG' }).click()]);
  const exported = await readFile(await svgDownload.path(), 'utf8');
  expect(exported).toContain('viewBox="0 0 24 24"');
  expect(exported).toContain('stroke-width="2"');
  expect(exported).not.toMatch(/<(g|mask|clipPath|image)\b/i);
  const [jsonDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save editable JSON' }).click()]);
  const json = await readFile(await jsonDownload.path(), 'utf8');
  expect(JSON.parse(json)).toMatchObject({ version: 4, subjectTransform: { scale: 0.7, offsetX: -0.5 }, modifierTransform: { offsetX: 7 } });
  await page.getByRole('button', { name: 'Subject', exact: true }).click();
  await page.getByRole('button', { name: 'Reset Transform' }).click();
  await expect(page.getByLabel('Subject scale')).toHaveValue('1');
  await page.locator('input[type=file]').setInputFiles({ name: 'restored.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.getByRole('button', { name: 'Subject', exact: true }).click();
  await expect(page.getByLabel('Subject scale')).toHaveValue('0.7');
  await expect(page.getByLabel('X position')).toHaveValue('11.5');
});

test('scale sliders use geometry pixels by default and Alt allows fine adjustment', async ({ page }) => {
  await page.getByRole('button', { name: 'Subject', exact: true }).click();
  const subjectScale = page.getByLabel('Subject scale');
  await subjectScale.fill('0.83');
  await expect(subjectScale).toHaveValue('0.85'); // file source is 20 units tall: 17 whole units
  await page.keyboard.down('Alt');
  await subjectScale.fill('0.833');
  await expect(subjectScale).toHaveValue('0.833');
  await page.keyboard.up('Alt');
  await subjectScale.focus();
  await page.keyboard.press('ArrowRight');
  await expect(subjectScale).toHaveValue('0.9');
  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  const modifierScale = page.getByLabel('Modifier scale');
  await modifierScale.fill('0.63');
  const scaledSpan = Number(await modifierScale.inputValue()) * 14; // plus source spans 14 units
  expect(scaledSpan).toBeCloseTo(Math.round(scaledSpan), 6);
});

test('choosing a new modifier snaps its retained scale to the new icon geometry', async ({ page }) => {
  await expect(page.getByLabel('Modifier scale')).toHaveValue('0.45');
  await selectIcon(page, 'modifier', 'minus', 'Minus');
  const scale = Number(await page.getByLabel('Modifier scale').inputValue());
  expect(scale * 14).toBeCloseTo(6, 6); // minus is 14 geometry units wide
  await expect(page.getByLabel('X position')).toHaveValue('18');
  await expect(page.getByLabel('Y position')).toHaveValue('18');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Modifier scale')).toHaveValue('0.45');
  await expect(page.getByRole('button', { name: /Choose modifier icon/ })).toContainText('Plus');
});
