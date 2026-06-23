import os
import sys
import time
import json
import uuid
import datetime
from pathlib import Path
from loguru import logger
import yfinance as yf
import concurrent.futures
import requests
import pandas as pd

class PriceFetchTimeout(Exception): pass
class PriceDataEmpty(Exception): pass

# --- STEP 1, 2, 3: YFINANCE WRAPPER WITH COINGECKO FALLBACK ---
def fallback_coingecko(ticker_symbol):
    mapping = {
        "BTC-USD": "bitcoin",
        "SOL-USD": "solana",
        "ETH-USD": "ethereum"
    }
    cg_id = mapping.get(ticker_symbol)
    if not cg_id:
        return pd.DataFrame()
        
    try:
        url = f"https://api.coingecko.com/api/v3/simple/price?ids={cg_id}&vs_currencies=usd&include_24hr_change=true"
        resp = requests.get(url, timeout=4)
        resp.raise_for_status()
        data = resp.json()
        price = data.get(cg_id, {}).get("usd")
        if price:
            logger.info(f"[PRICE-OK]      {ticker_symbol} â€” ${price:.2f} via CoinGecko")
            df = pd.DataFrame({"Close": [price], "Open": [price], "High": [price], "Low": [price], "Volume": [0]})
            df.index = [pd.Timestamp.utcnow()]
            return df
    except Exception as e:
        logger.error(f"[PRICE-FAIL] {ticker_symbol} â€” all sources exhausted (CoinGecko failed: {e})")
    
    logger.error(f"[PRICE-FAIL] {ticker_symbol} â€” all sources exhausted")
    return pd.DataFrame()

def fetch_live_price(ticker_symbol):
    """Fetches live price using yfinance.download with a 5s timeout wrapper"""
    def _fetch():
        # Use single string for download and grab the Series/DataFrame
        return yf.download(ticker_symbol, period="1d", progress=False)
        
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(_fetch)
        try:
            hist = future.result(timeout=5)
            if hist.empty:
                logger.error(f"[PRICE-EMPTY]   {ticker_symbol} â€” yfinance returned no data")
                if ticker_symbol in ["BTC-USD", "SOL-USD", "ETH-USD"]:
                    return fallback_coingecko(ticker_symbol)
                raise PriceDataEmpty(f"{ticker_symbol} empty data")
            
            # yf.download returns a multi-index DataFrame in recent versions sometimes, handle safely
            close_col = hist['Close']
            price = close_col.iloc[-1].item() if isinstance(close_col.iloc[-1], pd.Series) else close_col.iloc[-1]
            logger.info(f"[PRICE-OK]      {ticker_symbol} â€” ${price:.2f} via yfinance")
            return hist
        except concurrent.futures.TimeoutError:
            logger.error(f"[PRICE-TIMEOUT] {ticker_symbol} â€” yfinance blocked (>5s)")
            if ticker_symbol in ["BTC-USD", "SOL-USD", "ETH-USD"]:
                return fallback_coingecko(ticker_symbol)
            raise PriceFetchTimeout(f"{ticker_symbol} timed out")

def fetch_ohlcv_history(ticker_symbol):
    """Separate from live price. Used for analysis."""
    if ticker_symbol in ["BTC-USD", "SOL-USD", "ETH-USD"]:
        mapping = {
            "BTC-USD": "bitcoin",
            "SOL-USD": "solana",
            "ETH-USD": "ethereum"
        }
        cg_id = mapping.get(ticker_symbol)
        try:
            url = f"https://api.coingecko.com/api/v3/coins/{cg_id}/ohlc?vs_currency=usd&days=30"
            resp = requests.get(url, timeout=5)
            resp.raise_for_status()
            data = resp.json()
            if data and len(data) > 0:
                df = pd.DataFrame(data, columns=["timestamp", "Open", "High", "Low", "Close"])
                df["timestamp"] = pd.to_datetime(df["timestamp"], unit='ms')
                df.set_index("timestamp", inplace=True)
                df["Volume"] = 0 
                return df
            else:
                raise ValueError("Empty data")
        except Exception as e:
            logger.error(f"[HISTORY-FAIL] {ticker_symbol} â€” skipping analysis this cycle ({e})")
            return "history_unavailable"
    else:
        def _fetch_hist():
            t = yf.Ticker(ticker_symbol)
            return t.history(period="90d")
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_fetch_hist)
            try:
                hist = future.result(timeout=5)
                if hist.empty:
                    raise ValueError("Empty dataframe")
                return hist
            except Exception as e:
                logger.error(f"[HISTORY-FAIL] {ticker_symbol} â€” skipping analysis this cycle ({e})")
                return "history_unavailable"
# --------------------------------------------------------------
from dotenv import load_dotenv
import pytz
from groq import Groq

# Load environment variables first to ensure API keys are set before other imports
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

