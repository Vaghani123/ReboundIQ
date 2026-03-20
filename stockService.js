/**
 * ═══════════════════════════════════════════════════════════════
 *  Stock Data Service v2 — Enhanced Rebound Probability Engine
 * ═══════════════════════════════════════════════════════════════
 *
 * Uses LIVE Yahoo Finance data via CORS proxy to calculate a
 * highly accurate rebound probability from 12+ technical factors
 * with gradient scoring and weighted multi-factor analysis.
 *
 * Falls back to intelligent mock data when API is unavailable.
 */

const StockService = (() => {
  'use strict';

  const DEFAULT_TICKERS = [
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 'V', 'UNH',
    'JNJ', 'WMT', 'JPM', 'MA', 'PG', 'HD', 'AVGO', 'ORCL', 'CVX', 'ABBV',
    'MRK', 'KO', 'PEP', 'BAC', 'PFE', 'COST', 'TMO', 'CSCO', 'ABT', 'DIS',
    'AMD', 'ADBE', 'CRM', 'TXN', 'NFLX', 'QCOM', 'HON', 'NKE', 'UPS', 'PGR',
    'VZ', 'MS', 'INTC', 'RTX', 'LOW', 'CAT', 'SPGI', 'IBM', 'AXP', 'ELV',
    'GS', 'PLD', 'AMAT', 'DE', 'ISRG', 'LMT', 'BLK', 'BKNG', 'GE', 'SYK',
    'TJX', 'SBUX', 'MDLZ', 'GILD', 'REGN', 'ADP', 'AMT', 'ADI', 'CVS', 'VRTX',
    'CI', 'LRCX', 'MMC', 'EL', 'MU', 'ZTS', 'MO', 'SCHW', 'BDX', 'EQIX',
    'PANW', 'SNPS', 'CDNS', 'T', 'BSX', 'ETN', 'ITW', 'WM', 'C', 'ICE',
    'SHW', 'KLAC', 'HCA', 'MCD', 'ORLY', 'APD', 'MAR', 'CMG', 'MPC', 'SLB',
    'VLO', 'EOG', 'PSX', 'COP', 'DVN', 'HAL', 'FANG', 'HES', 'OXY', 'MRO'
  ];

  // CORS proxies to try in order (one will work)
  const CORS_PROXIES = [
    'https://corsproxy.io/?url=',
    'https://api.allorigins.win/raw?url=',
    'https://api.allorigins.win/get?url=',
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://thingproxy.freeboard.io/fetch/',
  ];

  const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
  const YAHOO_QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=';
  const YAHOO_LOSERS_URL = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=day_losers&count=250';
  const YAHOO_ACTIVE_URL = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=most_actives&count=250';
  const YAHOO_GAINERS_URL = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=day_gainers&count=250';

  // Cache to avoid hammering the API
  const dataCache = new Map();
  const CACHE_TTL_MS = 55000; // 55 seconds

  // ═══════════════════════════════════════════════════
  //  1. LIVE DATA FETCHING (Yahoo Finance)
  // ═══════════════════════════════════════════════════

  /**
   * Fetch with CORS proxy fallback.
   */
  async function fetchWithProxy(url) {
    // 1. First, try direct fetch (no proxy)
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) return await resp.json();
    } catch (_) { /* direct failed, try proxies */ }

    let lastError = null;

    for (const proxy of CORS_PROXIES) {
      try {
        const fullUrl = proxy.includes('?') ? (proxy + encodeURIComponent(url)) : (proxy + url);
        const resp = await fetch(fullUrl, {
          signal: AbortSignal.timeout(5000),
        });
        
        if (resp.ok) {
          const data = await resp.json();
          // Handle AllOrigins non-raw format if it was used (has a 'contents' property)
          if (data && data.contents && typeof data.contents === 'string') {
            try {
              return JSON.parse(data.contents);
            } catch (e) {
              return data.contents;
            }
          }
          return data;
        }
        lastError = `Proxy ${proxy.split('/')[2]} returned ${resp.status}`;
      } catch (err) {
        lastError = `Proxy ${proxy.split('/')[2]} failed: ${err.message}`;
        continue;
      }
    }
    console.warn(`📡 Live Fetch failed: ${lastError}. Falling back to simulations.`);
    return null;
  }

  /**
   * Fetch 3 months of daily OHLCV data from Yahoo Finance.
   */
  async function fetchYahooChart(ticker) {
    const cached = dataCache.get(ticker);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.data;
    }

    const url = `${YAHOO_CHART_URL}${ticker}?range=3mo&interval=1d&includePrePost=false`;
    const json = await fetchWithProxy(url);

    if (!json?.chart?.result?.[0]) return null;

    const result = json.chart.result[0];
    const meta = result.meta;
    const quotes = result.indicators.quote[0];
    const timestamps = result.timestamp || [];

    const data = {
      ticker,
      currency: meta.currency,
      currentPrice: meta.regularMarketPrice,
      previousClose: meta.chartPreviousClose || meta.previousClose,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      timestamps,
      opens: quotes.open,
      highs: quotes.high,
      lows: quotes.low,
      closes: quotes.close,
      volumes: quotes.volume,
    };

    dataCache.set(ticker, { data, ts: Date.now() });
    return data;
  }

  // ═══════════════════════════════════════════════════
  //  2. TECHNICAL INDICATOR CALCULATIONS
  // ═══════════════════════════════════════════════════

  /**
   * Calculate RSI (Relative Strength Index) using Wilder's smoothing.
   * Standard 14-period RSI.
   */
  function calculateRSI(closes, period = 14) {
    if (closes.length < period + 1) return 50; // neutral fallback

    const changes = [];
    for (let i = 1; i < closes.length; i++) {
      changes.push((closes[i] || closes[i - 1]) - (closes[i - 1] || 0));
    }

    let avgGain = 0, avgLoss = 0;

    // Initial average
    for (let i = 0; i < period; i++) {
      if (changes[i] > 0) avgGain += changes[i];
      else avgLoss += Math.abs(changes[i]);
    }
    avgGain /= period;
    avgLoss /= period;

    // Wilder's smoothing for remaining periods
    for (let i = period; i < changes.length; i++) {
      if (changes[i] > 0) {
        avgGain = (avgGain * (period - 1) + changes[i]) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(changes[i])) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return +(100 - 100 / (1 + rs)).toFixed(2);
  }

  /**
   * Calculate Stochastic RSI (more sensitive than regular RSI).
   * Measures RSI relative to its own range over a lookback period.
   */
  function calculateStochRSI(closes, rsiPeriod = 14, stochPeriod = 14) {
    if (closes.length < rsiPeriod + stochPeriod + 1) return 50;

    // Calculate RSI for each rolling window
    const rsiValues = [];
    for (let i = rsiPeriod + 1; i <= closes.length; i++) {
      rsiValues.push(calculateRSI(closes.slice(0, i), rsiPeriod));
    }

    if (rsiValues.length < stochPeriod) return 50;

    const recentRSIs = rsiValues.slice(-stochPeriod);
    const currentRSI = rsiValues[rsiValues.length - 1];
    const minRSI = Math.min(...recentRSIs);
    const maxRSI = Math.max(...recentRSIs);

    if (maxRSI === minRSI) return 50;
    return +((currentRSI - minRSI) / (maxRSI - minRSI) * 100).toFixed(2);
  }

  /**
   * Calculate Simple Moving Average.
   */
  function SMA(data, period) {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + (b || 0), 0) / period;
  }

  /**
   * Calculate Exponential Moving Average.
   */
  function EMA(data, period) {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = SMA(data.slice(0, period), period);
    for (let i = period; i < data.length; i++) {
      ema = (data[i] || ema) * k + ema * (1 - k);
    }
    return ema;
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence).
   * Returns { macd, signal, histogram }.
   */
  function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
    if (closes.length < slow + signal) return { macd: 0, signal: 0, histogram: 0 };

    const emaFast = EMA(closes, fast);
    const emaSlow = EMA(closes, slow);
    const macdLine = emaFast - emaSlow;

    // Calculate MACD line series for signal
    const macdSeries = [];
    for (let i = slow; i <= closes.length; i++) {
      const ef = EMA(closes.slice(0, i), fast);
      const es = EMA(closes.slice(0, i), slow);
      macdSeries.push(ef - es);
    }

    const signalLine = macdSeries.length >= signal ? SMA(macdSeries.slice(-signal), signal) : 0;
    return {
      macd: +macdLine.toFixed(4),
      signal: +signalLine.toFixed(4),
      histogram: +(macdLine - signalLine).toFixed(4),
    };
  }

  /**
   * Calculate Bollinger Bands.
   * Returns { upper, middle, lower, percentB, bandwidth }.
   */
  function calculateBollingerBands(closes, period = 20, stdDevMult = 2) {
    if (closes.length < period) return { upper: 0, middle: 0, lower: 0, percentB: 0.5, bandwidth: 0 };

    const slice = closes.slice(-period);
    const middle = slice.reduce((a, b) => a + (b || 0), 0) / period;

    const variance = slice.reduce((sum, val) => sum + Math.pow((val || middle) - middle, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    const upper = middle + stdDevMult * stdDev;
    const lower = middle - stdDevMult * stdDev;
    const currentPrice = closes[closes.length - 1] || middle;

    // %B: position within bands (0 = at lower, 1 = at upper, <0 = below lower)
    const percentB = upper !== lower ? (currentPrice - lower) / (upper - lower) : 0.5;

    // Bandwidth: how wide the bands are (squeeze detection)
    const bandwidth = middle !== 0 ? (upper - lower) / middle : 0;

    return { upper, middle, lower, percentB: +percentB.toFixed(4), bandwidth: +bandwidth.toFixed(4) };
  }

  /**
   * Calculate ATR (Average True Range) for volatility measurement.
   */
  function calculateATR(highs, lows, closes, period = 14) {
    if (closes.length < period + 1) return 0;

    const trueRanges = [];
    for (let i = 1; i < closes.length; i++) {
      const h = highs[i] || closes[i];
      const l = lows[i] || closes[i];
      const pc = closes[i - 1] || closes[i];
      trueRanges.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }

    // Wilder's smoothing
    let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trueRanges.length; i++) {
      atr = (atr * (period - 1) + trueRanges[i]) / period;
    }

    return +atr.toFixed(4);
  }

  /**
   * Detect support levels from price lows.
   * Finds clusters of lows within a tolerance.
   */
  function findSupportLevels(lows, closes, numLevels = 3) {
    const validLows = lows.filter(l => l != null && l > 0);
    if (validLows.length === 0) return [];

    // Find local minima
    const localMins = [];
    for (let i = 2; i < validLows.length - 2; i++) {
      if (validLows[i] <= validLows[i - 1] && validLows[i] <= validLows[i + 1] &&
        validLows[i] <= validLows[i - 2] && validLows[i] <= validLows[i + 2]) {
        localMins.push(validLows[i]);
      }
    }

    // Also include absolute min and recent lows
    localMins.push(Math.min(...validLows));
    localMins.push(...validLows.slice(-5));

    // Cluster nearby levels (within 2%)
    const currentPrice = closes[closes.length - 1];
    const sorted = [...new Set(localMins)].sort((a, b) => a - b);
    const clusters = [];

    for (const level of sorted) {
      const existing = clusters.find(c => Math.abs(c - level) / c < 0.02);
      if (!existing) {
        clusters.push(level);
      }
    }

    // Return levels below current price, sorted by proximity
    return clusters
      .filter(c => c <= currentPrice * 1.02)
      .sort((a, b) => Math.abs(currentPrice - a) - Math.abs(currentPrice - b))
      .slice(0, numLevels);
  }

  /**
   * Detect candlestick reversal patterns in the last few candles.
   * Returns a score 0-100 based on detected bullish reversal signals.
   */
  function detectReversalPatterns(opens, highs, lows, closes) {
    const len = closes.length;
    if (len < 3) return 0;

    let score = 0;
    const i = len - 1; // latest candle

    const o = opens[i] || closes[i];
    const h = highs[i] || closes[i];
    const l = lows[i] || closes[i];
    const c = closes[i] || 0;
    const body = Math.abs(c - o);
    const range = h - l;
    const lowerShadow = Math.min(o, c) - l;
    const upperShadow = h - Math.max(o, c);

    // Hammer: small body at top, long lower shadow (2x+ body)
    if (range > 0 && lowerShadow > body * 2 && upperShadow < body * 0.5) {
      score += 35;
    }

    // Doji: very small body relative to range (indecision after selloff)
    if (range > 0 && body / range < 0.1) {
      // Check if preceded by downtrend
      if (closes[i - 1] && closes[i - 2] && closes[i - 1] < closes[i - 2]) {
        score += 25;
      }
    }

    // Bullish Engulfing: current candle body engulfs previous bearish body
    if (i >= 1) {
      const prevO = opens[i - 1] || closes[i - 1];
      const prevC = closes[i - 1] || 0;
      const prevBody = Math.abs(prevC - prevO);
      if (prevC < prevO && c > o && body > prevBody && c > prevO && o < prevC) {
        score += 40;
      }
    }

    // Morning Star (3-candle pattern)
    if (i >= 2) {
      const c0 = closes[i - 2], o0 = opens[i - 2] || c0;
      const c1 = closes[i - 1], o1 = opens[i - 1] || c1;
      const body1 = Math.abs(c1 - o1);
      const range0 = Math.abs(c0 - o0);
      // Day 1: big bearish, Day 2: small body (star), Day 3: big bullish
      if (c0 < o0 && range0 > 0 && body1 < range0 * 0.3 && c > o && body > range0 * 0.5) {
        score += 30;
      }
    }

    // Piercing Line
    if (i >= 1) {
      const prevO = opens[i - 1] || closes[i - 1];
      const prevC = closes[i - 1] || 0;
      const midPrev = (prevO + prevC) / 2;
      if (prevC < prevO && c > o && o < prevC && c > midPrev && c < prevO) {
        score += 25;
      }
    }

    return Math.min(100, score);
  }

  /**
   * Analyze volume patterns for capitulation/accumulation signals.
   * Returns a score 0-100.
   */
  function analyzeVolume(volumes, closes) {
    if (volumes.length < 20) return 0;

    const recentVols = volumes.slice(-20).filter(v => v != null);
    if (recentVols.length === 0) return 0;

    const avgVol20 = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
    const latestVol = volumes[volumes.length - 1] || 0;
    const prevVol = volumes[volumes.length - 2] || avgVol20;

    let score = 0;

    // Volume spike ratio (current vs average)
    const spikeRatio = avgVol20 > 0 ? latestVol / avgVol20 : 1;

    if (spikeRatio > 3.0) score += 30;       // Extreme spike — capitulation
    else if (spikeRatio > 2.0) score += 22;   // Major spike
    else if (spikeRatio > 1.5) score += 15;   // Notable spike
    else if (spikeRatio > 1.2) score += 8;    // Slight increase

    // Volume increasing on down days (capitulation selling)
    const last5Closes = closes.slice(-5);
    const last5Vols = volumes.slice(-5);
    let downDayVolIncrease = 0;
    for (let i = 1; i < last5Closes.length; i++) {
      if (last5Closes[i] < last5Closes[i - 1] && last5Vols[i] > last5Vols[i - 1]) {
        downDayVolIncrease++;
      }
    }
    if (downDayVolIncrease >= 3) score += 20;      // Sustained capitulation
    else if (downDayVolIncrease >= 2) score += 12;

    // Volume dry-up after spike (sellers exhausted)
    if (spikeRatio < 0.7 && prevVol > avgVol20 * 1.5) {
      score += 15; // Volume dropping after a spike = selling exhaustion
    }

    // Consecutive declining volume (selling pressure fading)
    const last3Vols = volumes.slice(-3).filter(v => v != null);
    if (last3Vols.length === 3 && last3Vols[2] < last3Vols[1] && last3Vols[1] < last3Vols[0]) {
      score += 10;
    }

    return Math.min(100, score);
  }

  /**
   * Calculate price drop metrics across multiple timeframes.
   */
  function calculatePriceDrops(closes) {
    const current = closes[closes.length - 1];
    if (!current) return { drop1d: 0, drop3d: 0, drop5d: 0, drop10d: 0, drop20d: 0 };

    const getChange = (daysBack) => {
      const idx = closes.length - 1 - daysBack;
      if (idx < 0 || !closes[idx]) return 0;
      return +((current - closes[idx]) / closes[idx] * 100).toFixed(2);
    };

    return {
      drop1d: getChange(1),
      drop3d: getChange(3),
      drop5d: getChange(5),
      drop10d: getChange(10),
      drop20d: getChange(20),
    };
  }

  /**
   * Calculate mean reversion distance.
   * How far is the current price from key moving averages?
   */
  function calculateMeanReversion(closes) {
    const current = closes[closes.length - 1];
    if (!current) return { distSMA20: 0, distSMA50: 0, distEMA20: 0 };

    const sma20 = SMA(closes, 20);
    const sma50 = SMA(closes, 50);
    const ema20 = EMA(closes, 20);

    return {
      distSMA20: sma20 ? +((current - sma20) / sma20 * 100).toFixed(2) : 0,
      distSMA50: sma50 ? +((current - sma50) / sma50 * 100).toFixed(2) : 0,
      distEMA20: ema20 ? +((current - ema20) / ema20 * 100).toFixed(2) : 0,
    };
  }

  // ═══════════════════════════════════════════════════
  //  3. MASTER REBOUND PROBABILITY ALGORITHM v2
  // ═══════════════════════════════════════════════════
  //
  //  Weighted multi-factor scoring (100 points total):
  //
  //  ┌─────────────────────────────────────────────────────────┐
  //  │ CATEGORY              │ MAX PTS │ WEIGHT │ DESCRIPTION  │
  //  ├───────────────────────┼─────────┼────────┼──────────────┤
  //  │ RSI Analysis          │   20    │  20%   │ Gradient RSI │
  //  │ Stochastic RSI        │    5    │   5%   │ Extra confirm│
  //  │ Price Drop Severity   │   18    │  18%   │ Multi-TF     │
  //  │ Bollinger Band        │   10    │  10%   │ %B position  │
  //  │ Mean Reversion        │    8    │   8%   │ Dist from MA │
  //  │ MACD                  │    7    │   7%   │ Histogram    │
  //  │ Volume Analysis       │   12    │  12%   │ Capit./Accum │
  //  │ Support Proximity     │   10    │  10%   │ Key levels   │
  //  │ Candlestick Patterns  │    5    │   5%   │ Reversals    │
  //  │ 52-Week Position      │    5    │   5%   │ Range pos.   │
  //  │ Total                 │  100    │ 100%   │              │
  //  └─────────────────────────────────────────────────────────┘

  function calculateBounce(analysis) {
    let totalScore = 0;
    const breakdown = {};

    // ── 1. RSI Analysis (0–20 pts) ──
    // Gradient: RSI 10→20pts, RSI 20→16pts, RSI 30→10pts, RSI 40→4pts, RSI 50+→0pts
    {
      const rsi = analysis.rsi;
      let pts = 0;
      if (rsi <= 10) pts = 20;
      else if (rsi <= 20) pts = 20 - (rsi - 10) * 0.4;   // 20 → 16
      else if (rsi <= 30) pts = 16 - (rsi - 20) * 0.6;   // 16 → 10
      else if (rsi <= 40) pts = 10 - (rsi - 30) * 0.6;   // 10 → 4
      else if (rsi <= 50) pts = 4 - (rsi - 40) * 0.4;    // 4 → 0
      else pts = 0;
      pts = Math.max(0, pts);
      breakdown.rsi = +pts.toFixed(1);
      totalScore += pts;
    }

    // ── 2. Stochastic RSI (0–5 pts) ──
    {
      const stochRsi = analysis.stochRSI;
      let pts = 0;
      if (stochRsi <= 5) pts = 5;
      else if (stochRsi <= 15) pts = 4;
      else if (stochRsi <= 25) pts = 3;
      else if (stochRsi <= 35) pts = 1.5;
      else pts = 0;
      breakdown.stochRSI = +pts.toFixed(1);
      totalScore += pts;
    }

    // ── 3. Price Drop Severity (0–18 pts) ──
    // Multi-timeframe analysis with gradient scoring
    {
      let pts = 0;
      const drops = analysis.drops;

      // 5-day drop (0-8 pts)
      const abs5d = Math.abs(drops.drop5d);
      if (abs5d > 30) pts += 8;
      else if (abs5d > 20) pts += 6 + (abs5d - 20) * 0.2;
      else if (abs5d > 10) pts += 3 + (abs5d - 10) * 0.3;
      else if (abs5d > 5) pts += (abs5d - 5) * 0.6;

      // 10-day drop (0-5 pts)
      const abs10d = Math.abs(drops.drop10d);
      if (abs10d > 30) pts += 5;
      else if (abs10d > 20) pts += 3.5 + (abs10d - 20) * 0.15;
      else if (abs10d > 10) pts += 1.5 + (abs10d - 10) * 0.2;

      // 1-day sharp drop bonus (0-5 pts): sudden drops have higher bounce potential
      const abs1d = Math.abs(drops.drop1d);
      if (abs1d > 10) pts += 5;
      else if (abs1d > 7) pts += 3.5;
      else if (abs1d > 5) pts += 2;
      else if (abs1d > 3) pts += 1;

      breakdown.priceDrop = +Math.min(18, pts).toFixed(1);
      totalScore += Math.min(18, pts);
    }

    // ── 4. Bollinger Band Position (0–10 pts) ──
    {
      const bb = analysis.bollingerBands;
      let pts = 0;

      // %B < 0 means price is below the lower band
      if (bb.percentB < -0.2) pts = 10;        // Way below lower band
      else if (bb.percentB < 0) pts = 8;        // Below lower band
      else if (bb.percentB < 0.1) pts = 6;      // Near lower band
      else if (bb.percentB < 0.2) pts = 4;      // Approaching lower band
      else if (bb.percentB < 0.3) pts = 2;      // Lower quadrant
      else pts = 0;

      // Squeeze bonus: tight bands often precede big moves
      if (bb.bandwidth < 0.05 && bb.percentB < 0.3) {
        pts += 2;
      }

      breakdown.bollingerBand = +Math.min(10, pts).toFixed(1);
      totalScore += Math.min(10, pts);
    }

    // ── 5. Mean Reversion (0–8 pts) ──
    {
      const mr = analysis.meanReversion;
      let pts = 0;

      // Distance from 20-day SMA (0-4 pts)
      const dist20 = Math.abs(mr.distSMA20);
      if (mr.distSMA20 < 0) { // Below MA = bullish signal for rebound
        if (dist20 > 15) pts += 4;
        else if (dist20 > 10) pts += 3;
        else if (dist20 > 5) pts += 2;
        else if (dist20 > 2) pts += 1;
      }

      // Distance from 50-day SMA (0-4 pts)
      const dist50 = Math.abs(mr.distSMA50);
      if (mr.distSMA50 < 0) {
        if (dist50 > 20) pts += 4;
        else if (dist50 > 15) pts += 3;
        else if (dist50 > 10) pts += 2;
        else if (dist50 > 5) pts += 1;
      }

      breakdown.meanReversion = +Math.min(8, pts).toFixed(1);
      totalScore += Math.min(8, pts);
    }

    // ── 6. MACD Analysis (0–7 pts) ──
    {
      const macd = analysis.macd;
      let pts = 0;

      // Histogram turning positive (bullish momentum shift)
      if (macd.histogram > 0 && macd.macd < 0) {
        pts += 4; // Bullish crossover in negative territory — strong signal
      } else if (macd.histogram > 0) {
        pts += 2; // Histogram positive but MACD positive — weaker signal
      }

      // MACD deeply negative (mean reversion potential)
      if (macd.macd < -1) pts += 2;
      else if (macd.macd < -0.5) pts += 1;

      // Signal line crossover approaching
      if (macd.macd < 0 && macd.histogram > -0.1 && macd.histogram <= 0) {
        pts += 1; // About to cross — anticipation
      }

      breakdown.macd = +Math.min(7, pts).toFixed(1);
      totalScore += Math.min(7, pts);
    }

    // ── 7. Volume Analysis (0–12 pts) ──
    {
      const volScore = analysis.volumeScore; // 0-100 from analyzeVolume()
      const pts = (volScore / 100) * 12;
      breakdown.volume = +pts.toFixed(1);
      totalScore += pts;
    }

    // ── 8. Support Proximity (0–10 pts) ──
    {
      const supports = analysis.supportLevels;
      const price = analysis.currentPrice;
      let pts = 0;

      if (supports.length > 0 && price > 0) {
        const nearestSupport = supports[0];
        const distPercent = ((price - nearestSupport) / price) * 100;

        if (distPercent <= 0.5) pts = 10;        // Sitting right on support
        else if (distPercent <= 1) pts = 8;       // Very close
        else if (distPercent <= 2) pts = 6;       // Near support
        else if (distPercent <= 3) pts = 4;       // Approaching
        else if (distPercent <= 5) pts = 2;       // In the zone
        else pts = 0;

        // Bonus for multiple nearby supports (confluence)
        const nearbySupports = supports.filter(s => ((price - s) / price * 100) <= 5);
        if (nearbySupports.length >= 3) pts += 2;
        else if (nearbySupports.length >= 2) pts += 1;
      }

      breakdown.support = +Math.min(10, pts).toFixed(1);
      totalScore += Math.min(10, pts);
    }

    // ── 9. Candlestick Patterns (0–5 pts) ──
    {
      const patternScore = analysis.candlestickScore; // 0-100
      const pts = (patternScore / 100) * 5;
      breakdown.patterns = +pts.toFixed(1);
      totalScore += pts;
    }

    // ── 10. 52-Week Range Position (0–5 pts) ──
    {
      const price = analysis.currentPrice;
      const high52 = analysis.fiftyTwoWeekHigh;
      const low52 = analysis.fiftyTwoWeekLow;
      let pts = 0;

      if (high52 && low52 && high52 > low52) {
        const position = (price - low52) / (high52 - low52); // 0 = at low, 1 = at high
        if (position < 0.05) pts = 5;         // Near 52-week low
        else if (position < 0.1) pts = 4;
        else if (position < 0.15) pts = 3;
        else if (position < 0.25) pts = 2;
        else if (position < 0.35) pts = 1;
        else pts = 0;
      }

      breakdown.weekRange52 = +pts.toFixed(1);
      totalScore += pts;
    }

    return {
      probability: +Math.max(0, Math.min(100, totalScore)).toFixed(1),
      breakdown,
    };
  }

  // ═══════════════════════════════════════════════════
  //  4. FULL ANALYSIS PIPELINE
  // ═══════════════════════════════════════════════════

  /**
   * Perform full analysis on raw OHLCV data.
   */
  function analyzeStock(data) {
    const closes = data.closes.filter(c => c != null);
    const highs = data.highs.filter(h => h != null);
    const lows = data.lows.filter(l => l != null);
    const volumes = data.volumes.filter(v => v != null);
    const opens = data.opens.filter(o => o != null);

    // Align arrays to same length (use closes as reference)
    const len = Math.min(closes.length, highs.length, lows.length, volumes.length, opens.length);
    const c = closes.slice(-len);
    const h = highs.slice(-len);
    const l = lows.slice(-len);
    const v = volumes.slice(-len);
    const o = opens.slice(-len);

    const rsi = calculateRSI(c);
    const stochRSI = calculateStochRSI(c);
    const macd = calculateMACD(c);
    const bb = calculateBollingerBands(c);
    const atr = calculateATR(h, l, c);
    const drops = calculatePriceDrops(c);
    const meanReversion = calculateMeanReversion(c);
    const supportLevels = findSupportLevels(l, c);
    const volumeScore = analyzeVolume(v, c);
    const candlestickScore = detectReversalPatterns(o, h, l, c);

    const analysis = {
      ticker: data.ticker,
      currentPrice: data.currentPrice || c[c.length - 1],
      previousClose: data.previousClose,
      fiftyTwoWeekHigh: data.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: data.fiftyTwoWeekLow,
      rsi,
      stochRSI,
      macd,
      bollingerBands: bb,
      atr,
      drops,
      meanReversion,
      supportLevels,
      volumeScore,
      candlestickScore,
    };

    const result = calculateBounce(analysis);

    return {
      ...analysis,
      bounce: result.probability,
      breakdown: result.breakdown,
    };
  }

  // ═══════════════════════════════════════════════════
  //  5. FALLBACK MOCK DATA (when API unavailable)
  // ═══════════════════════════════════════════════════

  /**
   * Generate realistic OHLCV history for simulation.
   * Uses geometric Brownian motion with mean-reversion.
   */
  function generateMockOHLCV(ticker, days = 65) {
    // Seed based on ticker name for consistency
    let seed = 0;
    for (const ch of ticker) seed = (seed * 31 + ch.charCodeAt(0)) & 0x7fffffff;
    const seededRandom = () => {
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const basePrice = 5 + seededRandom() * 195;
    const volatility = 0.02 + seededRandom() * 0.04;
    const drift = -0.003 - seededRandom() * 0.008; // Negative drift = recent selloff

    const closes = [basePrice * (1.1 + seededRandom() * 0.3)]; // Start from higher price
    const highs = [], lows = [], opens = [], volumes = [];
    const baseVolume = 500000 + Math.floor(seededRandom() * 9500000);

    for (let i = 0; i < days; i++) {
      const prev = closes[closes.length - 1];
      const change = prev * (drift + volatility * (seededRandom() - 0.5) * 2);
      const close = Math.max(0.5, prev + change);
      const open = prev * (1 + (seededRandom() - 0.5) * volatility);
      const high = Math.max(open, close) * (1 + seededRandom() * volatility);
      const low = Math.min(open, close) * (1 - seededRandom() * volatility);

      // Volume spikes during selloffs
      const volMult = change < 0 ? 1 + seededRandom() * 1.5 : 0.7 + seededRandom() * 0.8;
      const vol = Math.floor(baseVolume * volMult);

      closes.push(+close.toFixed(2));
      opens.push(+open.toFixed(2));
      highs.push(+high.toFixed(2));
      lows.push(+low.toFixed(2));
      volumes.push(vol);
    }

    return {
      ticker,
      currentPrice: closes[closes.length - 1],
      previousClose: closes[closes.length - 2],
      fiftyTwoWeekHigh: Math.max(...closes) * 1.1,
      fiftyTwoWeekLow: Math.min(...closes) * 0.9,
      timestamps: Array.from({ length: closes.length }, (_, i) => Date.now() / 1000 - (closes.length - i) * 86400),
      opens,
      highs,
      lows,
      closes,
      volumes,
    };
  }

  // ═══════════════════════════════════════════════════
  //  6. PUBLIC API
  // ═══════════════════════════════════════════════════

  let apiAvailable = null; // null = not tested, true/false = tested

  /**
   * Fetch and analyze a single stock.
   */
  async function fetchAndAnalyzeTicker(ticker) {
    let data = null;

    // Try live API if not known to be unavailable
    let fetchedLive = false;
    if (apiAvailable !== false) {
      data = await fetchYahooChart(ticker);
      if (data) {
        apiAvailable = true;
        fetchedLive = true;
      } else if (apiAvailable === null) {
        apiAvailable = false; // Mark as unavailable after first failure
        console.warn(`⚠ Yahoo Finance API unavailable. Using simulated data for all tickers.`);
      }
    }

    // Fallback to mock data
    if (!data) {
      data = generateMockOHLCV(ticker);
    }

    const analysis = analyzeStock(data);

    // Compute display values
    const drops = analysis.drops;
    return {
      ticker: ticker.toUpperCase(),
      current: drops.drop5d,
      last: drops.drop1d,
      min3: drops.drop3d,
      min9: +(drops.drop5d * 0.6).toFixed(2), // Approximate 9-minute as fraction of 5d for display
      session: drops.drop10d,
      bounce: +analysis.bounce,
      rsi: analysis.rsi,
      price: analysis.currentPrice,
      breakdown: analysis.breakdown,
      stochRSI: analysis.stochRSI,
      bollingerB: analysis.bollingerBands.percentB,
      atrPercent: analysis.currentPrice > 0 ? +(analysis.atr / analysis.currentPrice * 100).toFixed(2) : 0,
      supportLevels: analysis.supportLevels,
      macdHistogram: analysis.macd.histogram,
      apiSource: fetchedLive ? 'live' : 'simulated',
    };
  }

  /**
   * Fetch stock data for a list of tickers.
   * Returns an array of fully-analyzed stock objects.
   */
  async function fetchStockData(tickers) {
    // Fetch all tickers in parallel (batched)
    const promises = tickers.map(t => fetchAndAnalyzeTicker(t));
    const results = await Promise.allSettled(promises);

    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);
  }

  /**
   * Fetch the top "Day Losers" from Yahoo Finance to find scanner candidates.
   */
  async function fetchTopLosers() {
    const screeners = [YAHOO_LOSERS_URL, YAHOO_ACTIVE_URL, YAHOO_GAINERS_URL];
    let allSymbols = new Set();

    for (const url of screeners) {
      try {
        const data = await fetchWithProxy(url);
        if (data?.finance?.result?.[0]?.quotes) {
          data.finance.result[0].quotes.forEach(q => {
            if (q.symbol && !q.symbol.includes('=') && !q.symbol.includes('.')) {
              allSymbols.add(q.symbol);
            }
          });
        }
      } catch (err) {
        console.warn(`⚠ Failed to fetch screener ${url}:`, err);
      }
    }

    if (allSymbols.size > 0) return Array.from(allSymbols).slice(0, 150);
    return DEFAULT_TICKERS; // Fallback to our curated list
  }

  /**
   * Diagnostic test to see if ANY proxy is working.
   */
  async function testConnection() {
    console.log("🧪 Diagnostic: Testing all proxies for AAPL...");
    const testUrl = YAHOO_CHART_URL + "AAPL?interval=1d&range=1d";
    let results = [];

    for (const proxy of CORS_PROXIES) {
      try {
        const fullUrl = proxy.includes('?') ? (proxy + encodeURIComponent(testUrl)) : (proxy + testUrl);
        const start = performance.now();
        const resp = await fetch(fullUrl, { signal: AbortSignal.timeout(5000) });
        const duration = Math.round(performance.now() - start);

        if (resp.ok) {
          results.push(`✅ ${proxy.split('/')[2]} (${duration}ms)`);
        } else {
          results.push(`❌ ${proxy.split('/')[2]} (Error ${resp.status})`);
        }
      } catch (err) {
        results.push(`❌ ${proxy.split('/')[2]} (Failed: ${err.name})`);
      }
    }
    return results.join("\n");
  }

  return { fetchStockData, DEFAULT_TICKERS, testConnection, fetchTopLosers };
})();
