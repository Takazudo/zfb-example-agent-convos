import type { Provider } from '../../../workers/conversations/src/execution.js';
import type { Manifest } from '../../core/src/repository.js';
/** Synthetic text only. Never falls back here after a real provider fails. */
export class FakeProvider implements Provider {
    mode: 'review' | 'read-only' | 'fail' = 'review';
    delayMs = 0;
    calls = 0;
    beforeFinish: (() => Promise<void>) | null = null;
    async generate(manifest: Manifest, options: Parameters<Provider['generate']>[1]): Promise<Awaited<ReturnType<Provider['generate']>>> {
        this.calls++;
        const reply = this.mode === 'read-only'
            ? 'This is a synthetic response. The request is retained in this conversation; no host content was changed.'
            : 'I prepared a release-page draft using the supplied request and the pinned writing guidelines. Review the exact changes below. Approval saves a draft; it does not publish a page.';
        for (const size of [35, 95, reply.length]) {
            options.signal.throwIfAborted();
            if (this.delayMs)
                await new Promise<void>((resolve, reject) => {
                    const timer = setTimeout(() => { options.signal.removeEventListener('abort', cancel); resolve(); }, this.delayMs);
                    const cancel = () => { clearTimeout(timer); reject(options.signal.reason); };
                    options.signal.addEventListener('abort', cancel, { once: true });
                });
            await options.checkpoint(reply.slice(0, size));
            if (this.mode === 'fail')
                throw new Error('Injected fake-provider interruption; not a model call.');
        }
        await this.beforeFinish?.();
        options.signal.throwIfAborted();
        if (this.mode === 'read-only')
            return { kind: 'text', text: reply };
        const request = manifest.messages.filter(m => m.role === 'user').at(-1)?.text ?? '';
        return { kind: 'proposal', text: reply, title: 'Save a release-page draft', body: `# October release\n\nA smaller setup. More room to play.\n\nExplore our October collection of compact instruments.\n\n## Request notes\n${request}\n\nStatus: draft — not published.` };
    }
}
