"""图片文件解析器

通过 OCR 提取图片中的文字内容，支持 jpg/png/bmp/tiff/webp 等格式。
优先使用 pytesseract，不可用时 fallback 到 easyocr。
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from PIL import Image

from .base import BaseParser, ParsedDocument
from .ocr_utils import ocr_image, is_tesseract_available, is_easyocr_available

logger = logging.getLogger(__name__)


class ImageParser(BaseParser):
    """图片文件解析器（基于 OCR）"""

    def supported_extensions(self) -> list[str]:
        return [".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"]

    async def parse(self, file_path: Path) -> ParsedDocument:
        """解析图片文件，使用 OCR 提取文字

        重写基类方法，直接在异步中执行 OCR。
        """
        try:
            # 1. 加载图片并提取基础 metadata
            img = await asyncio.to_thread(Image.open, str(file_path))
            await asyncio.to_thread(img.load)

            metadata: dict = {
                "file_name": file_path.name,
                "image_format": img.format or file_path.suffix.lstrip("."),
                "image_size": f"{img.width}x{img.height}",
                "image_width": img.width,
                "image_height": img.height,
                "image_mode": img.mode,
            }

            # 2. OCR 提取文字
            text, engine = await ocr_image(img)

            if engine is None:
                # 两个 OCR 引擎都不可用
                tesseract_hint = "brew install tesseract tesseract-lang" if not is_tesseract_available() else ""
                easyocr_hint = "pip install easyocr" if not is_easyocr_available() else ""
                hints = [h for h in [tesseract_hint, easyocr_hint] if h]
                error_msg = "无可用的 OCR 引擎，无法提取图片中的文字。"
                if hints:
                    error_msg += f" 请安装: {'; '.join(hints)}"

                return ParsedDocument(
                    content="",
                    metadata={**metadata, "error": error_msg, "ocr_available": False},
                    sections=[],
                    file_type="image",
                )

            # 3. 清洗文本
            cleaned = self.clean_text(text)
            metadata["ocr_engine"] = engine.value
            metadata["ocr_available"] = True

            if not cleaned.strip():
                metadata["warning"] = "OCR 未识别到文字内容，图片可能不包含文字"

            # 4. 构建结果
            sections = []
            if cleaned.strip():
                sections.append({
                    "title": "OCR 识别结果",
                    "content": cleaned,
                })

            return ParsedDocument(
                content=cleaned,
                metadata=metadata,
                sections=sections,
                file_type="image",
            )

        except Exception as e:
            logger.error("解析图片失败: %s — %s", file_path.name, e)
            return ParsedDocument(
                content="",
                metadata={"error": f"解析图片失败: {e}"},
                sections=[],
                file_type="image",
            )
