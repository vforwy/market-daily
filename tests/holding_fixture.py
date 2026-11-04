"""Tiny offline publication fixture, without private database imports."""
from holding_snapshot import _write


def make_holdings(root, varieties, quote_date, holding_date=None):
    root.mkdir(parents=True, exist_ok=True)
    holding_date = holding_date or quote_date
    dates = sorted({holding_date, quote_date})
    position = dates.index(holding_date)
    values = lambda value: [value if i == position else None for i in range(len(dates))]
    index = {"formatVersion": 1, "quoteDate": quote_date, "latestDate": holding_date, "tradingDates": dates, "varieties": {}}
    for variety in varieties:
        contract = f'{variety}2611.SHF'
        point = {"longSum": values(20), "shortSum": values(0), "ratio": values(None)}
        common = {"variety": variety, "varietyName": variety, "policyVersion": "tushare_priority_v1",
                  "latestHoldingDate": holding_date, "latestPriceDate": quote_date,
                  "missingHoldingDates": [d for d in dates if d != holding_date], "metadata": {}, "dates": dates,
                  "dominant": [contract] * len(dates), "ohlc": [[100, 101, 99, 102]] * len(dates),
                  "seats": [{"broker": "会员甲", "seatGroup": None, "seatLabel": None, "net": values(20),
                             "contractLong": values(20), "contractShort": values(0), "longRank": values(1), "shortRank": values(None)}]}
        archive = {"formatVersion": 1, "common": common, "topN": {str(n): {"combined": point, "contracts": [{"code": contract, **point}]} for n in (5, 10, 20)}}
        entry = {**_write(root, f'{variety}/board.json', archive), "latestDate": holding_date, "members": {}}
        for scope in (variety, contract):
            entry['members'][scope] = _write(root, f'{variety}/members/{scope}.json', {"formatVersion": 1, "variety": variety,
                "scopeCode": scope, "brokers": [["会员甲", None, None]], "rows": [[position, 0, 20, 1, None]]})
        index['varieties'][variety] = entry
    _write(root, 'index.json', index)
    return {"formatVersion": 1, "latestDate": holding_date, "varieties": len(varieties),
            "files": len(list(root.rglob('*.json'))), "bytes": sum(p.stat().st_size for p in root.rglob('*.json'))}
