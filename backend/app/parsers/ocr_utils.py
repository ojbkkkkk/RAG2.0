"""OCR 工具模块

提供通用的 OCR 功能，被 image.py 和 pdf.py 共用。
优先使用 pytesseract（Tesseract OCR），不可用时 fallback 到 easyocr。
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
from enum import Enum
from functools import lru_cache

from PIL import Image

logger = logging.getLogger(__name__)


class OCREngine(str, Enum):
    TESSERACT = "tesseract"
    EASYOCR = "easyocr"


# ── Tesseract 可用性检测 ──────────────────────────────────────


@lru_cache(maxsize=1)
def is_tesseract_available() -> bool:
    """检测 Tesseract OCR 是否已安装并可用"""
    tesseract_cmd = shutil.which("tesseract")
    if tesseract_cmd is None:
        return False
    try:
        result = subprocess.run(
            [tesseract_cmd, "--version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.returncode == 0
    except Exception:
        return False


@lru_cache(maxsize=1)
def is_tesseract_lang_available(lang: str) -> bool:
    """检测 Tesseract 是否支持指定语言包"""
    if not is_tesseract_available():
        return False
    try:
        result = subprocess.run(
            ["tesseract", "--list-langs"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            return False
        available_langs = result.stdout.strip().split("\n")
        # 第一行是标题，跳过
        available_langs = [l.strip() for l in available_langs[1:] if l.strip()]
        # 支持多语言组合，如 "chi_sim+eng"
        required_langs = lang.split("+")
        return all(l in available_langs for l in required_langs)
    except Exception:
        return False


@lru_cache(maxsize=1)
def is_easyocr_available() -> bool:
    """检测 easyocr 是否已安装"""
    try:
        import easyocr  # noqa: F401

        return True
    except ImportError:
        return False


# ── 核心 OCR 函数 ─────────────────────────────────────────────


def _ocr_with_tesseract(image: Image.Image, lang: str = "chi_sim+eng") -> str:
    """使用 pytesseract 进行 OCR"""
    import pytesseract

    # 预处理：转为 RGB 模式（tesseract 要求）
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    # 确定可用语言
    if not is_tesseract_lang_available(lang):
        # 尝试仅英文
        if is_tesseract_lang_available("eng"):
            logger.warning(
                "Tesseract 语言包 '%s' 不可用，降级为 'eng'。"
                "安装中文支持: brew install tesseract-lang",
                lang,
            )
            lang = "eng"
        else:
            # 使用默认语言
            lang = None

    config = "--oem 3 --psm 6"  # LSTM 引擎，假设为统一文本块
    kwargs = {"config": config}
    if lang:
        kwargs["lang"] = lang

    text = pytesseract.image_to_string(image, **kwargs)
    return text


def _ocr_with_easyocr(image: Image.Image) -> str:
    """使用 easyocr 进行 OCR（fallback 方案）"""
    import easyocr
    import numpy as np

    # 全局缓存 reader 实例（模型加载较慢）
    if not hasattr(_ocr_with_easyocr, "_reader"):
        _ocr_with_easyocr._reader = easyocr.Reader(
            ["ch_sim", "en"],
            gpu=False,  # CPU 模式，避免 GPU 显存占用
        )

    reader = _ocr_with_easyocr._reader
    img_array = np.array(image)
    results = reader.readtext(img_array)

    # 按位置排序，拼接文本
    texts = [item[1] for item in sorted(results, key=lambda x: (x[0][0][1], x[0][0][0]))]
    return "\n".join(texts)


async def ocr_image(image: Image.Image, lang: str = "chi_sim+eng") -> tuple[str, OCREngine | None]:
    """对单张图片进行 OCR（异步包装）

    Args:
        image: PIL Image 对象
        lang: Tesseract 语言代码，默认中英文

    Returns:
        (提取的文本, 使用的引擎) — 如果都不可用，返回 (空字符串, None)
    """
    # 优先 tesseract
    if is_tesseract_available():
        try:
            text = await asyncio.to_thread(_ocr_with_tesseract, image, lang)
            return text, OCREngine.TESSERACT
        except Exception as e:
            logger.warning("Tesseract OCR 失败: %s，尝试 easyocr fallback", e)

    # Fallback 到 easyocr
    if is_easyocr_available():
        try:
            text = await asyncio.to_thread(_ocr_with_easyocr, image)
            return text, OCREngine.EASYOCR
        except Exception as e:
            logger.warning("EasyOCR 也失败: %s", e)

    # 两个引擎都不可用
    logger.error(
        "无可用的 OCR 引擎。请安装: brew install tesseract tesseract-lang "
        "或 pip install easyocr"
    )
    return "", None


async def ocr_pdf_pages(file_path, page_indices: list[int] | None = None) -> tuple[str, OCREngine | None]:
    """对 PDF 文件进行逐页 OCR

    使用 PyMuPDF 将每页渲染为图片后 OCR。

    Args:
        file_path: PDF 文件路径
        page_indices: 要 OCR 的页码索引列表（0-based），None 表示全部

    Returns:
        (提取的文本, 使用的引擎)
    """
    import fitz

    doc = fitz.open(str(file_path))
    try:
        total_pages = len(doc)
        if page_indices is None:
            page_indices = list(range(total_pages))

        all_texts: list[str] = []
        engine_used: OCREngine | None = None

        for page_idx in page_indices:
            if page_idx >= total_pages:
                continue
            page = doc[page_idx]
            # 渲染为图片（DPI 300，平衡精度和速度）
            pix = page.get_pixmap(dpi=300)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

            text, engine = await ocr_image(img)
            if text.strip():
                all_texts.append(text.strip())
            if engine is not None and engine_used is None:
                engine_used = engine

        return "\n\n".join(all_texts), engine_used
    finally:
        doc.close()