# Setup system paths to import autohedge modules
sys.path.append(str(Path(__file__).resolve().parent.parent.parent / "autohedge"))

import threading
from whatsapp_handler import send_whatsapp_proposal, process_whatsapp_replies

# Import prompt templates and swarms Agent
try:
    from swarms import Agent
    from autohedge.workers import director_agent, GroqLLM
    from autohedge.prompts import DIRECTOR_PROMPT, QUANT_PROMPT, RISK_PROMPT, EXECUTION_PROMPT
except Exception as e:
    logger.error(f"Failed to import swarms/autohedge: {e}")

WATCHLIST_CRYPTO = ["BTC-USD", "SOL-USD"]
WATCHLIST_STOCKS = ["NVDA", "AAPL"]

import feedparser
from googleapiclient.discovery import build
from litellm import completion
import string
import numpy as np

TRADING_PERFORMANCE_PATH = Path(__file__).resolve().parent / 'trading_performance.json'
PAPER_PORTFOLIO_PATH = Path(__file__).resolve().parent / 'paper_portfolio.json'

NEWSAPI_KEY = os.getenv('NEWSAPI_KEY')
GNEWS_KEY = os.getenv('GNEWS_KEY')
YOUTUBE_KEY = os.getenv('YOUTUBE_KEY')
if not NEWSAPI_KEY: logger.warning('[CONFIG-WARN] NEWSAPI_KEY missing — source skipped this session.')
if not GNEWS_KEY: logger.warning('[CONFIG-WARN] GNEWS_KEY missing — source skipped this session.')
if not YOUTUBE_KEY: logger.warning('[CONFIG-WARN] YOUTUBE_KEY missing — source skipped this session.')

def load_paper_portfolio():
    if not PAPER_PORTFOLIO_PATH.exists():
        init = {'mode': 'paper', 'total_value': 10000.0, 'cash': 10000.0, 'positions': []}
        save_paper_portfolio(init)
        return init
    try:
        with open(PAPER_PORTFOLIO_PATH, 'r') as f: return json.load(f)
    except: return {'mode': 'paper', 'total_value': 10000.0, 'cash': 10000.0, 'positions': []}

def save_paper_portfolio(p):
    with open(PAPER_PORTFOLIO_PATH, 'w') as f: json.dump(p, f, indent=2)

def update_trading_performance():
    if not TRADING_PERFORMANCE_PATH.exists():
        perf = {
            'last_updated': datetime.datetime.utcnow().isoformat() + 'Z',
            'total_days': 0, 'total_trades_completed': 0, 'total_trades_proposed': 0,
            'win_rate': 0.0, 'total_pnl': 0.0, 'total_pnl_pct': 0.0, 'sharpe_estimate': None,
            'max_drawdown_ever': 0.0, 'max_drawdown_today': 0.0, 'trades_today': 0,
            'confirmation_rate': 0.0, 'skip_rate': 0.0, 'timeout_rate': 0.0, 'avg_analysis_time_seconds': 0.0,
            'news_source_stats': {
                'newsapi_success_rate': 0.0, 'gnews_success_rate': 0.0, 'youtube_success_rate': 0.0,
                'yahoo_rss_success_rate': 0.0, 'cryptopanic_success_rate': 0.0, 'et_success_rate': 0.0, 'reuters_success_rate': 0.0
            },
            'real_money_gate': {
                'days_history_met': False, 'win_rate_met': False, 'drawdown_met': False, 'min_trades_met': False,
                'gate_passed': False, 'gate_fail_reasons': [], 'days_remaining': 14, 'trades_remaining': 30
            }
        }
        with open(TRADING_PERFORMANCE_PATH, 'w') as f: json.dump(perf, f, indent=2)
        return perf
    try:
        with open(TRADING_PERFORMANCE_PATH, 'r') as f: return json.load(f)
    except: return {}

def print_startup_sequence():
    port = load_paper_portfolio()
    perf = update_trading_performance()
    g = perf.get('real_money_gate', {})
    cond_met = sum(1 for k in ['days_history_met', 'win_rate_met', 'drawdown_met', 'min_trades_met'] if g.get(k, False))
    open_pos = len([p for p in port.get('positions', []) if p.get('status') == 'open'])
    logger.info('[FRIDAY-TRADING] ----------------------')
    logger.info('[FRIDAY-TRADING] Mode: PAPER')
    logger.info(f'[FRIDAY-TRADING] Gate: {cond_met}/4 conditions met')
    logger.info(f'[FRIDAY-TRADING] Portfolio value: ')
    logger.info(f'[FRIDAY-TRADING] Open positions: {open_pos}/4')
    logger.info(f'[FRIDAY-TRADING] Win rate: {perf.get("win_rate", 0)*100:.1f}%')
    logger.info(f'[FRIDAY-TRADING] Days of history: {perf.get("total_days", 0)}/14')
    logger.info(f'[FRIDAY-TRADING] Trades completed: {perf.get("total_trades_completed", 0)}/30')
    logger.info('[FRIDAY-TRADING] ----------------------')

