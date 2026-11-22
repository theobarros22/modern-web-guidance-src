import { getAccessToken, isSignInEnabled, escapeHtml, getAgentBadge, formatJobDate } from './utils.js';
import { computeHeadlineInsights, hydrateMissingStats } from './insights.js';
import { AGENT_FAMILIES } from './agents.js';
import { isLocalServer } from './data-source.js';
/** @typedef {import('./insights.js').FamilyInsight} FamilyInsight */
/** @typedef {import('./insights.js').HeadlineInsights} HeadlineInsights */
/** @typedef {import('./insights.js').ManifestJob} ManifestJob */
/** @typedef {import('./insights.js').RateComparison} RateComparison */
const MAX_MULTI_NIGHTS = 5;
/** @type {Record<string, string>} */
const FAMILY_HINT = { antigravity_cli: 'Gemini' };
const heroEl = /** @type {HTMLElement | null} */ (document.getElementById('hero'));
let heroLoadSeq = 0;
let currentRecentN = 1;
/** @type {{ jobs: ManifestJob[], fetchEvals?: (testId: string) => Promise<import('../harness/lib/metrics.ts').EvalsReport>, onHydrated?: () => void, source?: import('./data-source.js').DataSource } | null} */
let latestHeroInput = null;
document.addEventListener('DOMContentLoaded', () => {
    const authBtn = document.getElementById('auth-btn');
    const heroAuthBtn = document.getElementById('hero-auth-btn');
    if (heroAuthBtn && authBtn) { heroAuthBtn.addEventListener('click', () => authBtn.click()); }
    const methodAgents = document.getElementById('method-agents');
    if (methodAgents) methodAgents.textContent = `: ${joinNames(AGENT_FAMILIES.map(f => f.label))}`;
    const windowToggle = document.getElementById('agents-window-toggle');
    if (windowToggle) {
        windowToggle.addEventListener('change', (e) => {
            const target = e.target;
            if (!(target instanceof HTMLInputElement) || target.name !== 'agents-window') return;
            currentRecentN = Math.max(1, parseInt(target.value, 10) || 1);
            if (latestHeroInput) updateHeroFromJobs(latestHeroInput.jobs, latestHeroInput);
        });
    }
});
/**
 * @param {ManifestJob[]} jobs
 * @param {{ fetchEvals?: (testId: string) => Promise<import('../harness/lib/metrics.ts').EvalsReport>, onHydrated?: () => void, source?: import('./data-source.js').DataSource }} [options]
 */
