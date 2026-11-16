export const SOURCES = {
  rsi: {
    label: 'StockCharts ChartSchool: RSI',
    href: 'https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi',
  },
  ma: {
    label: 'StockCharts ChartSchool: moving averages',
    href: 'https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-averages-simple-and-exponential',
  },
  funding: {
    label: 'Binance: funding rates',
    href: 'https://www.binance.com/en/support/faq/introduction-to-binance-futures-funding-rates-360033525031',
  },
  openInterest: { label: 'Wikipedia: open interest', href: 'https://en.wikipedia.org/wiki/Open_interest' },
  fearGreed: {
    label: 'alternative.me: Fear & Greed Index',
    href: 'https://alternative.me/crypto/fear-and-greed-index/',
  },
  binanceKeys: {
    label: 'Binance: how to create API keys',
    href: 'https://www.binance.com/en/support/faq/how-to-create-api-keys-on-binance-360002502072',
  },
  bybitKeys: {
    label: 'Bybit: how to create your API key',
    href: 'https://www.bybit.com/en/help-center/article/How-to-create-your-API-key',
  },
  okxKeys: {
    label: 'OKX: API key creation',
    href: 'https://www.okx.com/docs-v5/en/#overview-api-key-creation',
  },
};

export const HELP = {
  rsi: {
    title: 'RSI',
    text: 'The Relative Strength Index compares the size of recent gains with recent losses over 14 periods, on a scale from 0 to 100. Above 70 is usually read as overbought, below 30 as oversold. Shown here on daily candles.',
    source: SOURCES.rsi,
  },
  rsiWeekly: {
    title: 'Weekly RSI',
    text: 'The same Relative Strength Index on weekly candles. It moves slower and shows the longer trend.',
    source: SOURCES.rsi,
  },
  funding: {
    title: 'Funding',
    text: 'Perpetual futures have no expiry, so longs and shorts pay each other a funding rate every few hours. A positive rate means longs pay shorts and leverage leans long. Shown as the three-day average per 8 hours. The usual resting rate on Binance is 0.01%.',
    source: SOURCES.funding,
  },
  ma200: {
    title: '200-day average',
    text: 'How far the price is above or below its average close over the last 200 days. A price far above it has run ahead of its long trend.',
    source: SOURCES.ma,
  },
  openInterest: {
    title: 'Open interest',
    text: 'The number of futures contracts still open. When it grows while the price rises, new leverage is coming in.',
    source: SOURCES.openInterest,
  },
  heat: {
    title: 'Heat',
    text: "Stashboard's own score from 0 (cold) to 100 (overheated). It blends RSI, funding, the price against its 200-day average and open interest. It describes market conditions and is not advice.",
    source: { label: 'How heat is scored', href: '#signals' },
  },
  fearGreed: {
    title: 'Fear & Greed',
    text: "Rates the crypto market's mood from 0 (extreme fear) to 100 (extreme greed), from volatility, momentum and volume, social media, Bitcoin dominance and search trends. Updated once a day.",
    source: SOURCES.fearGreed,
  },
};

export const FEAR_GREED_TONE = [
  [25, 'cold'],
  [45, 'cool'],
  [56, 'neutral'],
  [76, 'warm'],
  [101, 'hot'],
];
export const fearGreedTone = (value) => FEAR_GREED_TONE.find(([limit]) => value < limit)[1];