# -- SUB-SYSTEM A: NEWS ENGINE -------------------------
def fetch_news_newsapi(ticker_symbol):
    if not NEWSAPI_KEY: return []
    try:
        q = f'{ticker_symbol} crypto' if ticker_symbol in ['BTC-USD', 'SOL-USD', 'ETH-USD'] else f'{ticker_symbol} stock'
        yesterday = (datetime.datetime.utcnow() - datetime.timedelta(days=1)).isoformat()
        url = f'https://newsapi.org/v2/everything?q={q}&from={yesterday}&sortBy=publishedAt&pageSize=5&language=en&apiKey={NEWSAPI_KEY}'
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        return [{'title': a.get('title'), 'source': a.get('source', {}).get('name'), 'publishedAt': a.get('publishedAt'), 'tier': 2, 'api': 'NewsAPI'} for a in resp.json().get('articles', [])]
    except Exception as e:
        logger.error(f'[NEWS-FAIL] NewsAPI — {e}')
        return []

def fetch_news_gnews(ticker_symbol):
    if not GNEWS_KEY: return []
    try:
        yesterday = (datetime.datetime.utcnow() - datetime.timedelta(days=1)).isoformat() + 'Z'
        url = f'https://gnews.io/api/v4/search?q={ticker_symbol}&from={yesterday}&max=5&lang=en&token={GNEWS_KEY}'
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        return [{'title': a.get('title'), 'source': a.get('source', {}).get('name'), 'publishedAt': a.get('publishedAt'), 'tier': 2, 'api': 'GNews'} for a in resp.json().get('articles', [])]
    except Exception as e:
        logger.error(f'[NEWS-FAIL] GNews — {e}')
        return []

def fetch_news_youtube(ticker_symbol):
    if not YOUTUBE_KEY: return []
    try:
        youtube = build('youtube', 'v3', developerKey=YOUTUBE_KEY, cache_discovery=False)
        yesterday = (datetime.datetime.utcnow() - datetime.timedelta(days=1)).isoformat() + 'Z'
        req = youtube.search().list(part='snippet', q=f'{ticker_symbol} market news', type='video', order='date', publishedAfter=yesterday, maxResults=10, relevanceLanguage='en')
        resp = req.execute()
        whitelist_t1 = {'UCIALMKvObZNtJ6AmdCLP7Lg': 'Bloomberg Technology', 'UCsgwFEMcJRwFSBbSC5PEXXQ': 'Reuters', 'UCEAZeUIeJs9_BODLqOqbOFQ': 'Bloomberg Markets', 'UCIeIbMFnuDdCeRFiAW5GCQQ': 'Financial Times'}
        whitelist_t2 = {'UCo8bcnLyZH8tBIH9V1mLgqQ': 'CNBC Television', 'UC0vBXGSyV14uvJ4hECDQl0Q': 'CNBC Main', 'UCNiRDLO-FxCnS39GWPD-HIQQ': 'Yahoo Finance', 'UCHv71qBtKpDpICPm7j0bvqA': 'NDTV Profit', 'UC_HkBTgFsBfRzL2oVmwImFg': 'ET Now'}
        results = []
        for item in resp.get('items', []):
            cid = item['snippet']['channelId']
            if cid in whitelist_t1: results.append({'title': item['snippet']['title'], 'source': whitelist_t1[cid], 'publishedAt': item['snippet']['publishedAt'], 'tier': 1, 'api': 'YouTube'})
            elif cid in whitelist_t2: results.append({'title': item['snippet']['title'], 'source': whitelist_t2[cid], 'publishedAt': item['snippet']['publishedAt'], 'tier': 2, 'api': 'YouTube'})
        logger.info(f'[NEWS-YT] {ticker_symbol} — {len(results)} whitelisted videos found')
        return results
    except Exception as e:
        logger.error(f'[NEWS-FAIL] YouTube — {e}')
        return []

def fetch_news_yahoorss(ticker_symbol):
    try:
        s = f'{ticker_symbol}-USD' if ticker_symbol in ['BTC', 'SOL', 'ETH'] else ticker_symbol
        url = f'https://feeds.finance.yahoo.com/rss/2.0/headline?s={s}&region=US&lang=en-US'
        resp = requests.get(url, timeout=4)
        feed = feedparser.parse(resp.content)
        return [{'title': entry.title, 'source': 'YahooRSS', 'publishedAt': entry.get('published', ''), 'tier': 2, 'api': 'YahooRSS'} for entry in feed.entries[:5]]
    except Exception as e:
        logger.error(f'[NEWS-FAIL] YahooRSS — {e}')
        return []

