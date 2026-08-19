from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from .base import BaseParser, ParsedDocument
from .ocr_utils import ocr_pdf_pages, is_tesseract_available, is_easyocr_available

logger = logging.getLogger(__name__)

# OCR 降级阈值：文本少于该字符数时尝试 OCR
OCR_FALLBACK_THRESHOLD = 50


class PDFParser(BaseParser):
    """PDF 文档解析器（使用 PyMuPDF/fitz），扫描版自动 OCR 降级"""

    def supported_extensions(self) -> list[str]:
        return [".pdf"]

    async def parse(self, file_path: Path) -> ParsedDocument:
        """解析 PDF 文件，逐页提取文本；扫描版自动降级为 OCR"""
        try:
            result = await asyncio.to_thread(self._parse_sync, file_path)
        except ImportError:
            return ParsedDocument(
                content="",
                metadata={"error": "PyMuPDF 未安装，请运行: pip install PyMuPDF"},
                sections=[],
                file_type="pdf",
            )
        except Exception as e:
            return ParsedDocument(
                content="",
                metadata={"error": f"解析 PDF 失败: {e}"},
                sections=[],
                file_type="pdf",
            )

        # 检测是否需要 OCR 降级：内容为空或极短
        if not result.content.strip() or len(result.content.strip()) < OCR_FALLBACK_THRESHOLD:
            logger.info(
                "PDF 文本内容过短（%d 字符），尝试 OCR 降级: %s",
                len(result.content.strip()),
                file_path.name,
            )
            ocr_result = await self._ocr_fallback(file_path, result)
            if ocr_result is not None:
                return ocr_result

        return result

    async def _ocr_fallback(self, file_path: Path, original: ParsedDocument) -> ParsedDocument | None:
        """对扫描版 PDF 进行 OCR 降级处理"""
        # 检测 OCR 引擎可用性
        if not is_tesseract_available() and not is_easyocr_available():
            tesseract_hint = "brew install tesseract tesseract-lang" if not is_tesseract_available() else ""
            easyocr_hint = "pip install easyocr" if not is_easyocr_available() else ""
            hints = [h for h in [tesseract_hint, easyocr_hint] if h]
            logger.warning(
                "无可用的 OCR 引擎，无法处理扫描版 PDF。%s",
                "请安装: " + "; ".join(hints) if hints else "",
            )
            # 返回原始结果，但添加提示
            original.metadata["is_scanned"] = True
            original.metadata["ocr_available"] = False
            if hints:
                original.metadata["ocr_hint"] = "请安装: " + "; ".join(hints)
            original.content = "[此 PDF 为扫描版，无可提取文本。请安装 OCR 引擎以支持识别。]"
            return original

        try:
            ocr_text, engine = await ocr_pdf_pages(file_path)
        except Exception as e:
            logger.error("PDF OCR 失败: %s — %s", file_path.name, e)
            original.metadata["is_scanned"] = True
            original.metadata["ocr_available"] = True
            original.metadata["ocr_error"] = str(e)
            original.content = f"[此 PDF 为扫描版，OCR 处理失败: {e}]"
            return original

        if not ocr_text.strip():
            logger.warning("PDF OCR 后仍无文字内容: %s", file_path.name)
            original.metadata["is_scanned"] = True
            original.metadata["ocr_available"] = True
            original.metadata["ocr_engine"] = engine.value if engine else None
            original.metadata["ocr_used"] = True
            original.content = "[此 PDF 经 OCR 处理后仍未识别到文字内容。]"
            return original

        # OCR 成功，更新结果
        logger.info("PDF OCR 成功，提取 %d 字符，引擎: %s", len(ocr_text), engine)
        cleaned = self.clean_text(ocr_text)

        # 更新 sections
        sections = []
        page_texts = cleaned.split("\n\n")
        for i, page_text in enumerate(page_texts):
            if page_text.strip():
                sections.append({
                    "title": f"第 {i + 1} 页（OCR）",
                    "content": page_text.strip(),
                    "page_number": i + 1,
                })

        original.content = cleaned
        original.sections = sections
        original.metadata["is_scanned"] = True
        original.metadata["ocr_available"] = True
        original.metadata["ocr_used"] = True
        original.metadata["ocr_engine"] = engine.value if engine else None
        return original

    def _parse_sync(self, file_path: Path) -> ParsedDocument:
        """同步解析 PDF"""
        import fitz  # PyMuPDF

        doc = fitz.open(str(file_path))
        try:
            page_count = len(doc)
            metadata = self._extract_metadata(doc, page_count, file_path)

            all_text_parts: list[str] = []
            sections: list[dict] = []

            for page_num in range(page_count):
                page = doc[page_num]
                page_text = page.get_text("text")
                cleaned = self.clean_text(page_text)

                if cleaned:
                    all_text_parts.append(cleaned)
                    sections.append({
                        "title": f"第 {page_num + 1} 页",
                        "content": cleaned,
                        "page_number": page_num + 1,
                    })

            content = "\n\n".join(all_text_parts)

            return ParsedDocument(
                content=content,
                metadata=metadata,
                sections=sections,
                file_type="pdf",
            )
        finally:
            doc.close()

    @staticmethod
    def _extract_metadata(doc, page_count: int, file_path: Path) -> dict:
        """提取 PDF 元数据"""
        metadata: dict = {
            "page_count": page_count,
            "file_name": file_path.name,
        }

        try:
            pdf_metadata = doc.metadata
            if pdf_metadata:
                if pdf_metadata.get("title"):
                    metadata["title"] = pdf_metadata["title"]
                if pdf_metadata.get("author"):
                    metadata["author"] = pdf_metadata["author"]
                if pdf_metadata.get("creationDate"):
                    metadata["creation_date"] = pdf_metadata["creationDate"]
                if pdf_metadata.get("modDate"):
                    metadata["modification_date"] = pdf_metadata["modDate"]
                if pdf_metadata.get("subject"):
                    metadata["subject"] = pdf_metadata["subject"]
        except Exception:
            pass

        return metadata
