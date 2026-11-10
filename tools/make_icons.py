"""Draws the extension icons (the character 中 on a red rounded square).

Needs matplotlib and a CJK font; on Windows that is Microsoft YaHei.
Usage: python tools/make_icons.py
"""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.font_manager import FontProperties  # noqa: E402
from matplotlib.patches import FancyBboxPatch  # noqa: E402

FONT = FontProperties(fname=r"C:\Windows\Fonts\msyhbd.ttc")
OUT = Path(__file__).resolve().parent.parent / "icons"


def draw(size: int) -> None:
    fig = plt.figure(figsize=(1, 1), dpi=size)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.add_patch(
        FancyBboxPatch(
            (0.04, 0.04), 0.92, 0.92,
            boxstyle="round,pad=0,rounding_size=0.2", linewidth=0, facecolor="#b3261e",
        )
    )
    ax.text(0.5, 0.47, "中", fontproperties=FONT, fontsize=50, color="white",
            ha="center", va="center")
    fig.savefig(OUT / f"icon{size}.png", transparent=True)
    plt.close(fig)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for size in (16, 48, 128):
        draw(size)
    print(f"icons written to {OUT}")
