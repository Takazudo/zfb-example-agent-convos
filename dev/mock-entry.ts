import { createScenario, SCENARIOS, type Scenario } from '../packages/mock/src/scenarios.js';
import { mountWorkbench } from '../packages/workbench/src/view.js';
let active: {
    dispose(): void;
} | null = null;
let generation = 0;
export async function start(scenario: Scenario = 'Ready for review') {
    const token = ++generation;
    active?.dispose();
    active = null;
    const root = document.getElementById('app');
    if (!root)
        throw new Error('Missing app root.');
    root.textContent = 'Preparing synthetic conversation…';
    const fixture = await createScenario(scenario);
    if (token !== generation) {
        fixture.dispose();
        return;
    }
    const view = mountWorkbench(root, { client: fixture.client, mode: 'mock', selectedId: fixture.selectedId, readHost: fixture.readHost, setOffline: fixture.setOffline, scenarios: SCENARIOS, scenario, changeScenario: value => { void start(value as Scenario); } });
    active = { dispose() { view.dispose(); fixture.dispose(); } };
    fixture.start();
}
