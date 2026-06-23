import os
import json
import httpx
import asyncio
import platform
import datetime
import webbrowser
import xml.etree.ElementTree as ET
import re
from mcp.server.fastmcp import FastMCP

# Initialize FastMCP Server
mcp = FastMCP(
    name="friday",
    instructions="You are Friday, Tony Stark's AI assistant. Answer concisely, cleanly, and act as a reliable cyber-advisor."
)

SEED_FEEDS = [
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://www.cnbc.com/id/100727362/device/rss/rss.html',
    'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
    'https://www.aljazeera.com/xml/rss/all.xml'
]

FINANCE_SEED_FEEDS = [
    'https://www.cnbc.com/id/10000664/device/rss/rss.html',
    'https://feeds.bloomberg.com/markets/news.rss',
    'https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best',
    'https://feeds.marketwatch.com/marketwatch/topstories/',
    'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
]

async def fetch_and_parse_feed(client, url):
    try:
        response = await client.get(url, headers={'User-Agent': 'Friday-AI/1.0'}, timeout=5.0)
        if response.status_code != 200:
            return []
        root = ET.fromstring(response.content)
        # Extract source name
        source_name = url.split('.')[1].upper()
        
        feed_items = []
        items = root.findall(".//item")[:5]
        for item in items:
            title = item.findtext("title")
            description = item.findtext("description")
            link = item.findtext("link")
            
            if description:
                description = re.sub('<[^<]+?>', '', description).strip()
            feed_items.append({
                "source": source_name,
                "title": title,
                "summary": description[:200] + "..." if description else "",
                "link": link
            })
        return feed_items
    except Exception:
        return []

@mcp.tool()
def get_current_time() -> str:
    """Return the current local date and time in ISO 8601 format."""
    return datetime.datetime.now().isoformat()

@mcp.tool()
def get_system_info() -> dict:
    """Return Friday's host hardware, platform, and OS environment information."""
    return {
        "os": platform.system(),
        "os_version": platform.version(),
        "machine": platform.machine(),
        "python_version": platform.python_version(),
    }

@mcp.tool()
async def get_world_news() -> str:
    """
    Fetches the latest global headlines from major news outlets (BBC, CNBC, NYT, Al Jazeera).
    Use this when the user asks 'What's going on in the world?' or 'Give me news'.
    """
    async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
        tasks = [fetch_and_parse_feed(client, url) for url in SEED_FEEDS]
        results_of_lists = await asyncio.gather(*tasks)
        all_articles = [item for sublist in results_of_lists for item in sublist]
        
    if not all_articles:
        return "The global news feeds are unresponsive, sir."
        
    report = ["### GLOBAL NEWS BRIEFING (LIVE)\n"]
    for entry in all_articles[:12]:
        report.append(f"**[{entry['source']}]** {entry['title']}")
        report.append(f"{entry['summary']}")
        report.append(f"Link: {entry['link']}\n")
    return "\n".join(report)

@mcp.tool()
async def get_world_finance_news() -> str:
    """
    Fetches the latest business, markets, and economic news from major financial outlets.
    Use this when the user asks for market updates or finance news.
    """
    async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
        tasks = [fetch_and_parse_feed(client, url) for url in FINANCE_SEED_FEEDS]
        results_of_lists = await asyncio.gather(*tasks)
        all_articles = [item for sublist in results_of_lists for item in sublist]
        
    if not all_articles:
        return "The financial feeds are unresponsive, sir."
        
    report = ["### FINANCE BRIEFING (LIVE)\n"]
    for entry in all_articles[:12]:
        report.append(f"**[{entry['source']}]** {entry['title']}")
        report.append(f"{entry['summary']}")
        report.append(f"Link: {entry['link']}\n")
    return "\n".join(report)

@mcp.tool()
def open_world_monitor() -> str:
    """Opens the live World Monitor dashboard (worldmonitor.app) in the system's default browser."""
    url = "https://worldmonitor.app/"
    try:
        webbrowser.open(url)
        return "Displaying the World Monitor on your primary screen, sir."
    except Exception as e:
        return f"Unable to initialize the visual monitor: {str(e)}"

@mcp.tool()
def open_finance_world_monitor() -> str:
    """Opens the live Finance Dashboard (finance.worldmonitor.app) in the default browser."""
    url = "https://finance.worldmonitor.app/"
    try:
        webbrowser.open(url)
        return "Displaying the Finance Monitor on your primary screen, sir."
    except Exception as e:
        return f"Unable to initialize the finance monitor: {str(e)}"

@mcp.tool()
async def execute_friday_skill(name: str, params: dict = {}) -> dict:
    """
    Execute one of Friday's JS skills (e.g. 'gmail', 'trading', 'search', 'memory', 'analyst', 'legal').
    Pass parameters as a key-value dictionary.
    """
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            res = await client.post(f"http://localhost:5000/api/skills/execute/{name}", json=params)
            return res.json()
        except Exception as e:
            return {"success": False, "error": f"Failed to connect to Friday's core server: {str(e)}"}

@mcp.tool()
async def get_trading_portfolio() -> dict:
    """Retrieve the paper portfolio asset balances and trading performance logs."""
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            res = await client.get("http://localhost:5000/api/trading/portfolio")
            return res.json()
        except Exception as e:
            return {"success": False, "error": str(e)}

@mcp.tool()
async def get_soul_state() -> dict:
    """Get F.R.I.D.A.Y.'s current consciousness soul state, user emotion history, and lessons."""
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            res = await client.get("http://localhost:5000/api/soul/status")
            return res.json()
        except Exception as e:
            return {"success": False, "error": str(e)}

if __name__ == "__main__":
    mcp.run(transport="sse")
