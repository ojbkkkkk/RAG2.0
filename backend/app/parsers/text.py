from __future__ import annotations

import asyncio
import json
from pathlib import Path

from .base import BaseParser, ParsedDocument


class TextParser(BaseParser):
    """纯文本/CSV/TSV/LOG/JSON 解析器"""

    def supported_extensions(self) -> list[str]:
        return [".txt", ".csv", ".tsv", ".log", ".json"]

    async def parse(self, file_path: Path) -> ParsedDocument:
        """解析文本类文件"""
        suffix = file_path.suffix.lower()

        try:
            if suffix == ".csv":
                return await self._parse_csv(file_path, delimiter=",")
            elif suffix == ".tsv":
                return await self._parse_csv(file_path, delimiter="\t")
            elif suffix == ".json":
                return await self._parse_json(file_path)
            else:
                # .txt, .log
                return await self._parse_plain(file_path)
        except Exception as e:
            return ParsedDocument(
                content="",
                metadata={"error": f"解析文件失败: {e}", "file_name": file_path.name},
                sections=[],
                file_type=suffix.lstrip("."),
            )

    async def _parse_plain(self, file_path: Path) -> ParsedDocument:
        """解析纯文本文件"""
        raw_content = await asyncio.to_thread(self._read_file, file_path)
        content = self.clean_text(raw_content)

        metadata: dict = {
            "line_count": content.count("\n") + 1 if content else 0,
            "word_count": len(content),
            "file_name": file_path.name,
            "encoding": "utf-8",
        }

        sections: list[dict] = []
        if content.strip():
            sections.append({
                "title": "",
                "content": content,
            })

        return ParsedDocument(
            content=content,
            metadata=metadata,
            sections=sections,
            file_type=file_path.suffix.lstrip("."),
        )

    async def _parse_csv(self, file_path: Path, delimiter: str) -> ParsedDocument:
        """解析 CSV/TSV 文件（使用 pandas）"""
        try:
            content = await asyncio.to_thread(self._read_csv_sync, file_path, delimiter)
        except ImportError:
            # pandas 未安装，退回纯文本解析
            return await self._parse_plain(file_path)

        metadata: dict = {
            "line_count": content.count("\n") + 1 if content else 0,
            "word_count": len(content),
            "file_name": file_path.name,
            "encoding": "utf-8",
        }

        sections: list[dict] = []
        if content.strip():
            sections.append({
                "title": "",
                "content": content,
            })

        return ParsedDocument(
            content=content,
            metadata=metadata,
            sections=sections,
            file_type=file_path.suffix.lstrip("."),
        )

    async def _parse_json(self, file_path: Path) -> ParsedDocument:
        """解析 JSON 文件，格式化后作为文本"""
        raw_content = await asyncio.to_thread(self._read_file, file_path)

        try:
            data = json.loads(raw_content)
            content = json.dumps(data, indent=2, ensure_ascii=False)
        except json.JSONDecodeError:
            # JSON 解析失败，作为纯文本返回
            content = raw_content

        content = self.clean_text(content)

        metadata: dict = {
            "line_count": content.count("\n") + 1 if content else 0,
            "word_count": len(content),
            "file_name": file_path.name,
            "encoding": "utf-8",
        }

        sections: list[dict] = []
        if content.strip():
            sections.append({
                "title": "",
                "content": content,
            })

        return ParsedDocument(
            content=content,
            metadata=metadata,
            sections=sections,
            file_type="json",
        )

    @staticmethod
    def _read_file(file_path: Path) -> str:
        """读取文件，处理编码问题"""
        encodings = ["utf-8", "utf-8-sig", "gbk", "gb2312", "latin-1"]
        for enc in encodings:
            try:
                return file_path.read_text(encoding=enc)
            except (UnicodeDecodeError, UnicodeError):
                continue
        return file_path.read_text(encoding="utf-8", errors="replace")

    @staticmethod
    def _read_csv_sync(file_path: Path, delimiter: str) -> str:
        """同步读取 CSV/TSV 文件并转为可读文本"""
        import pandas as pd

        encodings = ["utf-8", "utf-8-sig", "gbk", "gb2312", "latin-1"]
        df = None

        for enc in encodings:
            try:
                df = pd.read_csv(file_path, delimiter=delimiter, encoding=enc)
                break
            except (UnicodeDecodeError, UnicodeError):
                continue
            except Exception:
                break

        if df is None:
            df = pd.read_csv(file_path, delimiter=delimiter, encoding="utf-8", errors="replace")

        # 转为可读的文本格式
        return df.to_string(index=False)
