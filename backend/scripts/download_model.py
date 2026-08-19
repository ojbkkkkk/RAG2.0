"""预下载 BGE-M3 模型到本地缓存"""

from __future__ import annotations

import sys
from pathlib import Path

# 确保 backend 目录在 sys.path 中
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def download_model() -> None:
    print("正在下载 BGE-M3 模型（约2.2GB），首次下载可能需要几分钟...")
    print("模型将缓存到 ~/.cache/huggingface/ 目录")

    try:
        from FlagEmbedding import BGEM3FlagModel

        model = BGEM3FlagModel("BAAI/bge-m3", use_fp16=True)

        # 测试编码
        test_result = model.encode(
            ["测试文本"],
            return_dense=True,
            return_sparse=True,
            return_colbert_vecs=False,
        )
        dense_dim = len(test_result["dense_vecs"][0])
        print(f"✅ 模型下载并加载成功！")
        print(f"   Dense向量维度: {dense_dim}")
        print(f"   模型缓存位置: ~/.cache/huggingface/hub/models--BAAI--bge-m3/")
    except Exception as e:
        print(f"❌ 模型下载失败: {e}")
        print("请检查网络连接，或手动下载模型")
        sys.exit(1)


if __name__ == "__main__":
    download_model()