def fetch_news_cryptopanic(ticker_symbol):
    if ticker_symbol not in ['BTC-USD', 'SOL-USD', 'ETH-USD']: return []
    try:
        sym = ticker_symbol.split('-')[0]
        url = f'https://cryptopanic.com/api/v1/posts/?auth_token=free&currencies={sym}&filter=hot'
        resp = requests.get(url, timeout=4)
        resp.raise_for_status()
        return [{'title': r.get('title'), 'source': r.get('source', {}).get('title', 'Cryptopanic'), 'publishedAt': r.get('published_at'), 'tier': 3, 'api': 'Cryptopanic'} for r in resp.json().get('results', [])[:5]]
    except Exception as e:
        logger.error(f'[NEWS-FAIL] Cryptopanic — {e}')
        return []

def fetch_news_et(ticker_symbol):
    try:
        resp = requests.get('https://economictimes.indiatimes.com/markets/rss.cms', timeout=4)
        feed = feedparser.parse(resp.content)
        res = []
        for entry in feed.entries:
            if ticker_symbol.lower() in entry.title.lower():
                res.append({'title': entry.title, 'source': 'ET', 'publishedAt': entry.get('published', ''), 'tier': 1, 'api': 'ET'})
                if len(res) >= 3: break
        return res
    except Exception as e:
        logger.error(f'[NEWS-FAIL] EconomicTimes — {e}')
        return []

def fetch_news_reuters(ticker_symbol):
    try:
        resp = requests.get('https://feeds.reuters.com/reuters/businessNews', timeout=4)
        feed = feedparser.parse(resp.content)
        res = []
        for entry in feed.entries:
            if ticker_symbol.lower() in entry.title.lower():
                res.append({'title': entry.title, 'source': 'Reuters', 'publishedAt': entry.get('published', ''), 'tier': 1, 'api': 'Reuters'})
                if len(res) >= 3: break
        return res
    except Exception as e:
        logger.error(f'[NEWS-FAIL] ReutersRSS — {e}')
        return []

def run_news_engine(ticker_symbol):
    funcs = [fetch_news_newsapi, fetch_news_gnews, fetch_news_youtube, fetch_news_yahoorss, fetch_news_cryptopanic, fetch_news_et, fetch_news_reuters]
    all_news = []
    stats = {'NewsAPI': 0, 'GNews': 0, 'YouTube': 0, 'YahooRSS': 0, 'Cryptopanic': 0, 'ET': 0, 'Reuters': 0}
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as executor:
        futures = {executor.submit(f, ticker_symbol): f.__name__ for f in funcs}
        for future in concurrent.futures.as_completed(futures):
            try:
                res = future.result(timeout=6)
                all_news.extend(res)
                if res: stats[res[0]['api']] += len(res)
            except Exception: pass
            
    unique_news = []
    import re
    def get_word_set(text): return set(re.findall(r'\b\w+\b', text.lower())) - {'the', 'a', 'an', 'is', 'in', 'of', 'to'}
        
    for item in all_news:
        words_A = get_word_set(item['title'])
        is_dup = False
        for u in unique_news:
            words_B = get_word_set(u['title'])
            if len(words_A.union(words_B)) == 0: continue
            if (len(words_A.intersection(words_B)) / len(words_A.union(words_B))) > 0.70:
                is_dup = True
                if item['tier'] < u['tier']: u.update(item)
                break
        if not is_dup: unique_news.append(item)
            
    unique_news.sort(key=lambda x: str(x['publishedAt']), reverse=True)
    tier_counts = {1: sum(1 for u in unique_news if u['tier'] == 1), 2: sum(1 for u in unique_news if u['tier'] == 2), 3: sum(1 for u in unique_news if u['tier'] == 3)}
    
    logger.info(f'[NEWS-SUMMARY] {ticker_symbol}: NewsAPI:{stats["NewsAPI"]} GNews:{stats["GNews"]} YouTube:{stats["YouTube"]} YahooRSS:{stats["YahooRSS"]} Cryptopanic:{stats["Cryptopanic"]} ET:{stats["ET"]} Reuters:{stats["Reuters"]}')
    logger.info(f'After dedup: {len(unique_news)} unique headlines. Tier-1:{tier_counts[1]} | Tier-2:{tier_counts[2]} | Tier-3:{tier_counts[3]}')

    sentiment = 'unavailable'
    if len(unique_news) == 0:
        logger.info(f'[NEWS-ZERO] {ticker_symbol} — no headlines any source')
    else:
        headlines_txt = ''.join([f'[TIER-{n["tier"]}] [{n["source"]}] [Recently]\n{n["title"]}\n\n' for n in unique_news])
        prompt = f'''Classify sentiment for {ticker_symbol}.

Headlines (newest first):

{headlines_txt}
Weighting rules:
- Tier-1 counts 3x more than Tier-3
- Tier-2 counts 2x more than Tier-3
- If Tier-1 and Tier-3 conflict, always follow Tier-1
- Focus only on {ticker_symbol}-specific sentiment
- Ignore general market mood unless ticker-specific

Reply with exactly one word: BULLISH, BEARISH, or NEUTRAL'''
        try:
            resp = completion(model='groq/llama-3.1-8b-instant', messages=[{'role': 'system', 'content': 'You are a financial news sentiment classifier.\nBe concise and factual. Never hallucinate.'}, {'role': 'user', 'content': prompt}], timeout=8)
            word = resp.choices[0].message.content.strip().upper()
            word = word.translate(str.maketrans('', '', string.punctuation)).split()[0]
            if word in ['BULLISH', 'BEARISH', 'NEUTRAL']: sentiment = word
            else: logger.error(f'[SENTIMENT-PARSE-FAIL] response: {word}')
        except Exception as e:
            logger.error(f'[SENTIMENT-FAIL] {e}')
            
    return unique_news, sentiment, stats, tier_counts

