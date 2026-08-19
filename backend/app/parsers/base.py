from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ParsedDocument:
    """解析后的文档统一格式"""

    content: str  # 提取的全部文本内容
    metadata: dict = field(default_factory=dict)  # 元数据(页数、作者、标题等)
    sections: list[dict] = field(default_factory=list)  # 分节内容 [{title, content, page/slide_number}]
    file_type: str = ""  # 文件类型标识


class BaseParser(ABC):
    """文档解析器基类"""

    @abstractmethod
    def supported_extensions(self) -> list[str]:
        """返回支持的文件扩展名列表"""
        ...

    @abstractmethod
    async def parse(self, file_path: Path) -> ParsedDocument:
        """解析文件并返回结构化结果"""
        ...

    def can_parse(self, file_path: Path) -> bool:
        """检查是否能解析该文件"""
        return file_path.suffix.lower() in self.supported_extensions()

    @staticmethod
    def clean_text(text: str) -> str:
        """清洗文本：去除多余空白行、标准化换行符"""
        # 标准化换行符
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        # 去除每行尾部空白
        lines = [line.rstrip() for line in text.split("\n")]
        # 合并连续空白行为单个空行
        cleaned_lines: list[str] = []
        prev_blank = False
        for line in lines:
            if line == "":
                if not prev_blank:
                    cleaned_lines.append("")
                prev_blank = True
            else:
                cleaned_lines.append(line)
                prev_blank = False
        # 去除首尾空白行
        while cleaned_lines and cleaned_lines[0] == "":
            cleaned_lines.pop(0)
        while cleaned_lines and cleaned_lines[-1] == "":
            cleaned_lines.pop()
        return "\n".join(cleaned_lines)
