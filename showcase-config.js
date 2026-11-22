/**
 * Guides featured in the A/B Task Spotlight, in display order. Only the list is curated;
 * the results always come from each agent's latest nightly job, unfiltered.
 * @type {ReadonlyArray<{ id: string, label: string }>}
 */
export const SHOWCASE_TASKS = [
    { id: 'menu', label: 'Menu de ações' },
    { id: 'passkey-authentication', label: 'Login com passkey' },
    { id: 'progress-ring', label: 'Anel de progresso' },
    { id: 'swipe-to-remove', label: 'Deslizar para remover' },
    { id: 'scrollability-affordance-hints', label: 'Sombras de rolagem' },
    { id: 'form-fields-automatically-fit-contents', label: 'Campos autoajustáveis' }
];

export const SHOWCASE_GUIDE_IDS = new Set(SHOWCASE_TASKS.map(t => t.id));
