#!/usr/bin/env python3
# Genera las texturas del overlay de vision del rojo (fuente bitmap del pack).
# El tamano REAL en pantalla lo fija el campo "height" declarado del font
# (height en unidades de GUI -> x GUI scale en px).
# El tile mapea ~a la pantalla completa (columna de 480 unidades de alto):
#   - base roja translucida
#   - bordes negros arriba/abajo con degradado (estilo vinyeta/letterbox)
#   U+E120 = rojo | U+E121 = blackout (base roja + velo negro semi encima)
# OJO: la capa title renderiza DEBAJO del HUD — hotbar/corazones/minimapa
# se siguen viendo a color pleno durante la vision (limitacion de vanilla).
import json, os
from PIL import Image

CELL = 128           # tamano de celda en la textura (atlas-safe)
DECL_HEIGHT = 480    # "height" declarado del font: 480 unidades ~ pantalla completa
RED   = (150, 10, 10, 95)    # tinte sangre translucido (95 = "un poco mas transparente", pedido del user)

# negro SEMI ENCIMA del rojo (elegido por el user 2026-10-02): el blackout
# es la MISMA base roja con un velo negro translucido arriba — se intuye
# el rojo oscurecido debajo en vez de un corte a negro pleno.
# 175 = tapa de verdad (con 130 el user lo veia "rojo, no negro").
BLACKOUT_ALPHA = 175

# bordes negros arriba/abajo (dentro del tile)
SOLID = 9            # filas solidas en el borde
FADE = 15            # filas de degradado hacia el centro
BORDER_ALPHA = 200   # opacidad del borde solido

out_dir = os.path.dirname(os.path.abspath(__file__))


def make_tile(blackout: bool) -> Image.Image:
    t = Image.new("RGBA", (CELL, CELL), RED)
    # bordes negros con degradado (arriba y abajo) — comunes a ambos tiles
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
    if blackout:
        # velo negro semi-transparente SOBRE la base roja
        veil = Image.new("RGBA", (CELL, CELL), (0, 0, 0, BLACKOUT_ALPHA))
        t = Image.alpha_composite(t, veil)
        # transicion suave en el borde izquierdo (contra el tile rojo vecino)
        px = t.load()
        for x in range(5):
            for y in range(CELL):
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, int(a * x / 5))
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
