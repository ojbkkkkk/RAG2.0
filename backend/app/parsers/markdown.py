from __future__ import annotations

import asyncio
import re
from pathlib import Path

from .base import BaseParser, ParsedDocument


class MarkdownParser(BaseParser):
    """Markdown 文档解析器"""

    HEADING_PATTERN = re.compile(r"^(#{1,2})\s+(.+)$", re.MULTILINE)

    def supported_extensions(self) -> list[str]:
        return [".md", ".markdown"]

    async def parse(self, file_path: Path) -> ParsedDocument:
        """解析 Markdown 文件，保留原始格式，按标题分节"""
        try:
            raw_content = await self._read_file(file_path)
        except Exception as e:
            return ParsedDocument(
                content="",
                metadata={"error": f"读取文件失败: {e}"},
                sections=[],
                file_type="markdown",
            )

        content = self.clean_text(raw_content)
        title = self._extract_title(content)
        word_count = len(content)

        metadata: dict = {
            "title": title,
            "word_count": word_count,
            "file_name": file_path.name,
        }

        sections = self._split_sections(content)

        return ParsedDocument(
            content=content,
            metadata=metadata,
            sections=sections,
            file_type="markdown",
        )

    async def _read_file(self, file_path: Path) -> str:
        """异步读取文件内容，处理编码问题"""
        return await asyncio.to_thread(self._read_sync, file_path)

    @staticmethod
    def _read_sync(file_path: Path) -> str:
        """同步读取文件，尝试多种编码"""
        encodings = ["utf-8", "utf-8-sig", "gbk", "gb2312", "latin-1"]
        for enc in encodings:
            try:
                return file_path.read_text(encoding=enc)
            except (UnicodeDecodeError, UnicodeError):
                continue
        # 最后使用 errors='replace' 强制读取
        return file_path.read_text(encoding="utf-8", errors="replace")

    def _extract_title(self, content: str) -> str:
        """提取第一个 # 标题作为文档标题"""
        match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
        if match:
            return match.group(1).strip()
        return ""

    def _split_sections(self, content: str) -> list[dict]:
        """按一级和二级标题分节"""
        sections: list[dict] = []
        lines = content.split("\n")
        current_title = ""
        current_lines: list[str] = []

        for line in lines:
            heading_match = re.match(r"^(#{1,2})\s+(.+)$", line)
            if heading_match:
                # 保存前一个 section
                if current_lines or current_title:
                    section_content = self.clean_text("\n".join(current_lines))
                    if section_content or current_title:
                        sections.append({
                            "title": current_title,
                            "content": section_content,
                        })
                current_title = heading_match.group(2).strip()
                current_lines = []
            else:
                current_lines.append(line)

        # 保存最后一个 section
        if current_lines or current_title:
            section_content = self.clean_text("\n".join(current_lines))
            if section_content or current_title:
                sections.append({
                    "title": current_title,
                    "content": section_content,
                })

        # 如果没有任何标题，将整个内容作为一个 section
        if not sections and content.strip():
            sections.append({
                "title": "",
                "content": content,
            })

        return sections