# -- SUB-SYSTEM B: TECHNICAL ANALYSIS ENGINE ------------------------
def run_technical_analysis(hist):
    res = {}
    try:
        # RSI
        delta = hist['Close'].diff()
        up, down = delta.copy(), delta.copy()
        up[up < 0] = 0
        down[down > 0] = 0
        avg_gain = up.ewm(com=13, adjust=False).mean()
        avg_loss = abs(down.ewm(com=13, adjust=False).mean())
        rs = avg_gain / avg_loss
        hist['RSI'] = 100 - (100 / (1 + rs))
        rsi_val = hist['RSI'].iloc[-1]
        if np.isnan(rsi_val): rsi_val = 50
        res['rsi'] = {'value': float(rsi_val), 'signal': 'OVERSOLD' if rsi_val < 30 else ('OVERBOUGHT' if rsi_val > 70 else 'NEUTRAL')}
        
        # MA
        hist['SMA_20'] = hist['Close'].rolling(window=20).mean()
        hist['SMA_50'] = hist['Close'].rolling(window=50).mean()
        sma20 = hist['SMA_20'].iloc[-1]
        sma50 = hist['SMA_50'].iloc[-1]
        if np.isnan(sma20): sma20 = hist['Close'].iloc[-1]
        if np.isnan(sma50): sma50 = hist['Close'].iloc[-1]
        cross_sig = 'ABOVE_50SMA' if sma20 > sma50 else 'BELOW_50SMA'
        try:
            for i in range(-3, 0):
                p20, c20 = hist['SMA_20'].iloc[i-1], hist['SMA_20'].iloc[i]
                p50, c50 = hist['SMA_50'].iloc[i-1], hist['SMA_50'].iloc[i]
                if p20 <= p50 and c20 > c50: cross_sig = 'GOLDEN_CROSS'
                elif p20 >= p50 and c20 < c50: cross_sig = 'DEATH_CROSS'
        except: pass
        res['ma_cross'] = {'signal': cross_sig, 'sma20': float(sma20), 'sma50': float(sma50)}
        
        # MACD
        exp1 = hist['Close'].ewm(span=12, adjust=False).mean()
        exp2 = hist['Close'].ewm(span=26, adjust=False).mean()
        hist['MACD'] = exp1 - exp2
        hist['MACDs'] = hist['MACD'].ewm(span=9, adjust=False).mean()
        hist['MACDh'] = hist['MACD'] - hist['MACDs']
        macd = hist['MACD'].iloc[-1]
        sig_line = hist['MACDs'].iloc[-1]
        hist_val = hist['MACDh'].iloc[-1]
        m_sig = 'FLAT_POSITIVE' if macd > 0 else 'FLAT_NEGATIVE'
        try:
            for i in range(-2, 0):
                pm, cm = hist['MACD'].iloc[i-1], hist['MACD'].iloc[i]
                ps, cs = hist['MACDs'].iloc[i-1], hist['MACDs'].iloc[i]
                if pm <= ps and cm > cs: m_sig = 'BULLISH_CROSSOVER'
                elif pm >= ps and cm < cs: m_sig = 'BEARISH_CROSSOVER'
        except: pass
        res['macd'] = {'signal': m_sig, 'macd': float(macd), 'signal_line': float(sig_line), 'histogram': float(hist_val)}
        
        # BB
        hist['BB_mid'] = hist['Close'].rolling(window=20).mean()
        hist['BB_std'] = hist['Close'].rolling(window=20).std()
        hist['BBU'] = hist['BB_mid'] + 2 * hist['BB_std']
        hist['BBL'] = hist['BB_mid'] - 2 * hist['BB_std']
        middle = hist['BB_mid'].iloc[-1]
        upper = hist['BBU'].iloc[-1]
        lower = hist['BBL'].iloc[-1]
        if np.isnan(upper): upper = hist['Close'].iloc[-1]
        if np.isnan(lower): lower = hist['Close'].iloc[-1]
        if np.isnan(middle): middle = hist['Close'].iloc[-1]
        price = hist['Close'].iloc[-1]
        if price >= upper * 0.98: b_sig = 'NEAR_UPPER'
        elif price <= lower * 1.02: b_sig = 'NEAR_LOWER'
        else: b_sig = 'MIDDLE'
        res['bollinger'] = {'position': b_sig, 'upper': float(upper), 'lower': float(lower), 'middle': float(middle)}
        
        # Vol
        vol_avg = hist['Volume'].rolling(20).mean().iloc[-1]
        vol_today = hist['Volume'].iloc[-1]
        ratio = (vol_today / vol_avg * 100) if vol_avg and vol_avg > 0 else 100
        if ratio > 150: v_sig = 'HIGH_VOLUME'
        elif ratio >= 100: v_sig = 'ABOVE_AVERAGE'
        elif ratio >= 50: v_sig = 'BELOW_AVERAGE'
        else: v_sig = 'LOW_VOLUME'
        res['volume'] = {'signal': v_sig, 'ratio_pct': float(ratio)}
        
        # Trend
        highs, lows = hist['High'].values, hist['Low'].values
        sh, sl = [], []
        for i in range(1, len(hist)-1):
            if highs[i] > highs[i-1] and highs[i] > highs[i+1]: sh.append(highs[i])
            if lows[i] < lows[i-1] and lows[i] < lows[i+1]: sl.append(lows[i])
        trend = 'SIDEWAYS'
        if len(sh) >= 3 and len(sl) >= 3:
            if sh[-1] > sh[-2] > sh[-3] and sl[-1] > sl[-2] > sl[-3]: trend = 'UPTREND'
            elif sh[-1] < sh[-2] < sh[-3] and sl[-1] < sl[-2] < sl[-3]: trend = 'DOWNTREND'
        res['trend'] = {'trend': trend}
        return res
    except Exception as e:
        logger.error(f'[TA-FAIL] {e}')
        return None

