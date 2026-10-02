#!/usr/bin/env python3
# Genera las texturas del overlay de vision del rojo (fuente bitmap del pack).
# El tamano REAL en pantalla lo fija el campo "height" declarado del font
# (height en unidades de GUI -> x GUI scale en px).
# El tile mapea ~a la pantalla completa (columna de 480 unidades de alto):
#   - base roja translucida
#   - bordes negros arriba/abajo con degradado (estilo vinyeta/letterbox)
#   U+E120 = rojo | U+E121 = rojo con MITAD DERECHA negra (blackout)
import json, os
from PIL import Image

CELL = 128           # tamano de celda en la textura (atlas-safe)
DECL_HEIGHT = 480    # "height" declarado del font: 480 unidades ~ pantalla completa
RED   = (150, 10, 10, 115)   # tinte sangre translucido
BLACK = (0, 0, 0, 255)       # negro opaco

# bordes negros arriba/abajo (dentro del tile)
SOLID = 9            # filas solidas en el borde
FADE = 15            # filas de degradado hacia el centro
BORDER_ALPHA = 200   # opacidad del borde solido

out_dir = os.path.dirname(os.path.abspath(__file__))


def make_tile(blackout: bool) -> Image.Image:
    if blackout:
        # tile NEGRO PURO (con un mini degradado en el borde izquierdo para
        # que el corte contra el rojo no sea tan duro). OJO: el tile entero
        # debe ser negro — con tiles anchos, cualquier parte roja de este
        # gajo tapa la pantalla a la derecha del centro.
        t = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 255))
        for x in range(4):  # ~2% del ancho: transicion suave
            a = int(255 * x / 4)
            for y in range(CELL):
                t.putpixel((x, y), (0, 0, 0, a))
        return t
    t = Image.new("RGBA", (CELL, CELL), RED)
    # bordes negros con degradado (arriba y abajo)
    px = t.load()
    for i in range(SOLID + FADE):
        if i < SOLID:
            alpha = BORDER_ALPHA
        else:
            alpha = int(BORDER_ALPHA * (1 - (i - SOLID) / FADE))
        for x in range(CELL):
            for y in (i, CELL - 1 - i):
                r, g, b, a = px[x, y]
                px[x, y] = (max(0, r - 150), max(0, g - 10), max(0, b - 10), min(255, a + alpha))
    return t


img = Image.new("RGBA", (CELL * 2, CELL))
img.paste(make_tile(False), (0, 0))
img.paste(make_tile(True), (CELL, 0))
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
