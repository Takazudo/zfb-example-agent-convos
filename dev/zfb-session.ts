import { HttpConversationClient } from './shared/packages/client/src/http';
import { TransportError } from './shared/packages/client/src/wire';
export const LOCAL: boolean = true;
export const SCENARIOS = ['Ready for review'] as const;
export type Scenario = typeof SCENARIOS[number];
export async function createScenario(_scenario: Scenario) {
    let offline = false, disposed = false;
    const client = new HttpConversationClient('/api/v1', async (input, init) => {
        if (offline || disposed) throw new TransportError('network', 'Local connection interrupted. Reconnect to replay retained events.');
        return fetch(input, init);
    });
    return {
        client,
        start() {},
        setOffline(value: boolean) { offline = value; },
        async readHost(): Promise<{text: string; revision: string}> {
            const response = await fetch('/__dev/host', {cache: 'no-store', credentials: 'same-origin'});
            if (!response.ok) throw new Error('Cannot read the local demo host');
            return response.json();
        },
        dispose() { disposed = true; },
    };
}
