"""多格式文档解析器模块

提供统一的文档解析接口，支持 Markdown、PDF、DOCX、PPTX、纯文本、图片等格式。
"""

from __future__ import annotations

from pathlib import Path

from .base import BaseParser, ParsedDocument
from .markdown import MarkdownParser
from .pdf import PDFParser
from .docx_parser import DocxParser
from .pptx_parser import PptxParser
from .text import TextParser
from .image import ImageParser

# 解析器注册表
_parsers: list[BaseParser] = [
    MarkdownParser(),
    PDFParser(),
    DocxParser(),
    PptxParser(),
    TextParser(),
    ImageParser(),
]


def get_parser(file_path: Path) -> BaseParser | None:
    """根据文件类型获取合适的解析器"""
    for parser in _parsers:
        if parser.can_parse(file_path):
            return parser
    return None


def supported_extensions() -> list[str]:
    """返回所有支持的文件扩展名"""
    extensions: list[str] = []
    for parser in _parsers:
        extensions.extend(parser.supported_extensions())
    return extensions


__all__ = [
    "BaseParser",
    "ParsedDocument",
    "MarkdownParser",
    "PDFParser",
    "DocxParser",
    "PptxParser",
    "TextParser",
    "ImageParser",
    "get_parser",
    "supported_extensions",
]