# -- SUB-SYSTEM C: PRICE TARGET ENGINE ------------------------------
def calculate_price_targets(hist):
    try:
        high_low = hist['High'] - hist['Low']
        high_cp = np.abs(hist['High'] - hist['Close'].shift())
        low_cp = np.abs(hist['Low'] - hist['Close'].shift())
        df_concat = pd.concat([high_low, high_cp, low_cp], axis=1)
        tr = df_concat.max(axis=1)
        hist['ATR'] = tr.rolling(window=14).mean()
        atr = hist['ATR'].iloc[-1]
        if np.isnan(atr): atr = (hist['High'].iloc[-1] - hist['Low'].iloc[-1])
        
        last_14 = hist.tail(14)
        support = last_14['Low'].min()
        resistance = last_14['High'].max()
        entry = hist['Close'].iloc[-1]
        return {
            'atr': float(atr), 'support': float(support), 'resistance': float(resistance),
            'entry': float(entry), 'stop_loss': float(entry - (2 * atr)), 'target': float(entry + (3 * atr))
        }
    except Exception as e:
        logger.error(f'[TARGET-FAIL] {e}')
        return None

# -- SUB-SYSTEM D: PAPER TRADING LAYER ------------------------------
def process_trade_signal(ticker, ta_res, targets, news_res):
    if not ta_res or not targets: return
    unique_news, sentiment, news_stats, tier_counts = news_res
    
    rsi_sig = ta_res['rsi']['signal']
    ma_sig = ta_res['ma_cross']['signal']
    macd_sig = ta_res['macd']['signal']
    boll_pos = ta_res['bollinger']['position']
    
    buy_cond = (rsi_sig == 'OVERSOLD' or ma_sig == 'GOLDEN_CROSS' or macd_sig == 'BULLISH_CROSSOVER' or boll_pos == 'NEAR_LOWER')
    sell_cond = (rsi_sig == 'OVERBOUGHT' or ma_sig == 'DEATH_CROSS' or macd_sig == 'BEARISH_CROSSOVER' or boll_pos == 'NEAR_UPPER')
    
    if buy_cond and sell_cond:
        logger.info(f'[SIGNAL-CONFLICT] {ticker}')
        return
    elif buy_cond: action = 'BUY'
    elif sell_cond: action = 'SELL'
    else: return
        
    entry = targets['entry']
    stop_loss = targets['stop_loss']
    target = targets['target']
    
    if action == 'SELL':
        stop_loss = entry + (2 * targets['atr'])
        target = entry - (3 * targets['atr'])
        
    rr_ratio = abs((target - entry) / (entry - stop_loss)) if entry != stop_loss else 0
    if rr_ratio < 1.5:
        logger.info(f'[GATE-FAIL] {ticker} R:R {rr_ratio:.2f} < 1.5')
        return
    if stop_loss <= 0:
        logger.info(f'[GATE-FAIL] {ticker} invalid stop_loss')
        return
        
    score = 0.50
    if (action == 'BUY' and rsi_sig == 'OVERSOLD') or (action == 'SELL' and rsi_sig == 'OVERBOUGHT'): score += 0.10
    if (action == 'BUY' and ta_res['trend']['trend'] == 'UPTREND') or (action == 'SELL' and ta_res['trend']['trend'] == 'DOWNTREND'): score += 0.10
    if (action == 'BUY' and macd_sig == 'BULLISH_CROSSOVER') or (action == 'SELL' and macd_sig == 'BEARISH_CROSSOVER'): score += 0.10
    v_sig = ta_res['volume']['signal']
    if v_sig in ['HIGH_VOLUME', 'ABOVE_AVERAGE']: score += 0.05
    elif v_sig == 'LOW_VOLUME': score -= 0.10
    
    if action == 'BUY' and entry <= targets['support'] * 1.02: score += 0.05
    if action == 'SELL' and entry >= targets['resistance'] * 0.98: score += 0.05
    
    if sentiment == action: score += 0.10
    elif sentiment not in ['unavailable', 'NEUTRAL']: score -= 0.10
    elif sentiment == 'unavailable': score -= 0.05
    if tier_counts[1] == 0: score -= 0.05
    score = max(0.0, min(1.0, round(score, 2)))
    
    port = load_paper_portfolio()
    open_pos = [p for p in port['positions'] if p['status'] == 'open']
    if len(open_pos) >= 4:
        logger.info(f'[GATE-FAIL] {ticker} — max positions (4) reached')
        return
        
    trade_val = port['total_value'] * 0.02
    if trade_val > port['cash']:
        logger.info(f'[GATE-FAIL] {ticker} — insufficient cash')
        return
        
    qty = trade_val / entry
    
    try:
        reasoning_prompt = f"Summarize exactly 3 punchy bullet points on why we should {action} {ticker}. Technicals: RSI {rsi_sig}, MACD {macd_sig}, Vol {v_sig}, Trend {ta_res['trend']['trend']}. News sentiment: {sentiment}. No intro or outro."
        resp = completion(model='groq/llama-3.1-8b-instant', messages=[{"role": "user", "content": reasoning_prompt}], max_tokens=150)
        reasoning = resp.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"[REASONING-FAIL] {e}")
        reasoning = f"- Technical indicators show {action} signal.\n- Favorable Risk/Reward ratio.\n- Sentiment score supports the trend."
        
    pos = {
        'id': str(uuid.uuid4()), 'ticker': ticker, 'full_name': ticker, 'action': action,
        'quantity': float(qty), 'entry_price': float(entry), 'current_price': float(entry),
        'stop_loss': float(stop_loss), 'target': float(target), 'support_14d': float(targets['support']),
        'resistance_14d': float(targets['resistance']), 'atr': float(targets['atr']), 'rr_ratio': float(rr_ratio),
        'entry_timestamp': datetime.datetime.utcnow().isoformat() + 'Z', 'status': 'proposed',
        'exit_price': None, 'exit_timestamp': None, 'pnl': None, 'pnl_pct': None,
        'reasoning_summary': reasoning, 'confidence_score': score,
        'technical_snapshot': {
            'rsi_value': ta_res['rsi']['value'], 'rsi_signal': rsi_sig, 'trend': ta_res['trend']['trend'],
            'ma_cross': ma_sig, 'sma20': ta_res['ma_cross']['sma20'], 'sma50': ta_res['ma_cross']['sma50'],
            'macd_signal': macd_sig, 'macd_value': ta_res['macd']['macd'], 'volume_signal': v_sig,
            'volume_ratio_pct': ta_res['volume']['ratio_pct'], 'bollinger_position': boll_pos
        },
        'news_snapshot': {
            'sentiment': sentiment, 'total_headlines': len(unique_news), 'tier1_count': tier_counts[1],
            'tier2_count': tier_counts[2], 'tier3_count': tier_counts[3], 'youtube_count': news_stats['YouTube'],
            'top_headline': unique_news[0]['title'] if unique_news else 'unavailable', 
            'top_headline_source': unique_news[0]['source'] if unique_news else 'none', 
            'top_headline_tier': unique_news[0]['tier'] if unique_news else 0
        }
    }
    
    port['cash'] -= trade_val
    port['positions'].append(pos)
    save_paper_portfolio(port)
    logger.info(f'? Proposed Trade logged for {ticker} ({action}) - Score: {score}')
    
    send_whatsapp_proposal(pos)