export function updateHeroFromJobs(jobs, { fetchEvals, onHydrated, source } = {}) {
    if (!heroEl) return;
    latestHeroInput = { jobs, fetchEvals, onHydrated, source };
    const seq = ++heroLoadSeq;
    const isSignedOut = () => (!isLocalServer() || jobs.length === 0) && !getAccessToken();
    const emptyStatus = () => {
        if (source === 'public') return jobs.length === 0 ? 'public-empty' : 'empty';
        return isSignedOut() ? 'auth' : 'empty';
    };
    if (jobs.length === 0 && isSignedOut()) {
        syncWindowToggle(0);
        renderPending();
        setStatus(emptyStatus());
        setBusy(false);
        return;
    }
    let insightOptions = { perAgentRecentN: currentRecentN };
    let insights = computeHeadlineInsights(jobs, insightOptions);
    if (insights.maxJobsPerFamily < 2 && currentRecentN !== 1) {
        currentRecentN = 1;
        insightOptions = { perAgentRecentN: 1 };
        insights = computeHeadlineInsights(jobs, insightOptions);
    } else if (currentRecentN > 1) {
        const clamped = Math.min(MAX_MULTI_NIGHTS, insights.maxJobsPerFamily);
        if (currentRecentN !== clamped) {
            currentRecentN = clamped;
            insightOptions = { perAgentRecentN: currentRecentN };
            insights = computeHeadlineInsights(jobs, insightOptions);
        }
    }
    syncWindowToggle(insights.maxJobsPerFamily);
    if (!insights.families.length) {
        renderPending();
        setStatus(emptyStatus());
        setBusy(false);
        return;
    }
    renderHero(insights);
    setStatus(null);
    if (insights.missingStats.length > 0 && fetchEvals) {
        setBusy(true);
        void hydrateMissingStats(jobs, fetchEvals, insightOptions)
            .then(() => {
                if (seq !== heroLoadSeq) return;
                renderHero(computeHeadlineInsights(jobs, insightOptions));
                setBusy(false);
                if (onHydrated) onHydrated();
            })
            .catch(() => {
                if (seq === heroLoadSeq) setBusy(false);
            });
    } else {
        setBusy(false);
    }
}
/** @param {number} maxJobsPerFamily */
function syncWindowToggle(maxJobsPerFamily) {
    const toggle = document.getElementById('agents-window-toggle');
    const multiRadio = document.getElementById('agents-window-multi');
    const multiLabel = document.getElementById('agents-window-multi-label');
    if (!toggle) return;
    const canToggle = maxJobsPerFamily >= 2;
    toggle.hidden = !canToggle;
    if (!canToggle) return;
    const multiN = Math.min(MAX_MULTI_NIGHTS, maxJobsPerFamily);
    if (multiRadio instanceof HTMLInputElement) multiRadio.value = String(multiN);
    if (multiLabel) multiLabel.textContent = `Últimas ${multiN} execuções por modelo`;
    const activeVal = currentRecentN > 1 ? String(multiN) : '1';
    toggle.querySelectorAll('input[name="agents-window"]').forEach(el => {
        if (el instanceof HTMLInputElement) el.checked = el.value === activeVal;
    });
}
/** @param {boolean} busy */
function setBusy(busy) { if (heroEl) heroEl.setAttribute('aria-busy', String(busy)); }
/** @param {'auth' | 'empty' | 'public-empty' | null} kind */
function setStatus(kind) {
    const el = document.getElementById('hero-status');
    const text = document.getElementById('hero-status-text');
    const btn = document.getElementById('hero-auth-btn');
    if (!el || !text || !btn) return;
    if (!kind) { el.hidden = true; text.textContent = ''; return; }
    el.hidden = false;
    // The sign-in CTA stays for an empty public copy when ?show_login is set so Googlers
    // can reach internal jobs, unless a token is already held (clicking it would sign out).
    btn.hidden = kind === 'empty' || Boolean(getAccessToken()) || !isSignInEnabled();
    const messages = {
        'auth': 'Os resultados estão em um bucket privado. Entre com Google para carregar os números mais recentes.',
        'empty': 'Nenhuma execução de avaliação foi encontrada para esta fonte de dados ainda.',
        'public-empty': 'Nenhum resultado publicado ainda. Googlers podem entrar para ver execuções internas.'
    };
    text.textContent = messages[kind];
    announce(text.textContent);
}
/** @param {string} message */
function announce(message) {
    const live = document.getElementById('hero-live');
    if (!live) return;
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = message; });
}
/** @param {RateComparison | null | undefined} r
 * @param {'unguided' | 'guided'} side
 * @returns {number | null} */
function roundedRate(r, side) {
    if (!r) return null;
    const passed = side === 'guided' ? r.guidedPassed : r.unguidedPassed;
    const total = side === 'guided' ? r.guidedTotal : r.unguidedTotal;
    if (total > 0) return Math.round((passed / total) * 100);
    const rate = side === 'guided' ? r.guidedRate : r.unguidedRate;
    return rate === null ? null : Math.round(rate);
}

/** @param {RateComparison | null | undefined} r
 * @returns {number | null} */
