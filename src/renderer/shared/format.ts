import { formatTimestamp } from '../../shared/exporters';

export const formatMB = (bytes: number) => `${Math.round(bytes / 1_000_000)}\u00A0MB`;

export function formatSpeed(bps: number): string {
  return bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} MB` : `${Math.round(bps / 1000)} KB`;
}

export function formatDuration(ms: number, lang: string): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return lang === 'pt-BR' ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.max(1, Math.round(ms / 1000))} s`;
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function formatDate(ts: number, lang: string): string {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const time = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  if (d >= today) return (lang === 'pt-BR' ? 'Hoje, ' : 'Today, ') + time;
  if (d >= yesterday) return (lang === 'pt-BR' ? 'Ontem, ' : 'Yesterday, ') + time;
  return d.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }) + ', ' + time;
}

export { formatTimestamp };