def run_trading_cycle():
    logger.info('Executing periodic trading cycle...')
    port = load_paper_portfolio()
    
    for pos in port['positions']:
        if pos['status'] != 'open': continue
        ticker = pos['ticker']
        try:
            hist = fetch_live_price(ticker)
            if not hist.empty:
                c = hist['Close']
                current_price = c.iloc[-1].item() if isinstance(c.iloc[-1], pd.Series) else c.iloc[-1]
                pos['current_price'] = float(current_price)
                closed = False
                if pos['action'] == 'BUY':
                    if current_price <= pos['stop_loss']: closed, log_msg = True, '[STOP-HIT]'
                    elif current_price >= pos['target']: closed, log_msg = True, '[TARGET-HIT]'
                else:
                    if current_price >= pos['stop_loss']: closed, log_msg = True, '[STOP-HIT]'
                    elif current_price <= pos['target']: closed, log_msg = True, '[TARGET-HIT]'
                if closed:
                    pos['status'] = 'closed'
                    pos['exit_price'] = float(current_price)
                    pos['exit_timestamp'] = datetime.datetime.utcnow().isoformat() + 'Z'
                    pnl = (pos['exit_price'] - pos['entry_price']) * pos['quantity']
                    if pos['action'] == 'SELL': pnl = -pnl
                    pos['pnl'] = float(pnl)
                    pos['pnl_pct'] = float((pos['exit_price'] - pos['entry_price']) / pos['entry_price'] * 100)
                    if pos['action'] == 'SELL': pos['pnl_pct'] = -pos['pnl_pct']
                    port['cash'] += (pos['entry_price'] * pos['quantity']) + pnl
                    logger.info(f'{log_msg} {ticker} — pnl: ')
        except Exception as e:
            logger.error(f'Error updating price for {ticker}: {e}')
            
    total_val = port['cash']
    for pos in port['positions']:
        if pos['status'] == 'open': total_val += pos['current_price'] * pos['quantity']
    port['total_value'] = float(total_val)
    save_paper_portfolio(port)
    
    for symbol in WATCHLIST_CRYPTO + WATCHLIST_STOCKS:
        ticker = f'{symbol}-USD' if symbol in ['BTC', 'SOL', 'ETH'] else symbol
        hist = fetch_ohlcv_history(ticker)
        if not isinstance(hist, pd.DataFrame) or hist.empty: continue
        news_res = run_news_engine(ticker)
        ta_res = run_technical_analysis(hist)
        targets = calculate_price_targets(hist)
        process_trade_signal(ticker, ta_res, targets, news_res)