function displayedUpliftPp(r) {
    const u = roundedRate(r, 'unguided');
    const g = roundedRate(r, 'guided');
    return u === null || g === null ? null : g - u;
}
/** @param {HeadlineInsights} insights */
function renderHero(insights) {
    renderEyebrow(insights);
    renderTakeaways(insights);
    renderAgentTable(insights);
    const el = document.getElementById('method-recent-n');
    const recentN = insights.options.perAgentRecentN;
    if (el) {
        el.textContent = recentN === 1 ? 'a última execução por modelo' : `as ${recentN} execuções mais recentes por modelo`;
    }
    const overallUplift = displayedUpliftPp(insights.pooled?.overall);
    announce(overallUplift !== null ? `Resultados mais recentes carregados: ${signed(overallUplift, 0)} pontos percentuais a mais de verificações aprovadas com MWG.` : 'Resultados mais recentes carregados.');
}
function renderPending() {
    const list = document.getElementById('hero-takeaways');
    if (list) {
        list.innerHTML = [
            pendingCard('overall', 'Taxa de aprovação em boas práticas', 'ganho na taxa de aprovação', true),
            pendingCard('a11y', 'Verificações automáticas de acessibilidade', 'Não é uma auditoria WCAG completa', false)
        ].join('');
    }
    const body = document.getElementById('agent-table-body');
    if (body) {
        body.innerHTML = `<tr><th scope="row">Nenhum dado carregado</th><td data-label="Pass rate">${naCell()}</td><td data-label="Accessibility">${naCell()}</td><td data-label="Sample">${naCell()}</td></tr>`;
    }
    const eyebrow = document.getElementById('hero-eyebrow');
    if (eyebrow) eyebrow.textContent = 'Últimas execuções por modelo (últimos 7 dias; noturna ou linha de base 1.0)';
}
/** @param {HeadlineInsights} insights */
function renderEyebrow(insights) {
    const agentsEl = document.getElementById('hero-lede-agents');
    if (agentsEl && insights.families.length) {
        agentsEl.innerHTML = joinNames(insights.families.map(f => {
            const label = FAMILY_HINT[f.id] ? `${escapeHtml(f.label)} (${escapeHtml(FAMILY_HINT[f.id])})` : escapeHtml(f.label);
            return `<span class="nowrap">${getAgentBadge(f.id)}${label}</span>`;
        }));
    }
    const el = document.getElementById('hero-eyebrow');
    if (!el) return;
    const latest = latestDateOf(insights);
    const recentN = insights.options.perAgentRecentN;
    const label = recentN === 1 ? 'Última execução por modelo (últimos 7 dias; noturna ou linha de base 1.0)' : `${recentN} execuções mais recentes por modelo`;
    el.innerHTML = `<span class="hero-live-dot" aria-hidden="true"></span>${escapeHtml(label)}${latest ? ` · <span class="nowrap">${escapeHtml(formatDate(latest))}</span>` : ''}`;
}
/** @param {number | null} uRate @param {number | null} gRate */
function renderTakeawayDumbbell(uRate, gRate) {
    const u = Math.max(0, Math.min(100, Math.round(uRate || 0)));
    const g = Math.max(0, Math.min(100, Math.round(gRate || 0)));
    const lo = Math.min(u, g);
    const span = Math.max(0, Math.abs(g - u));
    const compactCls = span < 30 ? ' is-compact' : '';
    const regressedCls = g < u ? ' regressed' : '';
    const uAlignCls = u <= g ? ' align-start' : ' align-end';
    const gAlignCls = g >= u ? ' align-end' : ' align-start';
    return ` <div class="takeaway-dumbbell${compactCls}" aria-hidden="true"> <div class="takeaway-dumbbell-endpoints"> <div class="takeaway-endpoint unguided${uAlignCls}" style="--pos: ${u};"> <span class="endpoint-rate">${u}%</span> <span class="endpoint-name">sem MWG</span> </div> <div class="takeaway-endpoint guided${gAlignCls}" style="--pos: ${g};"> <strong class="endpoint-rate">${g}%</strong> <span class="endpoint-name">com MWG</span> </div> </div> <div class="suite-dumbbell-track takeaway-track"> <div class="connector${regressedCls}" style="left: ${lo}%; width: ${span}%;"></div> <div class="dot unguided" style="left: ${u}%;"></div> <div class="dot guided" style="left: ${g}%;"></div> </div> <div class="takeaway-dumbbell-scale"> <span>0%</span> <span>50%</span> <span>100%</span> </div> </div>`;
}
/** @param {HeadlineInsights} insights */
function renderTakeaways(insights) {
    const list = document.getElementById('hero-takeaways');
    if (!list) return;
    const pooled = insights.pooled;
    /** @type {string[]} */
    const cards = [];
    const overallUplift = displayedUpliftPp(pooled?.overall);
    if (pooled?.overall && overallUplift !== null) {
        const o = pooled.overall;
        const uRate = roundedRate(o, 'unguided');
        const gRate = roundedRate(o, 'guided');
        const recentN = insights.options.perAgentRecentN;
        const mAgents = pooled.familyCount || insights.families.length;
        const statement = taskStatement(insights, recentN);
        const jobsSuffix = recentN > 1 || pooled.jobCount > mAgents ? ` · ${pooled.jobCount} ${pooled.jobCount === 1 ? 'execução' : 'execuções'}` : '';
        const overallShortText = `~${fmtCompact(Math.min(o.unguidedTotal, o.guidedTotal))} verificações · ${mAgents} ${mAgents === 1 ? 'agente' : 'agentes'}${jobsSuffix}`;
        cards.push(takeawayCard({
            metric: 'overall',
            primary: true,
            label: 'Taxa de aprovação em boas práticas',
            figure: `<span class="figure-val">${signed(overallUplift, 0)}</span><span class="unit"> pp</span>`,
            figureText: `${signed(overallUplift, 0)} pontos percentuais`,
            statement,
            visual: renderTakeawayDumbbell(uRate, gRate),
            short: `<span class="visually-hidden">${fmtPct(uRate)} → ${fmtPct(gRate)} · </span><a href="#all-guides" class="takeaway-action-link" data-open-guides="all">${overallShortText} <span aria-hidden="true">→</span></a>`
        }));
    } else {
        cards.push(pendingCard('overall', 'Taxa de aprovação em boas práticas', 'ganho na taxa de aprovação', true));
    }
    const a11yUplift = displayedUpliftPp(pooled?.a11y);
    if (!pooled?.a11y || a11yUplift === null) { cards.push(pendingCard('a11y', 'Verificações automáticas de acessibilidade', 'Não é uma auditoria WCAG completa', false)); } else {
        const a = pooled.a11y;
        const uRate = roundedRate(a, 'unguided');
        const gRate = roundedRate(a, 'guided');
        const a11yShortText = `~${fmtCompact(Math.min(a.unguidedTotal, a.guidedTotal))} verificações${a.guideCount ? ` · ${a.guideCount} ${a.guideCount === 1 ? 'guia' : 'guias'}` : ''} · 5 dimensões`;
        cards.push(takeawayCard({
            metric: 'a11y',
            primary: false,
            label: 'Verificações automáticas de acessibilidade',
            figure: `<span class="figure-val">${signed(a11yUplift, 0)}</span><span class="unit"> pp</span> <span class="secondary-pair">(${fmtPct(uRate)} → <strong>${fmtPct(gRate)}</strong>)</span>`,
            figureText: `${signed(a11yUplift, 0)} pontos percentuais (${fmtPct(uRate)} para ${fmtPct(gRate)})`,
            statement: 'Não é uma auditoria WCAG completa',
            short: `<a href="#a11y-guides" class="takeaway-action-link" data-open-guides="a11y">${a11yShortText} <span aria-hidden="true">→</span></a>`
        }));
    }
    list.innerHTML = cards.join('');
}
/** @param {string} metric
 * @param {string} label
 * @param {string} statement
 * @param {boolean} [primary] */
