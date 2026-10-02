#!/usr/bin/env python3
# Genera las texturas del overlay de vision del rojo (fuente bitmap del pack).
# El tamano REAL en pantalla lo fija el campo "height" declarado del font
# (height en unidades de GUI -> x GUI scale en px). Por eso la celda es
# chica (128x128, lo que banca el atlas) y el "height" es el que agranda.
#   U+E120 = tile rojo (tinte sangre translucido)
#   U+E121 = tile negro (opaco: esa parte no se ve)
import json, os
from PIL import Image

CELL = 128           # tamano de celda en la textura (atlas-safe)
DECL_HEIGHT = 480    # "height" declarado del font: 480 unidades ~ pantalla completa
RED   = (150, 10, 10, 115)   # tinte sangre translucido (ajustable)
BLACK = (0, 0, 0, 255)       # negro opaco

out_dir = os.path.dirname(os.path.abspath(__file__))
img = Image.new("RGBA", (CELL * 2, CELL))
img.paste(Image.new("RGBA", (CELL, CELL), RED), (0, 0))
img.paste(Image.new("RGBA", (CELL, CELL), BLACK), (CELL, 0))
png_path = os.path.join(out_dir, "overlay.png")
img.save(png_path)

# Chars por codigo -> los bytes salen SIEMPRE correctos, sin depender del editor
CHARS = chr(0xE120) + chr(0xE121)
font = {
    "providers": [
        {
            "type": "bitmap",
            "file": "invalimon:font/overlay.png",
            "ascent": int(DECL_HEIGHT * 0.7),
            "height": DECL_HEIGHT,
            "chars": [CHARS],
        }
    ]
}
json_path = os.path.join(out_dir, "overlay.json")
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(font, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("ok:", png_path, "+", json_path)
print("chars:", [hex(ord(c)) for c in CHARS], "| height:", DECL_HEIGHT)
