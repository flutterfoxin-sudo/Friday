# -*- coding: utf-8 -*-
with open('C:\\Users\\hp\\OneDrive\\Desktop\\J.A.R.V.I.S\\backend\\skills\\autohedge_daemon.py', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('import pandas_ta as ta', '')

# Replace TA logic
old_ta = '''def run_technical_analysis(hist):
    res = {}
    try:
        hist.ta.rsi(length=14, append=True)
        rsi_col = hist.filter(like='RSI')
        rsi_val = rsi_col.iloc[-1, 0] if not rsi_col.empty else 50
        res['rsi'] = {'value': float(rsi_val), 'signal': 'OVERSOLD' if rsi_val < 30 else ('OVERBOUGHT' if rsi_val > 70 else 'NEUTRAL')}
        
        hist.ta.sma(length=20, append=True)
        hist.ta.sma(length=50, append=True)
        s20 = hist.filter(like='SMA_20')
        s50 = hist.filter(like='SMA_50')
        sma20 = s20.iloc[-1, 0] if not s20.empty else hist['Close'].iloc[-1]
        sma50 = s50.iloc[-1, 0] if not s50.empty else hist['Close'].iloc[-1]
        
        cross_sig = 'ABOVE_50SMA' if sma20 > sma50 else 'BELOW_50SMA'
        try:
            for i in range(-3, 0):
                p20, c20 = s20.iloc[i-1, 0], s20.iloc[i, 0]
                p50, c50 = s50.iloc[i-1, 0], s50.iloc[i, 0]
                if p20 <= p50 and c20 > c50: cross_sig = 'GOLDEN_CROSS'
                elif p20 >= p50 and c20 < c50: cross_sig = 'DEATH_CROSS'
        except: pass
        res['ma_cross'] = {'signal': cross_sig, 'sma20': float(sma20), 'sma50': float(sma50)}
        
        hist.ta.macd(fast=12, slow=26, signal=9, append=True)
        mc = hist.filter(like='MACD_')
        ms = hist.filter(like='MACDs_')
        mh = hist.filter(like='MACDh_')
        macd = mc.iloc[-1, 0] if not mc.empty else 0
        sig_line = ms.iloc[-1, 0] if not ms.empty else 0
        hist_val = mh.iloc[-1, 0] if not mh.empty else 0
        
        m_sig = 'FLAT_POSITIVE' if macd > 0 else 'FLAT_NEGATIVE'
        try:
            for i in range(-2, 0):
                pm, cm = mc.iloc[i-1, 0], mc.iloc[i, 0]
                ps, cs = ms.iloc[i-1, 0], ms.iloc[i, 0]
                if pm <= ps and cm > cs: m_sig = 'BULLISH_CROSSOVER'
                elif pm >= ps and cm < cs: m_sig = 'BEARISH_CROSSOVER'
        except: pass
        res['macd'] = {'signal': m_sig, 'macd': float(macd), 'signal_line': float(sig_line), 'histogram': float(hist_val)}
        
        hist.ta.bbands(length=20, std=2, append=True)
        bl = hist.filter(like='BBL_')
        bm = hist.filter(like='BBM_')
        bu = hist.filter(like='BBU_')
        lower = bl.iloc[-1, 0] if not bl.empty else hist['Close'].iloc[-1]
        middle = bm.iloc[-1, 0] if not bm.empty else hist['Close'].iloc[-1]
        upper = bu.iloc[-1, 0] if not bu.empty else hist['Close'].iloc[-1]
        price = hist['Close'].iloc[-1]
        
        if price >= upper * 0.98: b_sig = 'NEAR_UPPER'
        elif price <= lower * 1.02: b_sig = 'NEAR_LOWER'
        else: b_sig = 'MIDDLE'
        res['bollinger'] = {'position': b_sig, 'upper': float(upper), 'lower': float(lower), 'middle': float(middle)}
        
        vol_avg = hist['Volume'].rolling(20).mean().iloc[-1]
        vol_today = hist['Volume'].iloc[-1]
        ratio = (vol_today / vol_avg * 100) if vol_avg and vol_avg > 0 else 100
        if ratio > 150: v_sig = 'HIGH_VOLUME'
        elif ratio >= 100: v_sig = 'ABOVE_AVERAGE'
        elif ratio >= 50: v_sig = 'BELOW_AVERAGE'
        else: v_sig = 'LOW_VOLUME'
        res['volume'] = {'signal': v_sig, 'ratio_pct': float(ratio)}
        
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
        return None'''

new_ta = '''def run_technical_analysis(hist):
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
        return None'''

content = content.replace(old_ta, new_ta)

old_targ = '''def calculate_price_targets(hist):
    try:
        hist.ta.atr(length=14, append=True)
        ac = hist.filter(like='ATRr_')
        atr = ac.iloc[-1, 0] if not ac.empty else (hist['High'].iloc[-1] - hist['Low'].iloc[-1])
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
        return None'''

new_targ = '''def calculate_price_targets(hist):
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
        return None'''
content = content.replace(old_targ, new_targ)

with open('C:\\Users\\hp\\OneDrive\\Desktop\\J.A.R.V.I.S\\backend\\skills\\autohedge_daemon.py', 'w', encoding='utf-8') as f:
    f.write(content)