def main():
    print_startup_sequence()
    logger.info('Starting AutoHedge Trading Daemon (Phase 3 - WhatsApp Layer)...')
    
    def whatsapp_poll_loop():
        while True:
            try:
                process_whatsapp_replies()
            except Exception as e:
                logger.error(f"WhatsApp loop error: {e}")
            time.sleep(5)
            
    wa_thread = threading.Thread(target=whatsapp_poll_loop, daemon=True)
    wa_thread.start()
    
    while True:
        try:
            port = load_paper_portfolio()
            if port.get('trading_active', True):
                run_trading_cycle()
            else:
                logger.info("Trading is currently PAUSED via WhatsApp.")
        except Exception as e:
            logger.error(f'Critical error in main loop: {e}')
        time.sleep(300)
# â”€â”€ MANUAL TEST BLOCK (STEP 5 & 6) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def run_manual_price_test():
    tickers = ["BTC-USD", "SOL-USD", "NVDA", "AAPL"]
    print("\n" + "="*70)
    print(" TASK 1 VERIFICATION: PRICE & HISTORY FETCH TEST")
    print("="*70)
    print(f"{'TICKER':<10} | {'LIVE PRICE':<12} | {'OHLCV (90d/30d)':<15} | {'STATUS'}")
    print("-" * 70)
    
    for t in tickers:
        live_status = "FAIL"
        live_price = "N/A"
        hist_status = "FAIL"
        
        # 1. Fetch Live Price
        try:
            live_df = fetch_live_price(t)
            if not live_df.empty:
                # Handle possible multi-index from yfinance
                close_col = live_df['Close']
                val = close_col.iloc[-1].item() if isinstance(close_col.iloc[-1], pd.Series) else close_col.iloc[-1]
                live_price = f"${val:.2f}"
                live_status = "OK"
        except Exception as e:
            logger.error(f"Live price error for {t}: {e}")
            
        # 2. Fetch OHLCV History
        try:
            hist_df = fetch_ohlcv_history(t)
            if isinstance(hist_df, pd.DataFrame) and not hist_df.empty:
                hist_status = f"OK ({len(hist_df)} rows)"
            else:
                hist_status = "FAIL (Unavailable)"
        except Exception as e:
            logger.error(f"History error for {t}: {e}")
            
        print(f"{t:<10} | {live_price:<12} | {hist_status:<15} | {live_status}")
    
    print("="*70 + "\n")
    
if __name__ == "__main__":
    main()
