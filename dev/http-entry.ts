import { HttpConversationClient } from '../packages/client/src/http.js';
import { mountWorkbench } from '../packages/workbench/src/view.js';
export function start() {
    const root = document.getElementById('app');
    if (!root)
        throw new Error('Missing app root.');
    return mountWorkbench(root, { client: new HttpConversationClient(), mode: 'sqlite', readHost: async () => {
            const r = await fetch('/__dev/host', { cache: 'no-store', credentials: 'same-origin' });
            if (!r.ok)
                throw new Error('Local host unavailable');
            return await r.json() as {
                revision: string;
                text: string;
            };
        } });
}
