export type Extreme = 'overheated' | 'cold';

interface HeatItem {
  key: string;
  score: number;
  share: number;
}

interface AccountItem {
  label: string;
  error: string | null;
}

export interface Message {
  title: string;
  body: string;
  tag: string;
}

const NAMES_SHOWN = 3;

function names(list: string[]): string {
  const shown =
    list.length > NAMES_SHOWN + 1 ? [...list.slice(0, NAMES_SHOWN), `${list.length - NAMES_SHOWN} more`] : list;
  return shown.length <= 2 ? shown.join(' and ') : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

const percent = (n: number): string => `${(n * 100).toFixed(1)}%`;

export function heatMessage(zone: Extreme, assets: HeatItem[]): Message {
  const sorted = [...assets].sort((a, b) => b.share - a.share);
  const share = sorted.reduce((sum, a) => sum + Math.max(0, a.share), 0);
  const portion = share > 0 ? `${percent(share)} of the portfolio.` : '';
  const single = sorted.length === 1;
  return {
    title: `${names(sorted.map((a) => a.key))} ${single ? 'is' : 'are'} ${zone}`,
    body: single ? [`Heat ${sorted[0]!.score.toFixed(0)}.`, portion].filter(Boolean).join(' ') : portion,
    tag: `heat-${zone}`,
  };
}

export function accountsMessage(accounts: AccountItem[]): Message {
  if (accounts.length === 1) {
    return { title: `${accounts[0]!.label} is out of date`, body: accounts[0]!.error ?? '', tag: 'accounts' };
  }
  return {
    title: `${accounts.length} accounts are out of date`,
    body: `${names(accounts.map((a) => a.label))}.`,
    tag: 'accounts',
  };
}

export const WELCOME: Message = {
  title: 'Notifications are on',
  body: 'This device hears when a holding turns overheated or cold, or an account stops updating.',
  tag: 'welcome',
};