function pendingCard(metric, label, statement, primary = false) {
    return takeawayCard({
        metric,
        primary,
        label,
        figure: '<span class="unit">—</span>',
        figureText: 'não carregado',
        statement,
        short: 'Os números aparecem assim que os resultados forem carregados.'
    });
}
/** @param {{ metric: string, primary?: boolean, label: string, figure: string, figureText: string, statement?: string, visual?: string, short: string }} c */
function takeawayCard(c) {
    const roleCls = c.primary ? 'takeaway takeaway-primary' : 'takeaway takeaway-secondary';
    return ` <li class="${roleCls}" data-metric="${c.metric}"> <h3 class="takeaway-label">${c.label}</h3> <p class="takeaway-figure"><span aria-hidden="true">${c.figure}</span><span class="visually-hidden">${escapeHtml(c.figureText)}</span></p> ${c.statement ? `<p class="takeaway-statement">${c.statement}</p>` : ''}
            ${c.visual || ''} <p class="takeaway-qualifier takeaway-qualifier-short">${c.short}</p> </li>`;
}
/** @param {HeadlineInsights} insights @param {number} recentN */
function taskStatement(insights, recentN) {
    const counts = insights.families.map(f => f.sample.pairedTasks).filter(n => n > 0);
    if (counts.length === 0) return 'ganho na taxa de aprovação';
    const total = counts.reduce((sum, n) => sum + n, 0);
    if (recentN > 1 || (insights.pooled?.jobCount || 0) > insights.families.length) {
        return `ganho em ${fmtInt(total)} ${total === 1 ? 'tarefa' : 'tarefas'}`;
    }
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    if (min !== max) return `ganho em ${fmtInt(min)}–${fmtInt(max)} tarefas`;
    return `ganho em ${fmtInt(max)} ${max === 1 ? 'tarefa' : 'tarefas'}`;
}
/** @param {HeadlineInsights} insights */
function renderAgentTable(insights) {
    const body = document.getElementById('agent-table-body');
    const caption = document.getElementById('agent-table-caption');
    const windowNote = document.getElementById('hero-agents-window-note');
    if (!body) return;
    const n = insights.options.perAgentRecentN;
    if (caption) {
        caption.textContent = n === 1
            ? 'Última execução por modelo (últimos 7 dias; noturna ou linha de base 1.0) por família de agente. Sem guia → guiado; variação em pontos percentuais (pp).'
            : `${n} execuções mais recentes por modelo por família de agente, agrupadas. Sem guia → guiado; variação em pontos percentuais (pp).`;
    }
    if (windowNote) {
        windowNote.textContent = n === 1
            ? 'Última execução por modelo (modelos executados nos últimos 7 dias; noturna ou linha de base 1.0).'
            : `Últimas ${n} execuções por modelo agrupadas.`;
    }
    body.innerHTML = insights.families.map(f => {
        const overall = rateCell(f, f.overall, false);
        const a11y = rateCell(f, f.a11y, true);
        return ` <tr> <th scope="row">${getAgentBadge(f.id)}${escapeHtml(f.label)}</th> <td data-label="Pass rate"${overall.attrs}>${overall.html}</td> <td data-label="Accessibility"${a11y.attrs}>${a11y.html}</td> <td data-label="Sample">${sampleCell(f)}</td> </tr>`;
    }).join('');
}
/** @param {FamilyInsight} f @param {boolean} isA11y */
function singleJobHref(f, isA11y) {
    if (f.jobCount !== 1 || !f.latest.source) return '';
    const base = `dashboard.html?testId=${encodeURIComponent(f.latest.testId)}&source=${encodeURIComponent(f.latest.source)}`;
    return isA11y ? `${base}&mode=a11y&sort=a11y-desc` : base;
}
/** @param {RateComparison} r */
function checksCountText(r) {
    const u = r.unguidedTotal || 0;
    const g = r.guidedTotal || 0;
    if (u === 0 && g === 0) return '';
    if (u === g) return `${fmtInt(g)} ${g === 1 ? 'verificação' : 'verificações'}`;
    return `${fmtInt(u)} / ${fmtInt(g)} verificações`;
}
/** @param {FamilyInsight} f @param {RateComparison | null} r @param {boolean} isA11y
 * @returns {{ attrs: string, html: string }} */
