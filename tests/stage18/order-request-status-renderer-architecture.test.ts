import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const projectRoot = join(__dirname, '..', '..', '..');

function source(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

describe('Stage 18 employee request-status architecture', () => {
  it('refreshes only the saved submission id through the existing named API', () => {
    const renderer = source('src/renderer/renderer.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    assert.match(renderer, /submittedRequestId\s*=\s*result\.value\.requestId/);
    const start = renderer.indexOf('async function refreshSubmittedRequestStatus');
    const end = renderer.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start);
    const refresh = renderer.slice(start, end);
    assert.match(refresh, /api\.orderRequests\.get\(\{\s*requestId\s*\}\)/);
    assert.doesNotMatch(refresh, /\buid\s*:|\brole\s*:|\bstatus\s*:/);
    assert.doesNotMatch(refresh, /process\s*\(|submit\s*\(|addInboundStock|fetch\s*\(|XMLHttpRequest|WebSocket|ipcRenderer|require\s*\(/);
  });

  it('reuses the existing channel and exposes no request-id input', () => {
    const channels = source('electron/ipc/channels.ts');
    const contract = source('src/shared/ipc-contract.d.ts');
    const markup = source('src/renderer/index.html');

    assert.match(channels, /orderRequestsGet:\s*'drug-manager:order-requests:get'/);
    assert.match(contract, /get\(input: GetOrderRequestInput\)/);
    assert.doesNotMatch(channels, /stage18|request-status/);
    assert.doesNotMatch(markup, /id="[^"]*request-id[^"]*"\s+type="(?:text|search|number)"/);

    const start = markup.indexOf('id="request-status-panel"');
    const end = markup.indexOf('</div>', start);
    assert.ok(start >= 0 && end > start);
    const panel = markup.slice(start, end);
    assert.match(panel, /id="request-status-refresh"/);
    assert.doesNotMatch(panel, /<(?:input|select|textarea)\b/);
  });
});
