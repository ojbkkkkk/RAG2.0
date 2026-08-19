"""MCP Server 入口点 — 支持 python -m mcp_server 运行"""

import asyncio

from .server import main

if __name__ == "__main__":
    asyncio.run(main())