function rateCell(f, r, isA11y) {
    if (!r || (r.guidedTotal === 0 && r.unguidedTotal === 0)) return { attrs: '', html: naCell() };
    const checksText = checksCountText(r);
    const uRate = roundedRate(r, 'unguided');
    const gRate = roundedRate(r, 'guided');
    const uplift = displayedUpliftPp(r);
    const stackHtml = ` <div class="agent-cell-stack"> <div class="metric-main"> <span class="metric-pair">${fmtPct(uRate)} → <strong>${fmtPct(gRate)}</strong></span> ${uplift === null ? naCell() : deltaChip(uplift)} </div> <span class="metric-sub">${escapeHtml(checksText)}</span> </div>`;
    const href = singleJobHref(f, isA11y);
    const subParts = isA11y
        ? ['Verificações automáticas de acessibilidade', f.a11y?.guideCount ? `${f.a11y.guideCount} ${f.a11y.guideCount === 1 ? 'guia' : 'guias'}` : '']
        : ['Taxa de aprovação', sampleSummaryText(f)];
    const uDetail = r.unguidedTotal > 0 ? `${fmtInt(r.unguidedPassed)}/${fmtInt(r.unguidedTotal)} verificações` : '';
    const gDetail = r.guidedTotal > 0 ? `${fmtInt(r.guidedPassed)}/${fmtInt(r.guidedTotal)} verificações` : '';
    const upliftRounded = uplift === null ? '' : String(uplift);
    const attrs = ` data-barbell-title="${escapeHtml(f.label)}" data-barbell-sub="${escapeHtml(subParts.filter(Boolean).join(' · '))}" data-barbell-kind="${isA11y ? 'agent-a11y' : 'agent-overall'}" data-barbell-u="${uRate === null ? '' : uRate}" data-barbell-g="${gRate === null ? '' : gRate}" data-barbell-uplift="${upliftRounded}" data-barbell-u-detail="${escapeHtml(uDetail)}" data-barbell-g-detail="${escapeHtml(gDetail)}"`;
    const html = href
        ? `<a href="${escapeHtml(href)}" class="agent-rate-trigger" interestfor="barbell-tooltip">${stackHtml}</a>`
        : `<button type="button" class="agent-rate-trigger" interestfor="barbell-tooltip">${stackHtml}</button>`;
    return { attrs, html };
}
/** @param {FamilyInsight} f */
function sampleTasksLabel(f) {
    const s = f.sample;
    if (s.excludedTasks > 0) return `${fmtInt(s.pairedTasks)}/${fmtInt(s.attemptedTasks)} tarefas`;
    if (s.pairedTasks > 0) return `${fmtInt(s.pairedTasks)} ${s.pairedTasks === 1 ? 'tarefa' : 'tarefas'}`;
    return '';
}
/** @param {FamilyInsight} f */
function sampleTrialsPerTaskLabel(f) {
    const s = f.sample;
    if (s.pairedTasks === 0 && s.attemptedTasks === 0) return '';
    return s.minTrialsPerTask === s.maxTrialsPerTask ? `×${s.maxTrialsPerTask}/tarefa` : `×${s.minTrialsPerTask}–${s.maxTrialsPerTask}/tarefa`;
}
/** @param {FamilyInsight} f */
function sampleSummaryText(f) {
    const allNightly = f.models.length <= 1 && f.jobs.every(s => !s.curated && s.testId.startsWith('nightly-'));
    return [
        f.jobCount > 1 ? `${f.jobCount} ${allNightly ? 'noites' : 'execuções'}` : '',
        sampleTasksLabel(f),
        sampleTrialsPerTaskLabel(f)
    ].filter(Boolean).join(' · ');
}
/** @param {FamilyInsight} f */
function sampleCell(f) {
    const s = f.sample;
    const allNightly = f.models.length <= 1 && f.jobs.every(job => !job.curated && job.testId.startsWith('nightly-'));
    const countNoun = allNightly ? (f.jobCount === 1 ? 'noite' : 'noites') : (f.jobCount === 1 ? 'execução' : 'execuções');
    const primaryParts = [
        f.jobCount > 1 ? `<span class="sample-nights">${f.jobCount} ${countNoun}</span>` : '',
        escapeHtml(sampleTasksLabel(f)),
        escapeHtml(sampleTrialsPerTaskLabel(f)),
        s.infraErrorCount !== null && s.infraErrorCount > 0
            ? `<span class="sample-warn">${escapeHtml(`${fmtInt(s.infraErrorCount)} ${s.infraErrorCount === 1 ? 'erro' : 'erros'}`)}</span>`
            : (s.infraErrorRate > 0 ? `<span class="sample-warn">${escapeHtml(`${s.infraErrorRate}% erro`)}</span>` : ''),
        s.pageLoadFailed > 0 ? `<span class="sample-warn">${escapeHtml(`${fmtInt(s.pageLoadFailed)} falha de carga`)}</span>` : '',
        s.unguidedLeakRate > 0 ? `<span class="sample-leak">${escapeHtml(`${s.unguidedLeakRate}% vazam.`)}</span>` : ''
    ].filter(Boolean);
    const jobsListHtml = f.jobs.map(job => {
        const model = shortModelName(job.model);
        const effort = job.reasoningEffort?.level ? ` (${job.reasoningEffort.level})` : '';
        const date = formatDateShort(job.timestamp);
        const badge = job.curated ? ' <span class="run-kind-badge curated">linha de base 1.0</span>' : '';
        return `<span class="sample-run-pill">${escapeHtml(model)}${escapeHtml(effort)} · <time>${escapeHtml(date)}</time>${badge}</span>`;
    }).join(' · ');
    return ` <div class="agent-cell-stack"> <span class="agent-sample-main">${primaryParts.join(' · ')}</span> ${jobsListHtml ? `<span class="metric-sub">${jobsListHtml}</span>` : ''} </div>`;
}
/** @param {number} v */
function fmtInt(v) { return Math.round(v || 0).toLocaleString('pt-BR'); }
function naCell() { return '<span class="na"><span aria-hidden="true">—</span><span class="visually-hidden">não disponível</span></span>'; }
/** @param {number} value */
function deltaChip(value) {
    const rounded = Math.sign(value) * Math.round(Math.abs(value || 0));
    const isFlat = rounded === 0;
    const isGood = rounded > 0;
    const cls = isFlat ? 'flat' : (isGood ? 'good' : 'cost');
    const glyph = isFlat ? '•' : (rounded > 0 ? '▲' : '▼');
    const visible = `${signed(rounded, 0)} pp`;
    const sr = isFlat ? 'sem alteração' : `${rounded > 0 ? 'aumento de' : 'queda de'} ${Math.abs(rounded)} pontos percentuais${isGood ? ', melhor' : ', pior'}`;
    return `<span class="delta ${cls}"><span class="glyph" aria-hidden="true">${glyph}</span><span aria-hidden="true">${visible}</span><span class="visually-hidden">${sr}</span></span>`;
}
/** @param {HeadlineInsights} insights */
function latestDateOf(insights) { return insights.latestTimestamp || ''; }
/** @param {string} model */
function shortModelName(model) { return (model || '').replace(/^(claude-|gemini-)/i, ''); }
/** @param {string} iso */
function formatDateShort(iso) {
    const formatted = formatJobDate(iso, { month: 'short', day: 'numeric' }, 'pt-BR');
    return formatted === '-' ? iso : formatted;
}
/** @param {number} v */
function fmtCompact(v) {
    return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.round(v || 0)).toLowerCase();
}
/** @param {string[]} names */
function joinNames(names) {
    if (names.length <= 1) return names.join('');
    if (names.length === 2) return `${names[0]} e ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}
/** @param {number | null} v @param {number} digits */
function signed(v, digits) {
    if (v === null) return '—';
    const r = Math.sign(v || 0) * Number(Math.abs(v || 0).toFixed(digits));
    if (r > 0) return `+${r}`;
    if (r < 0) return `−${Math.abs(r)}`;
    return '0';
}
/** @param {number | null} v */
function fmtPct(v) {
    if (v === null) return '—';
    return `${Math.round(v || 0)}%`;
}
/** @param {string} iso */
function formatDate(iso) {
    const formatted = formatJobDate(iso, { month: 'short', day: 'numeric', year: 'numeric' }, 'pt-BR');
    return formatted === '-' ? iso : formatted;
}
